import mongoose from "mongoose";
import {
  Archive,
  BadgeCheck,
  Boxes,
  PackageSearch,
  Warehouse,
} from "lucide-react";
import { Product } from "@/models";
import { connectDB } from "@/lib/db";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { PRODUCT_STATUS } from "@/config/app.config";
import { VendorProductsTable } from "@/components/vendor/products-table";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { AdminListQuerySchema } from "@/lib/validations";
import { fetchVendorProductList } from "@/lib/vendors/vendor-product-list";
import { ProductsTableSkeleton } from "@/components/admin/products-table-skeleton";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface VendorProductsStats {
  totalProducts: number;
  activeProducts: number;
  draftProducts: number;
  outOfStockProducts: number;
  totalInventoryUnits: number;
}

export default async function VendorProductsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  const search = await searchParams;
  setRequestLocale(locale);
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_PRODUCTS],
  });
  const vendor = access.vendor;
  const canCreateProduct =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_PRODUCTS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.CREATE_PRODUCTS);
  const canEditProduct =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_PRODUCTS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_PRODUCTS);
  const canDeleteProduct =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_PRODUCTS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.DELETE_PRODUCTS);
  // Buying a boost is gated the same way the /vendor/boosts pages and the
  // checkout API are; without this the row action walks a staff member through
  // the whole purchase dialog only to 403 at the pay button.
  const canBoostProduct = access.vendorPermissions.includes(
    VENDOR_PERMISSIONS.MANAGE_BOOSTS,
  );

  const stats = await getVendorProductStats(String(vendor._id));

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("admin.productsPage.stats.totalProducts.title"),
      value: stats.totalProducts,
      description: t("admin.productsPage.stats.totalProducts.description"),
      icon: <Boxes className="h-5 w-5" />,
      iconClassName: "text-teal-700 bg-teal-100",
    },
    {
      title: t("admin.productsPage.stats.activeListings.title"),
      value: stats.activeProducts,
      description: t("admin.productsPage.stats.activeListings.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.productsPage.stats.draftProducts.title"),
      value: stats.draftProducts,
      description: t("admin.productsPage.stats.draftProducts.description"),
      icon: <Archive className="h-5 w-5" />,
      iconClassName: "text-indigo-700 bg-indigo-100",
    },
    {
      title: t("admin.productsPage.stats.outOfStock.title"),
      value: stats.outOfStockProducts,
      description: t("admin.productsPage.stats.outOfStock.description"),
      icon: <PackageSearch className="h-5 w-5" />,
      iconClassName: "text-orange-700 bg-orange-100",
    },
    {
      title: t("admin.productsPage.stats.inventoryUnits.title"),
      value: stats.totalInventoryUnits,
      description: t("admin.productsPage.stats.inventoryUnits.description"),
      icon: <Warehouse className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <Suspense fallback={<ProductsTableSkeleton />}>
        <VendorProductsTableSection
          locale={locale}
          searchParams={search}
          vendorId={String(vendor._id)}
          canCreateProduct={canCreateProduct}
          canEditProduct={canEditProduct}
          canDeleteProduct={canDeleteProduct}
          canBoostProduct={canBoostProduct}
        />
      </Suspense>
    </div>
  );
}

async function getVendorProductStats(vendorId: string): Promise<VendorProductsStats> {
  await connectDB();
  const vendorObjectId = new mongoose.Types.ObjectId(vendorId);

  const [result] = await Product.aggregate([
    { $match: { vendorId: vendorObjectId } },
    {
      $project: {
        status: 1,
        stock: 1,
        variants: 1,
        inventoryCount: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ["$variants", []] } }, 0] },
            {
              $sum: {
                $map: {
                  input: { $ifNull: ["$variants", []] },
                  as: "variant",
                  in: { $ifNull: ["$$variant.stock", 0] },
                },
              },
            },
            { $ifNull: ["$stock", 0] },
          ],
        },
      },
    },
    {
      $facet: {
        totalProducts: [{ $count: "count" }],
        activeProducts: [
          { $match: { status: PRODUCT_STATUS.ACTIVE } },
          { $count: "count" },
        ],
        draftProducts: [
          { $match: { status: PRODUCT_STATUS.DRAFT } },
          { $count: "count" },
        ],
        outOfStockProducts: [
          { $match: { inventoryCount: { $lte: 0 } } },
          { $count: "count" },
        ],
        totalInventoryUnits: [
          { $group: { _id: null, total: { $sum: "$inventoryCount" } } },
        ],
      },
    },
  ]);

  return {
    totalProducts: result?.totalProducts?.[0]?.count ?? 0,
    activeProducts: result?.activeProducts?.[0]?.count ?? 0,
    draftProducts: result?.draftProducts?.[0]?.count ?? 0,
    outOfStockProducts: result?.outOfStockProducts?.[0]?.count ?? 0,
    totalInventoryUnits: result?.totalInventoryUnits?.[0]?.total ?? 0,
  };
}

async function VendorProductsTableSection({
  locale,
  searchParams,
  vendorId,
  canCreateProduct,
  canEditProduct,
  canDeleteProduct,
  canBoostProduct,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
  vendorId: string;
  canCreateProduct: boolean;
  canEditProduct: boolean;
  canBoostProduct: boolean;
  canDeleteProduct: boolean;
}) {
  // Parsed with the schema the API route uses, so the page and the endpoint
  // can never read one query string two different ways.
  const query = parsePageQuery(searchParams, AdminListQuerySchema);
  const list = await fetchVendorProductList(query, vendorId);

  return (
    <VendorProductsTable
      locale={locale}
      canCreateProduct={canCreateProduct}
      canEditProduct={canEditProduct}
      canDeleteProduct={canDeleteProduct}
      canBoostProduct={canBoostProduct}
      data={serializeRows(list.items)}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
    />
  );
}
