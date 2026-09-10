"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";
import type {
  CustomerHeaderData,
  CustomerStatus,
  LoyaltyTier,
} from "./customer-detail-types";

interface CustomerDetailHeaderProps {
  data: CustomerHeaderData;
  /** Skeletonize the identity block (avatar, name, badges, email). */
  loading?: boolean;
  /** Skeletonize only the KPI values. Defaults to `loading`. */
  statsLoading?: boolean;
}

function getInitials(name?: string) {
  if (!name) return "CU";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

const STATUS_META: Record<
  CustomerStatus,
  { label: string; variant: "default" | "outline" | "destructive"; dot: string }
> = {
  active: { label: "Active", variant: "default", dot: "bg-emerald-500" },
  inactive: { label: "Inactive", variant: "outline", dot: "bg-muted-foreground" },
  banned: { label: "Banned", variant: "destructive", dot: "bg-destructive" },
};

const TIER_META: Record<LoyaltyTier, { label: string; className: string }> = {
  bronze: {
    label: "Bronze",
    className: "bg-amber-700/10 text-amber-700 dark:text-amber-500",
  },
  silver: {
    label: "Silver",
    className: "bg-slate-400/15 text-slate-600 dark:text-slate-300",
  },
  gold: {
    label: "Gold",
    className: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-500",
  },
  platinum: {
    label: "Platinum",
    className: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  },
};

function formatRelative(date?: string) {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  const days = Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function KpiCell({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-20" />
      ) : (
        <p className="mt-0.5 truncate text-lg font-semibold tabular-nums">
          {value}
        </p>
      )}
    </div>
  );
}

export function CustomerDetailHeader({
  data,
  loading = false,
  statsLoading,
}: CustomerDetailHeaderProps) {
  const { formatPrice } = useCurrency();
  const status = STATUS_META[data.status] ?? STATUS_META.active;
  const tier = TIER_META[data.loyaltyTier] ?? TIER_META.bronze;
  const stats = data.stats || {};
  const kpiLoading = statsLoading ?? loading;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-4">
          {loading ? (
            <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
          ) : (
            <Avatar className="h-14 w-14">
              <AvatarImage src={data.image} alt={data.name || "Customer"} />
              <AvatarFallback>{getInitials(data.name)}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-44" />
                <Skeleton className="h-4 w-56" />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold">
                    {data.name || "Unknown customer"}
                  </h2>
                  <Badge
                    variant="secondary"
                    className={cn("font-medium", tier.className)}
                  >
                    {tier.label}
                  </Badge>
                  <Badge variant={status.variant} className="gap-1.5">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", status.dot)}
                    />
                    {status.label}
                  </Badge>
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {data.email}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y border-t sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
        <KpiCell
          label="Total spent"
          value={formatPrice(stats.totalSpent ?? 0)}
          loading={kpiLoading}
        />
        <KpiCell
          label="Orders"
          value={(stats.totalOrders ?? 0).toLocaleString()}
          loading={kpiLoading}
        />
        <KpiCell
          label="Avg. order"
          value={formatPrice(stats.averageOrderValue ?? 0)}
          loading={kpiLoading}
        />
        <KpiCell
          label="Last order"
          value={formatRelative(stats.lastOrderDate)}
          loading={kpiLoading}
        />
        <KpiCell
          label="Loyalty points"
          value={(data.loyaltyPoints ?? 0).toLocaleString()}
          loading={kpiLoading}
        />
      </div>
    </div>
  );
}
