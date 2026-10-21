"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import {
  CloudOff,
  Loader2,
  LogIn,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OfflineSale } from "@/lib/pos/offline-db";

interface POSOfflineBannerProps {
  isOffline: boolean;
  snapshotAt: string | null;
  queued: OfflineSale[];
  isSyncing: boolean;
  /** The server said this session may no longer use the register. */
  sessionExpired?: boolean;
  onSync: () => void;
  /** Opens the list of sales the server refused, for a human to settle. */
  onReview: () => void;
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
  sessionExpired = false,
  onSync,
  onReview,
}: POSOfflineBannerProps) {
  const t = useTranslations("pos.offline");
  const format = useFormatter();
  // Re-rendered each minute, so "Stock shown is from 5 minutes ago" ages.
  const now = useNow({ updateInterval: 60_000 });
  const pending = queued.filter((sale) => sale.status !== "needs_review").length;
  const needsReview = queued.filter(
    (sale) => sale.status === "needs_review",
  ).length;

  if (!isOffline && !sessionExpired && pending === 0 && needsReview === 0) {
    return null;
  }

  const snapshotAge =
    snapshotAt && !Number.isNaN(new Date(snapshotAt).getTime())
      ? format.relativeTime(new Date(snapshotAt), now)
      : null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3 py-2 text-sm",
        isOffline
          ? "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : sessionExpired || needsReview > 0
            ? "border-red-500/40 bg-red-500/10 text-red-900 dark:text-red-200"
            : "border-border/60 bg-muted/60 text-foreground",
      )}
    >
      {isOffline ? (
        <>
          <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-medium">{t("bannerOffline")}</span>
          {snapshotAge && (
            <span className="text-xs opacity-80">
              {t("bannerStockAge", { age: snapshotAge })}
            </span>
          )}
        </>
      ) : sessionExpired ? (
        // The server is reachable and refused the session. Said plainly,
        // because every other signal here ("waiting to sync") reads as the
        // network, and the cashier would wait for a line that is not down.
        <>
          <LogIn className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-medium">{t("bannerSignedOut")}</span>
          <span className="text-xs opacity-80">{t("bannerSignedOutNote")}</span>
        </>
      ) : (
        <>
          <RefreshCw className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-medium">{t("bannerBackOnline")}</span>
        </>
      )}

      {pending > 0 && (
        <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium">
          {t("waitingToSync", { count: pending })}
        </span>
      )}

      {needsReview > 0 && (
        <button
          type="button"
          onClick={onReview}
          className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline"
        >
          <TriangleAlert className="h-3 w-3" aria-hidden />
          {t("needsReview", { count: needsReview })}
        </button>
      )}

      {!isOffline && (pending > 0 || needsReview > 0) && (
        <div className="ml-auto flex items-center gap-1">
          {needsReview > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={onReview}
            >
              {t("review")}
            </Button>
          )}
          {sessionExpired ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => window.location.reload()}
            >
              {t("signIn")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={onSync}
              disabled={isSyncing}
            >
              {isSyncing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("syncNow")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
