"use client";

import { Circle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  inventoryValuationReport,
  inventoryMovementHistory,
} from "@/lib/inventory/finance-reports";

export type Report = Awaited<ReturnType<typeof inventoryValuationReport>>;
export type Position = Report["positions"][number];
export type History = Awaited<ReturnType<typeof inventoryMovementHistory>>;
export type Movement = History["items"][number];
export type Label = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;
export type Money = (value: number, currency: string) => string;
export type Action = "receipts" | "adjustments" | "valuation-changes";
export type Preview = {
  delta?: number;
  valueDelta?: number;
  purchaseAmount?: number;
  variance?: number;
  currency?: string;
  positions?: Array<{
    key: string;
    version: number;
    oldValue: number;
    newValue: number;
    currency: string;
  }>;
  productVersion?: string;
};

/** "2026-10-10" in the viewer's own days. */
export function toLocalDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Midnight of a "2026-10-10" day, in the viewer's timezone. */
export function fromLocalDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function InventorySelect({
  id,
  value,
  onChange,
  options,
  disabled,
  placeholder,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select
      value={value || "__all"}
      onValueChange={(next) => onChange(next === "__all" ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || "__all"}
            value={option.value || "__all"}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Where a stock change's ledger entry stands, in plain words. */
export function ledgerState(state: string): "posted" | "waiting" | "review" {
  if (state === "complete" || state === "synced") return "posted";
  if (state === "pending" || state === "posting_pending") return "waiting";
  return "review";
}

const LEDGER_BADGE = {
  posted: {
    key: "ledgerPosted",
    fallback: "Posted",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  waiting: {
    key: "ledgerWaiting",
    fallback: "Waiting to post",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  },
  review: {
    key: "ledgerReview",
    fallback: "Needs review",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  },
} as const;

/** The Orders table's dot badge, for a stock change's ledger entry. */
export function LedgerBadge({ state, label }: { state: string; label: Label }) {
  const badge = LEDGER_BADGE[ledgerState(state)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-[12px] font-medium",
        badge.className,
      )}
    >
      <Circle aria-hidden="true" className="h-2.5 w-2.5 fill-current stroke-0" />
      {label(badge.key, badge.fallback)}
    </span>
  );
}
