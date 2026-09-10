import { Suspense } from "react";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import mongoose from "mongoose";
import { BadgeCheck, Boxes, Globe, Hand, Layers } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { VendorCollectionsDataTable } from "@/components/vendor/collections-data-table";
import { serializeRows } from "@/lib/api/list-query";
import { fetchVendorCollectionList } from "@/lib/vendors/vendor-collection-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface CollectionStats {
  totalCollections: number;
  activeCollections: number;
  manualCollections: number;
  onlineCollections: number;
  totalProductsInCollections: number;
}

export default async function VendorCollectionsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_PRODUCTS],
  });
  const vendor = access.vendor;

  const stats = await getVendorCollectionStats(String(vendor._id));

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("vendor.collectionsPage.stats.totalCollections.title"),
      value: stats.totalCollections,
      description: t("vendor.collectionsPage.stats.totalCollections.description"),
      icon: <Layers className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("vendor.collectionsPage.stats.activeCollections.title"),
      value: stats.activeCollections,
      description: t("vendor.collectionsPage.stats.activeCollections.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("vendor.collectionsPage.stats.manualCollections.title"),
      value: stats.manualCollections,
      description: t("vendor.collectionsPage.stats.manualCollections.description"),
      icon: <Hand className="h-5 w-5" />,
      iconClassName: "text-indigo-700 bg-indigo-100",
    },
    {
      title: t("vendor.collectionsPage.stats.onlineStore.title"),
      value: stats.onlineCollections,
      description: t("vendor.collectionsPage.stats.onlineStore.description"),
      icon: <Globe className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
    {
      title: t("vendor.collectionsPage.stats.assignedProducts.title"),
      value: stats.totalProductsInCollections,
      description: t("vendor.collectionsPage.stats.assignedProducts.description"),
      icon: <Boxes className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <Suspense
        fallback={
          <AdminListSkeleton stats={0} columns={5} tabs={4} thumbnail />
        }
      >
        <VendorCollectionsTable searchParams={search} vendorId={String(vendor._id)} />
      </Suspense>
    </div>
  );
}

async function getVendorCollectionStats(vendorId: string): Promise<CollectionStats> {
  await connectDB();

  const [result] = await Product.aggregate([
    {
      $match: {
        vendorId: new mongoose.Types.ObjectId(vendorId),
        collectionIds: { $exists: true, $ne: [] },
      },
    },
    { $unwind: "$collectionIds" },
    {
      $lookup: {
        from: "collections",
        localField: "collectionIds",
        foreignField: "_id",
        as: "collectionDoc",
      },
    },
    { $unwind: "$collectionDoc" },
    {
      $group: {
        _id: "$collectionIds",
        productCount: { $sum: 1 },
        status: { $first: "$collectionDoc.status" },
        collectionType: { $first: "$collectionDoc.collectionType" },
        onlineStore: { $first: "$collectionDoc.publishing.onlineStore" },
      },
    },
    {
      $group: {
        _id: null,
        totalCollections: { $sum: 1 },
        activeCollections: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        manualCollections: { $sum: { $cond: [{ $eq: ["$collectionType", "manual"] }, 1, 0] } },
        onlineCollections: { $sum: { $cond: ["$onlineStore", 1, 0] } },
        totalProductsInCollections: { $sum: "$productCount" },
      },
    },
  ]);

  const stats = result?.[0] || {};
  return {
    totalCollections: stats.totalCollections ?? 0,
    activeCollections: stats.activeCollections ?? 0,
    manualCollections: stats.manualCollections ?? 0,
    onlineCollections: stats.onlineCollections ?? 0,
    totalProductsInCollections: stats.totalProductsInCollections ?? 0,
  };
}

/**
 * Rebuilt as URLSearchParams so the page reads the query string through the
 * very same parser `/api/vendor/collections` uses.
 */
async function VendorCollectionsTable({
  searchParams,
  vendorId,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
  vendorId: string;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }

  const list = await fetchVendorCollectionList(params, vendorId);

  return (
    <VendorCollectionsDataTable
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
