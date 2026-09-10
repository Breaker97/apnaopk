"use client";

import Image from "next/image";
import { AlertCircle, Loader2, Send, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";
import type { StaffHeaderData, StaffStats } from "./staff-detail-types";

interface StaffDetailHeaderProps {
  data: StaffHeaderData;
  stats: StaffStats | null;
  /** Live from the form, so the badges track unsaved edits. */
  permissionCount: number;
  totalPermissions: number;
  /** Live staff-access toggle, which is separate from the account status. */
  accessEnabled: boolean;
  hasPosAccess: boolean;
  loading?: boolean;
  statsLoading?: boolean;
  statsError?: boolean;
  onSendInvite?: () => void;
  invitePending?: boolean;
  inviteDisabled?: boolean;
}

const STATUS_META: Record<
  string,
  { label: string; variant: "default" | "outline" | "destructive"; dot: string }
> = {
  active: { label: "Active", variant: "default", dot: "bg-emerald-500" },
  inactive: { label: "Inactive", variant: "outline", dot: "bg-amber-500" },
  banned: { label: "Banned", variant: "destructive", dot: "bg-destructive" },
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

/** "2h ago" for anything inside a week, an absolute date beyond it. */
function relativeDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const diffMs = Date.now() - parsed.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function KpiCell({
  label,
  value,
  hint,
  loading,
  unavailable,
}: {
  label: string;
  value: string;
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

export function StaffDetailHeader({
  data,
  stats,
  permissionCount,
  totalPermissions,
  accessEnabled,
  hasPosAccess,
  loading = false,
  statsLoading,
  statsError = false,
  onSendInvite,
  invitePending = false,
  inviteDisabled = false,
}: StaffDetailHeaderProps) {
  const { formatPrice } = useCurrency();
  const status = STATUS_META[data.status] ?? STATUS_META.active;
  const kpiLoading = statsLoading ?? loading;
  const counts = stats;
  const lastOrder = relativeDate(counts?.lastOrderAt);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-4">
          {loading ? (
            <Skeleton className="h-14 w-14 shrink-0 rounded-lg" />
          ) : (
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-primary/10 text-lg font-semibold text-primary">
              {data.image ? (
                <Image
                  src={data.image}
                  alt={data.name || "Staff member"}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : data.name ? (
                initials(data.name)
              ) : (
                <UserRound className="h-6 w-6 text-muted-foreground" />
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
                    {data.name || "Unnamed staff member"}
                  </h2>
                  <Badge variant={status.variant} className="gap-1.5">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", status.dot)}
                    />
                    {status.label}
                  </Badge>
                  {/* Access is its own switch: an active account whose staff
                      access is off still cannot open the dashboard. */}
                  {!accessEnabled && (
                    <Badge variant="outline" className="gap-1">
                      Access off
                    </Badge>
                  )}
                  {data.department && (
                    <Badge variant="outline">{data.department}</Badge>
                  )}
                  {hasPosAccess && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" />
                      POS access
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 truncate text-sm text-muted-foreground">
                  <span>{data.email || "—"}</span>
                  {data.phone ? <span>{data.phone}</span> : null}
                  {data.jobTitle ? <span>{data.jobTitle}</span> : null}
                </p>
              </>
            )}
          </div>
        </div>

        {onSendInvite && !loading ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSendInvite}
              disabled={invitePending || inviteDisabled}
            >
              {invitePending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {data.hasPassword ? "Send password link" : "Send invite email"}
            </Button>
          </div>
        ) : null}
      </div>

      {statsError && !kpiLoading && (
        <div className="flex items-center gap-2 border-t bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Order figures could not be loaded. Refresh to try again.
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-y border-t sm:grid-cols-4 sm:divide-y-0">
        <KpiCell
          label="Orders processed"
          value={(counts?.orderCount ?? 0).toLocaleString()}
          hint={
            counts
              ? `${counts.posOrderCount.toLocaleString()} POS · ${counts.onlineOrderCount.toLocaleString()} online`
              : undefined
          }
          loading={kpiLoading}
          unavailable={statsError && !counts}
        />
        <KpiCell
          label="Sales handled"
          value={formatPrice(counts?.totalSales ?? 0)}
          hint="Paid orders"
          loading={kpiLoading}
          unavailable={statsError && !counts}
        />
        <KpiCell
          label="Permissions"
          value={`${permissionCount} / ${totalPermissions}`}
          hint={permissionCount === 0 ? "No access granted" : undefined}
          loading={loading}
        />
        <KpiCell
          label="Last order"
          value={lastOrder ?? "—"}
          hint={lastOrder ? undefined : "No orders yet"}
          loading={kpiLoading}
          unavailable={statsError && !counts}
        />
      </div>
    </div>
  );
}
