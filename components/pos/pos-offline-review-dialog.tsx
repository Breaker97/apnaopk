"use client";

import * as React from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Loader2, RotateCw, Store, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import type { OfflineSale } from "@/lib/pos/offline-db";

interface POSOfflineReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only the sales the server refused; the caller filters. */
  sales: OfflineSale[];
  onRetry: (clientRequestId: string) => Promise<void>;
  onDiscard: (clientRequestId: string) => Promise<void>;
  formatPrice: (value: number) => string;
  /** The counter a sale was taken at, by its outbox scope. */
  locationNameFor: (scope: string) => string | null;
}

/**
 * The way out for a sale the server refused.
 *
 * A refused offline sale is money already in the drawer for goods already
 * gone, so the queue keeps it rather than dropping it — but a count on the
 * banner was all that existed, and a count has no way out. These sales were
 * never retried (the drain skips them) and could only be cleared by wiping the
 * browser's site data, which the lock screen rightly tells cashiers never to
 * do. So: what was sold, what the server said, and two honest ways to settle
 * it — send it again once the cause is fixed, or forget it once it has been
 * recorded by hand.
 *
 * Discarding is the one destructive action in the whole offline path and is
 * confirmed, with the receipt number in the question, because the receipt is
 * what the customer is holding.
 */
export function POSOfflineReviewDialog({
  open,
  onOpenChange,
  sales,
  onRetry,
  onDiscard,
  formatPrice,
  locationNameFor,
}: POSOfflineReviewDialogProps) {
  const t = useTranslations("pos.offline");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const { confirm } = useConfirmation();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  if (!open) return null;

  const run = async (
    clientRequestId: string,
    action: (clientRequestId: string) => Promise<void>,
  ) => {
    setBusyId(clientRequestId);
    try {
      await action(clientRequestId);
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (sale: OfflineSale) => {
    const confirmed = await confirm({
      type: "danger",
      title: t("discardTitle"),
      description: t("discardDescription", { number: sale.localReceiptNumber }),
      confirmText: t("reviewDiscard"),
      confirmVariant: "destructive",
    });
    if (!confirmed) return;
    await run(sale.clientRequestId, onDiscard);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("reviewLabel")}
        className="bg-background flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300"
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <TriangleAlert className="h-4 w-4 text-red-600" aria-hidden />
              {t("reviewTitle")}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("reviewDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5">
          {sales.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t("reviewEmpty")}
            </p>
          ) : (
            sales.map((sale) => {
              const queuedAt = new Date(sale.queuedAt);
              const validDate = !Number.isNaN(queuedAt.getTime());
              const counter = locationNameFor(sale.scope);
              const busy = busyId === sale.clientRequestId;
              return (
                <div
                  key={sale.clientRequestId}
                  className="rounded-xl border border-border/60 bg-card p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="text-sm font-semibold">
                      {t("reviewReceipt", { number: sale.localReceiptNumber })}
                    </div>
                    <div className="text-sm font-semibold tabular-nums">
                      {formatPrice(sale.total)}
                    </div>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {validDate ? (
                      <span
                        title={format.dateTime(queuedAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      >
                        {t("reviewTaken", {
                          time: format.relativeTime(queuedAt, now),
                        })}
                      </span>
                    ) : null}
                    {counter ? (
                      <span className="inline-flex items-center gap-1">
                        <Store className="h-3 w-3" aria-hidden />
                        {counter}
                      </span>
                    ) : null}
                    <span>{t("reviewAttempts", { count: sale.attempts })}</span>
                  </div>

                  <ul className="mt-2 space-y-0.5 text-sm">
                    {sale.items.map((item, index) => (
                      <li
                        key={`${sale.clientRequestId}-${index}`}
                        className="flex justify-between gap-3"
                      >
                        <span className="min-w-0 truncate">
                          {item.quantity} × {item.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatPrice(item.price * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {sale.lastError ? (
                    <p className="mt-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-900 dark:text-red-200">
                      {t("reviewServerSaid", { message: sale.lastError })}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={busy}
                      onClick={() => void discard(sale)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {t("reviewDiscard")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8"
                      disabled={busy}
                      onClick={() => void run(sale.clientRequestId, onRetry)}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        <RotateCw className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {t("reviewSendAgain")}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
