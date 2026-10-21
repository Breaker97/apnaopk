"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  SingleDatePicker,
  startOfDay,
  type DatePreset,
} from "@/components/ui/date-range-picker";
import { cn } from "@/lib/utils";
import {
  fromLocalDay,
  toLocalDay,
  type Label,
  type Money,
  type Report,
} from "./shared";

/** The trigger look the finance period picker uses, so the two match. */
export const FINANCE_PICKER_TRIGGER =
  "h-9 rounded-md border-input bg-background px-3 text-sm shadow-xs hover:bg-accent";

const MATCH_TOLERANCE = 0.005;

/**
 * What the stock is worth, and whether the ledger agrees — one figure and one
 * verdict. The arithmetic behind the verdict is a click away rather than four
 * more cards: most days it matches, and on the days it does not, the
 * "Needs attention" list below says why.
 */
export function InventorySummaryCard({
  report,
  currency,
  asOf,
  onAsOfChange,
  disabled,
  locale,
  label,
  money,
}: {
  report: Report;
  currency: string;
  /** "" for now, otherwise the "2026-09-30" day whose balances are shown. */
  asOf: string;
  onAsOfChange: (day: string) => void;
  disabled: boolean;
  locale: string;
  label: Label;
  money: Money;
}) {
  const [showMath, setShowMath] = useState(false);
  const day = (date: Date) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  const amount = (value: number) => money(value, currency);

  const now = new Date();
  const today = startOfDay(now);
  const presets: DatePreset[] = [
    { id: "today", label: label("asOfToday", "Today"), date: today },
    {
      id: "month",
      label: label("asOfMonthEnd", "End of last month"),
      date: new Date(now.getFullYear(), now.getMonth(), 0),
    },
    {
      id: "year",
      label: label("asOfYearEnd", "End of last year"),
      date: new Date(now.getFullYear() - 1, 11, 31),
    },
  ];
  const applied = asOf ? fromLocalDay(asOf) : today;
  const activePreset = asOf
    ? presets.find((preset) => toLocalDay(preset.date) === asOf)
    : presets[0];
  const pick = (date: Date) => {
    const next = toLocalDay(date);
    onAsOfChange(next === toLocalDay(today) ? "" : next);
  };

  const difference = report.unexplainedDifference;
  const matches = Math.abs(difference) < MATCH_TOLERANCE;

  // Where the value sits, over every position on the chosen day (the table
  // below lists a bounded number of rows). "Ready to sell" is what is left of
  // the owned value, so the legend always adds up to the figure above it.
  const {
    reservedValue: reserved,
    heldValue: held,
    transitValue: transit,
  } = report.stock;
  const segments = [
    {
      id: "ready",
      label: label("segmentReady", "Ready to sell"),
      value: Math.max(0, report.ownedBookValue - reserved - held - transit),
      color: "bg-primary",
    },
    {
      id: "reserved",
      label: label("segmentReserved", "Reserved for orders"),
      value: reserved,
      color: "bg-primary/45",
    },
    {
      id: "held",
      label: label("segmentHeld", "Held"),
      value: held,
      color: "bg-amber-500",
    },
    {
      id: "transit",
      label: label("segmentTransit", "In transit"),
      value: transit,
      color: "bg-violet-400",
    },
    {
      id: "funding",
      label: label("segmentFunding", "Paid for, not received"),
      value: report.fundingAwaitingAllocation,
      color: "bg-muted-foreground/35",
    },
  ].filter((segment) => segment.value > MATCH_TOLERANCE);
  const segmentTotal = segments.reduce((sum, segment) => sum + segment.value, 0);

  const { units, skus, locations } = report.stock;
  // With no stock rows there is nothing to count; the empty table below says
  // so once, rather than this line saying it as well.
  const sub = asOf
    ? label("atEndOf", "At the end of {date}", { date: day(applied) })
    : report.positions.length === 0
      ? null
      : label("stockCounts", "{units} units · {skus} SKUs · {locations} locations", {
          units,
          skus,
          locations,
        });

  const stockRows = [
    { id: "owned", label: label("mathOwned", "Stock at cost"), value: report.ownedBookValue },
    ...(Math.abs(report.fundingAwaitingAllocation) > MATCH_TOLERANCE
      ? [
          {
            id: "funding",
            label: label("segmentFunding", "Paid for, not received"),
            value: report.fundingAwaitingAllocation,
          },
        ]
      : []),
  ];
  const ledgerRows = [
    { id: "posted", label: label("mathPosted", "Posted to inventory"), value: report.postedValue },
    ...(Math.abs(report.pendingEffect) > MATCH_TOLERANCE
      ? [
          {
            id: "pending",
            label: label("mathPending", "Waiting to post · {count}", {
              count: report.pendingOperations,
            }),
            value: report.pendingEffect,
          },
        ]
      : []),
  ];

  return (
    <Card className="gap-0 py-0 shadow-xs">
      <CardContent className="p-6 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {asOf
              ? label("stockValueOn", "Stock value on {date}", {
                  date: day(applied),
                })
              : label("stockValue", "Stock value")}
          </h2>
          {/* On this card, not the page header: it changes these figures and
              nothing else. */}
          <SingleDatePicker
            id="inventory-asof"
            ariaLabel={label("asOf", "Balances as of")}
            value={applied}
            locale={locale}
            disabled={disabled}
            triggerLabel={
              asOf
                ? label("asOfDate", "As of {date}", { date: day(applied) })
                : label("asOfNow", "As of today")
            }
            triggerClassName={FINANCE_PICKER_TRIGGER}
            iconClassName="size-4"
            presets={presets}
            presetsTitle={label("asOfTitle", "As of")}
            activePresetId={activePreset?.id}
            onSelectPreset={(preset) => pick(preset.date)}
            customLabel={label("asOfCustom", "Pick a date")}
            onApply={pick}
            summary={(draft) =>
              !draft || toLocalDay(draft) === toLocalDay(today)
                ? label("asOfNowSummary", "Balances right now")
                : label("asOfSummary", "Balances at the end of {date}", {
                    date: day(draft),
                  })
            }
            cancelLabel={label("cancel", "Cancel")}
            applyLabel={label("apply", "Apply")}
            calendarProps={{ disabled: { after: now } }}
          />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <p className="text-4xl font-semibold tracking-tight tabular-nums">
            {amount(report.bookValue)}
          </p>
          <span
            className={cn(
              "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[13px] font-semibold",
              matches
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400",
            )}
          >
            {matches ? (
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
            ) : (
              <AlertTriangle aria-hidden="true" className="size-3.5" />
            )}
            {matches
              ? label("matchesLedger", "Matches the ledger")
              : label("offBy", "Off by {amount}", {
                  amount: amount(Math.abs(difference)),
                })}
          </span>
        </div>
        {sub ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>
        ) : null}

        {/* Today's stock only: the rows behind the bar are always current. */}
        {!asOf && segmentTotal > 0 ? (
          <>
            <div
              aria-hidden="true"
              className="mt-5 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted"
            >
              {segments.map((segment) => (
                <div
                  key={segment.id}
                  className={cn("h-full min-w-[3px]", segment.color)}
                  style={{ flex: `${segment.value / segmentTotal} 1 0` }}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {segments.map((segment) => (
                <li
                  key={segment.id}
                  className="inline-flex items-center gap-2 text-[13px] text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-2 shrink-0 rounded-full", segment.color)}
                  />
                  {segment.label}
                  <span className="font-semibold text-foreground tabular-nums">
                    {amount(segment.value)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-4 border-t border-border/60 pt-2.5">
          <button
            type="button"
            aria-expanded={showMath}
            onClick={() => setShowMath((current) => !current)}
            className="-ms-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-primary transition-colors hover:bg-accent"
          >
            {showMath
              ? label("hideMath", "Hide the math")
              : label("showMath", "Show the math")}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3.5 transition-transform",
                showMath && "rotate-180",
              )}
            />
          </button>
          {showMath ? (
            <div className="pb-2 pt-2">
              <div className="grid gap-3 md:grid-cols-2">
                <MathBox
                  title={label("mathYourStock", "Your stock")}
                  rows={stockRows}
                  total={{
                    label: label("stockValue", "Stock value"),
                    value: report.bookValue,
                  }}
                  amount={amount}
                />
                <MathBox
                  title={label("mathLedger", "The ledger")}
                  rows={ledgerRows}
                  total={{
                    label: label("mathLedgerTotal", "Ledger total"),
                    value: report.expectedLedgerValue,
                  }}
                  amount={amount}
                />
              </div>
              <p
                className={cn(
                  "mt-3 flex items-center gap-2 text-[13px] font-medium",
                  matches
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400",
                )}
              >
                {matches ? (
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                ) : (
                  <AlertTriangle aria-hidden="true" className="size-4" />
                )}
                {matches
                  ? label("noDifference", "No difference.")
                  : difference > 0
                    ? label("ledgerLower", "The ledger is {amount} lower than your stock.", {
                        amount: amount(difference),
                      })
                    : label("ledgerHigher", "The ledger is {amount} higher than your stock.", {
                        amount: amount(-difference),
                      })}
              </p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MathBox({
  title,
  rows,
  total,
  amount,
}: {
  title: string;
  rows: Array<{ id: string; label: string; value: number }>;
  total: { label: string; value: number };
  amount: (value: number) => string;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-4 py-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <dl className="text-[13px]">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex justify-between gap-3 py-1 text-muted-foreground"
          >
            <dt>{row.label}</dt>
            <dd className="tabular-nums text-foreground">{amount(row.value)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-3 border-t pt-2 font-semibold">
          <dt>{total.label}</dt>
          <dd className="tabular-nums">{amount(total.value)}</dd>
        </div>
      </dl>
    </div>
  );
}
