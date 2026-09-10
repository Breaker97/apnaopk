import { Suspense } from "react";
import {
  Boxes,
  MapPin,
  PackageSearch,
  ScanSearch,
  Warehouse,
} from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { InventoryTableSection } from "@/components/admin/inventory-table-section";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface InventoryStats {
  totalSkus: number;
  lowStockSkus: number;
  outOfStockSkus: number;
  onHandUnits: number;
  activeLocations: number;
}

export default async function AdminInventoryPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  const access = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_INVENTORY],
  });

  const stats = await getInventoryStats();

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("admin.inventoryPage.stats.trackedSkus.title"),
      value: stats.totalSkus,
      description: t("admin.inventoryPage.stats.trackedSkus.description"),
      icon: <Boxes className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.inventoryPage.stats.lowStockSkus.title"),
      value: stats.lowStockSkus,
      description: t("admin.inventoryPage.stats.lowStockSkus.description"),
      icon: <ScanSearch className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: t("admin.inventoryPage.stats.outOfStock.title"),
      value: stats.outOfStockSkus,
      description: t("admin.inventoryPage.stats.outOfStock.description"),
      icon: <PackageSearch className="h-5 w-5" />,
      iconClassName: "text-rose-700 bg-rose-100",
    },
    {
      title: t("admin.inventoryPage.stats.onHandUnits.title"),
      value: stats.onHandUnits,
      description: t("admin.inventoryPage.stats.onHandUnits.description"),
      icon: <Warehouse className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
    {
      title: t("admin.inventoryPage.stats.activeLocations.title"),
      value: stats.activeLocations,
      description: t("admin.inventoryPage.stats.activeLocations.description"),
      icon: <MapPin className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={7} tabs={4} thumbnail />
        }
      >
        <InventoryTableSection
          locale={locale}
          searchParams={search}
          staffScope={access?.staffScope}
        />
      </Suspense>
    </div>
  );
}

async function getInventoryStats(): Promise<InventoryStats> {
  await connectDB();

  // Counted in the database: loading every product document just to tally SKUs
  // grew linearly with the catalogue on every render of this page.
  const [[totals], activeLocations] = await Promise.all([
    Product.aggregate<Omit<InventoryStats, "activeLocations">>([
      {
        // One quantity per SKU row: a variant each when the product has
        // variants, otherwise the product's own stock.
        $project: {
          quantities: {
            $let: {
              vars: {
                variants: {
                  $cond: [{ $isArray: "$variants" }, "$variants", []],
                },
              },
              in: {
                $cond: [
                  { $gt: [{ $size: "$$variants" }, 0] },
                  {
                    $map: {
                      input: "$$variants",
                      as: "variant",
                      in: { $ifNull: ["$$variant.stock", 0] },
                    },
                  },
                  [{ $ifNull: ["$stock", 0] }],
                ],
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          totalSkus: { $sum: { $size: "$quantities" } },
          onHandUnits: { $sum: { $sum: "$quantities" } },
          lowStockSkus: {
            $sum: {
              $size: {
                $filter: {
                  input: "$quantities",
                  cond: {
                    $and: [
                      { $gt: ["$$this", 0] },
                      { $lte: ["$$this", 10] },
                    ],
                  },
                },
              },
            },
          },
          outOfStockSkus: {
            $sum: {
              $size: {
                $filter: {
                  input: "$quantities",
                  cond: { $lte: ["$$this", 0] },
                },
              },
            },
          },
        },
      },
      { $project: { _id: 0 } },
    ]),
    InventoryLocation.countDocuments({ isActive: true }),
  ]);

  return {
    totalSkus: totals?.totalSkus ?? 0,
    lowStockSkus: totals?.lowStockSkus ?? 0,
    outOfStockSkus: totals?.outOfStockSkus ?? 0,
    onHandUnits: totals?.onHandUnits ?? 0,
    activeLocations,
  };
}
