"use client";

import * as React from "react";
import type { DateRange, PropsBase, PropsRange } from "react-day-picker";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The one date-range picker. Before this, the vendor dashboard, admin analytics
 * and the admin orders chart each carried their own copy of the popover plus
 * its own `startOfDay` / `normalizeDateRange` / `formatAppliedDateRange`
 * helpers — three near-identical bodies drifting apart one style tweak at a
 * time.
 *
 * A range is applied only when both ends are picked; the draft lives inside the
 * popover so cancelling leaves the applied value untouched.
 */

export type AppliedDateRange = { from: Date; to: Date };

/** Local midnight. Ranges are compared and formatted in the viewer's timezone. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Both ends present and ordered, or null. Reversed selections are swapped. */
function normalizeDateRange(
  range: DateRange | undefined,
): AppliedDateRange | null {
  if (!range?.from || !range.to) return null;
  const from = startOfDay(range.from);
  const to = startOfDay(range.to);
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Inclusive day count: a single-day range is 1. */
export function rangeLengthDays(range: AppliedDateRange): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(
    1,
    Math.round(
      (startOfDay(range.to).getTime() - startOfDay(range.from).getTime()) /
        msPerDay,
    ) + 1,
  );
}

/** "12 Aug 2026 - 18 Aug 2026". */
export function formatAppliedDateRange(
  range: AppliedDateRange,
  locale: string,
): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(range.from)} - ${formatter.format(range.to)}`;
}

/**
 * Range-mode calendar props the caller may forward, minus the ones this
 * component owns. Narrowed off `PropsBase` rather than
 * `ComponentProps<typeof Calendar>`, because the latter is a union across every
 * DayPicker mode and spreading it would make `selected`/`onSelect` ambiguous.
 */
type ForwardedCalendarProps = Omit<
  PropsBase & PropsRange,
  "mode" | "selected" | "onSelect"
>;

/** A named span offered beside the calendar. */
export type DateRangePreset = {
  id: string;
  label: string;
  range: AppliedDateRange;
};

export function DateRangePicker({
  value,
  onApply,
  locale,
  cancelLabel,
  applyLabel,
  align = "end",
  numberOfMonths = 2,
  formatLabel = formatAppliedDateRange,
  triggerLabel,
  triggerClassName,
  contentClassName,
  iconClassName,
  calendarProps,
  presets,
  presetsTitle,
  activePresetId,
  onSelectPreset,
  customLabel,
  summary,
}: {
  value: AppliedDateRange;
  onApply: (range: AppliedDateRange) => void;
  locale: string;
  cancelLabel: string;
  applyLabel: string;
  align?: "start" | "center" | "end";
  numberOfMonths?: number;
  /** Override the trigger text — analytics collapses a single-day range. */
  formatLabel?: (range: AppliedDateRange, locale: string) => string;
  /** Replaces the formatted range on the trigger — a chosen preset's name. */
  triggerLabel?: string;
  triggerClassName?: string;
  contentClassName?: string;
  /** Applied to both the calendar glyph and the chevron. */
  iconClassName?: string;
  /**
   * Named spans in a rail beside the calendar. Picking one applies straight
   * away: a preset is a decision, and making someone confirm it with Apply
   * turns one click into two for the case that is used most.
   */
  presets?: DateRangePreset[];
  presetsTitle?: string;
  activePresetId?: string;
  /**
   * Told which preset was picked rather than only its dates, so a caller that
   * keeps the choice somewhere durable — the URL — can store "last 30 days"
   * and have it still mean that tomorrow.
   */
  onSelectPreset?: (preset: DateRangePreset) => void;
  /** Rail entry standing for the calendar itself. */
  customLabel?: string;
  /**
   * Footer text beside the buttons, given the range currently drafted in the
   * calendar — "47 days" while it is being chosen, not after.
   */
  summary?: (draft: AppliedDateRange | null) => React.ReactNode;
  /**
   * Forwarded to the calendar: `disabled`, `modifiers`, `modifiersClassNames`,
   * `startMonth`, `endMonth`, `excludeDisabled`, and anything else DayPicker
   * accepts. Booked-day painting rides on this.
   */
  calendarProps?: ForwardedCalendarProps;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRange | undefined>({
    from: value.from,
    to: value.to,
  });
  const normalizedDraft = normalizeDateRange(draft);

  const handleOpenChange = (nextOpen: boolean) => {
    // Reopening always restarts from the applied value, so an abandoned draft
    // never leaks into the next interaction.
    if (nextOpen) setDraft({ from: value.from, to: value.to });
    setOpen(nextOpen);
  };

  const handleApply = () => {
    if (!normalizedDraft) return;
    onApply(normalizedDraft);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-8 w-full max-w-full justify-between gap-2 rounded-[6px] border-border bg-muted/40 px-3 text-xs font-medium text-foreground hover:bg-muted/60 sm:w-auto",
            triggerClassName,
          )}
        >
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
            <CalendarDays
              className={cn("size-3.5 text-muted-foreground", iconClassName)}
            />
            <span className="truncate text-left">
              {triggerLabel ?? formatLabel(value, locale)}
            </span>
          </span>
          <ChevronDown
            className={cn("size-4 text-muted-foreground", iconClassName)}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={10}
        className={cn(
          "w-[calc(100vw-2rem)] overflow-hidden p-0",
          // The rail needs room of its own; without this the two months and
          // the presets shared 636px and the calendar clipped its last column.
          presets?.length ? "max-w-[820px]" : "max-w-[636px]",
          contentClassName,
        )}
      >
        <div className="flex items-stretch">
          {presets?.length ? (
            <div className="hidden w-44 shrink-0 flex-col gap-0.5 border-r p-3 sm:flex">
              {presetsTitle ? (
                <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {presetsTitle}
                </p>
              ) : null}
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setDraft({ from: preset.range.from, to: preset.range.to });
                    if (onSelectPreset) {
                      onSelectPreset(preset);
                      setOpen(false);
                      return;
                    }
                    onApply(preset.range);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-8 items-center rounded-md px-2 text-left text-[13px] transition-colors hover:bg-muted",
                    activePresetId === preset.id &&
                      "bg-accent font-medium text-accent-foreground",
                  )}
                >
                  {preset.label}
                </button>
              ))}
              {customLabel ? (
                <>
                  <div className="my-2 h-px bg-border" />
                  <span
                    className={cn(
                      "flex h-8 items-center rounded-md px-2 text-[13px]",
                      !activePresetId &&
                        "bg-accent font-medium text-accent-foreground",
                    )}
                  >
                    {customLabel}
                  </span>
                </>
              ) : null}
            </div>
          ) : null}
          {/* `relative` so the calendar's absolutely-positioned month arrows
              anchor HERE and not to the popover: with a preset rail beside
              them, the previous-month arrow landed on top of the rail's
              heading. */}
          <div className="relative min-w-0 flex-1 overflow-x-auto px-5 pb-5 pt-6">
          <Calendar
            mode="range"
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft?.from ?? value.from}
            numberOfMonths={numberOfMonths}
            fixedWeeks
            weekStartsOn={1}
            autoFocus
            formatters={{
              formatCaption: (date) =>
                `${new Intl.DateTimeFormat(locale, { month: "long" }).format(date)} / ${date.getFullYear()}`,
            }}
            {...calendarProps}
          />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
          <span className="truncate text-xs text-muted-foreground">
            {summary ? summary(normalizedDraft) : null}
          </span>
          <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            className="h-9 rounded-lg px-4 text-[13px] font-medium"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!normalizedDraft}
            onClick={handleApply}
            className="h-9 rounded-lg px-4 text-[13px] font-semibold"
          >
            {applyLabel}
          </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
