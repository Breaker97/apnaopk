// Desktop column classes for the product-browser grids ("Product Grid"
// section). Static strings so Tailwind's scanner picks them up; phones and
// tablets keep their fixed 2/3-column tiers and only the lg tier is
// admin-configurable, matching the carousel sections.
export const PRODUCT_GRID_DESKTOP_COLUMN_CLASSES: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

/*
 * The space BETWEEN product cards. Every class reads the store's card-grid
 * spacing (Product card → Style → Grid spacing): the store surface sets
 * --card-grid-gap-x / --card-grid-gap-y only when the merchant customized
 * it, and until then each class falls back to the gap its grid shipped with
 * at that breakpoint — an untouched store renders exactly as before.
 * Static strings, like the column maps, so Tailwind's scanner sees them.
 */

/** A plain card grid: 20px both ways. */
export const CARD_GRID_GAP =
  "gap-x-[var(--card-grid-gap-x,1.25rem)] gap-y-[var(--card-grid-gap-y,1.25rem)]";

/** A plain card grid at 16px (the tighter grids inside editorial sections). */
export const CARD_GRID_GAP_TIGHT =
  "gap-x-[var(--card-grid-gap-x,1rem)] gap-y-[var(--card-grid-gap-y,1rem)]";

/** The product browser's rhythm: 12px/28px on phones, 20px/44px from sm. */
export const CARD_BROWSER_GRID_GAP =
  "gap-x-[var(--card-grid-gap-x,0.75rem)] gap-y-[var(--card-grid-gap-y,1.75rem)] sm:gap-x-[var(--card-grid-gap-x,1.25rem)] sm:gap-y-[var(--card-grid-gap-y,2.75rem)]";

/** A one-row shelf: 12px on phones, 20px from sm. Rows never wrap, so no row gap. */
export const CARD_SHELF_GAP =
  "gap-x-[var(--card-grid-gap-x,0.75rem)] sm:gap-x-[var(--card-grid-gap-x,1.25rem)]";

/**
 * Desktop shelf widths per visible-card count: N cards and the N-1 gaps
 * between them fill the row exactly, whatever the gap is set to.
 */
export const PRODUCT_SHELF_DESKTOP_COLUMN_CLASSES: Record<number, string> = {
  2: "lg:auto-cols-[calc((100%_-_var(--card-grid-gap-x,1.25rem))_/_2)]",
  3: "lg:auto-cols-[calc((100%_-_var(--card-grid-gap-x,1.25rem)_*_2)_/_3)]",
  4: "lg:auto-cols-[calc((100%_-_var(--card-grid-gap-x,1.25rem)_*_3)_/_4)]",
  5: "lg:auto-cols-[calc((100%_-_var(--card-grid-gap-x,1.25rem)_*_4)_/_5)]",
  6: "lg:auto-cols-[calc((100%_-_var(--card-grid-gap-x,1.25rem)_*_5)_/_6)]",
};

export function clampDesktopColumns(value: number | undefined): number {
  const normalized = Number.isFinite(value) ? Math.floor(value as number) : 4;
  return Math.min(6, Math.max(2, normalized));
}
