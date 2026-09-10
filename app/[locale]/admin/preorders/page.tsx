import { Suspense } from "react";
import {
  BadgeCheck,
  CalendarClock,
  Clock3,
  CreditCard,
  PackageCheck,
} from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { Order } from "@/models";
import { connectDB } from "@/lib/db";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { PreordersTableSection } from "@/components/admin/preorders-table-section";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface PreorderStats {
  total: number;
  reserved: number;
  paymentDue: number;
  ready: number;
  dueSoon: number;
}

export default async function AdminPreordersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const access = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ORDERS],
  });

  const stats = await getPreorderStats();
  const canEditPreorder =
    !access.staffPermissions ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.EDIT_ORDERS);
  const canCancelPreorder =
    !access.staffPermissions ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_ORDERS);

  const statItems: AdminStatsStripItem[] = [
    {
      title: "Pre-orders",
      value: new Intl.NumberFormat(locale).format(stats.total),
      description: "Orders waiting for release",
      icon: <CalendarClock className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: "Reserved",
      value: new Intl.NumberFormat(locale).format(stats.reserved),
      description: "Customer quantities held",
      icon: <Clock3 className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: "Payment due",
      value: new Intl.NumberFormat(locale).format(stats.paymentDue),
      description: "Needs balance collection",
      icon: <CreditCard className="h-5 w-5" />,
      iconClassName: "text-orange-700 bg-orange-100",
    },
    {
      title: "Ready",
      value: new Intl.NumberFormat(locale).format(stats.ready),
      description: "Released to fulfillment",
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: "Due soon",
      value: new Intl.NumberFormat(locale).format(stats.dueSoon),
      description: "Expected in the next 14 days",
      icon: <PackageCheck className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <Suspense
        fallback={
          <AdminListSkeleton
            stats={0}
            columns={6}
            tabs={4}
            thumbnail={false}
          />
        }
      >
        <PreordersTableSection
          locale={locale}
          searchParams={search}
          staffScope={access?.staffScope}
          canEditPreorder={canEditPreorder}
          canCancelPreorder={canCancelPreorder}
        />
      </Suspense>
    </div>
  );
}

async function getPreorderStats(): Promise<PreorderStats> {
  await connectDB();

  const dueSoon = new Date();
  dueSoon.setDate(dueSoon.getDate() + 14);

  const [result] = await Order.aggregate([
    { $match: { hasPreorder: true } },
    {
      $facet: {
        total: [{ $count: "count" }],
        reserved: [
          { $match: { preorderStatus: "reserved" } },
          { $count: "count" },
        ],
        ready: [
          { $match: { preorderStatus: "ready" } },
          { $count: "count" },
        ],
        paymentDue: [
          { $match: { preorderStatus: "payment_due" } },
          { $count: "count" },
        ],
        dueSoon: [
          {
            $match: {
              preorderStatus: "reserved",
              preorderReleaseDate: { $lte: dueSoon },
            },
          },
          { $count: "count" },
        ],
      },
    },
  ]);

  return {
    total: result?.total?.[0]?.count ?? 0,
    reserved: result?.reserved?.[0]?.count ?? 0,
    paymentDue: result?.paymentDue?.[0]?.count ?? 0,
    ready: result?.ready?.[0]?.count ?? 0,
    dueSoon: result?.dueSoon?.[0]?.count ?? 0,
  };
}
