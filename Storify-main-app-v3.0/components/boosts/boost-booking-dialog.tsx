"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import type { DateRange, DayProps } from "react-day-picker";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ImageIcon,
  Loader2,
  Rocket,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  addDays,
  calendarDateFromUtcDay,
  dayStartUtc,
  daysBetweenInclusive,
  utcDay,
  utcDayFromCalendarDate,
} from "@/lib/boosts/boost-days";
import {
  blockedDays,
  clashingDays,
  dayRuns,
  missingSurfaces,
  nextFreeDay,
  type BookingCalendarData,
  type BookingRung,
  type BookingSurface,
} from "@/lib/boosts/boost-booking";

/**
 * The boost booking dialog's shared pieces. The admin's offline booking
 * (components/admin/manual-boost-dialog.tsx) and the vendor's checkout
 * (components/vendor/boost-purchase-dialog.tsx) load and submit differently,
 * but both draw every step from here, so the two screens cannot drift apart
 * again the way the old admin form and vendor wizard did.
 *
 * The layout keeps one fact in one place: the stepper carries what has been
 * picked, the footer carries the total, and a rung only says something when it
 * differs from the norm (a surface it misses, a later free day, a clash).
 */

interface BookingSelection {
  startDay: string;
  endDay: string;
  days: number;
}

/** A complete picked range as UTC days, or null while it is still open. */
export function selectionFromRange(range: DateRange | undefined): BookingSelection | null {
  if (!range?.from || !range.to) return null;
  const a = utcDayFromCalendarDate(range.from);
  const b = utcDayFromCalendarDate(range.to);
  const startDay = a <= b ? a : b;
  const endDay = a <= b ? b : a;
  return { startDay, endDay, days: daysBetweenInclusive(startDay, endDay) };
}

/** "Oct 11" in the viewer's locale, read as a UTC day. */
function formatBookingDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(dayStartUtc(day));
}

/** "Oct 8 – 14" (or with the year: "Oct 8 – 14, 2026"), one day when they match. */
export function formatBookingRange(
  startDay: string,
  endDay: string,
  locale: string,
  withYear = false,
): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  });
  if (startDay === endDay) return formatter.format(dayStartUtc(startDay));
  return formatter.formatRange(dayStartUtc(startDay), dayStartUtc(endDay));
}

/** Runs of days for a message: "Oct 8 – 10, Oct 14". */
export function formatBookingRuns(days: readonly string[], locale: string): string {
  return dayRuns(days)
    .map(([start, end]) => formatBookingRange(start, end, locale))
    .join(", ");
}

// ---------------------------------------------------------------------------
// Frame

export function BookingDialogFrame(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A short tag beside the title — the admin's "Offline payment". */
  badge?: string;
  /** Read by screen readers only; the title and steps carry the visual story. */
  description: string;
  stepper?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* A column with a pinned header, stepper and footer: only the step in
          between scrolls, so the total and the buttons never leave the
          screen. `flex` replaces DialogContent's grid, whose one auto column
          grew to the longest product name. */}
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 gap-0 px-4 pt-5 pr-14 text-left sm:px-6">
          <DialogTitle className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Rocket className="h-5 w-5 shrink-0 text-primary" />
            {props.title}
            {props.badge ? (
              <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {props.badge}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="sr-only">{props.description}</DialogDescription>
        </DialogHeader>
        {props.stepper}
        <div className="scrollbar-visible min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {props.children}
        </div>
        {props.footer}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Stepper

export interface BookingStepItem {
  key: string;
  label: string;
  /** Shown in place of the label once the step is done: what was picked. */
  picked?: string | null;
  /** Done but not reopenable — a product preselected from the products table. */
  locked?: boolean;
}

export function BookingStepper(props: {
  steps: BookingStepItem[];
  current: string;
  onStepClick: (key: string) => void;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const currentIndex = props.steps.findIndex((step) => step.key === props.current);
  return (
    <nav
      aria-label={label("boosts.booking.steps", "Booking steps")}
      className="flex shrink-0 items-center border-b px-4 py-4 sm:px-6"
    >
      {props.steps.map((step, index) => {
        const done = index < currentIndex;
        const isCurrent = index === currentIndex;
        const clickable = done && !step.locked;
        const text = done && step.picked ? step.picked : step.label;
        return (
          // `flex-auto`, not `flex-1`: steps size to their own label first
          // and share only the slack, so a phone's lone visible label is not
          // squeezed to "Position & d…" to leave room for a bare number.
          <div
            key={step.key}
            className={cn("flex min-w-0 items-center", index > 0 && "flex-auto")}
          >
            {index > 0 ? (
              <div
                className={cn(
                  "mx-2.5 h-px min-w-3 flex-1",
                  done || isCurrent ? "bg-primary" : "bg-border",
                )}
              />
            ) : null}
            <button
              type="button"
              onClick={() => clickable && props.onStepClick(step.key)}
              disabled={!clickable}
              aria-current={isCurrent ? "step" : undefined}
              title={done && step.picked ? step.picked : undefined}
              className="group flex min-w-0 shrink items-center gap-2 rounded-full disabled:cursor-default"
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  isCurrent && "border-primary text-primary",
                  !done && !isCurrent && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : index + 1}
              </span>
              <span
                className={cn(
                  "truncate text-[13px] font-medium transition-colors",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                  clickable && "group-hover:text-foreground",
                  done && "max-w-[180px]",
                  // A phone keeps the current step's name only.
                  !isCurrent && "hidden sm:inline",
                )}
              >
                {text}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — product

export interface BookingProductItem {
  id: string;
  name: string;
  image?: string | null;
  /** The admin sees which store sells it. */
  subtitle?: string | null;
}

function ProductThumb({ image, className }: { image?: string | null; className: string }) {
  if (image) {
    return (
      <Image
        src={image}
        alt=""
        width={40}
        height={40}
        className={cn("shrink-0 rounded-lg object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg border bg-muted",
        className,
      )}
    >
      <ImageIcon className="size-4 text-muted-foreground/70" />
    </span>
  );
}

export function BookingProductStep(props: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  /** The admin's store filter, beside the search. */
  filter?: ReactNode;
  items: BookingProductItem[];
  /** Matches on the server; more than `items` means the list was cut. */
  total: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (item: BookingProductItem) => void;
  emptyText: string;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={props.placeholder}
            className="h-10 bg-card pl-9"
            placeholder={props.placeholder}
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
          />
        </div>
        {props.filter}
      </div>
      <div
        role="listbox"
        aria-label={label("boosts.purchase.stepProduct", "Product")}
        className="overflow-hidden rounded-2xl border bg-card"
      >
        {props.loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : props.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {props.emptyText}
          </p>
        ) : (
          props.items.map((item, index) => {
            const selected = item.id === props.selectedId;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => props.onSelect(item)}
                className={cn(
                  "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
                  index > 0 && "border-t border-border/60",
                  selected ? "bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <ProductThumb image={item.image} className="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium" title={item.name}>
                    {item.name}
                  </span>
                  {item.subtitle ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.subtitle}
                    </span>
                  ) : null}
                </span>
                {selected ? (
                  <Check className="size-[18px] shrink-0 text-primary" strokeWidth={2.5} />
                ) : null}
              </button>
            );
          })
        )}
      </div>
      {!props.loading && props.total > props.items.length ? (
        <p className="text-xs text-muted-foreground">
          {label(
            "boosts.booking.showingSome",
            "Showing {shown} of {total} — search to find the rest",
            { shown: props.items.length, total: props.total },
          )}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — position and dates

const SURFACE_NOTE: Record<BookingSurface, { key: string; fallback: string }> = {
  home: { key: "boosts.booking.notOnHome", fallback: "Not on the home page" },
  listing: { key: "boosts.booking.notOnListings", fallback: "Not on listing pages" },
  productPage: {
    key: "boosts.booking.notOnProductPages",
    fallback: "Not on product pages",
  },
};

/** A dot under the day number: the product already runs that day elsewhere. */
const PRODUCT_DAY_DOT =
  "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-amber-600";

/**
 * A sold day is disabled, and the calendar's disabled style switches pointer
 * events off — which also kills the hover tooltip saying who holds it. They
 * come back on the cell only; the button inside stays disabled.
 */
const HOVERABLE_DAY = "!pointer-events-auto [&>button]:hover:!bg-transparent";

/**
 * A range that crosses days this rung cannot sell is kept, not dropped, and
 * painted red, so switching rungs shows exactly which days collide instead of
 * wiping the pick.
 */
const CLASH_RANGE_CLASSNAMES = {
  range_start:
    "rounded-l-full bg-destructive/10 [&>button]:!bg-destructive [&>button]:!text-white [&>button]:hover:!bg-destructive",
  range_middle:
    "bg-destructive/10 [&>button]:!bg-transparent [&>button]:hover:!bg-transparent",
  range_end:
    "rounded-r-full bg-destructive/10 [&>button]:!bg-destructive [&>button]:!text-white [&>button]:hover:!bg-destructive",
};

/**
 * Next month's days trailing October's grid are hidden, but they still carry
 * a range crossing into November: no band, no dot in an empty cell.
 */
const HIDDEN_DAY = "!bg-transparent after:!hidden";

const DayTitleContext = createContext<(day: string) => string | undefined>(
  () => undefined,
);

/** The day cell plus a tooltip: who holds the day, or why it is shut. */
function BookingDay({ day, modifiers, ...props }: DayProps) {
  const titleFor = useContext(DayTitleContext);
  return (
    <td
      {...props}
      title={modifiers.hidden ? undefined : titleFor(utcDayFromCalendarDate(day.date))}
    />
  );
}

export function BookingSlotStep(props: {
  area: "admin" | "vendor";
  rungs: BookingRung[];
  placementsEnabled: Record<BookingSurface, boolean>;
  /** Null until availability first loads. */
  data: BookingCalendarData | null;
  /** A refetch is running over data already on screen. */
  refreshing?: boolean;
  horizonDays: number;
  maxBookingDays: number;
  position: number | null;
  onPositionChange: (position: number) => void;
  range: DateRange | undefined;
  onRangeChange: (range: DateRange | undefined) => void;
  /** A refusal from the server (someone booked the days first). */
  serverNote: string | null;
  formatPrice: (amount: number, currency: string) => string;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const locale = useLocale();
  const positionLabelId = useId();
  const datesLabelId = useId();
  const { data, position } = props;

  const selection = useMemo(() => selectionFromRange(props.range), [props.range]);
  const today = data?.today ?? utcDay();
  const lastDay = data?.lastDay ?? addDays(today, props.horizonDays);

  const clash = useMemo(
    () =>
      data && position !== null && selection
        ? clashingDays(data, position, selection.startDay, selection.endDay)
        : [],
    [data, position, selection],
  );
  const overMax = Boolean(selection && selection.days > props.maxBookingDays);

  // One month at a time, opened where the booking is: the picked range, else
  // the rung's first free day. Opening on the current month showed a grid of
  // mostly past days on the 27th.
  const anchorDay =
    selection?.startDay ??
    (data && position !== null ? nextFreeDay(data, position) : null) ??
    today;
  const [month, setMonth] = useState(() => calendarDateFromUtcDay(anchorDay));
  useApplyOnChange([position, data], () => {
    if (!props.range?.from) setMonth(calendarDateFromUtcDay(anchorDay));
  });

  const notes = useMemo(() => {
    const out = new Map<number, { text: string; error: boolean }>();
    for (const rung of props.rungs) {
      if (rung.blocked === "unreachable") {
        out.set(rung.position, {
          error: true,
          text: label(
            "boosts.booking.blockedNowhere",
            "Shows on no page right now — raise a placement's slot count first.",
          ),
        });
        continue;
      }
      if (rung.blocked === "stale") {
        out.set(rung.position, {
          error: true,
          text:
            props.area === "admin"
              ? label(
                  "boosts.booking.blockedStale",
                  "Priced in another currency — re-price it on the ladder first.",
                )
              : label(
                  "boosts.purchase.positionStale",
                  "Priced in another currency — ask the marketplace to re-price it.",
                ),
        });
        continue;
      }
      if (!data) continue;
      if (selection) {
        const taken = clashingDays(
          data,
          rung.position,
          selection.startDay,
          selection.endDay,
        ).length;
        if (taken > 0) {
          out.set(rung.position, {
            error: true,
            text: label("boosts.booking.daysTaken", "{taken} of {total} days taken", {
              taken,
              total: selection.days,
            }),
          });
          continue;
        }
      }
      const parts = missingSurfaces(rung.reach, props.placementsEnabled).map(
        (surface) => label(SURFACE_NOTE[surface].key, SURFACE_NOTE[surface].fallback),
      );
      if (!selection) {
        const free = nextFreeDay(data, rung.position);
        if (free === null) {
          parts.push(
            label("boosts.booking.noFreeDays", "No free day in the next {days} days", {
              days: props.horizonDays,
            }),
          );
        } else if (free !== data.today) {
          parts.push(
            label("boosts.positions.freeFrom", "Free from {day}", {
              day: formatBookingDay(free, locale),
            }),
          );
        }
      }
      if (parts.length > 0) out.set(rung.position, { error: false, text: parts.join(" · ") });
    }
    return out;
  }, [props.rungs, props.area, props.placementsEnabled, props.horizonDays, data, selection, label, locale]);

  const calendar = useMemo(() => {
    const toDates = (days: Iterable<string>) => [...days].map(calendarDateFromUtcDay);
    if (!data || position === null) {
      return { blocked: [], taken: [], own: [], product: [], clash: [] };
    }
    const own = data.own.get(position) ?? new Set<string>();
    return {
      blocked: toDates(blockedDays(data, position)),
      // Struck through: sold to someone else. The vendor's own days are
      // ringed instead — seeing them struck out reads as a fault.
      taken: toDates([...(data.taken.get(position) ?? [])].filter((day) => !own.has(day))),
      own: toDates(own),
      product: toDates(data.productDays),
      clash: toDates(clash),
    };
  }, [data, position, clash]);

  const titleForDay = useCallback(
    (day: string) => {
      if (!data || position === null) return undefined;
      if (data.productDays.has(day)) {
        return label("boosts.booking.legendThisProduct", "This product already boosted");
      }
      if (data.taken.get(position)?.has(day)) {
        const holder = data.holders.get(position)?.get(day);
        const booked = label("boosts.purchase.legendBooked", "Booked");
        return holder ? `${booked}: ${holder}` : booked;
      }
      return undefined;
    },
    [data, position, label],
  );

  let dateNote: { text: string; error: boolean } | null = null;
  if (position !== null) {
    if (props.serverNote) dateNote = { text: props.serverNote, error: true };
    else if (overMax) {
      dateNote = {
        error: true,
        text: label("boosts.purchase.overMaxDays", "A booking cannot exceed {days} days.", {
          days: props.maxBookingDays,
        }),
      };
    } else if (clash.length > 0 && data) {
      const days = formatBookingRuns(clash, locale);
      dateNote = {
        error: true,
        text: clash.some((day) => data.productDays.has(day))
          ? label(
              "boosts.purchase.productBusy",
              "This product is already scheduled on {days}. Pick other dates, or a different product.",
              { days },
            )
          : label(
              "boosts.booking.datesTaken",
              "Already booked on this position: {days}. Pick other dates or another position.",
              { days },
            ),
      };
    } else if (!props.range?.from) {
      dateNote = {
        error: false,
        text: label("boosts.booking.pickFirstDay", "Click the first day, then the last."),
      };
    } else if (!props.range.to) {
      dateNote = {
        error: false,
        text: label("boosts.booking.pickLastDay", "Now click the last day."),
      };
    }
  }

  if (props.rungs.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">
        {label("boosts.purchase.noPositions", "No sponsored positions are on sale yet")}
      </p>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)] md:items-start">
      <section aria-labelledby={positionLabelId} className="space-y-2">
        <h3 id={positionLabelId} className="text-sm font-medium">
          {label("boosts.admin.position", "Position")}
        </h3>
        <div
          role="radiogroup"
          aria-labelledby={positionLabelId}
          className="overflow-hidden rounded-2xl border bg-card"
        >
          {props.rungs.map((rung, index) => {
            const active = rung.position === position;
            const locked = rung.blocked !== null;
            const note = notes.get(rung.position);
            return (
              <button
                key={rung.position}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                onClick={() => props.onPositionChange(rung.position)}
                className={cn(
                  "flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors",
                  index > 0 && "border-t border-border/60",
                  active ? "bg-primary/5" : "hover:bg-muted/50",
                  locked && "cursor-not-allowed opacity-70 hover:bg-transparent",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-px size-[18px] shrink-0 rounded-full border-[1.5px] bg-card",
                    active ? "border-[5px] border-primary" : "border-muted-foreground/40",
                    locked && "border-dashed",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">
                      <span className="mr-1.5 font-medium text-muted-foreground">
                        #{rung.position}
                      </span>
                      {rung.label}
                    </span>
                    {/* The rung's own currency: a stale rung is listed because
                        it is priced in another one, and relabelling it with
                        the store's symbol would hide why it is locked. */}
                    <span className="shrink-0 text-sm font-semibold whitespace-nowrap">
                      {props.formatPrice(rung.pricePerDay, rung.currency)}
                      <span className="text-xs font-normal text-muted-foreground">
                        {label("boosts.purchase.perDay", "/day")}
                      </span>
                    </span>
                  </span>
                  {note ? (
                    <span
                      className={cn(
                        "mt-0.5 block text-xs",
                        note.error ? "font-medium text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {note.text}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={datesLabelId} className="min-w-0 space-y-2">
        <h3 id={datesLabelId} className="text-sm font-medium">
          {label("boosts.admin.dates", "Dates (UTC)")}
        </h3>
        <div className="relative rounded-2xl border bg-card p-4">
          <div className={cn(position === null && "pointer-events-none opacity-35")}>
            {/* `relative`: the month arrows are absolutely positioned and
                anchor to the nearest positioned box. */}
            <div className="relative mx-auto w-fit">
              <DayTitleContext.Provider value={titleForDay}>
                <Calendar
                  mode="range"
                  month={month}
                  onMonthChange={setMonth}
                  selected={props.range}
                  onSelect={props.onRangeChange}
                  numberOfMonths={1}
                  showOutsideDays={false}
                  fixedWeeks
                  weekStartsOn={1}
                  // A drag can never span a sold day, so the calendar cannot
                  // offer a range the server would refuse.
                  excludeDisabled
                  min={1}
                  max={props.maxBookingDays}
                  startMonth={calendarDateFromUtcDay(today)}
                  endMonth={calendarDateFromUtcDay(lastDay)}
                  disabled={[
                    { before: calendarDateFromUtcDay(today) },
                    { after: calendarDateFromUtcDay(lastDay) },
                    ...calendar.blocked,
                  ]}
                  modifiers={{
                    taken: calendar.taken,
                    own: calendar.own,
                    productBooked: calendar.product,
                    clash: calendar.clash,
                  }}
                  modifiersClassNames={{
                    taken: cn(
                      "!opacity-80 [&>button]:!text-muted-foreground [&>button]:line-through",
                      HOVERABLE_DAY,
                    ),
                    own: "[&>button]:ring-1 [&>button]:ring-primary/40 [&>button]:ring-inset",
                    productBooked: cn(
                      "!opacity-80 [&>button]:!text-muted-foreground",
                      PRODUCT_DAY_DOT,
                      HOVERABLE_DAY,
                    ),
                    clash: "!opacity-100 [&>button]:!text-destructive [&>button]:line-through",
                  }}
                  classNames={{
                    hidden: HIDDEN_DAY,
                    ...(clash.length > 0 ? CLASH_RANGE_CLASSNAMES : {}),
                  }}
                  components={{ Day: BookingDay }}
                />
              </DayTitleContext.Provider>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium line-through">8</span>
              {label("boosts.purchase.legendBooked", "Booked")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="relative pb-1.5 font-medium">
                8
                <span className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-amber-600" />
              </span>
              {label("boosts.booking.legendThisProduct", "This product already boosted")}
            </span>
            {props.area === "vendor" ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex size-5 items-center justify-center rounded-full font-medium text-foreground ring-1 ring-primary/40 ring-inset">
                  8
                </span>
                {label("boosts.purchase.legendYours", "Yours")}
              </span>
            ) : null}
          </div>
          {position === null ? (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <span className="rounded-xl border bg-card px-3.5 py-2.5 text-center text-[13px] font-medium shadow-sm">
                {label(
                  "boosts.purchase.pickPositionFirst",
                  "Pick a position to see which days are free.",
                )}
              </span>
            </div>
          ) : null}
          {props.refreshing ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>
        {dateNote ? (
          <p
            className={cn(
              "flex items-start gap-2 text-[13px] leading-5",
              dateNote.error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {dateNote.error ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : null}
            <span>{dateNote.text}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — summary and footer

export function BookingSummary(props: {
  productName: string;
  productImage?: string | null;
  storeName?: string | null;
  rows: Array<{ label: string; value: string }>;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  return (
    <section
      aria-label={label("boosts.booking.summary", "Summary")}
      className="space-y-3 rounded-2xl border bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <ProductThumb image={props.productImage} className="size-10" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" title={props.productName}>
            {props.productName}
          </p>
          {props.storeName ? (
            <p className="truncate text-xs text-muted-foreground">{props.storeName}</p>
          ) : null}
        </div>
      </div>
      <div className="h-px bg-border/60" />
      <dl className="space-y-2 text-[13px]">
        {props.rows.map((row) => (
          <div key={row.label} className="flex gap-3">
            <dt className="w-16 shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function BookingFooter(props: {
  secondary: { label: string; onClick: () => void; disabled?: boolean };
  total: { label: string; value: string } | null;
  primary: {
    label: string;
    onClick: () => void;
    disabled: boolean;
    busy?: boolean;
    arrow?: boolean;
  };
}) {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-t px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
      {props.total ? (
        <div className="flex items-baseline justify-between gap-3 sm:order-2 sm:ml-auto sm:flex-col sm:items-end sm:gap-0">
          <span className="text-xs text-muted-foreground">{props.total.label}</span>
          <span className="text-lg leading-6 font-bold">{props.total.value}</span>
        </div>
      ) : null}
      {/* `contents` on wide screens lets the buttons join the row around the
          total; on a phone they sit together under it. */}
      <div className="flex gap-2 sm:contents">
        <Button
          variant="outline"
          className="h-10 flex-1 bg-card sm:order-1 sm:flex-none"
          onClick={props.secondary.onClick}
          disabled={props.secondary.disabled}
        >
          {props.secondary.label}
        </Button>
        <Button
          className={cn("h-10 flex-1 sm:order-3 sm:flex-none", !props.total && "sm:ml-auto")}
          onClick={props.primary.onClick}
          disabled={props.primary.disabled}
        >
          {props.primary.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {props.primary.label}
          {props.primary.arrow ? <ArrowRight className="h-4 w-4" /> : null}
        </Button>
      </div>
    </div>
  );
}
