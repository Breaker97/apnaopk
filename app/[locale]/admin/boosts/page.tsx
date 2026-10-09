import { Suspense } from "react";
import {
  CalendarClock,
  CircleDollarSign,
  Eye,
  Receipt,
  Rocket,
} from "lucide-react";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BoostCampaign, BoostPosition, Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import { Card, CardContent } from "@/components/ui/card";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { BoostCampaignsContent } from "@/components/admin/boost-campaigns-content";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { BOOST_CAMPAIGN_STATUS } from "@/config/app.config";
import { parsePageQuery } from "@/lib/api/validate";
import { BoostCampaignListQuerySchema } from "@/lib/validations";
import { fetchBoostCampaignList } from "@/lib/boosts/boost-campaign-list";
import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminBoostsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const boostingEnabled = Boolean(
    settings.multiVendorMode?.enabled && settings.boosting?.enabled,
  );

  const tSafe = (key: string, fallback: string) => {
    try {
      const value = t(key);
      return value === key ? fallback : value;
    } catch {
      return fallback;
    }
  };

  if (!boostingEnabled) {
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
                "boosts.disabled.campaigns",
                "Enable boosting in Settings → Product Boosting to sell sponsored placements to vendors.",
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const storeCurrency = (settings.general?.defaultCurrency || "USD").toUpperCase();
  const money = (amount: number) =>
    formatCurrency(amount, storeCurrency, resolveCurrency(storeCurrency).locale);

  const stats = await getBoostStats(storeCurrency);
  const statItems: AdminStatsStripItem[] = [
    {
      title: tSafe("boosts.stats.active", "Active boosts"),
      value: stats.active,
      description: tSafe("boosts.stats.activeDescription", "Live right now"),
      icon: <Rocket className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: tSafe("boosts.stats.upcoming", "Upcoming"),
      value: stats.scheduled,
      description: tSafe(
        "boosts.stats.upcomingDescription",
        "Booked, not started",
      ),
      icon: <CalendarClock className="h-5 w-5" />,
      iconClassName: "text-sky-700 bg-sky-100",
    },
    {
      // A bare number here is a number in no currency at all, and summing two
      // currencies into it says something false in both. The store's own
      // currency is totalled; anything booked in another is named, not added.
      title: tSafe("boosts.stats.revenue", "Boost revenue"),
      value: money(stats.revenue),
      description: stats.otherCurrencies.length
        ? `${tSafe("boosts.stats.revenueDescription", "Paid bookings less refunds, all time")} · ${tSafe("boosts.stats.otherCurrencies", "excludes")} ${stats.otherCurrencies.join(", ")}`
        : tSafe(
            "boosts.stats.revenueDescription",
            "Paid bookings less refunds, all time",
          ),
      icon: <CircleDollarSign className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      // The queue that costs money while nobody looks at it: a released day is
      // an obligation until a human settles it at the gateway, and until now
      // the only way to see one was to open a row's action menu.
      title: tSafe("boosts.stats.creditOwed", "Credit owed"),
      value: money(stats.creditOwed),
      description: stats.creditCount
        ? `${stats.creditCount} ${tSafe("boosts.stats.creditOwedDescription", "bookings to settle")}`
        : tSafe("boosts.stats.creditOwedNone", "nothing outstanding"),
      icon: <Receipt className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      // CTR is a fraction of these same views, so it rides under them rather
      // than taking a sixth cell of its own.
      title: tSafe("boosts.stats.impressions", "Impressions"),
      value: stats.impressions.toLocaleString(),
      description: stats.impressions
        ? `${tSafe("boosts.stats.ctrDescription", "Click-through rate")} ${((stats.clicks / stats.impressions) * 100).toFixed(1)}%`
        : tSafe(
            "boosts.stats.impressionsDescription",
            "Sponsored views, all time",
          ),
      icon: <Eye className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      {/* The list is fetched inside the boundary, not awaited above it — a
          Suspense wrapper around already-resolved props can never show its
          fallback. Compare app/[locale]/admin/discounts/page.tsx. */}
      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={9} tabs={8} thumbnail />
        }
      >
        <BoostCampaignsSection locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function BoostCampaignsSection({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [list, vendorOptions, positionOptions] = await Promise.all([
    fetchBoostCampaignList(
      parsePageQuery(searchParams, BoostCampaignListQuerySchema),
    ),
    // Sellers who have actually booked, not every approved vendor: the filter
    // exists to narrow this table, and a store with no bookings narrows it to
    // nothing.
    listBoostVendorOptions(),
    listBoostPositionOptions(),
  ]);

  return (
    <BoostCampaignsContent
      locale={locale}
      data={list.items}
      vendorOptions={vendorOptions}
      positionOptions={positionOptions}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
    />
  );
}

async function listBoostVendorOptions() {
  await connectDB();
  const vendorIds = await BoostCampaign.distinct("vendorId");
  if (vendorIds.length === 0) return [];
  const vendors = await Vendor.find({ _id: { $in: vendorIds } })
    .select("storeName")
    .sort({ storeName: 1 })
    .lean<Array<{ _id: unknown; storeName?: string }>>();
  return vendors.map((vendor) => ({
    value: String(vendor._id),
    label: vendor.storeName || String(vendor._id),
  }));
}

/**
 * Every rung on the ladder plus every number a booking was ever sold at. The
 * ladder's "View bookings" links here with `?position=N`, so a rung with no
 * bookings yet still has to be a value the select can show.
 */
async function listBoostPositionOptions() {
  await connectDB();
  const [rungs, sold] = await Promise.all([
    BoostPosition.find()
      .select("position label")
      .lean<Array<{ position: number; label?: string }>>(),
    BoostCampaign.distinct("positionSnapshot.position"),
  ]);
  const labels = new Map(rungs.map((rung) => [rung.position, rung.label ?? ""]));
  const numbers = new Set<number>([
    ...rungs.map((rung) => rung.position),
    ...(sold as number[]).filter((n) => Number.isInteger(n) && n > 0),
  ]);
  return [...numbers]
    .sort((a, b) => a - b)
    .map((n) => ({
      value: String(n),
      label: labels.get(n) ? `#${n} · ${labels.get(n)}` : `#${n}`,
    }));
}

async function getBoostStats(storeCurrency: string) {
  await connectDB();

  const [stats] = await BoostCampaign.aggregate([
    {
      $facet: {
        active: [
          { $match: { status: BOOST_CAMPAIGN_STATUS.ACTIVE } },
          { $count: "count" },
        ],
        scheduled: [
          { $match: { status: BOOST_CAMPAIGN_STATUS.SCHEDULED } },
          { $count: "count" },
        ],
        // Net of refunds. Summing `amount` alone over-reports from the first
        // partial refund onward, and under per-day proration partial refunds
        // are routine rather than exceptional — a released day is money handed
        // back, so revenue that ignores them drifts permanently high.
        //
        // Grouped BY CURRENCY: a store that has changed its default carries
        // bookings in both, and adding them produces a figure that is true in
        // neither.
        revenue: [
          { $match: { paidAt: { $ne: null } } },
          {
            $lookup: {
              from: "platformpayments",
              localField: "paymentId",
              foreignField: "_id",
              as: "payment",
              pipeline: [{ $project: { refundedAmount: 1 } }],
            },
          },
          {
            $group: {
              _id: "$currency",
              total: {
                $sum: {
                  $subtract: [
                    "$amount",
                    {
                      $ifNull: [{ $first: "$payment.refundedAmount" }, 0],
                    },
                  ],
                },
              },
            },
          },
        ],
        credit: [
          { $match: { refundableAmount: { $gt: 0 } } },
          {
            $group: {
              _id: "$currency",
              total: { $sum: "$refundableAmount" },
              count: { $sum: 1 },
            },
          },
        ],
        totals: [
          {
            $group: {
              _id: null,
              impressions: { $sum: "$totalImpressions" },
              clicks: { $sum: "$totalClicks" },
            },
          },
        ],
      },
    },
  ]);

  type CurrencyBucket = { _id?: string | null; total?: number; count?: number };
  const revenueBuckets: CurrencyBucket[] = stats?.revenue ?? [];
  const creditBuckets: CurrencyBucket[] = stats?.credit ?? [];
  const inStoreCurrency = (rows: CurrencyBucket[]) =>
    rows.find((row) => (row._id || "").toUpperCase() === storeCurrency);

  const otherCurrencies = [
    ...new Set(
      [...revenueBuckets, ...creditBuckets]
        .map((row) => (row._id || "").toUpperCase())
        .filter((code) => code && code !== storeCurrency),
    ),
  ];

  return {
    active: stats?.active?.[0]?.count ?? 0,
    scheduled: stats?.scheduled?.[0]?.count ?? 0,
    revenue: inStoreCurrency(revenueBuckets)?.total ?? 0,
    creditOwed: inStoreCurrency(creditBuckets)?.total ?? 0,
    creditCount: creditBuckets.reduce((sum, row) => sum + (row.count ?? 0), 0),
    otherCurrencies,
    impressions: stats?.totals?.[0]?.impressions ?? 0,
    clicks: stats?.totals?.[0]?.clicks ?? 0,
  };
}
