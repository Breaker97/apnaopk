import { Suspense } from "react";
import {
  CalendarClock,
  CircleDollarSign,
  Eye,
  Rocket,
  TrendingUp,
} from "lucide-react";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BoostCampaign } from "@/models";
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
import { AdminListQuerySchema } from "@/lib/validations";
import { fetchBoostCampaignList } from "@/lib/boosts/boost-campaign-list";

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

  if (!boostingEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-2 py-10">
            <Rocket className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Product boosting is off</h2>
            <p className="text-sm text-muted-foreground">
              Enable boosting in Settings → Product Boosting to sell sponsored
              placements to vendors.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tSafe = (key: string, fallback: string) => {
    try {
      const value = t(key);
      return value === key ? fallback : value;
    } catch {
      return fallback;
    }
  };

  const stats = await getBoostStats();
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
      title: tSafe("boosts.stats.revenue", "Boost revenue"),
      value: stats.revenue.toLocaleString(),
      description: tSafe(
        "boosts.stats.revenueDescription",
        "Paid bookings less refunds, all time (store currency)",
      ),
      icon: <CircleDollarSign className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: tSafe("boosts.stats.impressions", "Impressions"),
      value: stats.impressions,
      description: tSafe(
        "boosts.stats.impressionsDescription",
        "Sponsored views, all time",
      ),
      icon: <Eye className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: tSafe("boosts.stats.ctr", "CTR"),
      value: stats.impressions
        ? `${((stats.clicks / stats.impressions) * 100).toFixed(1)}%`
        : "—",
      description: tSafe("boosts.stats.ctrDescription", "Click-through rate"),
      icon: <TrendingUp className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
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
          <AdminListSkeleton stats={0} columns={7} tabs={6} thumbnail />
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
  const list = await fetchBoostCampaignList(
    parsePageQuery(searchParams, AdminListQuerySchema),
  );
  return (
    <BoostCampaignsContent
      locale={locale}
      data={list.items}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
    />
  );
}

async function getBoostStats() {
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
              _id: null,
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

  return {
    active: stats?.active?.[0]?.count ?? 0,
    scheduled: stats?.scheduled?.[0]?.count ?? 0,
    revenue: stats?.revenue?.[0]?.total ?? 0,
    impressions: stats?.totals?.[0]?.impressions ?? 0,
    clicks: stats?.totals?.[0]?.clicks ?? 0,
  };
}
