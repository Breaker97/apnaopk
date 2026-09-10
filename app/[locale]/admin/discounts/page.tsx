import { Suspense } from "react";
import {
  CalendarClock,
  CircleDollarSign,
  TicketPercent,
  TrendingUp,
} from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { Coupon } from "@/models";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { DiscountsTableSection } from "@/components/admin/discounts-table-section";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface CouponStats {
  totalCoupons: number;
  activeCoupons: number;
  totalRedemptions: number;
  expiringSoon: number;
}

export default async function AdminDiscountsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  const stats = await getCouponStats();

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("admin.discountsPage.stats.totalDiscounts.title"),
      value: stats.totalCoupons,
      description: t("admin.discountsPage.stats.totalDiscounts.description"),
      icon: <TicketPercent className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.discountsPage.stats.activeDiscounts.title"),
      value: stats.activeCoupons,
      description: t("admin.discountsPage.stats.activeDiscounts.description"),
      icon: <TrendingUp className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.discountsPage.stats.totalRedemptions.title"),
      value: stats.totalRedemptions,
      description: t("admin.discountsPage.stats.totalRedemptions.description"),
      icon: <CircleDollarSign className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: t("admin.discountsPage.stats.expiringIn7Days.title"),
      value: stats.expiringSoon,
      description: t("admin.discountsPage.stats.expiringIn7Days.description"),
      icon: <CalendarClock className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={6} tabs={4} thumbnail={false} />
        }
      >
        <DiscountsTableSection locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function getCouponStats(): Promise<CouponStats> {
  await connectDB();

  const now = new Date();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [stats] = await Coupon.aggregate([
    {
      $facet: {
        totalCoupons: [{ $count: "count" }],
        activeCoupons: [
          { $match: { status: "active", endDate: { $gte: now } } },
          { $count: "count" },
        ],
        totalRedemptions: [
          { $group: { _id: null, total: { $sum: "$usedCount" } } },
        ],
        expiringSoon: [
          {
            $match: {
              status: "active",
              endDate: { $gte: now, $lte: inSevenDays },
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);

  return {
    totalCoupons: stats?.totalCoupons?.[0]?.count ?? 0,
    activeCoupons: stats?.activeCoupons?.[0]?.count ?? 0,
    totalRedemptions: stats?.totalRedemptions?.[0]?.total ?? 0,
    expiringSoon: stats?.expiringSoon?.[0]?.count ?? 0,
  };
}
