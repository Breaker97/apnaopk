"use client";

import * as React from "react";
import { Check, ChevronDown, Lock, Search, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  matchPOSLocations,
  posLocationAccent,
  posLocationShortCode,
} from "@/lib/pos/register-location";
import type { POSLocationOption } from "@/lib/pos/list-locations";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/**
 * Which counter this register is standing at — the one control on the POS bar
 * that is not a filter.
 *
 * It sits left of the search field because "who is this register" is the first
 * question, and it is tinted with the branch's own accent so it cannot be
 * mistaken for the stock dropdown sitting beside it. A cashier selling from the
 * wrong branch decrements the wrong stock and prints the wrong receipt footer,
 * so the cost of this reading as "just another filter" is real money.
 */

/** Above this many counters, scanning a list beats reading it. */
const SEARCH_THRESHOLD = 8;
/** Number keys only reach the first nine rows; past that, type to narrow. */
const MAX_NUMBER_SHORTCUTS = 9;

interface POSLocationBadgeProps {
  locations: POSLocationOption[];
  /** Empty string means the register sells from aggregate stock. */
  locationId: string;
  onSelect: (locationId: string) => void;
  /** Held sale counts per location id, shown so parked work is not forgotten. */
  heldCounts?: Record<string, number>;
  /** True while a payment is in flight — switching then is a data-integrity bug. */
  locked?: boolean;
  /** Below `lg` the full name does not fit beside the search field. */
  compact?: boolean;
  /** Full-width row for the mobile cart tab, where the search bar is hidden. */
  stretch?: boolean;
  /**
   * Bumped by the workspace on every DELIBERATE counter change, which makes the
   * badge pulse once in the new branch's colour.
   *
   * A counter under a register moved and nothing on screen moved with it is how
   * a cashier stops trusting the badge — the toast says it in words, this says it
   * where their eyes already are. Driven by a token rather than by watching
   * `locationId` so the quiet correction at boot, when the machine's remembered
   * counter replaces the server's guess, does not flash at somebody who did
   * nothing.
   */
  flashToken?: number;
  className?: string;
}

export function POSLocationBadge({
  locations,
  locationId,
  onSelect,
  heldCounts,
  locked = false,
  compact = false,
  stretch = false,
  flashToken = 0,
  className,
}: POSLocationBadgeProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [isFlashing, setIsFlashing] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // A ring added and removed rather than a keyframe: the face already carries
  // `transition-all`, so the browser eases it in and back out on its own and
  // there is no animation to keep in step with the theme.
  useApplyOnChange([flashToken], () => {
    if (flashToken !== 0) setIsFlashing(true);
  });
  React.useEffect(() => {
    if (flashToken === 0) return;
    const timer = window.setTimeout(() => setIsFlashing(false), 850);
    return () => window.clearTimeout(timer);
  }, [flashToken]);

  const active = React.useMemo(
    () => locations.find((location) => location.id === locationId) ?? null,
    [locations, locationId],
  );

  // A stored id with no matching row means the branch was deactivated while the
  // register was open. The cashier is told, but not thrown out mid-sale.
  const isStale = Boolean(locationId) && !active;

  // A dropdown holding the option you are already on is noise, so one counter
  // usually means a static label. It is still a real choice while the register
  // sits on shared stock, though: without this a single-branch merchant could
  // see their counter named and have no way to move onto it.
  //
  // Shared stock is never offered as a DESTINATION. It is where a register
  // starts before anyone configures a counter, not somewhere a cashier should
  // be able to retreat to — that would let them sell a branch's sales against
  // the aggregate pool. Moving back is a merchant decision, made in settings.
  const isSwitchable =
    locations.length > 1 ||
    (locations.length === 1 && locationId !== locations[0].id);

  const accent = posLocationAccent(locationId);
  const label = active
    ? active.name
    : isStale
      ? "Counter unavailable"
      : "Shared stock";

  const filtered = React.useMemo(
    () => matchPOSLocations(locations, query),
    [locations, query],
  );

  const showSearch = locations.length > SEARCH_THRESHOLD;

  useApplyOnChange([open], () => {
    if (!open) setQuery("");
  });

  // Alt+B opens the list. Deliberately a modifier chord and not a bare key: a
  // stray keystroke must never be able to move the register to another counter.
  React.useEffect(() => {
    if (!isSwitchable || locked) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSwitchable, locked]);

  /**
   * Keys while the list is open, under the same rule the shift-start picker
   * uses: focus decides whether a digit picks a counter or is part of a branch
   * name. Two screens that answer the same keypress differently is one rule too
   * many for somebody working a till.
   *
   * They used to switch off entirely past eight counters, which threw away the
   * fastest input for everyone because 1–9 cannot address a tenth. The tenth is
   * reachable by typing instead.
   */
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const typingHere = document.activeElement === searchRef.current;

      if (event.key === "Escape" && typingHere && query) {
        event.preventDefault();
        setQuery("");
        searchRef.current?.blur();
        return;
      }

      if (typingHere || event.ctrlKey || event.metaKey || event.altKey) return;

      const index = Number(event.key) - 1;
      if (
        !Number.isNaN(index) &&
        index >= 0 &&
        index < Math.min(filtered.length, MAX_NUMBER_SHORTCUTS)
      ) {
        event.preventDefault();
        setOpen(false);
        onSelect(filtered[index].id);
        return;
      }

      // Type-ahead, so the field never has to be focused for the cashier — on a
      // tablet an auto-focused search throws the on-screen keyboard over the
      // very rows they opened the list to tap.
      if (showSearch && event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault();
        setQuery((current) => current + event.key);
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filtered, onSelect, open, query, showSearch]);

  const face = (
    <BadgeFace
      accent={accent}
      compact={compact}
      isFlashing={isFlashing}
      isShared={!active && !isStale}
      isStale={isStale}
      label={label}
      locked={locked}
      showChevron={isSwitchable && !locked}
      stretch={stretch}
    />
  );

  if (locked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("cursor-not-allowed", stretch && "w-full", className)}>
            {face}
          </div>
        </TooltipTrigger>
        <TooltipContent>Finish or cancel the current sale first</TooltipContent>
      </Tooltip>
    );
  }

  if (!isSwitchable) {
    return <div className={cn(stretch && "w-full", className)}>{face}</div>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Selling from ${label}. Change counter`}
          className={cn(
            "cursor-pointer rounded-xl outline-none transition-all",
            "focus-visible:ring-2 focus-visible:ring-primary/30",
            open && "ring-2 ring-primary/20",
            stretch && "w-full",
            className,
          )}
        >
          {face}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(21.75rem,calc(100vw-1.5rem))] rounded-2xl p-2"
      >
        <div className="flex items-center justify-between px-3 pb-2 pt-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Selling from
          </span>
          <kbd className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Alt B
          </kbd>
        </div>

        {showSearch ? (
          <div className="relative px-1 pb-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a counter..."
              className="h-9 rounded-xl pl-9 text-sm"
            />
          </div>
        ) : null}

        {/* The cap has to be on the VIEWPORT as well as the root, which is the
            house pattern (see `country-multi-select`). With it on the root
            alone, Radix's viewport keeps its `h-full` and grows to the full
            content height, so the root simply clipped the list at five counters
            with nothing to scroll — the rest were unreachable.

            Unconditional, because a popover list should always be bounded; with
            three counters the content never reaches the cap anyway. */}
        <ScrollArea className="max-h-72" viewportClassName="max-h-72">
          <div className="flex flex-col">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No counter matches that.
              </p>
            ) : (
              filtered.map((location, index) => {
                const isActive = location.id === locationId;
                const held = heldCounts?.[location.id] ?? 0;
                return (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onSelect(location.id);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg p-3 text-left transition-colors",
                      isActive ? "bg-primary/5" : "hover:bg-muted/60",
                    )}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        backgroundColor: `${posLocationAccent(location.id)}1f`,
                      }}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: posLocationAccent(location.id),
                        }}
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-semibold tracking-[-0.01em]">
                        {location.name}
                      </span>
                      {location.area ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {location.area}
                        </span>
                      ) : null}
                    </span>
                    {isActive ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    ) : held > 0 ? (
                      // Sales parked at another counter are invisible from here
                      // — say so before the cashier walks away from them.
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        {held} held
                      </span>
                    ) : index < MAX_NUMBER_SHORTCUTS ? (
                      <kbd className="shrink-0 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {index + 1}
                      </kbd>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>

        <div className="mt-1 flex items-center justify-between border-t border-border/60 px-3 pb-1 pt-2.5">
          <span className="text-xs text-muted-foreground">
            {locations.length} active
          </span>
          {isStale ? (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Current counter was deactivated
            </span>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface BadgeFaceProps {
  accent: string;
  compact: boolean;
  isFlashing: boolean;
  isShared: boolean;
  isStale: boolean;
  label: string;
  locked: boolean;
  showChevron: boolean;
  stretch: boolean;
}

/**
 * The visible chip. Split out because four different wrappers render it — a
 * popover trigger, a tooltip target, a plain label and a full-width mobile row —
 * and the chip must look identical in all of them.
 */
function BadgeFace({
  accent,
  compact,
  isFlashing,
  isShared,
  isStale,
  label,
  locked,
  showChevron,
  stretch,
}: BadgeFaceProps) {
  // The full-width row replaces a search bar that is not on screen, so it has
  // room to say what the chip can only imply.
  const text =
    compact && !isShared && !isStale
      ? posLocationShortCode(label)
      : stretch && !isShared && !isStale
        ? `Selling at ${label}`
        : label;

  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-2.5 rounded-xl border pl-3 pr-3.5 transition-all duration-500 xl:h-10",
        stretch && "w-full",
        locked && "opacity-60",
        isStale
          ? "border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20"
          : isShared
            ? "border-dashed border-border bg-card"
            : "border-transparent",
      )}
      // The tint is the branch's own colour, so it cannot be a theme token.
      // Alpha suffixes keep it legible on both the light and dark card surface.
      // The flash ring uses the same colour at a heavier alpha, so the pulse
      // reads as "this branch" rather than as a generic highlight.
      style={{
        ...(isStale || isShared
          ? {}
          : {
              backgroundColor: `${accent}14`,
              borderColor: `${accent}47`,
            }),
        ...(isFlashing ? { boxShadow: `0 0 0 4px ${accent}55` } : {}),
      }}
    >
      {isStale ? (
        <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      ) : isShared ? (
        <span className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-muted-foreground/60" />
      ) : (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
      )}

      <span
        className={cn(
          "truncate text-sm font-semibold tracking-[-0.01em]",
          compact && !isShared && !isStale && "tracking-[0.04em]",
          isStale
            ? "text-amber-900 dark:text-amber-200"
            : isShared
              ? "text-muted-foreground"
              : "text-foreground",
          stretch && "flex-1",
        )}
      >
        {text}
      </span>

      {locked ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : showChevron ? (
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isStale ? "text-amber-600" : "text-muted-foreground",
          )}
        />
      ) : null}
    </div>
  );
}
