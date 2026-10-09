"use client";

import { useMemo, type ReactNode } from "react";
import Link from "@/components/language/link";
import {
  Archive,
  CalendarDays,
  Check,
  Circle,
  Minus,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { addDays } from "@/lib/boosts/boost-days";
import {
  buildLadderSegments,
  ladderAxisTicks,
  ladderDividerStep,
  type LadderDay,
  type LadderWindowSummary,
} from "@/lib/boosts/boost-ladder-track";
import {
  isPositionUnreachable,
  type SponsoredPlacementDepths,
  type SponsoredPlacementsEnabled,
} from "@/lib/boosts/boost-placement-depths";
import { cn } from "@/lib/utils";

export interface BoostPositionRow {
  _id: string;
  position: number;
  label: string;
  description: string;
  pricePerDay: number;
  currency: string;
  status: "active" | "archived";
  /** Booked days from today to the end of the occupancy window, in order. */
  bookedDays: LadderDay[];
  /** Observed impressions/day for this rung over the last 30 days. */
  avgImpressionsPerDay: number | null;
  /**
   * Why DELETE would refuse, asked by the page so the menu can say so before
   * anyone confirms: days sold from today onward, or a paused / scheduled /
   * unpaid booking that still points at the rung.
   */
  deleteBlocked: "booked" | "claimed" | null;
}

type LadderLabel = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

/**
 * A rung card has three arrangements, picked by the width of the ladder itself
 * (a container query, so a collapsed sidebar counts too):
 *
 * - narrow: stacked — who and where, three stat tiles, then the track;
 * - from 720px: the numbers join the first line and the track runs the full
 *   width underneath, because a track squeezed in beside them is too short to
 *   read a month on;
 * - from 1100px: one row on the axis header's own column template, so every
 *   card's track and numbers sit under the header's dates and titles and the
 *   cards read down like a table without giving up being cards.
 */
const LADDER_CARD_GRID =
  "grid-cols-3 @[720px]:grid-cols-[minmax(0,1fr)_76px_88px_112px_72px] @[720px]:items-center @[720px]:gap-x-4 @[1100px]:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_72px_84px_112px_72px]";
const LADDER_HEADER_GRID =
  "grid-cols-[minmax(240px,300px)_minmax(0,1fr)_72px_84px_112px_72px] gap-x-4";

/** The pattern that tells an unpaid hold from a paid day without colour alone. */
const HOLD_STRIPES =
  "repeating-linear-gradient(135deg, color-mix(in oklab, var(--primary) 32%, transparent) 0 5px, color-mix(in oklab, var(--primary) 12%, transparent) 5px 10px)";

/** An archived rung's free days: hatched, because they are not for sale. */
const NOT_FOR_SALE_HATCH =
  "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, var(--foreground) 8%, transparent) 6px 12px)";

export const LADDER_SURFACES = [
  {
    key: "home",
    nameKey: "boosts.positions.surfaceHome",
    fallback: "Home",
  },
  {
    key: "listing",
    nameKey: "boosts.positions.surfaceListing",
    fallback: "Listings",
  },
  {
    key: "productPage",
    nameKey: "boosts.positions.surfaceProductPage",
    fallback: "Product pages",
  },
] as const;

/**
 * A surface is off when its Settings switch is off OR its template renders no
 * sponsored section (depth 0). Either way no rung shows there, and saying
 * "top 0" would read like a setting rather than an absence.
 */
export function isSurfaceOff(
  key: (typeof LADDER_SURFACES)[number]["key"],
  depths: SponsoredPlacementDepths,
  enabled: SponsoredPlacementsEnabled,
): boolean {
  return enabled[key] === false || depths[key] <= 0;
}

function pct(days: number, windowDays: number): string {
  return `${(days / windowDays) * 100}%`;
}

export function LadderAxisHeader({
  today,
  windowDays,
  formatDay,
  label,
}: {
  today: string;
  windowDays: number;
  formatDay: (day: string) => string;
  label: LadderLabel;
}) {
  return (
    // Hidden from assistive tech: every card carries its own screen-reader
    // captions, so a header row read once, out of context, adds nothing.
    <div
      aria-hidden
      className={cn("hidden items-end px-[17px] @[1100px]:grid", LADDER_HEADER_GRID)}
    >
      <HeaderCell title={label("boosts.positions.position", "Position")} align="left" />
      <div className="relative h-4">
        {ladderAxisTicks(windowDays).map((offset) => (
          <span
            key={offset}
            className="absolute bottom-0 whitespace-nowrap border-l border-border pl-1.5 text-[11px] leading-3.5 text-muted-foreground"
            style={{ left: pct(offset, windowDays) }}
          >
            {offset === 0
              ? label("boosts.positions.axisToday", "Today")
              : formatDay(addDays(today, offset))}
          </span>
        ))}
        <span className="absolute right-0 bottom-0 whitespace-nowrap border-r border-border pr-1.5 text-[11px] leading-3.5 text-muted-foreground">
          {formatDay(addDays(today, windowDays - 1))}
        </span>
      </div>
      <HeaderCell
        title={label("boosts.positions.colPrice", "Price")}
        sub={label("boosts.positions.colPerDay", "per day")}
      />
      <HeaderCell
        title={label("boosts.positions.colBooked", "Booked")}
        sub={label("boosts.positions.colNextDays", "next {days} days", {
          days: windowDays,
        })}
      />
      <HeaderCell
        title={label("boosts.positions.colImpressions", "Impressions")}
        sub={label(
          "boosts.positions.colImpressionsHint",
          "per day · 30-day avg",
        )}
      />
      <span />
    </div>
  );
}

function HeaderCell({
  title,
  sub,
  align = "right",
}: {
  title: string;
  sub?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right")}>
      <p className="truncate text-xs font-medium text-muted-foreground">{title}</p>
      {sub ? (
        <p className="truncate text-[11px] text-muted-foreground/80">{sub}</p>
      ) : null}
    </div>
  );
}

/**
 * One rung: who holds it and when (the track), what it costs, how full it is
 * and what it delivers — on one row, so ten rungs fit on a screen and compare
 * at a glance.
 */
export function LadderRungCard({
  row,
  locale,
  today,
  windowDays,
  horizonDays,
  summary,
  depths,
  placementsEnabled,
  storeCurrency,
  formatDay,
  label,
  busy,
  onEdit,
  onToggleArchive,
  onDelete,
}: {
  row: BoostPositionRow;
  locale: string;
  today: string;
  windowDays: number;
  /** How far ahead vendors can book; "next free" is looked for this far. */
  horizonDays: number;
  summary: LadderWindowSummary;
  depths: SponsoredPlacementDepths;
  placementsEnabled: SponsoredPlacementsEnabled;
  storeCurrency: string;
  formatDay: (day: string) => string;
  label: LadderLabel;
  busy: boolean;
  onEdit: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const archived = row.status === "archived";
  // Archived outranks the rest: a rung that is off sale is not "broken" for
  // rendering nowhere or for its currency — nothing can be bought on it.
  const unreachable =
    !archived && isPositionUnreachable(row.position, depths, placementsEnabled);
  const stale =
    !archived &&
    Boolean(row.currency) &&
    row.currency.toUpperCase() !== storeCurrency.toUpperCase();

  const actions = (className: string) => (
    <RungActions
      row={row}
      locale={locale}
      label={label}
      busy={busy}
      onEdit={onEdit}
      onToggleArchive={onToggleArchive}
      onDelete={onDelete}
      className={className}
    />
  );

  return (
    <Card
      className={cn(
        "gap-0 py-0",
        archived && "bg-muted/40",
        (unreachable || stale) && "border-destructive/40",
      )}
    >
      <CardContent className={cn("grid gap-2.5 px-4 py-3.5", LADDER_CARD_GRID)}>
        <RungIdentity
          row={row}
          archived={archived}
          unreachable={unreachable}
          stale={stale}
          depths={depths}
          placementsEnabled={placementsEnabled}
          label={label}
          actions={actions("-mt-1 -mr-2 @[720px]:hidden")}
          className="col-span-3 @[720px]:col-span-1"
        />
        <RungTrack
          row={row}
          locale={locale}
          today={today}
          windowDays={windowDays}
          summary={summary}
          archived={archived}
          unreachable={unreachable}
          stale={stale}
          formatDay={formatDay}
          label={label}
          className="order-last col-span-3 @[720px]:col-span-5 @[1100px]:order-none @[1100px]:col-span-1"
        />
        <RungPriceStat
          pricePerDay={row.pricePerDay}
          currency={row.currency}
          stale={stale}
          muted={archived}
          storeCurrency={storeCurrency}
          label={label}
        />
        <RungStat
          caption={label("boosts.positions.colBooked", "Booked")}
          value={`${Math.round((summary.booked / windowDays) * 100)}%`}
          valueClassName={
            summary.booked === 0 || archived ? "text-muted-foreground" : undefined
          }
          sub={bookedSub({ archived, summary, windowDays, horizonDays, formatDay, label })}
        />
        <RungStat
          caption={label("boosts.positions.colImpressions", "Impressions")}
          value={
            row.avgImpressionsPerDay === null
              ? "—"
              : row.avgImpressionsPerDay.toLocaleString(locale)
          }
          valueClassName={
            row.avgImpressionsPerDay === null || archived
              ? "text-muted-foreground"
              : undefined
          }
          sub={
            row.avgImpressionsPerDay === null
              ? label("boosts.positions.noData", "no data yet")
              : label("boosts.positions.colPerDay", "per day")
          }
          // The wide layout's header already says "per day".
          subClassName={
            row.avgImpressionsPerDay === null ? undefined : "@[1100px]:hidden"
          }
        />
        {actions("hidden @[720px]:flex")}
      </CardContent>
    </Card>
  );
}

function bookedSub({
  archived,
  summary,
  windowDays,
  horizonDays,
  formatDay,
  label,
}: {
  archived: boolean;
  summary: LadderWindowSummary;
  windowDays: number;
  horizonDays: number;
  formatDay: (day: string) => string;
  label: LadderLabel;
}): string {
  if (archived) return label("boosts.positions.noNewBookings", "no new bookings");
  if (summary.firstFree === null) {
    // Sold out across the window: the useful fact is when it frees up, not
    // that the visible stretch is full.
    return summary.nextFreeDay
      ? label("boosts.positions.freeFromShort", "free from {day}", {
          day: formatDay(summary.nextFreeDay),
        })
      : label("boosts.positions.noFreeDay", "no free day in the next {days} days", {
          days: Math.max(windowDays, horizonDays),
        });
  }
  return summary.held > 0
    ? label("boosts.positions.bookedOfHeld", "{booked} of {total} days, {held} on hold", {
        booked: summary.booked,
        total: windowDays,
        held: summary.held,
      })
    : label("boosts.positions.bookedOf", "{booked} of {total} days", {
        booked: summary.booked,
        total: windowDays,
      });
}

function RungIdentity({
  row,
  archived,
  unreachable,
  stale,
  depths,
  placementsEnabled,
  label,
  actions,
  className,
}: {
  row: BoostPositionRow;
  archived: boolean;
  unreachable: boolean;
  stale: boolean;
  depths: SponsoredPlacementDepths;
  placementsEnabled: SponsoredPlacementsEnabled;
  label: LadderLabel;
  actions: ReactNode;
  className?: string;
}) {
  const badges: Array<{ id: string; text: string; tone: string }> = [];
  if (archived) {
    badges.push({
      id: "archived",
      text: label("boosts.positions.archived", "Archived"),
      tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200",
    });
  } else {
    if (unreachable) {
      badges.push({
        id: "nowhere",
        text: label("boosts.positions.statusNowhere", "Renders nowhere"),
        tone: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
      });
    }
    if (stale) {
      badges.push({
        id: "stale",
        text: label("boosts.positions.statusReprice", "Re-price needed"),
        tone: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
      });
    }
    if (!unreachable && !stale) {
      badges.push({
        id: "active",
        text: label("boosts.positions.active", "Active"),
        tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
      });
    }
  }

  return (
    <div className={cn("flex min-w-0 items-start gap-3", className)}>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg text-[15px] font-bold tabular-nums",
          archived
            ? "bg-muted text-muted-foreground"
            : unreachable
              ? "bg-destructive/10 text-destructive"
              : "bg-primary/10 text-primary",
        )}
      >
        #{row.position}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={cn(
              "min-w-0 truncate text-sm font-semibold",
              archived && "text-muted-foreground",
            )}
          >
            {row.label}
          </p>
          {badges.map((badge) => (
            <span
              key={badge.id}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2 py-0.5 text-[11px] font-medium",
                badge.tone,
              )}
            >
              <Circle className="size-2 fill-current stroke-0" aria-hidden />
              {badge.text}
            </span>
          ))}
        </div>
        {row.description ? (
          <p className="truncate text-xs text-muted-foreground" title={row.description}>
            {row.description}
          </p>
        ) : null}
        <ReachChips
          position={row.position}
          depths={depths}
          placementsEnabled={placementsEnabled}
          label={label}
        />
      </div>
      {actions}
    </div>
  );
}

/**
 * Where the rung renders, one chip per surface. The depths themselves are
 * global and live once in the toolbar; a card only says in or out.
 */
function ReachChips({
  position,
  depths,
  placementsEnabled,
  label,
}: {
  position: number;
  depths: SponsoredPlacementDepths;
  placementsEnabled: SponsoredPlacementsEnabled;
  label: LadderLabel;
}) {
  return (
    <div className="flex flex-wrap gap-1 pt-0.5">
      {LADDER_SURFACES.map((surface) => {
        const name = label(surface.nameKey, surface.fallback);
        const off = isSurfaceOff(surface.key, depths, placementsEnabled);
        const shown = !off && position <= depths[surface.key];
        const tip = off
          ? label(
              "boosts.positions.chipDisabled",
              "{surface} shows no sponsored products right now",
              { surface: name },
            )
          : shown
            ? label(
                "boosts.positions.chipOn",
                "{surface} shows the top {n} positions — this one included",
                { surface: name, n: depths[surface.key] },
              )
            : label(
                "boosts.positions.chipOff",
                "{surface} shows only the top {n} positions",
                { surface: name, n: depths[surface.key] },
              );
        return (
          <span
            key={surface.key}
            title={tip}
            className={cn(
              "inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap",
              shown
                ? "bg-foreground/[0.05] text-foreground"
                : "border border-dashed border-border text-muted-foreground",
            )}
          >
            {shown ? (
              <Check className="size-2.5 text-primary" strokeWidth={3} aria-hidden />
            ) : (
              <Minus className="size-2.5" strokeWidth={3} aria-hidden />
            )}
            {name}
            <span className="sr-only">: {tip}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The window as a track: today at the left edge, one segment per booking with
 * the seller named on it, and the free stretch labelled in place. Widths are
 * percentages, so the track never wraps onto a second line the way a strip of
 * fixed-width day cells did at 90 days.
 */
function RungTrack({
  row,
  locale,
  today,
  windowDays,
  summary,
  archived,
  unreachable,
  stale,
  formatDay,
  label,
  className,
}: {
  row: BoostPositionRow;
  locale: string;
  today: string;
  windowDays: number;
  summary: LadderWindowSummary;
  archived: boolean;
  unreachable: boolean;
  stale: boolean;
  formatDay: (day: string) => string;
  label: LadderLabel;
  className?: string;
}) {
  const segments = useMemo(
    () => buildLadderSegments(row.bookedDays, today, windowDays),
    [row.bookedDays, today, windowDays],
  );
  const dividerWidth = pct(ladderDividerStep(windowDays), windowDays);

  const free = freeLabel({ summary, today, windowDays, archived, unreachable, stale, formatDay, label });

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "relative h-7 rounded-md",
          unreachable ? "bg-destructive/10" : "bg-foreground/[0.06]",
        )}
        style={
          unreachable
            ? undefined
            : archived
              ? { backgroundImage: NOT_FOR_SALE_HATCH }
              : {
                  // One divider per day (or week, past a month) from a single
                  // background layer rather than a span per day.
                  backgroundImage:
                    "linear-gradient(to right, transparent calc(100% - 1px), var(--card) 0)",
                  backgroundSize: `${dividerWidth} 100%`,
                }
        }
      >
        {free && summary.firstFree !== null && summary.freeRunEnd !== null ? (
          <span
            className="@container pointer-events-none absolute inset-y-0 flex items-center overflow-hidden px-2.5"
            style={{
              left: pct(summary.firstFree, windowDays),
              width: pct(summary.freeRunEnd - summary.firstFree, windowDays),
            }}
          >
            <span
              className={cn(
                "truncate text-[11px] font-medium",
                free.danger ? "text-destructive" : "text-muted-foreground",
                free.short ? cn("hidden", free.longAt) : "block",
              )}
            >
              {free.text}
              {unreachable ? (
                <Link
                  href={`/${locale}/admin/settings/boosting`}
                  className="pointer-events-auto ml-1 font-semibold underline underline-offset-2"
                >
                  {label("boosts.positions.nowhereFix", "Change slot counts")}
                </Link>
              ) : null}
            </span>
            {free.short ? (
              <span
                className={cn(
                  "hidden truncate text-[11px] font-medium text-muted-foreground @[44px]:block",
                  free.shortUntil,
                )}
              >
                {free.short}
              </span>
            ) : null}
          </span>
        ) : null}

        {segments.map((segment) => {
          const range = label(
            "boosts.positions.segmentRange",
            "{from} – {to} · {count} days",
            {
              from: formatDay(segment.firstDay),
              to: formatDay(segment.lastDay),
              count: segment.days,
            },
          );
          return (
            <Tooltip key={`${segment.campaignId}-${segment.offset}`}>
              <TooltipTrigger asChild>
                <Link
                  href={`/${locale}/admin/boosts/${segment.campaignId}`}
                  aria-label={`${segment.store}, ${segment.product}, ${range}`}
                  className={cn(
                    "@container absolute inset-y-[3px] block overflow-hidden rounded-[5px] px-2 text-[11px] leading-[22px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    segment.hold
                      ? "text-primary"
                      : "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                  style={{
                    left: `calc(${pct(segment.offset, windowDays)} + 2px)`,
                    width: `max(3px, calc(${pct(segment.span, windowDays)} - 4px))`,
                    ...(segment.hold ? { backgroundImage: HOLD_STRIPES } : {}),
                  }}
                >
                  <span className="hidden truncate @[56px]:block">
                    {segment.hold
                      ? label("boosts.positions.segmentHold", "On hold · unpaid")
                      : segment.store}
                    {segment.hold ? null : (
                      <span className="hidden @[220px]:inline">
                        {" · "}
                        {label("boosts.positions.segmentUntil", "until {day}", {
                          day: formatDay(segment.lastDay),
                        })}
                      </span>
                    )}
                  </span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72 text-left">
                <p className="font-semibold">{segment.store}</p>
                {segment.product ? <p className="opacity-70">{segment.product}</p> : null}
                <p className="mt-1">{range}</p>
                <p className="mt-1 opacity-70">
                  {segment.hold
                    ? label(
                        "boosts.positions.segmentHoldHint",
                        "Unpaid checkout — the days free up if payment doesn't arrive",
                      )
                    : label("boosts.positions.segmentOpen", "Open the booking")}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground @[1100px]:hidden">
        <span>{label("boosts.positions.axisToday", "Today")}</span>
        <span>{formatDay(addDays(today, windowDays - 1))}</span>
      </div>
    </div>
  );
}

/**
 * What the free stretch says. The long and short forms switch on the label's
 * own width (a container query), so a two-day gap still gets a date and a
 * month-long one gets the sentence.
 */
function freeLabel({
  summary,
  today,
  windowDays,
  archived,
  unreachable,
  stale,
  formatDay,
  label,
}: {
  summary: LadderWindowSummary;
  today: string;
  windowDays: number;
  archived: boolean;
  unreachable: boolean;
  stale: boolean;
  formatDay: (day: string) => string;
  label: LadderLabel;
}): {
  text: string;
  short?: string;
  danger?: boolean;
  longAt?: string;
  shortUntil?: string;
} | null {
  if (summary.firstFree === null) return null;
  if (archived) return { text: label("boosts.positions.notForSale", "Not for sale") };
  if (unreachable) {
    return {
      text: label(
        "boosts.positions.nowhereTrack",
        "Shown on no page — vendors can't book it.",
      ),
      danger: true,
    };
  }
  if (stale) {
    return {
      text: label(
        "boosts.positions.staleTrack",
        "Vendors can't check out until it's re-priced",
      ),
      danger: true,
    };
  }
  if (summary.booked === 0) {
    return {
      text: label(
        "boosts.positions.freeWindow",
        "Free — no bookings in the next {days} days",
        { days: windowDays },
      ),
      short: label("boosts.positions.freeShort", "Free"),
      longAt: "@[240px]:block",
      shortUntil: "@[240px]:hidden",
    };
  }
  if (summary.firstFree === 0) {
    return {
      text: label("boosts.positions.freeToday", "Free today"),
      short: label("boosts.positions.freeShort", "Free"),
      longAt: "@[110px]:block",
      shortUntil: "@[110px]:hidden",
    };
  }
  const day = formatDay(addDays(today, summary.firstFree));
  return {
    text: label("boosts.positions.freeFrom", "Free from {day}", { day }),
    short: day,
    longAt: "@[130px]:block",
    shortUntil: "@[130px]:hidden",
  };
}

function RungStat({
  caption,
  value,
  valueClassName,
  sub,
  subClassName,
}: {
  caption: string;
  value: string;
  valueClassName?: string;
  sub?: string;
  subClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2 @[720px]:rounded-none @[720px]:bg-transparent @[720px]:p-0 @[720px]:text-right">
      {/* Drawn wherever there is no header row; on the wide layout the header
          carries it visually and this stays for screen readers. */}
      <p className="truncate text-[11px] text-muted-foreground @[1100px]:sr-only">
        {caption}
      </p>
      <p className={cn("truncate text-sm font-semibold tabular-nums", valueClassName)}>
        {value}
      </p>
      {sub ? (
        <p className={cn("truncate text-[11px] text-muted-foreground", subClassName)}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The price in the rung's OWN currency. `useCurrency().formatPrice` speaks the
 * store's default, which is exactly wrong for a rung priced before the store
 * changed currency: a $20 rung on a EUR store was drawn as "€20.00", hiding
 * the one fact on the card that needed reading.
 */
function RungPriceStat({
  pricePerDay,
  currency,
  stale,
  muted,
  storeCurrency,
  label,
}: {
  pricePerDay: number;
  currency: string;
  stale: boolean;
  muted: boolean;
  storeCurrency: string;
  label: LadderLabel;
}) {
  const formatPrice = useCurrencyFormatter(currency);
  return (
    <RungStat
      caption={label("boosts.positions.pricePerDay", "Price per day")}
      value={formatPrice(pricePerDay)}
      valueClassName={
        stale ? "text-destructive" : muted ? "text-muted-foreground" : undefined
      }
      sub={
        stale
          ? label("boosts.positions.storeCurrency", "store is {currency}", {
              currency: storeCurrency.toUpperCase(),
            })
          : undefined
      }
      subClassName={stale ? "text-destructive" : undefined}
    />
  );
}

function RungActions({
  row,
  locale,
  label,
  busy,
  onEdit,
  onToggleArchive,
  onDelete,
  className,
}: {
  row: BoostPositionRow;
  locale: string;
  label: LadderLabel;
  busy: boolean;
  onEdit: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const blockedReason =
    row.deleteBlocked === "booked"
      ? label(
          "boosts.positions.deleteBlockedBooked",
          "Has bookings from today onward — archive it instead.",
        )
      : row.deleteBlocked === "claimed"
        ? label(
            "boosts.positions.deleteBlockedClaimed",
            "A paused, scheduled or unpaid booking still holds it — archive it instead.",
          )
        : null;

  return (
    <div className={cn("flex shrink-0 items-center justify-end gap-1", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={label("boosts.positions.editAria", "Edit position {position}", {
              position: row.position,
            })}
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label("common.edit", "Edit")}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={label(
              "boosts.positions.moreActions",
              "More actions for position {position}",
              { position: row.position },
            )}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem asChild>
            <Link href={`/${locale}/admin/boosts?position=${row.position}`}>
              <CalendarDays />
              {label("boosts.positions.viewBookings", "View bookings")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onClick={onToggleArchive}>
            <Archive />
            {row.status === "active"
              ? label("boosts.positions.archive", "Archive")
              : label("boosts.positions.unarchive", "Unarchive")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {blockedReason ? (
            // Disabled, and says why — instead of letting the admin confirm a
            // delete the server is certain to refuse.
            <DropdownMenuItem
              disabled
              className="items-start text-muted-foreground data-[disabled]:opacity-100"
            >
              <Trash2 className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span>{label("common.delete", "Delete")}</span>
                <span className="text-xs leading-snug">{blockedReason}</span>
              </span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" disabled={busy} onClick={onDelete}>
              <Trash2 />
              {label("common.delete", "Delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Undefined rungs drawn where they sit, between the rungs around them. A
 * banner alone said "#4 is undefined" and left the admin to find the hole.
 * Consecutive holes collapse into one card.
 */
export function LadderGapCard({
  from,
  to,
  label,
  onDefine,
}: {
  from: number;
  to: number;
  label: LadderLabel;
  onDefine: () => void;
}) {
  const single = from === to;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border-[1.5px] border-dashed border-foreground/15 px-4 py-3">
      <span className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border-[1.5px] border-dashed border-foreground/15 px-1.5 text-[15px] font-bold text-muted-foreground tabular-nums">
        {single ? `#${from}` : `#${from}–${to}`}
      </span>
      {/* The basis makes the button drop under the copy on a phone rather
          than squeeze it into a four-line column. */}
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold text-muted-foreground">
          {label("boosts.positions.gapTitle", "Not defined")}
        </p>
        <p className="text-xs text-muted-foreground">
          {single
            ? label(
                "boosts.positions.gapHint",
                "Slot {position} shows a regular product every day — nothing below moves up into it.",
                { position: from },
              )
            : label(
                "boosts.positions.gapRangeHint",
                "Slots {from}–{to} show a regular product every day — nothing below moves up into them.",
                { from, to },
              )}
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onDefine}>
        <Plus className="size-3.5" />
        {label("boosts.positions.defineGap", "Define #{position}", { position: from })}
      </Button>
    </div>
  );
}
