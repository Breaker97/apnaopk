"use client";

import * as React from "react";
import type { DateRange, PropsBase, PropsRange } from "react-day-picker";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverAnchor,
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

/** Anything the popover can position itself against — an element, in practice. */
type Measurable = { getBoundingClientRect(): DOMRect };

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
  collapseCalendar = false,
  open: openProp,
  onOpenChange,
  anchorRef,
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
   * Show only the preset list until the `customLabel` entry is clicked, which
   * then reveals the calendar and the Apply footer. Needs `presets` and
   * `customLabel`; without it the calendar is always shown beside the rail.
   */
  collapseCalendar?: boolean;
  /**
   * Forwarded to the calendar: `disabled`, `modifiers`, `modifiersClassNames`,
   * `startMonth`, `endMonth`, `excludeDisabled`, and anything else DayPicker
   * accepts. Booked-day painting rides on this.
   */
  calendarProps?: ForwardedCalendarProps;
  /** Controlled open state. Without it the picker opens from its own trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Opens the popover against this element instead of rendering a trigger of
   * its own, for a picker that is reached from elsewhere — a row in a filter
   * menu — and so needs `open` as well.
   */
  anchorRef?: React.RefObject<Measurable | null>;
}) {
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (nextOpen: boolean) => {
    setOwnOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const [draft, setDraft] = React.useState<DateRange | undefined>({
    from: value.from,
    to: value.to,
  });
  const normalizedDraft = normalizeDateRange(draft);
  const collapsible = Boolean(collapseCalendar && presets?.length && customLabel);
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  const showCalendar = !collapsible || calendarOpen;

  // Opening always restarts from the applied value, so an abandoned draft never
  // leaks into the next interaction. Done as the open state changes rather than
  // in the trigger's handler, because a controlled picker is opened by its
  // parent and never passes through one.
  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft({ from: value.from, to: value.to });
      // A custom range is already applied: open straight onto its calendar.
      setCalendarOpen(!activePresetId);
    }
  }

  const handleApply = () => {
    if (!normalizedDraft) return;
    onApply(normalizedDraft);
    setOpen(false);
  };

  // A popover hands focus back to its trigger when it closes, and an anchored
  // picker has none. Hand it back to the anchor instead — except after a click
  // elsewhere, where focus belongs to whatever was clicked.
  const dismissedOutsideRef = React.useRef(false);
  const handleCloseAutoFocus = (event: Event) => {
    const anchor = anchorRef?.current;
    if (anchor instanceof HTMLElement && !dismissedOutsideRef.current) {
      event.preventDefault();
      anchor.focus();
    }
    dismissedOutsideRef.current = false;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {anchorRef ? (
        <PopoverAnchor virtualRef={anchorRef as React.RefObject<Measurable>} />
      ) : (
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
      )}
      <PopoverContent
        align={align}
        sideOffset={10}
        onInteractOutside={() => {
          dismissedOutsideRef.current = true;
        }}
        onCloseAutoFocus={handleCloseAutoFocus}
        className={cn(
          "w-[calc(100vw-2rem)] overflow-hidden p-0",
          // The rail needs room of its own; without this the two months and
          // the presets shared 636px and the calendar clipped its last column.
          presets?.length ? "max-w-[820px]" : "max-w-[636px]",
          !showCalendar && "w-56",
          contentClassName,
        )}
      >
        <div className="flex items-stretch">
          {presets?.length ? (
            <div
              className={cn(
                "w-44 shrink-0 flex-col gap-0.5 p-3",
                showCalendar ? "hidden border-r sm:flex" : "flex w-full",
                collapsible && showCalendar && "flex",
              )}
            >
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
                  {collapsible ? (
                    <button
                      type="button"
                      onClick={() => setCalendarOpen(true)}
                      className={cn(
                        "flex h-8 items-center rounded-md px-2 text-left text-[13px] transition-colors hover:bg-muted",
                        (calendarOpen || !activePresetId) &&
                          "bg-accent font-medium text-accent-foreground",
                      )}
                    >
                      {customLabel}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "flex h-8 items-center rounded-md px-2 text-[13px]",
                        !activePresetId &&
                          "bg-accent font-medium text-accent-foreground",
                      )}
                    >
                      {customLabel}
                    </span>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
          {/* `relative` so the calendar's absolutely-positioned month arrows
              anchor HERE and not to the popover: with a preset rail beside
              them, the previous-month arrow landed on top of the rail's
              heading. */}
          {showCalendar ? (
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
          ) : null}
        </div>
        {showCalendar ? (
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
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
