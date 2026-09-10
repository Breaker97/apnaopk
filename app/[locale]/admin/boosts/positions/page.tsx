import { Rocket } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BoostPosition, BoostSlotDay } from "@/models";
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

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Widest window the strip offers, so one aggregation serves 30/60/90. */
const OCCUPANCY_WINDOW_DAYS = 90;

export default async function AdminBoostPositionsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const boostingEnabled = Boolean(
    settings.multiVendorMode?.enabled && settings.boosting?.enabled,
  );

  if (!boostingEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-2 py-10">
            <Rocket className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Product boosting is off</h2>
            <p className="text-sm text-muted-foreground">
              Enable boosting in Settings → Product Boosting to manage the
              position ladder.
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
  const [positions, occupancy, depths, delivery] = await Promise.all([
    BoostPosition.find().sort({ position: 1 }).lean(),
    BoostSlotDay.aggregate<{ _id: number; days: Array<{ day: string; store: string; product: string }> }>([
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
      {
        $group: {
          _id: "$position",
          days: {
            $push: {
              day: "$day",
              store: { $ifNull: [{ $first: "$vendor.storeName" }, ""] },
              product: { $ifNull: [{ $first: "$product.name" }, ""] },
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
  ]);

  const bookedByPosition = new Map(occupancy.map((row) => [row._id, row.days]));

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
  }));

  return (
    <BoostPositionsLadder
      positions={rows}
      today={today}
      depths={depths}
      storeCurrency={settings.general?.defaultCurrency || "USD"}
      horizonDays={Math.min(
        OCCUPANCY_WINDOW_DAYS,
        settings.boosting?.bookingHorizonDays ?? 60,
      )}
    />
  );
}
