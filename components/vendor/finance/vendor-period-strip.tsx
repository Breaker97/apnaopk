"use client";

import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface VendorPeriodStripItem {
  id: string;
  label: string;
  value: string;
  /** Said in a tooltip, not on the screen: the figure is the point. */
  hint?: string;
}

export interface VendorPeriodStripExtra {
  id: string;
  label: string;
  value: string;
  tone?: "negative" | "positive";
}

/**
 * The period's four figures as one quiet strip.
 *
 * Opening, what was earned, what was paid out, and the balance left — read
 * left to right like the top of a bank statement. Five separate cards with an
 * icon and a sentence each made the overview read as a wall of tiles; the
 * sentences live in tooltips now, where a seller who wants them can find them.
 */
export function VendorPeriodStrip({
  items,
  label,
  extras,
}: {
  items: VendorPeriodStripItem[];
  label: string;
  /**
   * Movements that changed the balance but have no tile of their own — a
   * refund, a delivery label. One quiet line under the figures, so Opening +
   * Earned − Paid out + these = Held for you adds up without a second panel.
   */
  extras?: { label: string; items: VendorPeriodStripExtra[] };
}) {
  return (
    <Card
      role="group"
      aria-label={label}
      className="grid grid-cols-2 gap-0 overflow-hidden py-0 lg:grid-cols-4"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="min-w-0 px-4 py-4 sm:px-6 max-lg:even:border-l max-lg:[&:nth-child(n+3)]:border-t lg:[&:nth-child(n+2)]:border-l"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{item.label}</span>
            {item.hint ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={item.hint}
                    className="inline-flex shrink-0 rounded-sm text-muted-foreground/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Info className="size-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-56">
                  {item.hint}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <p
            className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums"
            title={item.value}
          >
            {item.value}
          </p>
        </div>
      ))}
      {extras && extras.items.length > 0 ? (
        <div className="col-span-full flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t bg-muted/40 px-4 py-3 text-xs sm:px-6">
          <span className="font-medium text-muted-foreground">{extras.label}</span>
          {extras.items.map((extra) => (
            <span key={extra.id} className="inline-flex items-baseline gap-2">
              <span className="text-muted-foreground">{extra.label}</span>
              <span
                className={cn(
                  "font-semibold tabular-nums",
                  extra.tone === "negative" && "text-destructive",
                  extra.tone === "positive" && "text-status-on-positive",
                )}
              >
                {extra.value}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
