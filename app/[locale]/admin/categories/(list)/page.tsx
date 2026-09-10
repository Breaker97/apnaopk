import { BadgeCheck, Ban, Boxes, FolderTree, Layers } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { Category } from "@/models";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { CategoriesDataTable } from "@/components/admin/categories-data-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface CategoriesStats {
  totalCategories: number;
  activeCategories: number;
  inactiveCategories: number;
  parentCategories: number;
  totalAssignedProducts: number;
}

export default async function AdminCategoriesPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  await requireAdminPageAccess(locale);

  const page = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const searchQuery =
    typeof search.search === "string" ? search.search : undefined;
  const status = typeof search.status === "string" ? search.status : "all";
  const stats = await getCategoriesStats();

  const statItems: AdminStatsStripItem[] = [
    {
      title: t("admin.categoriesPage.stats.totalCategories.title"),
      value: stats.totalCategories,
      description: t("admin.categoriesPage.stats.totalCategories.description"),
      icon: <FolderTree className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("admin.categoriesPage.stats.activeCategories.title"),
      value: stats.activeCategories,
      description: t("admin.categoriesPage.stats.activeCategories.description"),
      icon: <BadgeCheck className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: t("admin.categoriesPage.stats.inactiveCategories.title"),
      value: stats.inactiveCategories,
      description: t("admin.categoriesPage.stats.inactiveCategories.description"),
      icon: <Ban className="h-5 w-5" />,
      iconClassName: "text-rose-700 bg-rose-100",
    },
    {
      title: t("admin.categoriesPage.stats.parentCategories.title"),
      value: stats.parentCategories,
      description: t("admin.categoriesPage.stats.parentCategories.description"),
      icon: <Layers className="h-5 w-5" />,
      iconClassName: "text-indigo-700 bg-indigo-100",
    },
    {
      title: t("admin.categoriesPage.stats.assignedProducts.title"),
      value: stats.totalAssignedProducts,
      description: t("admin.categoriesPage.stats.assignedProducts.description"),
      icon: <Boxes className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={statItems} />
      <CategoriesDataTable
        locale={locale}
        initialPage={page}
        initialSearch={searchQuery}
        initialStatus={status}
      />
    </div>
  );
}

async function getCategoriesStats(): Promise<CategoriesStats> {
  await connectDB();

  const [result] = await Category.aggregate([
    {
      $facet: {
        totalCategories: [{ $count: "count" }],
        activeCategories: [
          { $match: { isActive: true } },
          { $count: "count" },
        ],
        inactiveCategories: [
          { $match: { isActive: false } },
          { $count: "count" },
        ],
        parentCategories: [
          { $match: { parentId: null } },
          { $count: "count" },
        ],
        totalAssignedProducts: [
          { $group: { _id: null, total: { $sum: { $ifNull: ["$productCount", 0] } } } },
        ],
      },
    },
  ]);

  return {
    totalCategories: result?.totalCategories?.[0]?.count ?? 0,
    activeCategories: result?.activeCategories?.[0]?.count ?? 0,
    inactiveCategories: result?.inactiveCategories?.[0]?.count ?? 0,
    parentCategories: result?.parentCategories?.[0]?.count ?? 0,
    totalAssignedProducts: result?.totalAssignedProducts?.[0]?.total ?? 0,
  };
}
