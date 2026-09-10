import { Suspense } from "react";
import {
  Boxes,
  MapPin,
  PackageSearch,
  ScanSearch,
  Warehouse,
} from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { InventoryTableSection } from "@/components/admin/inventory-table-section";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  buildStaffLocationScopeFilter,
  buildStaffProductScopeFilter,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

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

export default async function StaffInventoryPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  const access = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_INVENTORY],
  });
  const readOnly = !(
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_INVENTORY) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.EDIT_INVENTORY) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.CREATE_INVENTORY) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_INVENTORY)
  );

  const stats = await getInventoryStats(access.staffScope);

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
      iconClassName: "text-indigo-700 bg-indigo-100",
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
          readOnly={readOnly}
          staffScope={access.staffScope}
        />
      </Suspense>
    </div>
  );
}

async function getInventoryStats(staffScope?: StaffAccessScope): Promise<InventoryStats> {
  await connectDB();

  const [products, locations] = await Promise.all([
    Product.find(buildStaffProductScopeFilter(staffScope))
      .select("variants sku stock")
      .lean(),
    InventoryLocation.countDocuments(
      mergeScopeFilter(
        { isActive: true },
        buildStaffLocationScopeFilter(staffScope),
      ),
    ),
  ]);

  let totalSkus = 0;
  let lowStockSkus = 0;
  let outOfStockSkus = 0;
  let onHandUnits = 0;

  for (const product of products) {
    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
    if (hasVariants) {
      for (const variant of product.variants!) {
        totalSkus += 1;
        const qty = variant.stock ?? 0;
        onHandUnits += qty;
        if (qty <= 0) outOfStockSkus += 1;
        else if (qty <= 10) lowStockSkus += 1;
      }
    } else {
      totalSkus += 1;
      const qty = product.stock ?? 0;
      onHandUnits += qty;
      if (qty <= 0) outOfStockSkus += 1;
      else if (qty <= 10) lowStockSkus += 1;
    }
  }

  return {
    totalSkus,
    lowStockSkus,
    outOfStockSkus,
    onHandUnits,
    activeLocations: locations,
  };
}
