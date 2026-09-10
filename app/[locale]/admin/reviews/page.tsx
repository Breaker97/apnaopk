import { Suspense } from "react";
import { Review } from "@/models";
import { connectDB } from "@/lib/db";
import { setRequestLocale } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { ReviewsDataTable } from "@/components/admin/reviews-data-table";
import { ReviewsStatsCard } from "@/components/admin/reviews-stats-card";
import type { ReviewsStats } from "@/lib/admin/reviews-types";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { AdminReviewListQuerySchema } from "@/lib/validations";
import { fetchAdminReviewList } from "@/lib/catalog/review-list";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}


export default async function AdminReviewsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [
      STAFF_PERMISSIONS.VIEW_REVIEWS,
      STAFF_PERMISSIONS.MANAGE_REVIEWS,
    ],
  });

  return (
    <div className="space-y-4">
      {/* The real card is pinned to 181px from `lg` up and stacks to roughly
          300px below it; matching that keeps the table from jumping. */}
      <Suspense
        fallback={
          <Skeleton className="h-[300px] w-full rounded-[12px] lg:h-[181px]" />
        }
      >
        <ReviewsStats />
      </Suspense>

      <Suspense
        fallback={
          <AdminListSkeleton
            stats={0}
            columns={5}
            tabs={5}
            headerActions={0}
            toolbarAction={false}
          />
        }
      >
        <ReviewsTable locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function ReviewsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Parsed with the schema the API route uses, so the page and the endpoint
  // can never read one query string two different ways.
  const query = parsePageQuery(searchParams, AdminReviewListQuerySchema);
  const view =
    typeof searchParams.view === "string" ? searchParams.view : "all";
  const list = await fetchAdminReviewList({ ...query, view });

  return (
    <ReviewsDataTable
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

async function ReviewsStats() {
  return <ReviewsStatsCard stats={await getReviewsStats()} />;
}

async function getReviewsStats(): Promise<ReviewsStats> {
  await connectDB();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [agg, weekDelta] = await Promise.all([
    Review.aggregate([
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 },
          rating5: { $sum: { $cond: [{ $eq: ["$rating", 5] }, 1, 0] } },
          rating4: { $sum: { $cond: [{ $eq: ["$rating", 4] }, 1, 0] } },
          rating3: { $sum: { $cond: [{ $eq: ["$rating", 3] }, 1, 0] } },
          rating2: { $sum: { $cond: [{ $eq: ["$rating", 2] }, 1, 0] } },
          rating1: { $sum: { $cond: [{ $eq: ["$rating", 1] }, 1, 0] } },
          published: {
            $sum: { $cond: [{ $eq: ["$isApproved", true] }, 1, 0] },
          },
          onHold: {
            $sum: { $cond: [{ $eq: ["$isApproved", false] }, 1, 0] },
          },
        },
      },
    ]),
    Review.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
  ]);

  const s = agg[0] || {
    averageRating: 0,
    totalReviews: 0,
    rating5: 0,
    rating4: 0,
    rating3: 0,
    rating2: 0,
    rating1: 0,
    published: 0,
    onHold: 0,
  };

  return {
    average: Math.round((s.averageRating || 0) * 100) / 100,
    total: s.totalReviews || 0,
    published: s.published || 0,
    onHold: s.onHold || 0,
    weekDelta: weekDelta || 0,
    breakdown: {
      5: s.rating5 || 0,
      4: s.rating4 || 0,
      3: s.rating3 || 0,
      2: s.rating2 || 0,
      1: s.rating1 || 0,
    },
  };
}
