"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Lock, LockOpen } from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import { closableMonths, formatMonthLabel } from "@/lib/finance/months";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export interface PeriodSnapshotLine {
  currency: string;
  income: number;
  expenses: number;
  net: number;
}

export interface ClosedPeriodRow {
  _id: string;
  label: string;
  closedAt: string;
  note?: string | null;
  snapshot?: PeriodSnapshotLine[];
}

const API = "/api/admin/finance/periods";

/**
 * Closing and reopening months.
 *
 * The list is the record of what has been signed off, with the totals as they
 * stood at the time — which is the only way to answer "why is March different
 * now?" without recomputing a March that has already absorbed the change.
 *
 * The month waiting to be closed is shown with the figures it would freeze.
 * Signing something off is the one action here that a store's accountant will
 * be asked about later, and it used to be a bare dropdown next to a button: you
 * closed a month without ever seeing what it said. The note goes in at the same
 * moment for the same reason — afterwards there is no screen that takes one.
 *
 * Reopening is offered for the newest close only. The API enforces it; the row
 * shows it inline rather than inside a menu, so the rule is visible rather than
 * discovered through an error.
 */
export function PeriodClosePanel({
  periods,
  nextMonth,
}: {
  periods: ClosedPeriodRow[];
  /**
   * The newest finished month that is not closed, with what closing it would
   * record. Null when everything closable is closed.
   */
  nextMonth: { month: string; snapshot: PeriodSnapshotLine[] } | null;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const label = useFallbackTranslator(t);
  const monthName = useCallback(
    (month: string) => formatMonthLabel(month, locale),
    [locale],
  );

  const closed = useMemo(
    () => new Set(periods.map((period) => period.label)),
    [periods],
  );
  const options = useMemo(
    () => closableMonths(new Date()).filter((month) => !closed.has(month)),
    [closed],
  );

  const [note, setNote] = useState("");
  const [pickingOlder, setPickingOlder] = useState(false);
  const [month, setMonth] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  /**
   * The month actually offered, which is not always the one in state.
   *
   * Closing a month removes it from `options`, but `useState` keeps holding it
   * — so the trigger rendered a value matching no item, which shows EMPTY
   * rather than falling back (the same trap the period picker documents), while
   * the button stayed enabled and posted a month the API had just accepted.
   * Deriving it means the select can never point at something that is gone.
   */
  const selected = pickingOlder
    ? options.includes(month)
      ? month
      : (options[0] ?? "")
    : (nextMonth?.month ?? "");

  const close = useCallback(async () => {
    if (!selected) return;
    const ok = await confirm({
      title: label("finance.periods.closeTitle", "Close this month?").replace(
        "{month}",
        monthName(selected),
      ),
      description: label(
        "finance.periods.closeDescription",
        "Nothing is deleted or locked. Entries that arrive for this month afterwards will be dated into the open period instead, so the figures you have filed stop moving.",
      ),
      confirmText: label("finance.periods.close", "Close month"),
    });
    if (!ok) return;

    setIsBusy(true);
    try {
      await apiClient.post(API, { month: selected, note: note.trim() || undefined });
      toast.success(
        label("finance.periods.closed", "{month} closed").replace(
          "{month}",
          monthName(selected),
        ),
      );
      setNote("");
      setPickingOlder(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label("finance.periods.closeFailed", "Could not close the month"),
      );
    } finally {
      setIsBusy(false);
    }
  }, [selected, confirm, label, monthName, note, router]);

  const reopen = useCallback(
    async (row: ClosedPeriodRow) => {
      const ok = await confirm({
        title: label("finance.periods.reopenTitle", "Reopen this month?"),
        description: label(
          "finance.periods.reopenDescription",
          "Entries already dated into the open period stay where they are — they were posted there, and moving them back is the rewriting of history the close exists to prevent.",
        ),
        confirmText: label("finance.periods.reopen", "Reopen"),
        variant: "destructive",
      });
      if (!ok) return;

      setIsBusy(true);
      try {
        await apiClient.delete(`${API}?month=${encodeURIComponent(row.label)}`);
        toast.success(
          label("finance.periods.reopened", "{month} reopened").replace(
            "{month}",
            monthName(row.label),
          ),
        );
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : label("finance.periods.reopenFailed", "Could not reopen it"),
        );
      } finally {
        setIsBusy(false);
      }
    },
    [confirm, label, monthName, router],
  );

  const columns = useMemo<DataTableColumn<ClosedPeriodRow>[]>(
    () => [
      {
        id: "label",
        header: label("finance.periods.month", "Month"),
        cell: (row) => (
          <span className="font-medium">{formatMonthLabel(row.label, locale)}</span>
        ),
      },
      {
        id: "closedAt",
        header: label("finance.periods.closedAt", "Closed"),
        cell: (row) => (
          <span className="text-muted-foreground">
            {new Date(row.closedAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        ),
      },
      {
        id: "note",
        header: label("finance.periods.note", "Note"),
        // Stored since the day closing was built and shown nowhere, so the one
        // place a store could say WHY a month was signed off when it was —
        // "VAT filed", "corrected before closing" — was write-only.
        className: "max-w-[24rem]",
        cell: (row) =>
          row.note ? (
            <span className="text-muted-foreground">{row.note}</span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "snapshot",
        header: label("finance.periods.snapshot", "Net at close"),
        className: "text-right",
        headerClassName: "text-right",
        cell: (row) =>
          row.snapshot?.length ? (
            <div className="space-y-0.5">
              {row.snapshot.map((line) => (
                <p key={line.currency} className="tabular-nums">
                  {formatCurrency(line.net, line.currency)}
                </p>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [label, locale],
  );

  const closedThrough = periods[0]?.label ?? null;

  return (
    <div className="space-y-4">
      {nextMonth || options.length > 0 ? (
        <div className="flex gap-4 rounded-xl border bg-card p-6 shadow-sm">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <Lock className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">
              {selected
                ? label(
                    "finance.periods.readyTitle",
                    "{month} is ready to close",
                  ).replace("{month}", monthName(selected))
                : label("finance.periods.allClosed", "Everything is closed")}
            </p>
            <p className="mt-1.5 max-w-[70ch] text-sm text-muted-foreground">
              {label(
                "finance.periods.closeDescription",
                "Nothing is deleted or locked. Entries that arrive for this month afterwards will be dated into the open period instead, so the figures you have filed stop moving.",
              )}
            </p>

            {/* What closing would record, before it records it. */}
            {!pickingOlder && nextMonth?.snapshot.length ? (
              <div className="mt-4 space-y-3 rounded-xl bg-muted/50 px-5 py-4">
                {nextMonth.snapshot.map((line) => (
                  <div
                    key={line.currency}
                    className="flex flex-wrap items-end gap-x-10 gap-y-3"
                  >
                    <SnapshotFigure
                      label={label("finance.overview.income", "Income")}
                      value={formatCurrency(line.income, line.currency)}
                    />
                    <SnapshotFigure
                      label={label("finance.overview.expenses", "Costs")}
                      value={formatCurrency(line.expenses, line.currency)}
                    />
                    <SnapshotFigure
                      label={label("finance.periods.snapshot", "Net at close")}
                      value={formatCurrency(line.net, line.currency)}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {pickingOlder ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <Label className="mb-1.5 block">
                    {label("finance.periods.month", "Month")}
                  </Label>
                  <Select value={selected} onValueChange={setMonth}>
                    <SelectTrigger className="w-48">
                      <SelectValue
                        placeholder={label("finance.periods.month", "Month")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {monthName(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="pb-2 text-xs text-muted-foreground">
                  {label(
                    "finance.periods.olderHint",
                    "Figures for an older month are recorded as they stand now.",
                  )}
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-[16rem] flex-1">
                <Label htmlFor="period-close-note" className="mb-1.5 block">
                  {label("finance.periods.note", "Note")}
                  <span className="font-normal text-muted-foreground">
                    {label(
                      "finance.periods.noteHint",
                      "— kept with the month, and shown in the list below",
                    )}
                  </span>
                </Label>
                <Input
                  id="period-close-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  disabled={!selected || isBusy}
                  placeholder={label(
                    "finance.periods.notePlaceholder",
                    "e.g. VAT return filed 12 Aug",
                  )}
                />
              </div>
              <Button
                onClick={() => void close()}
                disabled={!selected || isBusy}
              >
                <Lock className="size-4" />
                {selected
                  ? label("finance.periods.closeMonth", "Close {month}").replace(
                      "{month}",
                      monthName(selected),
                    )
                  : label("finance.periods.close", "Close month")}
              </Button>
            </div>

            {options.length > 1 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => setPickingOlder((value) => !value)}
                >
                  {pickingOlder
                    ? label(
                        "finance.periods.closeNewest",
                        "Close the newest month instead",
                      )
                    : label(
                        "finance.periods.closeOlder",
                        "Close an older month instead",
                      )}
                </button>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div>
        <h2 className="font-semibold">
          {label("finance.periods.title", "Closed months")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {closedThrough
            ? label(
                "finance.periods.closedThrough",
                "Everything up to {month} is closed.",
              ).replace("{month}", monthName(closedThrough))
            : label(
                "finance.periods.noneClosed",
                "Nothing is closed yet — every figure can still move.",
              )}
        </p>
      </div>

      <DataTable<ClosedPeriodRow>
        data={periods}
        columns={columns}
        keyField="_id"
        emptyIcon={<LockOpen className="h-8 w-8" />}
        emptyMessage={label(
          "finance.periods.empty",
          "No month has been closed. Closing one stops its figures moving when a late payment or a corrected expense arrives.",
        )}
        rowActionsVariant="inline"
        rowActions={(row) =>
          // Only the newest, because reopening an older one would leave a
          // closed month sitting behind an open one.
          row.label === periods[0]?.label
            ? [
                {
                  id: "reopen",
                  label: label("finance.periods.reopen", "Reopen"),
                  icon: <LockOpen className="h-4 w-4" />,
                  onClick: () => void reopen(row),
                },
              ]
            : []
        }
      />

      <p className="text-xs text-muted-foreground">
        {label(
          "finance.periods.reopenRule",
          "Only the newest close can be reopened — reopening an older month would leave a closed month sitting behind an open one.",
        )}
      </p>
    </div>
  );
}

function SnapshotFigure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
