"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import type { POSLineDiscount } from "@/components/pos/pos-types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

const QUICK_PERCENTS = [5, 10, 15, 20];

interface POSLineDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string | null;
  itemName: string;
  lineSubtotal: number;
  current: POSLineDiscount | null;
  onApply: (itemId: string, discount: POSLineDiscount | null) => void;
}

export function POSLineDiscountDialog({
  open,
  onOpenChange,
  itemId,
  itemName,
  lineSubtotal,
  current,
  onApply,
}: POSLineDiscountDialogProps) {
  const { currency, formatPrice } = useCurrency();
  const currencySymbol = currency?.symbol || currency?.code || "";
  const [type, setType] = React.useState<"percent" | "amount">("percent");
  const [value, setValue] = React.useState<string>("");

  // Reset form when dialog opens
  useApplyOnChange([open, current], () => {
    if (!open) return;
    if (current) {
      setType(current.type);
      setValue(String(current.value));
    } else {
      setType("percent");
      setValue("");
    }
  });

  const numericValue = parseFloat(value) || 0;
  const discountAmount =
    type === "percent"
      ? (lineSubtotal * Math.min(numericValue, 100)) / 100
      : Math.min(numericValue, lineSubtotal);
  const newLineTotal = Math.max(0, lineSubtotal - discountAmount);

  const handleQuickPercent = (p: number) => {
    setType("percent");
    setValue(String(p));
  };

  const handleApply = () => {
    if (!itemId) return;
    if (numericValue <= 0) {
      onApply(itemId, null);
    } else {
      onApply(itemId, {
        type,
        value: numericValue,
      });
    }
    onOpenChange(false);
  };

  const handleRemove = () => {
    if (!itemId) return;
    onApply(itemId, null);
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="bg-background w-full max-w-md rounded-2xl border shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-2 duration-300">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="min-w-0 flex-1 pr-2">
            <h2 className="text-base font-semibold">Line discount</h2>
            <p className="truncate text-xs text-muted-foreground">{itemName}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="space-y-5 p-5">
          {/* Tabs */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
            <button
              type="button"
              onClick={() => setType("percent")}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-all",
                type === "percent"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Percent
            </button>
            <button
              type="button"
              onClick={() => setType("amount")}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-medium transition-all",
                type === "amount"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Amount
            </button>
          </div>

          {/* Quick percent buttons */}
          {type === "percent" ? (
            <div className="grid grid-cols-4 gap-2">
              {QUICK_PERCENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleQuickPercent(p)}
                  className={cn(
                    "h-10 rounded-xl border text-sm font-medium transition-all",
                    numericValue === p && type === "percent"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 hover:border-primary/50 hover:bg-primary/5",
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
          ) : null}

          {/* Input */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {type === "percent" ? "Percent off" : "Amount off"}
            </label>
            <div className="relative">
              {type === "percent" ? (
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  %
                </span>
              ) : (
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  {currencySymbol}
                </span>
              )}
              <Input
                type="number"
                min={0}
                step={type === "percent" ? "1" : "0.01"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={type === "percent" ? "10" : "0.00"}
                className="h-11 rounded-xl pl-9 text-sm"
                autoFocus
              />
            </div>
          </div>

          {/* New line total preview */}
          <div className="rounded-xl bg-muted/40 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">New line total</span>
              <span className="text-base font-semibold tabular-nums">
                {formatPrice(newLineTotal)}
              </span>
            </div>
            {discountAmount > 0 ? (
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>You save</span>
                <span className="tabular-nums">
                  {formatPrice(discountAmount)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
          {current ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              className="rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Remove
            </Button>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            className="rounded-xl bg-primary px-5 text-white hover:bg-primary/90"
          >
            <Check className="mr-1 h-4 w-4" />
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
