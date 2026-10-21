"use client";

import { useTranslations } from "next-intl";
import { Check, Printer, FileText, Plus, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { POSReceiptSender } from "@/components/pos/pos-receipt-sender";

interface POSSaleCompleteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber: string;
  total: number;
  itemCount?: number;
  onViewReceipt: () => void;
  onPrintReceipt: () => void;
  onNewSale: () => void;
  fp: (amount: number) => string;
  /** Optional payment method label, e.g. "Cash", "Card" */
  paymentMethod?: string | null;
  /**
   * The counter the sale was rung up at. Shown because this is the last moment
   * the cashier can catch having sold from the wrong branch — after this the
   * only trace is the order record.
   */
  locationName?: string | null;
  /**
   * The sale's server id. Null for a sale queued offline: there is nothing to
   * fetch an invoice for or send a receipt of until it syncs.
   */
  orderId?: string | null;
  /** The sale's customer, the receipt's default recipient. */
  defaultEmail?: string;
  defaultPhone?: string;
  /** Which ways this store can send a receipt (`lib/pos/pos-seat-settings.ts`). */
  receiptChannels?: { email: boolean; sms: boolean };
}

export function POSSaleCompleteModal({
  open,
  onOpenChange,
  orderNumber,
  total,
  itemCount,
  onViewReceipt,
  onPrintReceipt,
  onNewSale,
  fp,
  paymentMethod,
  locationName,
  orderId,
  defaultEmail,
  defaultPhone,
  receiptChannels,
}: POSSaleCompleteModalProps) {
  const t = useTranslations("pos.complete");
  const synced = Boolean(orderId);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className={cn(
          "bg-background w-full max-w-md overflow-hidden rounded-2xl border shadow-2xl",
          "animate-in zoom-in-95 slide-in-from-bottom-2 duration-300",
        )}
      >
        <div className="flex flex-col items-center px-6 pt-8 pb-6 text-center sm:px-8">
          {/* Success icon */}
          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute inset-0 -m-2 rounded-full bg-emerald-500/10 animate-ping" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <Check
                className="h-8 w-8 text-emerald-600 dark:text-emerald-400"
                strokeWidth={2.5}
              />
            </div>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">{orderNumber}</p>

          <div className="mt-5 w-full">
            <p className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              {fp(total)}
            </p>
            {itemCount !== undefined ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("items", { count: itemCount })}
                {paymentMethod ? ` · ${paymentMethod}` : ""}
              </p>
            ) : null}
            {locationName ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                <Store className="h-3 w-3" />
                {t("soldAt", { name: locationName })}
              </p>
            ) : null}
          </div>

          {/* Email or text the receipt. A queued sale has no server record yet. */}
          <div className="mt-5 w-full">
            <POSReceiptSender
              orderId={orderId ?? null}
              defaultEmail={defaultEmail}
              defaultPhone={defaultPhone}
              receiptChannels={receiptChannels}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-2 border-t bg-muted/30 px-4 py-4 sm:gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onViewReceipt}
            disabled={!synced}
            title={!synced ? t("offlineHint") : undefined}
            className="h-10 flex-1 rounded-xl text-sm font-medium text-foreground hover:bg-muted"
          >
            <FileText className="mr-1.5 h-4 w-4" />
            {t("viewReceipt")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onPrintReceipt}
            className="h-10 flex-1 rounded-xl text-sm font-medium text-foreground hover:bg-muted"
          >
            <Printer className="mr-1.5 h-4 w-4" />
            {t("printReceipt")}
          </Button>
          <Button
            type="button"
            onClick={onNewSale}
            className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-white hover:bg-primary/90"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t("newSale")}
          </Button>
        </div>
      </div>
    </div>
  );
}
