import { Rocket } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BoostCampaign, BoostPosition, BoostSlotDay } from "@/models";
import { NON_TERMINAL_BOOST_CAMPAIGN_STATUSES } from "@/models/boostCampaign.model";
import { BOOST_CAMPAIGN_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { Card, CardContent } from "@/components/ui/card";
import {
  BoostPositionsLadder,
  type BoostPositionRow,
} from "@/components/admin/boost-positions-ladder";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { addDays, utcDay } from "@/lib/boosts/boost-days";
import { getSponsoredPlacementDepths } from "@/lib/boosts/sponsored-products";
import { getPositionDeliveryAverages } from "@/lib/boosts/boosts";
import type { LadderDay } from "@/lib/boosts/boost-ladder-track";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Widest window the strip offers, so one aggregation serves 30/60/90. */
const OCCUPANCY_WINDOW_DAYS = 90;

export default async function AdminBoostPositionsPage({ params }: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const boostingEnabled = Boolean(
    settings.multiVendorMode?.enabled && settings.boosting?.enabled,
  );

  if (!boostingEnabled) {
    const tSafe = (key: string, fallback: string) => {
      try {
        const value = t(key);
        return value === key ? fallback : value;
      } catch {
        return fallback;
      }
    };
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-2 py-10">
            <Rocket className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {tSafe("boosts.disabled.title", "Product boosting is off")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "boosts.disabled.positions",
                "Enable boosting in Settings → Product Boosting to manage the position ladder.",
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const today = utcDay();
  const horizon = addDays(today, OCCUPANCY_WINDOW_DAYS);

  // ONE aggregation for the whole screen. Per-card fetches would turn a ten-rung
  // ladder into ten round trips for data that comes from a single index range.
  const [positions, occupancy, depths, delivery, bookedFromToday, claimedRungIds] =
    await Promise.all([
      BoostPosition.find().sort({ position: 1 }).lean(),
      BoostSlotDay.aggregate<{ _id: number; days: LadderDay[] }>([
        { $match: { day: { $gte: today, $lt: horizon } } },
        {
          $lookup: {
            from: "vendors",
            localField: "vendorId",
            foreignField: "_id",
            as: "vendor",
            pipeline: [{ $project: { storeName: 1 } }],
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "productId",
            foreignField: "_id",
            as: "product",
            pipeline: [{ $project: { name: 1 } }],
          },
        },
        // The booking behind each day: its id lets the track merge a run of
        // days into one segment that links to the booking, and its status
        // tells a paid day from an unpaid checkout that may still let go.
        {
          $lookup: {
            from: "boostcampaigns",
            localField: "campaignId",
            foreignField: "_id",
            as: "campaign",
            pipeline: [{ $project: { status: 1 } }],
          },
        },
        {
          $group: {
            _id: "$position",
            days: {
              $push: {
                day: "$day",
                store: { $ifNull: [{ $first: "$vendor.storeName" }, ""] },
                product: { $ifNull: [{ $first: "$product.name" }, ""] },
                campaignId: { $toString: "$campaignId" },
                hold: {
                  $eq: [
                    { $first: "$campaign.status" },
                    BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
                  ],
                },
              },
            },
          },
        },
      ]),
      getSponsoredPlacementDepths(),
      // The evidence base for the ladder's price. Without it the first vendor to
      // ask how Position 1 compares with Position 3 opens a ticket nobody can
      // answer, and the admin re-prices on instinct.
      getPositionDeliveryAverages(),
      // The two checks DELETE /api/admin/boosts/positions/[id] refuses on, asked
      // up front so the menu can say why before the admin confirms anything.
      BoostSlotDay.distinct("position", { day: { $gte: today } }),
      BoostCampaign.distinct("positionId", {
        status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
      }),
    ]);

  const bookedByPosition = new Map(occupancy.map((row) => [row._id, row.days]));
  const bookedRungs = new Set<number>(bookedFromToday as number[]);
  const claimedRungs = new Set(claimedRungIds.map((id) => String(id)));

  const rows: BoostPositionRow[] = positions.map((p) => ({
    _id: String(p._id),
    position: p.position,
    label: p.label,
    description: p.description ?? "",
    pricePerDay: p.pricePerDay ?? 0,
    currency: p.currency,
    status: p.status,
    bookedDays: (bookedByPosition.get(p.position) ?? []).sort((a, b) =>
      a.day.localeCompare(b.day),
    ),
    avgImpressionsPerDay: delivery[p.position] ?? null,
    deleteBlocked: bookedRungs.has(p.position)
      ? "booked"
      : claimedRungs.has(String(p._id))
        ? "claimed"
        : null,
  }));

  const placements = settings.boosting?.placements;

  return (
    <BoostPositionsLadder
      locale={locale}
      positions={rows}
      today={today}
      depths={depths}
      placementsEnabled={{
        home: placements?.home !== false,
        listing: placements?.listing !== false,
        productPage: placements?.productPage !== false,
      }}
      storeCurrency={settings.general?.defaultCurrency || "USD"}
      horizonDays={Math.min(
        OCCUPANCY_WINDOW_DAYS,
        settings.boosting?.bookingHorizonDays ?? 60,
      )}
    />
  );
}
