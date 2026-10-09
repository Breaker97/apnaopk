"use client";

import Image from "next/image";
import { AlertCircle, BadgeCheck, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";
import { VENDOR_STATUS } from "@/config/app.config";
import { cn } from "@/lib/utils";
import type { VendorHeaderData, VendorStats } from "./vendor-detail-types";

interface VendorDetailHeaderProps {
  data: VendorHeaderData;
  /** Commerce counts, loaded independently of the identity block. */
  stats: VendorStats | null;
  /** Live commission from the vendor form, so the KPI tracks unsaved edits. */
  commission?: number;
  /** Live verification flag from the form, for the same reason as commission. */
  verified?: boolean;
  /** Skeletonize the identity block (logo, store name, status, owner email). */
  loading?: boolean;
  /** Skeletonize only the KPI values. Defaults to `loading`. */
  statsLoading?: boolean;
  /** Set when the stats request failed, so zeros aren't shown as fact. */
  statsError?: boolean;
}

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "outline" | "destructive"; dot: string }
> = {
  [VENDOR_STATUS.APPROVED]: {
    label: "Approved",
    variant: "default",
    dot: "bg-emerald-500",
  },
  [VENDOR_STATUS.PENDING]: {
    label: "Pending",
    variant: "outline",
    dot: "bg-amber-500",
  },
  [VENDOR_STATUS.PAYMENT_REQUIRED]: {
    label: "Payment Required",
    variant: "outline",
    dot: "bg-blue-500",
  },
  [VENDOR_STATUS.SUSPENDED]: {
    label: "Suspended",
    variant: "destructive",
    dot: "bg-destructive",
  },
  [VENDOR_STATUS.REJECTED]: {
    label: "Rejected",
    variant: "destructive",
    dot: "bg-destructive",
  },
};

function KpiCell({
  label,
  value,
  hint,
  loading,
  unavailable,
}: {
  label: string;
  value: string;
  /** Muted second line: what the headline figure leaves out. */
  hint?: string;
  loading?: boolean;
  /** Render a dash instead of a figure the request never delivered. */
  unavailable?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-20" />
      ) : (
        <p className="mt-0.5 truncate text-lg font-semibold tabular-nums">
          {unavailable ? "—" : value}
        </p>
      )}
      {!loading && !unavailable && hint ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function VendorDetailHeader({
  data,
  stats,
  commission,
  verified = false,
  loading = false,
  statsLoading,
  statsError = false,
}: VendorDetailHeaderProps) {
  const { formatPrice } = useCurrency();
  const status = STATUS_META[data.status] ?? STATUS_META[VENDOR_STATUS.PENDING];
  const kpiLoading = statsLoading ?? loading;
  const counts = stats ?? {};

  const cancelledCount = counts.cancelledOrderCount ?? 0;
  // No per-currency hint beside the headline any more: sales charged before the
  // store currency changed are now folded into `totalSales` and relabelled, so
  // listing them again here would show the same money twice.

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-4">
          {loading ? (
            <Skeleton className="h-14 w-14 shrink-0 rounded-lg" />
          ) : (
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {data.logo ? (
                <Image
                  src={data.logo}
                  alt={data.storeName || "Store"}
                  fill
                  sizes="56px"
                  className="object-contain"
                />
              ) : (
                <Store className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
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
                    {data.storeName || "Unknown store"}
                  </h2>
                  <Badge variant={status.variant} className="gap-1.5">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", status.dot)}
                    />
                    {status.label}
                  </Badge>
                  {/* Mirrors the storefront badge, and tracks the Profile
                      switch live so an admin sees what they are awarding
                      before saving. */}
                  {verified && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    >
                      <BadgeCheck className="h-3.5 w-3.5" />
                      Verified
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {data.ownerEmail || "—"}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {statsError && !kpiLoading && (
        <div className="flex items-center gap-2 border-t bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Commerce counts could not be loaded. Refresh to try again.
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-y border-t sm:grid-cols-4 sm:divide-y-0">
        <KpiCell
          label="Products"
          value={(counts.productCount ?? 0).toLocaleString()}
          loading={kpiLoading}
          // A tab that has since loaded can supply its own count even when the
          // stats request failed, so each cell judges itself rather than
          // blanking the whole strip.
          unavailable={statsError && counts.productCount === undefined}
        />
        <KpiCell
          label="Orders"
          value={(counts.orderCount ?? 0).toLocaleString()}
          hint={
            cancelledCount > 0
              ? `${cancelledCount.toLocaleString()} cancelled`
              : undefined
          }
          loading={kpiLoading}
          unavailable={statsError && counts.orderCount === undefined}
        />
        <KpiCell
          label="Total sales"
          value={formatPrice(counts.totalSales ?? 0)}
          loading={kpiLoading}
          unavailable={statsError && counts.totalSales === undefined}
        />
        <KpiCell
          label="Commission"
          value={`${commission ?? 0}%`}
          loading={loading}
        />
      </div>
    </div>
  );
}
