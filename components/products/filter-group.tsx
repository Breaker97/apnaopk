"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { useHydrated } from "@/hooks/use-client-value";

/**
 * Collapsed groups, remembered across visits.
 *
 * Only the *collapsed* ids are stored, so a group added later opens by default
 * instead of inheriting an absent preference — a shopper who has never seen the
 * group has not asked for it to be shut.
 */
const STORAGE_KEY = "storify:product-filters:collapsed";

/**
 * Read once per page load and shared by every group.
 *
 * The desktop sidebar and the mobile sheet both render the same panel, and the
 * sidebar itself is remounted when its Suspense boundary resolves — going
 * through one cache keeps those instances agreeing without a context provider
 * or a `localStorage` hit per group.
 */
let collapsedCache: Set<string> | null = null;

function readCollapsed(): Set<string> {
  if (collapsedCache) return collapsedCache;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    collapsedCache = new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    // Storage blocked (private mode) or corrupt JSON: fall back to defaults.
    // The panel still collapses, it just will not be remembered.
    collapsedCache = new Set();
  }

  return collapsedCache;
}

function writeCollapsed(id: string, collapsed: boolean) {
  const set = readCollapsed();
  if (collapsed) set.add(id);
  else set.delete(id);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // See above — the in-memory set still drives the rest of this page load.
  }
}

interface FilterGroupProps {
  /** Stable key for the remembered open/closed state. */
  id: string;
  title: string;
  /**
   * How many filters in this group are active, shown as a badge on the header.
   * The badge is what makes collapsing safe: a shut group still says it is
   * narrowing the grid. Omit or pass 0 for groups with nothing to count.
   */
  activeCount?: number;
  /** Open on a first visit, before any stored preference exists. */
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * One collapsible section of the product filter sidebar.
 *
 * Height animates through `grid-template-rows: 0fr → 1fr` rather than a
 * measured pixel height: no `ResizeObserver`, no layout read on every frame,
 * and a group whose contents change size (the city list, the radius counter)
 * stays correct without re-measuring.
 *
 * The content stays mounted while collapsed — the location group holds fetched
 * cities and the price group holds an un-committed slider drag, and unmounting
 * would throw both away on a toggle. `inert` is what makes that safe: hidden
 * content leaves the tab order and the accessibility tree, so nothing focusable
 * hides behind a zero-height row.
 */
export function FilterGroup({
  id,
  title,
  activeCount = 0,
  defaultOpen = true,
  children,
  className,
}: FilterGroupProps) {
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen);
  // Transitions stay off until the stored state has been applied, so a group
  // remembered as collapsed does not animate itself shut on every page load.
  const [animated, setAnimated] = useState(false);

  // The remembered state is only readable in the browser; applying it during
  // hydration would disagree with the server's markup.
  const hydrated = useHydrated();
  useApplyOnChange([id, hydrated], () => {
    if (hydrated) setOpen(!readCollapsed().has(id));
  });

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, [id]);

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    writeCollapsed(id, !next);
  }, [id, open]);

  return (
    <div className={cn("py-4 first:pt-0 last:pb-0", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="group/filter flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-bold tracking-wide">
            {title}
          </span>
          {activeCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover/filter:text-foreground",
            !open && "-rotate-90",
          )}
        />
      </button>

      <div
        className={cn(
          "grid",
          animated && "transition-[grid-template-rows] duration-300 ease-out",
        )}
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div
          id={contentId}
          inert={!open}
          className={cn(
            "overflow-hidden transition-opacity duration-200",
            open ? "opacity-100" : "opacity-0",
          )}
        >
          {/* The padding lives on an inner element so the animated row can
              reach a true zero height — padding on the clipped element itself
              would leave a permanent sliver of open group behind. */}
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}
