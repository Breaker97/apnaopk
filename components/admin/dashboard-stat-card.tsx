import type { ComponentProps, ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type DashboardStatTrendDirection = "up" | "down" | "neutral";

export interface DashboardStatTrendConfig {
  value: ReactNode;
  direction?: DashboardStatTrendDirection;
}

export interface DashboardStatCardItem {
  id: string;
  label: ReactNode;
  value: ReactNode;
  subLabel?: ReactNode;
  icon?: ReactNode;
  trend?: DashboardStatTrendConfig;
  className?: string;
}

interface DashboardStatCardProps extends Omit<
  ComponentProps<"article">,
  "children"
> {
  label: ReactNode;
  value: ReactNode;
  subLabel?: ReactNode;
  icon?: ReactNode;
  trend?: DashboardStatTrendConfig;
  /** When true, the label and icon stay visible but the value/sub-label swap to skeletons. */
  loading?: boolean;
}

interface DashboardStatsGridProps {
  stats: DashboardStatCardItem[];
  className?: string;
  cardClassName?: string;
}

interface DashboardStatTrendProps extends DashboardStatTrendConfig {
  className?: string;
}

const trendClassNames: Record<DashboardStatTrendDirection, string> = {
  up: "text-emerald-600",
  down: "text-red-500",
  neutral: "text-muted-foreground",
};

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

export function DashboardStatTrend({
  value,
  direction = "neutral",
  className,
}: DashboardStatTrendProps) {
  const Icon = trendIcons[direction];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs",
        trendClassNames[direction],
        className,
      )}
    >
      {value}
      <Icon className="size-3" />
    </span>
  );
}

export function DashboardStatCard({
  label,
  value,
  subLabel,
  icon,
  trend,
  loading = false,
  className,
  ...props
}: DashboardStatCardProps) {
  const valueTitle =
    typeof value === "string" || typeof value === "number"
      ? String(value)
      : undefined;

  return (
    <article
      className={cn(
        "!rounded-sm border border-border bg-card px-4 py-4",
        className,
      )}
      {...props}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs leading-none text-muted-foreground">
          {label}
        </p>
        {icon ? (
          <span className="shrink-0 text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-5 w-24" />
      ) : (
        <p
          className="truncate text-lg font-semibold leading-none tracking-tight text-foreground"
          title={valueTitle}
        >
          {value}
        </p>
      )}

      {loading ? (
        <div className="mt-2 flex items-center gap-2">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-10" />
        </div>
      ) : subLabel || trend ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs leading-none text-muted-foreground">
          {subLabel ? (
            <span className="min-w-0 truncate">{subLabel}</span>
          ) : null}
          {trend ? <DashboardStatTrend {...trend} /> : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Column track counts written out per card count, so a row of N cards fills the
 * full width instead of leaving empty tracks in a fixed six-column grid. The
 * classes are spelled out rather than built from the number because Tailwind
 * only ships the class names it can find in the source. Seven or more cards
 * wrap deliberately — a single row that narrow is unreadable.
 */
const statsGridColumns: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

export function statsGridColumnsFor(count: number) {
  return (
    statsGridColumns[count] ??
    "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
  );
}

export function DashboardStatsGrid({
  stats,
  className,
  cardClassName,
}: DashboardStatsGridProps) {
  return (
    <div
      className={cn("grid gap-3", statsGridColumnsFor(stats.length), className)}
    >
      {stats.map(({ id, className: itemClassName, ...stat }) => (
        <DashboardStatCard
          key={id}
          {...stat}
          className={cn(cardClassName, itemClassName)}
        />
      ))}
    </div>
  );
}

function DashboardStatCardSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "!rounded-sm border border-border bg-card px-4 py-4",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="size-4 rounded-full" />
      </div>
      <Skeleton className="h-5 w-24" />
      <div className="mt-2 flex items-center gap-2">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-10" />
      </div>
    </div>
  );
}

export function DashboardStatsGridSkeleton({
  items = 6,
  className,
  cardClassName,
}: {
  items?: number;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <div className={cn("grid gap-3", statsGridColumnsFor(items), className)}>
      {Array.from({ length: items }).map((_, index) => (
        <DashboardStatCardSkeleton
          key={`dashboard-stat-skeleton-${index}`}
          className={cardClassName}
        />
      ))}
    </div>
  );
}
