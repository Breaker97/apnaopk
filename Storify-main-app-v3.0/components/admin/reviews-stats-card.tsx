"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReviewsStats } from "@/lib/admin/reviews-types";

interface ReviewsStatsCardProps {
  stats: ReviewsStats;
}

const STAR_LEVELS = [5, 4, 3, 2, 1] as const;

function getPerformanceTier(average: number) {
  if (average >= 4.5) return "excellent" as const;
  if (average >= 4.0) return "good" as const;
  if (average >= 3.0) return "average" as const;
  if (average > 0) return "poor" as const;
  return "none" as const;
}

const TIER_STYLES: Record<string, string> = {
  excellent:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  good: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  average:
    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  poor: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  none: "bg-muted text-muted-foreground",
};

function RatingSummaryMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-[44px] w-[78px] text-slate-900 dark:text-slate-100"
      viewBox="0 0 78 44"
      fill="none"
    >
      <path
        d="m11.5 7.4 1.8 4.1 4.4.4-3.3 2.9 1 4.3-3.9-2.3-3.8 2.3 1-4.3-3.3-2.9 4.4-.4 1.7-4.1Z"
        fill="currentColor"
      />
      <path
        d="m25.6 0 2 4.8 5.2.4-4 3.4 1.2 5-4.4-2.7-4.5 2.7 1.2-5-3.9-3.4 5.1-.4L25.6 0ZM43.1 2.9l1.5 3.5 3.8.3-2.9 2.5.9 3.7-3.3-2-3.3 2 .9-3.7-2.9-2.5 3.8-.3 1.5-3.5Z"
        fill="currentColor"
      />
      <path
        d="m58.8 12.2 1.4 3.4 3.7.3-2.8 2.4.8 3.6-3.1-1.9-3.2 1.9.9-3.6-2.8-2.4 3.6-.3 1.5-3.4Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path
        d="m71.1 11.7 1 2.4 2.7.2-2 1.8.6 2.6-2.3-1.4-2.3 1.4.6-2.6-2-1.8 2.7-.2 1-2.4Z"
        stroke="currentColor"
        strokeWidth=".9"
        strokeLinejoin="round"
      />
      <path
        d="M29.6 40.6c1.6-4.9 3.8-9.4 6.7-13.2 2.2-2.8 4.7-5.2 7.5-7.2 1-.7 2.4-.6 3.2.3.7.9.6 2.1-.2 2.9l-3.5 3.3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m36.1 33.7 7.7-11.9c.7-1.1 2.1-1.4 3.1-.8 1 .6 1.4 1.9.9 3L45 29.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m41.9 34.8 5.6-9.9c.7-1.2 2.1-1.6 3.1-1 .9.5 1.3 1.6 1 2.6l-1.8 5.1"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m49.4 34.3 2-4.6c.5-1.1 1.8-1.5 2.8-1 1 .5 1.4 1.7.9 2.8l-1.9 4.7c-.8 1.9-2.1 3.5-3.8 4.7l-2.5 1.8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M34 27.8c-2.6-.2-5.1.2-7.6 1.2-1.2.5-1.7 1.8-1.2 2.8.4.9 1.5 1.4 2.5 1.1l4.5-1.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReviewsStatsCard({ stats }: ReviewsStatsCardProps) {
  const t = useTranslations();

  const tier = getPerformanceTier(stats.average);
  const tierLabel: Record<string, string> = {
    excellent: t("admin.reviewsPage.performance.excellent"),
    good: t("admin.reviewsPage.performance.good"),
    average: t("admin.reviewsPage.performance.average"),
    poor: t("admin.reviewsPage.performance.poor"),
    none: t("admin.reviewsPage.performance.none"),
  };

  return (
    <Card className="grid gap-y-5 rounded-[12px] border border-slate-200 bg-white px-4 py-4 shadow-none lg:h-[181px] lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-x-9 dark:border-slate-800 dark:bg-slate-950">
      <div className="min-w-0">
        <RatingSummaryMark />
        <div className="mt-3">
          <p className="text-[36px] font-bold leading-none tracking-normal text-slate-800 dark:text-slate-100">
            {stats.average.toFixed(2)}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[14px] font-medium leading-6 text-slate-500 dark:text-slate-400">
            <span>
              {t("admin.reviewsPage.outOfReviews", {
                count: stats.total,
              })}
            </span>
            {stats.weekDelta > 0 && (
              <span className="inline-flex h-6 items-center rounded-full bg-slate-200 px-2.5 text-[12px] font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                +{stats.weekDelta}{" "}
                {t("admin.reviewsPage.thisWeek")}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col justify-between py-1">
        <div className="space-y-2">
          {STAR_LEVELS.map((level) => {
            const count = stats.breakdown[level] || 0;
            const width = stats.total
              ? Math.round((count / stats.total) * 100)
              : 0;

            return (
              <div
                key={level}
                className="grid h-4 grid-cols-[112px_minmax(0,1fr)_16px] items-center gap-x-4"
              >
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <Star
                      key={idx}
                      className={cn(
                        "h-4 w-4",
                        idx < level
                          ? "fill-[#1f5cff] text-[#1f5cff] dark:fill-blue-400 dark:text-blue-400"
                          : "fill-[#d9dde4] text-[#d9dde4] dark:fill-slate-700 dark:text-slate-700",
                      )}
                    />
                  ))}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#e3e6eb] dark:bg-slate-800">
                  <div
                    className="h-2 rounded-full bg-[#1f5cff] transition-[width] dark:bg-blue-500"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="text-right text-[14px] font-medium leading-none text-slate-500 dark:text-slate-400">
                  {count}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 text-[14px] font-medium leading-6 text-slate-500 dark:text-slate-400">
          <span>
            {t("admin.reviewsPage.overallPerformance")}
          </span>
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-semibold",
              TIER_STYLES[tier],
            )}
          >
            {tierLabel[tier]}
          </span>
        </div>
      </div>
    </Card>
  );
}
