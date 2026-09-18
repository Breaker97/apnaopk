"use client";

import {
  createContext,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * How a product listing is being viewed: cards in a grid, or one product
 * per row with its picture beside the details.
 *
 * Read by the card itself (`ModernProductCard`), so the grid's server
 * markup never changes: the toolbar flips this context and the cards
 * rearrange. Anything outside a listing reads the default and is a grid.
 */
export type ListingViewMode = "grid" | "list";

const ListingViewContext = createContext<ListingViewMode>("grid");

export function useListingView(): ListingViewMode {
  return useContext(ListingViewContext);
}

/** Desktop column choices, in the toolbar's icon order. */
const DENSITIES = [2, 3, 4] as const;
type Density = (typeof DENSITIES)[number];
type ViewChoice = Density | "list";

/**
 * The grid class a listing's grid must carry to follow the toolbar: its lg
 * column count reads the `--listing-cols` this shell sets (1 in list view).
 */
export const LISTING_GRID_COLUMNS_CLASS =
  "lg:grid-cols-[repeat(var(--listing-cols,4),minmax(0,1fr))]";

/**
 * Cards in ONE row at the widest view — the builder's framed render of a
 * listing.
 *
 * The frame is there to show the page's chrome and its card design, not the
 * depth of the catalogue: a full page of products made every listing preview
 * a tall scroll of the same card, and an infinite grid inside a short frame
 * kept fetching the next page nobody could see. The widest density is also
 * `--listing-cols`'s default, so the previewed row is exactly full.
 */
export const LISTING_PREVIEW_ROW = 4;

/**
 * A listing's toolbar and the grid under it: view choices on the left (two,
 * three or four across, or a list), the sort control on the right, a rule
 * beneath — then an optional row of horizontal filters, then the products.
 *
 * View is a preference, not a filter, so it stays client-side and out of
 * the URL, reaching the server-rendered grid through \`--listing-cols\` and
 * the cards through context.
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
  children,
}: {
  /** The sort control, passed in so the server page owns its labels. */
  sort: ReactNode;
  /** Controls before the sort (a Filter button). */
  actions?: ReactNode;
  /** A horizontal filter row, between the toolbar and the grid. */
  filters?: ReactNode;
  /** Translated accessible prefix for the view buttons ("View: 3"). */
  viewLabel: string;
  /** Translated name of the list view. */
  listLabel: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<ViewChoice>(4);
  const mode: ListingViewMode = view === "list" ? "list" : "grid";

  return (
    <ListingViewContext.Provider value={mode}>
      <div>
        <div
          className={cn(
            "hidden items-center justify-between gap-4 border-b border-border/70 pb-4 lg:flex",
            filters ? "mb-4" : "mb-6",
          )}
        >
          <div className="flex items-center gap-[18px]">
            {DENSITIES.map((cols) => (
              <button
                key={cols}
                type="button"
                aria-label={`${viewLabel}: ${cols}`}
                aria-pressed={view === cols}
                onClick={() => setView(cols)}
                className="cursor-pointer p-0.5"
              >
                <DensityDots cols={cols} active={view === cols} />
              </button>
            ))}
            <button
              type="button"
              aria-label={listLabel}
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              className="cursor-pointer p-0.5"
            >
              <ListMark active={view === "list"} />
            </button>
          </div>
          <div className="ms-auto flex items-center gap-3">
            {actions}
            {sort}
          </div>
        </div>

        {filters}

        <div
          style={{ "--listing-cols": view === "list" ? 1 : view } as CSSProperties}
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
 * two-column mark, drawn 2×2.
 */
function DensityDots({ cols, active }: { cols: Density; active: boolean }) {
  const rows = cols === 2 ? 2 : 3;
  const dot = cols === 2 ? "size-[6px]" : cols === 3 ? "size-[4.5px]" : "size-[4px]";
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
            "rounded-[1.5px] transition-colors",
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
