"use client";

import * as React from "react";
import { Check, Printer, FileText, Plus, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
}: POSSaleCompleteModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
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

          {/* Title */}
          <h2 className="text-xl font-semibold tracking-tight">
            Sale complete
          </h2>

          {/* Order number */}
          <p className="mt-1.5 font-mono text-xs text-muted-foreground">
            {orderNumber}
          </p>

          {/* Total */}
          <div className="mt-5 w-full">
            <p className="text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
              {fp(total)}
            </p>
            {itemCount !== undefined ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {itemCount} {itemCount === 1 ? "item" : "items"}
                {paymentMethod ? ` · ${paymentMethod}` : ""}
              </p>
            ) : null}
            {locationName ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                <Store className="h-3 w-3" />
                Sold at {locationName}
              </p>
            ) : null}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-2 border-t bg-muted/30 px-4 py-4 sm:gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onViewReceipt}
            className="h-10 flex-1 rounded-xl text-sm font-medium text-foreground hover:bg-muted"
          >
            <FileText className="mr-1.5 h-4 w-4" />
            View receipt
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onPrintReceipt}
            className="h-10 flex-1 rounded-xl text-sm font-medium text-foreground hover:bg-muted"
          >
            <Printer className="mr-1.5 h-4 w-4" />
            Print receipt
          </Button>
          <Button
            type="button"
            onClick={onNewSale}
            className="h-10 flex-1 rounded-xl bg-primary text-sm font-semibold text-white hover:bg-primary/90"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New sale
          </Button>
        </div>
      </div>
    </div>
  );
}
