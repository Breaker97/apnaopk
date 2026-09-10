import { Suspense } from "react";
import mongoose from "mongoose";
import {
  CalendarClock,
  Eye,
  MousePointerClick,
  Rocket,
  TrendingUp,
} from "lucide-react";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BoostCampaign } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { BoostsContent } from "@/components/vendor/boosts-content";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { BOOST_CAMPAIGN_STATUS } from "@/config/app.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { primaryDenial, vendorLockedPath } from "@/lib/vendors/vendor-permissions";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { parsePageQuery } from "@/lib/api/validate";
import { AdminListQuerySchema } from "@/lib/validations";
import { fetchBoostCampaignList } from "@/lib/boosts/boost-campaign-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function VendorBoostsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const search = await searchParams;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({ locale });

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.boosting?.enabled) {
    redirect(`/${locale}/vendor/dashboard`);
  }

  // Checked against the resolution the guard already loaded, not via a second
  // `hasVendorPermission` round trip — and a miss goes to the reason-carrying
  // gate rather than a bare /forbidden. The guard is called without `required`
  // so that a marketplace with boosting switched off still sends the vendor to
  // their dashboard instead of explaining a permission they cannot use anyway.
  if (!access.access?.has(VENDOR_PERMISSIONS.VIEW_BOOSTS)) {
    redirect(
      vendorLockedPath(
        locale,
        primaryDenial(access.access!, [VENDOR_PERMISSIONS.VIEW_BOOSTS]),
      ),
    );
  }

  const vendor = await requireApprovedVendorByUserId(access.session.user.id);
  const stats = await getVendorBoostStats(String(vendor._id));

  const tSafe = (key: string, fallback: string) => {
    try {
      const value = t(key);
      return value === key ? fallback : value;
    } catch {
      return fallback;
    }
  };

  const statItems: AdminStatsStripItem[] = [
    {
      title: tSafe("boosts.stats.active", "Active boosts"),
      value: stats.active,
      description: tSafe("boosts.stats.activeDescription", "Live right now"),
      icon: <Rocket className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      // Without this card a vendor who just paid for next month sees "0 active
      // boosts" and opens a ticket. Future bookings are the normal case now.
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
      title: tSafe("boosts.stats.clicks", "Clicks"),
      value: stats.clicks,
      description: tSafe(
        "boosts.stats.clicksDescription",
        "Sponsored clicks, all time",
      ),
      icon: <MousePointerClick className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
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
      {/* Fetched inside the boundary so the fallback can actually render — a
          Suspense wrapper around already-resolved props never suspends. */}
      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={7} tabs={6} thumbnail />
        }
      >
        <VendorBoostsSection
          locale={locale}
          vendorId={String(vendor._id)}
          searchParams={search}
        />
      </Suspense>
    </div>
  );
}

async function VendorBoostsSection({
  locale,
  vendorId,
  searchParams,
}: {
  locale: string;
  vendorId: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const list = await fetchBoostCampaignList(
    parsePageQuery(searchParams, AdminListQuerySchema),
    { vendorId },
  );
  return (
    <BoostsContent
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

async function getVendorBoostStats(vendorId: string) {
  await connectDB();
  const vendorObjectId = new mongoose.Types.ObjectId(vendorId);

  const [stats] = await BoostCampaign.aggregate([
    { $match: { vendorId: vendorObjectId } },
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
    impressions: stats?.totals?.[0]?.impressions ?? 0,
    clicks: stats?.totals?.[0]?.clicks ?? 0,
  };
}
