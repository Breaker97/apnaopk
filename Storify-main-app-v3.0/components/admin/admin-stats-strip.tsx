import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface AdminStatsStripItem {
  title: string;
  value: string | number;
  description: string;
  icon: ReactNode;
  iconClassName?: string;
}

interface AdminStatsStripProps {
  items: AdminStatsStripItem[];
  /** Full responsive column spec. Omit it: the columns follow the cell count. */
  columnsClassName?: string;
}

function getIconThemeClasses(iconClassName?: string) {
  if (!iconClassName) {
    return "bg-muted text-muted-foreground dark:bg-muted/70 dark:text-foreground";
  }

  if (iconClassName.includes("blue")) {
    return `${iconClassName} dark:bg-blue-500/20 dark:text-blue-300`;
  }
  if (iconClassName.includes("green")) {
    return `${iconClassName} dark:bg-green-500/20 dark:text-green-300`;
  }
  if (iconClassName.includes("indigo")) {
    return `${iconClassName} dark:bg-indigo-500/20 dark:text-indigo-300`;
  }
  if (iconClassName.includes("violet")) {
    return `${iconClassName} dark:bg-violet-500/20 dark:text-violet-300`;
  }
  if (iconClassName.includes("cyan")) {
    return `${iconClassName} dark:bg-cyan-500/20 dark:text-cyan-300`;
  }
  if (iconClassName.includes("teal")) {
    return `${iconClassName} dark:bg-teal-500/20 dark:text-teal-300`;
  }
  if (iconClassName.includes("amber")) {
    return `${iconClassName} dark:bg-amber-500/20 dark:text-amber-300`;
  }
  if (iconClassName.includes("orange")) {
    return `${iconClassName} dark:bg-orange-500/20 dark:text-orange-300`;
  }
  if (iconClassName.includes("rose")) {
    return `${iconClassName} dark:bg-rose-500/20 dark:text-rose-300`;
  }

  return `${iconClassName} dark:bg-muted/70 dark:text-foreground`;
}

/**
 * Column tracks per cell count, so a strip of N cells fills the row instead of
 * leaving an empty divided cell at the end of a fixed five-column grid. Spelled
 * out per count because Tailwind only ships class names it can see in source.
 */
const stripColumns: Record<number, string> = {
  1: "",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
  4: "md:grid-cols-2 lg:grid-cols-4",
  5: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

function stripColumnsFor(count: number) {
  return stripColumns[count] ?? "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
}

export function AdminStatsStrip({
  items,
  columnsClassName,
}: AdminStatsStripProps) {
  return (
    <Card className="overflow-hidden rounded-[12px] border border-border/70 p-0 shadow-sm">
      <div
        className={`grid grid-cols-1 divide-y divide-border md:divide-x md:divide-y-0 ${columnsClassName ?? stripColumnsFor(items.length)}`}
      >
        {items.map((item) => (
          <div key={item.title} className="px-6 py-4">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-0 pt-0">
              <CardTitle className="text-sm font-medium text-foreground/85">
                {item.title}
              </CardTitle>
              <div
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-black/5 [&_svg]:h-4 [&_svg]:w-4 dark:ring-white/10 ${getIconThemeClasses(item.iconClassName)}`}
              >
                {item.icon}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 px-0 pb-0">
              <p className="text-xl font-bold tracking-tight text-foreground">
                {typeof item.value === "number"
                  ? item.value.toLocaleString()
                  : item.value}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.description}
              </p>
            </CardContent>
          </div>
        ))}
      </div>
    </Card>
  );
}

interface AdminStatsStripSkeletonProps {
  items?: number;
  /** Only needed when the real strip also overrides its columns. */
  columnsClassName?: string;
}

/**
 * Placeholder for the strip above. It reproduces the real markup — ONE card
 * whose cells are separated by dividers — rather than N free-floating tiles,
 * because the strip renders while a server component is still aggregating its
 * counts and a differently-shaped placeholder reflows the page underneath it.
 */
export function AdminStatsStripSkeleton({
  items = 5,
  columnsClassName,
}: AdminStatsStripSkeletonProps) {
  return (
    <Card className="overflow-hidden rounded-[12px] border border-border/70 p-0 shadow-sm">
      <div
        className={`grid grid-cols-1 divide-y divide-border md:divide-x md:divide-y-0 ${columnsClassName ?? stripColumnsFor(items)}`}
      >
        {Array.from({ length: items }).map((_, index) => (
          <div key={`admin-stat-skeleton-${index}`} className="px-6 py-4">
            <div className="flex flex-row items-center justify-between">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
