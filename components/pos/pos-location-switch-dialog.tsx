"use client";

import * as React from "react";
import {
  ArrowRight,
  Loader2,
  Pause,
  Receipt,
  Store,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { posLocationAccent } from "@/lib/pos/register-location";
import type { HeldOrderAdjustment } from "@/lib/pos/revalidate-held-order";
import type { POSLocationOption } from "@/lib/pos/list-locations";

/**
 * The guard between an open sale and a counter change.
 *
 * Moving the register invalidates four things at once: the stock counts painted
 * on the grid, every cart line's `maxStock`, the held sales (they are keyed by
 * location in `localStorage`, so they vanish from view), and any barcode lookup
 * still in flight. None of that is visible, which is exactly why the switch
 * cannot be silent.
 *
 * The cart is never cleared without being offered somewhere to go: parking the
 * sale at the counter it belongs to is the primary action, and re-checking it
 * against the new counter is the explicit alternative.
 */

interface POSLocationSwitchDialogProps {
  open: boolean;
  /** Null when the register is currently on shared stock. */
  from: POSLocationOption | null;
  to: POSLocationOption | null;
  /** What re-checking the cart against `to` would do to it. */
  adjustments: HeldOrderAdjustment[];
  keptLines: number;
  totalLines: number;
  totalUnits: number;
  /** Sales already parked at `from`, which stay behind. */
  heldAtCurrent: number;
  isProbing: boolean;
  onHoldAndSwitch: () => void;
  onSwitchAndRecheck: () => void;
  onCancel: () => void;
}

export function POSLocationSwitchDialog({
  open,
  from,
  to,
  adjustments,
  keptLines,
  totalLines,
  totalUnits,
  heldAtCurrent,
  isProbing,
  onHoldAndSwitch,
  onSwitchAndRecheck,
  onCancel,
}: POSLocationSwitchDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, open]);

  if (!open || !to) return null;

  const fromName = from?.name ?? "Shared stock";
  const removed = adjustments.filter((entry) => entry.kind === "removed");
  const reduced = adjustments.filter((entry) => entry.kind === "quantity");
  const wouldEmpty = keptLines === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm duration-200 animate-in fade-in sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      {/* A bottom sheet on phones so the actions sit under the thumb, a centred
          dialog from `sm` up. Same content either way — the guard is not worth
          less on the screen where it is easiest to mis-tap. */}
      <div className="flex w-full max-w-lg flex-col rounded-t-3xl border bg-background shadow-2xl duration-300 animate-in slide-in-from-bottom-4 sm:rounded-2xl sm:zoom-in-95">
        <span className="mx-auto mt-2.5 h-1 w-9 rounded-full bg-border sm:hidden" />

        <div className="flex items-start gap-3.5 px-5 pb-1 pt-4 sm:pt-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Store className="h-[19px] w-[19px]" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.015em]">
              Switch counter with a sale open?
            </h2>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {totalUnits} {totalUnits === 1 ? "unit" : "units"} on the counter,
              priced and stocked for {fromName}.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-1.5 -mt-0.5 h-8 w-8 shrink-0 rounded-full"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3.5">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: posLocationAccent(from?.id ?? "") }}
              />
              <span className="truncate text-sm font-semibold">{fromName}</span>
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: posLocationAccent(to.id) }}
              />
              <span className="truncate text-sm font-semibold">{to.name}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 px-5 pt-4">
          {isProbing ? (
            <Consequence tone="neutral" icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}>
              Checking what {to.name} can cover&hellip;
            </Consequence>
          ) : (
            <>
              {removed.length > 0 ? (
                <Consequence tone="warn" icon={<TriangleAlert className="h-3.5 w-3.5" />}>
                  <span className="font-semibold">{removed[0].name}</span>
                  {removed.length > 1
                    ? ` and ${removed.length - 1} more have `
                    : " has "}
                  <span className="font-semibold">no stock at {to.name}</span>
                  {removed.length > 1 ? " — they" : " — it"} would drop off the
                  sale.
                </Consequence>
              ) : null}

              {reduced.length > 0 ? (
                <Consequence tone="warn" icon={<TriangleAlert className="h-3.5 w-3.5" />}>
                  {reduced.length} {reduced.length === 1 ? "line" : "lines"}{" "}
                  would be reduced to the stock {to.name} actually holds.
                </Consequence>
              ) : null}

              {removed.length === 0 && reduced.length === 0 ? (
                <Consequence tone="neutral" icon={<Store className="h-3.5 w-3.5" />}>
                  Every line on this sale is available at {to.name}.
                </Consequence>
              ) : null}
            </>
          )}

          <Consequence tone="neutral" icon={<Pause className="h-3.5 w-3.5" />}>
            {heldAtCurrent > 0
              ? `${heldAtCurrent} ${heldAtCurrent === 1 ? "sale" : "sales"} held here stay at ${fromName}. You will not see ${heldAtCurrent === 1 ? "it" : "them"} from ${to.name}.`
              : `Sales held here stay at ${fromName}. You will not see them from ${to.name}.`}
          </Consequence>

          <Consequence tone="neutral" icon={<Receipt className="h-3.5 w-3.5" />}>
            Stock counts and the receipt footer change to {to.name} from the
            next line.
          </Consequence>
        </div>

        <div className="flex flex-col gap-2 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pb-5">
          {/* Available while the probe is still running: parking the sale needs
              nothing from the new counter, so there is no reason to make the
              cashier wait for an answer they are not going to use. */}
          <button
            type="button"
            onClick={onHoldAndSwitch}
            className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.995]"
          >
            <Pause className="h-4 w-4" />
            Hold this sale, then switch
          </button>

          <button
            type="button"
            disabled={isProbing}
            onClick={onSwitchAndRecheck}
            className={cn(
              "flex h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 text-sm font-medium transition-colors",
              isProbing ? "cursor-not-allowed opacity-60" : "hover:bg-accent",
            )}
          >
            <span>Switch and re-check stock</span>
            {isProbing ? null : (
              <span
                className={cn(
                  "shrink-0 text-xs",
                  wouldEmpty
                    ? "font-semibold text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {wouldEmpty
                  ? `Removes all ${totalLines}`
                  : `Keeps ${keptLines} of ${totalLines} lines`}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 cursor-pointer items-center justify-center rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Stay at {fromName}
          </button>
        </div>
      </div>
    </div>
  );
}

function Consequence({
  children,
  icon,
  tone,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  tone: "neutral" | "warn";
}) {
  return (
    <p className="flex items-start gap-2.5 text-[13px] leading-relaxed">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
          tone === "warn"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-500"
            : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
