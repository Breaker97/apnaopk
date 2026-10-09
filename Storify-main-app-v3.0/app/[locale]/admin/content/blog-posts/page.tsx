import { Newspaper, FileText, CheckCircle2, Clock, Eye } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BlogPost } from "@/models";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { BlogPostsDataTable } from "@/components/admin/blog/blog-posts-data-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AdminBlogPostsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  const page = typeof search.page === "string" ? parseInt(search.page, 10) : 1;
  const searchQuery = typeof search.search === "string" ? search.search : undefined;
  const status = typeof search.status === "string" ? search.status : "all";

  const stats = await getStats();

  const items: AdminStatsStripItem[] = [
    {
      title: "Total posts",
      value: stats.total,
      description: "All blog posts",
      icon: <Newspaper className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: "Published",
      value: stats.published,
      description: "Live on storefront",
      icon: <CheckCircle2 className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: "Drafts",
      value: stats.drafts,
      description: "Unpublished posts",
      icon: <FileText className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: "Scheduled",
      value: stats.scheduled,
      description: "Auto-publish later",
      icon: <Clock className="h-5 w-5" />,
      iconClassName: "text-indigo-700 bg-indigo-100",
    },
    {
      title: "Total views",
      value: stats.views,
      description: "Across all posts",
      icon: <Eye className="h-5 w-5" />,
      iconClassName: "text-violet-700 bg-violet-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={items} />
      <BlogPostsDataTable
        locale={locale}
        initialPage={page}
        initialSearch={searchQuery}
        initialStatus={status}
      />
    </div>
  );
}

async function getStats() {
  await connectDB();
  const [result] = await BlogPost.aggregate([
    {
      $facet: {
        total: [{ $count: "count" }],
        published: [{ $match: { status: "published" } }, { $count: "count" }],
        drafts: [{ $match: { status: "draft" } }, { $count: "count" }],
        scheduled: [{ $match: { status: "scheduled" } }, { $count: "count" }],
        views: [{ $group: { _id: null, total: { $sum: "$viewCount" } } }],
      },
    },
  ]);
  return {
    total: result?.total?.[0]?.count ?? 0,
    published: result?.published?.[0]?.count ?? 0,
    drafts: result?.drafts?.[0]?.count ?? 0,
    scheduled: result?.scheduled?.[0]?.count ?? 0,
    views: result?.views?.[0]?.total ?? 0,
  };
}
