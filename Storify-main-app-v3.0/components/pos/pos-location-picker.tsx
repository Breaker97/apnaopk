"use client";

import * as React from "react";
import { ArrowRight, Check, Search, Store } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  matchPOSLocations,
  posLocationAccent,
} from "@/lib/pos/register-location";
import type { POSLocationOption } from "@/lib/pos/list-locations";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/**
 * The shift-start question: which counter is this register standing at?
 *
 * A full screen rather than a dropdown because it is asked once a shift and
 * every sale that follows inherits the answer — stock, held sales and the
 * receipt footer all key off it. Getting it wrong quietly costs a day of
 * decrements against the wrong branch, so the choice is worth a deliberate,
 * unmissable moment.
 *
 * The scaling problem here is not "how do I browse a list". A cashier is not
 * browsing: they work at one counter, yesterday and tomorrow as well as today,
 * so ten counters is one answer and nine pieces of noise. The fix is therefore
 * MEMORY, not search — the counters this machine has used are offered first,
 * and searching is what is left for the rest.
 */

/** Past this many, a flat grid stops reading at a glance and gets a search box. */
const SEARCH_THRESHOLD = 8;
/**
 * Below this, splitting the list into "recent" and "the rest" costs more than
 * it saves — five cards are already one glance, and two headings over them is
 * furniture around a decision that did not need it.
 */
const RECENTS_THRESHOLD = 5;
/** Digits only reach nine rows; past that the rest are found by typing. */
const MAX_NUMBER_SHORTCUTS = 9;

interface POSLocationPickerProps {
  locations: POSLocationOption[];
  /**
   * Counters this machine has sold from, newest first. Offered above the rest,
   * and the first still-valid one is what the screen opens on.
   */
  recentLocationIds?: string[];
  /**
   * Fallback for a machine with no history: the platform's configured counter,
   * then the store's default location.
   */
  preselectedLocationId?: string;
  onConfirm: (locationId: string) => void;
  cashierName?: string | null;
}

export function POSLocationPicker({
  locations,
  recentLocationIds,
  preselectedLocationId,
  onConfirm,
  cashierName,
}: POSLocationPickerProps) {
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  // History filtered down to counters that still exist and are still this
  // cashier's to stand at. A branch closed since the last shift must not be
  // offered back as the convenient answer.
  const recents = React.useMemo(() => {
    const ids = recentLocationIds ?? [];
    return ids
      .map((id) => locations.find((location) => location.id === id))
      .filter((location): location is POSLocationOption => Boolean(location));
  }, [locations, recentLocationIds]);

  const fallbackId =
    recents[0]?.id ??
    locations.find((location) => location.id === preselectedLocationId)?.id ??
    locations.find((location) => location.isDefault)?.id ??
    locations[0]?.id ??
    "";

  const [selectedId, setSelectedId] = React.useState(fallbackId);

  const isSearching = query.trim().length > 0;
  // The box appears past the threshold OR the moment there is something in it,
  // so type-ahead works at four counters without a field cluttering the screen
  // for a list that never needed one.
  const showSearch = locations.length > SEARCH_THRESHOLD || isSearching;
  const columns = locations.length > SEARCH_THRESHOLD ? 3 : 2;

  const filtered = React.useMemo(
    () => matchPOSLocations(locations, query),
    [locations, query],
  );

  // Two sections, unless a search is running — then they collapse into one flat
  // result list, because "recent" and "everything else" stop meaning anything
  // once the list is an answer to a query, and keeping them would split a single
  // match across two headings.
  const useSections =
    !isSearching &&
    recents.length > 0 &&
    locations.length > RECENTS_THRESHOLD;

  const others = React.useMemo(
    () =>
      useSections
        ? locations.filter(
            (location) => !recents.some((recent) => recent.id === location.id),
          )
        : [],
    [locations, recents, useSections],
  );

  /**
   * The order the number keys address, which has to be the order on screen —
   * a cashier pressing 3 counts the third card they can see, not the third row
   * of some other list.
   */
  const keyOrder = React.useMemo(
    () => (useSections ? [...recents, ...others] : filtered),
    [filtered, others, recents, useSections],
  );

  // A search that hides the selected counter must move the selection with it.
  // Otherwise typing "Uttara" narrows the list to one card while the button
  // still reads "Start selling at Main Branch" — and Enter, the fastest way to
  // confirm, opens the register at the counter the cashier was searching AWAY
  // from. A click inside the filtered list keeps its own selection, because
  // that card is still on screen.
  useApplyOnChange([filtered, selectedId], () => {
    if (filtered.length === 0) return;
    if (filtered.some((location) => location.id === selectedId)) return;
    setSelectedId(filtered[0].id);
  });

  const selected = locations.find((location) => location.id === selectedId);

  /**
   * Keyboard. Focus is the arbiter between "digits pick a counter" and "digits
   * are part of a branch name" — without that rule, a merchant with a counter
   * called "Till 2" could never type it.
   *
   * Not focused: digits pick, any other printable character starts a search and
   * carries itself into the field. Focused: everything is typing, and Escape
   * clears and hands the digits back.
   */
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const typingHere = document.activeElement === searchRef.current;

      if (event.key === "Enter") {
        if (!selectedId) return;
        event.preventDefault();
        onConfirm(selectedId);
        return;
      }

      if (event.key === "Escape" && typingHere) {
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
        index < Math.min(keyOrder.length, MAX_NUMBER_SHORTCUTS)
      ) {
        event.preventDefault();
        setSelectedId(keyOrder[index].id);
        return;
      }

      // Type-ahead. The field is never focused FOR the cashier — on a tablet
      // that throws up the on-screen keyboard and covers the very cards they
      // came to tap — so it takes focus only once they have actually typed, and
      // the character that started it is carried in rather than swallowed.
      if (event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault();
        setQuery((current) => current + event.key);
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyOrder, onConfirm, selectedId]);

  const renderCard = (
    location: POSLocationOption,
    shortcut: number | null,
    dense: boolean,
  ) => {
    const isSelected = location.id === selectedId;
    const accent = posLocationAccent(location.id);
    return (
      <button
        key={location.id}
        type="button"
        onClick={() => setSelectedId(location.id)}
        onDoubleClick={() => onConfirm(location.id)}
        className={cn(
          // 88px is a deliberate floor: this is tapped in a hurry, at the start
          // of a shift, sometimes with gloves on.
          "flex min-h-[5.5rem] cursor-pointer items-center rounded-2xl border bg-card text-left transition-all",
          dense ? "gap-3 p-3.5" : "gap-3.5 p-4",
          isSelected
            ? "border-transparent shadow-sm"
            : "border-border hover:border-border/80 hover:shadow-sm",
        )}
        style={
          isSelected
            ? { borderColor: accent, boxShadow: `0 0 0 3px ${accent}1f` }
            : undefined
        }
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl",
            dense ? "h-9 w-9" : "h-11 w-11",
          )}
          style={{ backgroundColor: `${accent}1a` }}
        >
          <span
            className={cn("rounded-full", dense ? "h-2.5 w-2.5" : "h-3 w-3")}
            style={{ backgroundColor: accent }}
          />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "truncate font-semibold tracking-[-0.01em]",
              dense ? "text-sm" : "text-base",
            )}
          >
            {location.name}
          </span>
          {location.area || location.isDefault ? (
            <span
              className={cn(
                "truncate text-muted-foreground",
                dense ? "text-xs" : "text-[13px]",
              )}
            >
              {[location.area, location.isDefault ? "Default location" : ""]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </span>

        {isSelected ? (
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: accent }}
          >
            <Check className="h-3.5 w-3.5" />
          </span>
        ) : shortcut !== null ? (
          <kbd className="shrink-0 rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground">
            {shortcut}
          </kbd>
        ) : null}
      </button>
    );
  };

  const shortcutFor = (location: POSLocationOption): number | null => {
    const index = keyOrder.findIndex((entry) => entry.id === location.id);
    return index >= 0 && index < MAX_NUMBER_SHORTCUTS ? index + 1 : null;
  };

  return (
    // Opaque, and no backdrop blur. A half-covered terminal behind the question
    // reads as a page still loading, and a blurred one draws the eye to the
    // catalogue instead of the one thing that has to be answered before any of
    // it means anything.
    <div className="absolute inset-0 z-40 flex items-center justify-center overflow-y-auto bg-muted p-6 sm:p-12">
      <div className="flex w-full max-w-[980px] flex-col gap-6">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Store className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">
            Which counter are you at?
          </h1>
          <p className="max-w-lg text-sm text-muted-foreground sm:text-[15px]">
            Stock, held sales and every receipt printed on this register follow
            this choice.
          </p>
        </div>

        {showSearch ? (
          <div className="relative mx-auto w-full max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find your counter..."
              className="h-11 rounded-xl pl-11"
            />
          </div>
        ) : null}

        {/* Bounded by height, not by counter count. The old ceiling only applied
            once a search box appeared, so six counters split across two sections
            could push the confirm button off a 768px screen with nothing to
            scroll. */}
        <ScrollArea className="max-h-[52vh]" viewportClassName="max-h-[52vh]">
          <div className="flex flex-col gap-6 pr-1">
            {useSections ? (
              <>
                <section className="flex flex-col gap-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Recent on this device
                  </span>
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {recents.map((location) =>
                      renderCard(location, shortcutFor(location), false),
                    )}
                  </div>
                </section>

                <section className="flex flex-col gap-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Other counters
                  </span>
                  <div
                    className={cn(
                      "grid gap-3",
                      columns === 3
                        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                        : "grid-cols-1 sm:grid-cols-2",
                    )}
                  >
                    {others.map((location) =>
                      renderCard(location, shortcutFor(location), true),
                    )}
                  </div>
                </section>
              </>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No counter matches that.
              </p>
            ) : (
              <div
                className={cn(
                  "grid gap-3.5",
                  columns === 3
                    ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                    : "grid-cols-1 sm:grid-cols-2",
                )}
              >
                {filtered.map((location) =>
                  renderCard(location, shortcutFor(location), false),
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex flex-col gap-3.5">
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && onConfirm(selected.id)}
            className={cn(
              "flex h-14 cursor-pointer items-center justify-center gap-2.5 rounded-2xl text-base font-semibold transition-all",
              selected
                ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.995]"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {selected ? `Start selling at ${selected.name}` : "Pick a counter"}
            <ArrowRight className="h-4 w-4" />
          </button>

          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <span className="text-[13px] text-muted-foreground">
              {cashierName ? `Signed in as ${cashierName}` : "Signed in"}
            </span>
            {/* Honest about its own reach. Claiming "1–9" covers the list is
                true at nine counters and a lie at thirty. */}
            <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
              {keyOrder.length > MAX_NUMBER_SHORTCUTS ? (
                <>
                  <Kbd>1</Kbd>&ndash;<Kbd>9</Kbd> for the first nine, type to
                  find the rest,
                </>
              ) : keyOrder.length > 1 ? (
                <>
                  Press <Kbd>1</Kbd>&ndash;<Kbd>{keyOrder.length}</Kbd> to pick,
                </>
              ) : null}
              <Kbd>Enter</Kbd> to start
            </span>
          </div>

          {/*
            A merchant can keep locations for pickup and online dispatch without
            running their counter against any one of them. Leaving no way back
            to aggregate stock would silently change how those registers sell.
          */}
          <button
            type="button"
            onClick={() => onConfirm("")}
            className="mx-auto cursor-pointer text-[13px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Sell from shared stock instead
          </button>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}
