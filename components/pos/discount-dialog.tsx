"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

export type POSDiscountType = "percent" | "amount";

export interface POSDiscount {
  type: POSDiscountType;
  value: number;
  reason?: string;
  note?: string;
}

interface POSDiscountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subtotal: number;
  /** The sale is taxed after this discount, so the preview needs the rate. */
  taxRate: number;
  taxIncluded: boolean;
  current: POSDiscount | null;
  onApply: (discount: POSDiscount | null) => void;
  fp: (amount: number) => string;
}

const REASON_OPTIONS = [
  { value: "", label: "— Choose a reason —" },
  { value: "loyalty", label: "Loyalty / Returning customer" },
  { value: "damage", label: "Damaged item" },
  { value: "staff", label: "Staff discount" },
  { value: "price_match", label: "Price match" },
  { value: "promo", label: "Promotion" },
  { value: "other", label: "Other" },
];

const QUICK_PERCENTS = [5, 10, 15, 20];

export function POSDiscountDialog({
  open,
  onOpenChange,
  subtotal,
  taxRate,
  taxIncluded,
  current,
  onApply,
  fp,
}: POSDiscountDialogProps) {
  const [type, setType] = React.useState<POSDiscountType>("percent");
  const [value, setValue] = React.useState<string>("");
  const [reason, setReason] = React.useState<string>("");
  const [note, setNote] = React.useState<string>("");

  // Reset form when dialog opens
  useApplyOnChange([open, current], () => {
    if (!open) return;
    if (current) {
      setType(current.type);
      setValue(String(current.value));
      setReason(current.reason ?? "");
      setNote(current.note ?? "");
    } else {
      setType("percent");
      setValue("");
      setReason("");
      setNote("");
    }
  });

  const numericValue = parseFloat(value) || 0;
  const discountAmount =
    type === "percent" ? (subtotal * Math.min(numericValue, 100)) / 100 : Math.min(numericValue, subtotal);
  const newTotal = taxIncluded
    ? Math.max(0, subtotal - discountAmount)
    : Math.max(0, subtotal - discountAmount) * (1 + taxRate);
  // A till discount says why, for the audit trail and the reports.
  const needsReason = numericValue > 0 && !reason;

  const handleQuickPercent = (p: number) => {
    setType("percent");
    setValue(String(p));
  };

  const handleApply = () => {
    if (numericValue <= 0) {
      onApply(null);
    } else {
      onApply({
        type,
        value: numericValue,
        reason: reason || undefined,
        note: note || undefined,
      });
    }
    onOpenChange(false);
  };

  const handleRemove = () => {
    onApply(null);
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
          <h2 className="text-base font-semibold">Order-level discount</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
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
                  ? "bg-background shadow-sm text-foreground"
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
                  $
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

          {/* New total preview */}
          <div className="rounded-xl bg-muted/40 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">New total</span>
              <span className="text-base font-semibold tabular-nums">
                {fp(newTotal)}
              </span>
            </div>
            {discountAmount > 0 ? (
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>You save</span>
                <span className="tabular-nums">{fp(discountAmount)}</span>
              </div>
            ) : null}
          </div>

          {/* Reason */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Reason
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-11 w-full rounded-xl border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Note (optional)
            </label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. price match with competitor"
              className="h-11 rounded-xl text-sm"
            />
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
            disabled={needsReason}
            title={needsReason ? "Choose a reason for the discount" : undefined}
            className="rounded-xl bg-primary px-5 text-white hover:bg-primary/90"
          >
            <span className="mr-1">✓</span>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
