import { Suspense } from "react";
import mongoose from "mongoose";
import { notFound } from "next/navigation";
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
import { getSettings } from "@/models/settings.model";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { PreordersTableSection } from "@/components/admin/preorders-table-section";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface VendorPreorderStats {
  total: number;
  reserved: number;
  paymentDue: number;
  ready: number;
  dueSoon: number;
}

export default async function VendorPreordersPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_ORDERS],
  });
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) notFound();

  const vendorId = String(access.vendor._id);
  const stats = await getVendorPreorderStats(vendorId);
  const canEditPreorder =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_ORDERS);
  const canCancelPreorder =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_ORDERS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.DELETE_ORDERS);

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
          scope="vendor"
          searchParams={search}
          vendorId={vendorId}
          canEditPreorder={canEditPreorder}
          canCancelPreorder={canCancelPreorder}
        />
      </Suspense>
    </div>
  );
}

async function getVendorPreorderStats(
  vendorId: string,
): Promise<VendorPreorderStats> {
  await connectDB();

  const vendorObjectId = new mongoose.Types.ObjectId(vendorId);
  const dueSoon = new Date();
  dueSoon.setDate(dueSoon.getDate() + 14);

  const [result] = await Order.aggregate([
    { $match: { hasPreorder: true } },
    { $unwind: "$subOrders" },
    { $match: { "subOrders.vendorId": vendorObjectId } },
    {
      $project: {
        preorderReleaseDate: 1,
        subtotal: "$subOrders.subtotal",
        itemStatuses: {
          $map: {
            input: {
              $filter: {
                input: "$subOrders.items",
                as: "item",
                cond: { $eq: ["$$item.purchaseType", "preorder"] },
              },
            },
            as: "item",
            in: "$$item.preorderStatus",
          },
        },
      },
    },
    {
      $addFields: {
        preorderStatus: {
          $cond: [
            { $allElementsTrue: { $map: { input: "$itemStatuses", as: "status", in: { $eq: ["$$status", "cancelled"] } } } },
            "cancelled",
            {
              $cond: [
                { $allElementsTrue: { $map: { input: "$itemStatuses", as: "status", in: { $eq: ["$$status", "ready"] } } } },
                "ready",
                {
                  $cond: [
                    { $allElementsTrue: { $map: { input: "$itemStatuses", as: "status", in: { $eq: ["$$status", "payment_due"] } } } },
                    "payment_due",
                    "reserved",
                  ],
                },
              ],
            },
          ],
        },
      },
    },
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
