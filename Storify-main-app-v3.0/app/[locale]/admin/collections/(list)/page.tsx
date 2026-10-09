import { Suspense } from "react";
import { BadgeCheck, Boxes, Globe, Hand, Layers } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  AdminStatsStrip,
  AdminStatsStripSkeleton,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { CollectionsDataTable } from "@/components/admin/collections-data-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { CollectionListQuerySchema } from "@/lib/validations";
import {
  fetchAdminCollectionList,
  fetchAdminCollectionStats,
} from "@/lib/catalog/collection-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminCollectionsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <CollectionsStats locale={locale} />
      </Suspense>

      <Suspense
        fallback={<AdminListSkeleton stats={0} columns={5} tabs={4} thumbnail />}
      >
        <CollectionsTable locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function CollectionsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Parsed with the schema the API route uses, so the page and the endpoint
  // can never read one query string two different ways.
  const query = parsePageQuery(searchParams, CollectionListQuerySchema);
  const list = await fetchAdminCollectionList(query);

  return (
    <CollectionsDataTable
      locale={locale}
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

async function CollectionsStats({ locale }: { locale: string }) {
  const [t, stats] = await Promise.all([
    getTranslations({ locale }),
    fetchAdminCollectionStats(),
  ]);

  const items: AdminStatsStripItem[] = [
    {
      title: t("admin.collectionsPage.stats.totalCollections.title"),
      value: stats.totalCollections,
      description: t("admin.collectionsPage.stats.totalCollections.description"),
      icon: <Layers className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.collectionsPage.stats.activeCollections.title"),
      value: stats.activeCollections,
      description: t(
        "admin.collectionsPage.stats.activeCollections.description",
      ),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.collectionsPage.stats.manualCollections.title"),
      value: stats.manualCollections,
      description: t(
        "admin.collectionsPage.stats.manualCollections.description",
      ),
      icon: <Hand className="h-5 w-5" />,
      iconClassName: "text-indigo-700 bg-indigo-100",
    },
    {
      title: t("admin.collectionsPage.stats.onlineStore.title"),
      value: stats.onlineCollections,
      description: t("admin.collectionsPage.stats.onlineStore.description"),
      icon: <Globe className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
    {
      title: t("admin.collectionsPage.stats.productsInCollections.title"),
      value: stats.totalProductsInCollections,
      description: t(
        "admin.collectionsPage.stats.productsInCollections.description",
      ),
      icon: <Boxes className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}
