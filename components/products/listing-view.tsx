"use client";

import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useClientValue } from "@/hooks/use-client-value";
import {
  DEFAULT_LISTING_VIEW,
  LISTING_DENSITIES,
  LISTING_IMAGE_SIZES,
  readListingViewCookie,
  saveListingView,
  type ListingDensity,
  type ListingViewChoice,
} from "@/lib/storefront/listing-view";
import { cn } from "@/lib/utils";

/**
 * How a product listing is being viewed: cards in a grid, or one product
 * per row with its picture beside the details.
 *
 * Read by the card itself (`ModernProductCard`), so the grid's server
 * markup never changes: the toolbar flips this context and the cards
 * rearrange. Anything outside a listing reads the default and is a grid.
 */
type ListingViewMode = "grid" | "list";

/** The shopper's pick; null outside a listing shell. */
const ListingViewContext = createContext<ListingViewChoice | null>(null);

export function useListingView(): ListingViewMode {
  return useContext(ListingViewContext) === "list" ? "list" : "grid";
}

/**
 * The card picture's `sizes` hint for the view in effect, or null outside a
 * listing, where the card keeps its own default. The picture's width follows
 * the grid, so the file the browser fetches must follow it too.
 */
export function useListingImageSizes(): string | null {
  const view = useContext(ListingViewContext);
  return view === null ? null : LISTING_IMAGE_SIZES[view];
}

function readStoredView(): ListingViewChoice | null {
  return readListingViewCookie(document.cookie);
}

/**
 * A listing's toolbar and the grid under it: view choices on the left (two,
 * four or six across, or a list), the sort control on the right, a rule
 * beneath — then an optional row of horizontal filters, then the products.
 *
 * View is a preference, not a filter, so it stays out of the URL: it reaches
 * the server-rendered grid through `--listing-cols` and the cards through
 * context, and is remembered in a cookie. The server reads the cookie into
 * `initialView`, so a reload or the next page draws the right columns from the
 * first byte; the browser's own copy is read after hydration too, because Back
 * can restore the page from the router cache with a payload made before the
 * pick was changed.
 *
 * Desktop only: below lg the responsive column count already decides
 * density, and the phone's sort rides the listing's mobile filter toolbar.
 */
export function ListingShell({
  sort,
  actions,
  filters,
  viewLabel,
  listLabel,
  initialView = DEFAULT_LISTING_VIEW,
  remember = true,
  children,
}: {
  /** The sort control, passed in so the server page owns its labels. */
  sort: ReactNode;
  /** Controls before the sort (a Filter button). */
  actions?: ReactNode;
  /** A horizontal filter row, between the toolbar and the grid. */
  filters?: ReactNode;
  /** Translated accessible prefix for the view buttons ("View: 4"). */
  viewLabel: string;
  /** Translated name of the list view. */
  listLabel: string;
  /** The view the server drew: the shopper's saved pick, else the default. */
  initialView?: ListingViewChoice;
  /**
   * Off for a frame that is not the shopper's page (the builder's preview):
   * it neither reads nor writes the saved pick, and stays on `initialView`.
   */
  remember?: boolean;
  children: ReactNode;
}) {
  const stored = useClientValue(readStoredView, null);
  const [chosen, setChosen] = useState<ListingViewChoice | null>(null);
  const view = chosen ?? (remember ? stored : null) ?? initialView;
  const list = view === "list";

  const choose = (next: ListingViewChoice) => {
    setChosen(next);
    if (remember) saveListingView(next);
  };

  return (
    <ListingViewContext.Provider value={view}>
      <div>
        <div
          className={cn(
            "hidden items-center justify-between gap-4 border-b border-border/70 pb-4 lg:flex",
            filters ? "mb-4" : "mb-6",
          )}
        >
          <div className="flex items-center gap-[18px]">
            {LISTING_DENSITIES.map((cols) => (
              <button
                key={cols}
                type="button"
                aria-label={`${viewLabel}: ${cols}`}
                aria-pressed={view === cols}
                onClick={() => choose(cols)}
                className="cursor-pointer p-0.5"
              >
                <DensityDots cols={cols} active={view === cols} />
              </button>
            ))}
            <button
              type="button"
              aria-label={listLabel}
              aria-pressed={list}
              onClick={() => choose("list")}
              className="cursor-pointer p-0.5"
            >
              <ListMark active={list} />
            </button>
          </div>
          <div className="ms-auto flex items-center gap-3">
            {actions}
            {sort}
          </div>
        </div>

        {filters}

        {/* The grid keys its classes on `data-view` (`group-data-[view=list]/
            listing:`), and its skeleton keeps to a grid's columns while the
            list is chosen, so a loading list never flashes one giant column. */}
        <div
          data-view={list ? "list" : "grid"}
          className="group/listing"
          style={
            {
              "--listing-cols": list ? 1 : view,
              "--listing-skeleton-cols": list ? DEFAULT_LISTING_VIEW : view,
            } as CSSProperties
          }
        >
          {children}
        </div>
      </div>
    </ListingViewContext.Provider>
  );
}

/**
 * The density glyphs are literal dot matrices, drawn as dots rather than
 * approximated with a lucide grid outline. Three rows deep, except the
 * two-column mark, drawn 2×2; the dots shrink as the columns multiply, the
 * way the tiles do.
 */
function DensityDots({ cols, active }: { cols: ListingDensity; active: boolean }) {
  const rows = cols === 2 ? 2 : 3;
  const dot =
    cols === 2
      ? "size-[6px] rounded-[1.5px]"
      : cols === 4
        ? "size-[4px] rounded-[1.5px]"
        : "size-[3px] rounded-[1px]";
  return (
    <span
      className="grid gap-[2px]"
      style={{ gridTemplateColumns: `repeat(${cols}, max-content)` }}
      aria-hidden
    >
      {Array.from({ length: cols * rows }).map((_, index) => (
        <span
          key={index}
          className={cn(
            "transition-colors",
            dot,
            active ? "bg-foreground" : "bg-muted-foreground/35",
          )}
        />
      ))}
    </span>
  );
}

/** The list mark: three rows of a dot and a line, in the density marks' ink. */
function ListMark({ active }: { active: boolean }) {
  return (
    <span className="grid gap-[3px]" aria-hidden>
      {[0, 1, 2].map((row) => (
        <span key={row} className="flex items-center gap-[3px]">
          <span
            className={cn(
              "size-[4px] rounded-[1px] transition-colors",
              active ? "bg-foreground" : "bg-muted-foreground/35",
            )}
          />
          <span
            className={cn(
              "h-[2px] w-[14px] rounded-full transition-colors",
              active ? "bg-foreground" : "bg-muted-foreground/35",
            )}
          />
        </span>
      ))}
    </span>
  );
}
