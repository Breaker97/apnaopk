"use client";

import { formatDistanceToNow } from "date-fns";
import { CloudOff, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OfflineSale } from "@/lib/pos/offline-db";

interface POSOfflineBannerProps {
  isOffline: boolean;
  snapshotAt: string | null;
  queued: OfflineSale[];
  isSyncing: boolean;
  onSync: () => void;
}

/**
 * Tells the cashier which mode they are selling in, and what is still owed to
 * the server.
 *
 * Deliberately loud when offline and deliberately still present afterwards
 * while sales remain queued: a cashier who does not know the register is
 * offline will promise a customer an emailed receipt that cannot be sent, and a
 * shift that ends with unsynced sales in a closed tab has money in the drawer
 * that the books do not know about.
 *
 * Renders nothing when the register is online and the queue is empty, which is
 * the overwhelmingly common state — a permanent status strip would train
 * everyone to stop reading it.
 */
export function POSOfflineBanner({
  isOffline,
  snapshotAt,
  queued,
  isSyncing,
  onSync,
}: POSOfflineBannerProps) {
  const pending = queued.filter((sale) => sale.status !== "needs_review").length;
  const needsReview = queued.filter(
    (sale) => sale.status === "needs_review",
  ).length;

  if (!isOffline && pending === 0 && needsReview === 0) return null;

  const snapshotAge =
    snapshotAt && !Number.isNaN(new Date(snapshotAt).getTime())
      ? formatDistanceToNow(new Date(snapshotAt), { addSuffix: true })
      : null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-sm",
        isOffline
          ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : needsReview > 0
            ? "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200"
            : "border-border/60 bg-muted/60 text-foreground",
      )}
    >
      {isOffline ? (
        <>
          <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-medium">Offline — sales are being queued</span>
          {snapshotAge && (
            <span className="text-xs opacity-80">
              Stock shown is from {snapshotAge}
            </span>
          )}
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-medium">Back online</span>
        </>
      )}

      {pending > 0 && (
        <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium">
          {pending} sale{pending === 1 ? "" : "s"} waiting to sync
        </span>
      )}

      {needsReview > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium">
          <TriangleAlert className="h-3 w-3" aria-hidden />
          {needsReview} need{needsReview === 1 ? "s" : ""} review
        </span>
      )}

      {!isOffline && (pending > 0 || needsReview > 0) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7"
          onClick={onSync}
          disabled={isSyncing}
        >
          {isSyncing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Sync now
        </Button>
      )}
    </div>
  );
}
