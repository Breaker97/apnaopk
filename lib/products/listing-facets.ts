import type { StorefrontProductPriceRange } from "@/lib/products/storefront-product-filters";

/**
 * The listing's filters as data, for the horizontal layouts (a bar of facet
 * buttons, or one Filter button over a panel). The sidebar components each
 * hard-wire their groups; these layouts draw whatever facets the listing
 * hands them, so the Classic and Electronics listings describe their own
 * facet sets here and share one renderer. State stays in the URL, under the
 * same params the sidebars and the grid already read.
 */

export interface ListingFacetOption {
  value: string;
  label: string;
}

export type ListingFacet =
  | {
      kind: "options";
      id: string;
      title: string;
      /** URL param holding the comma-separated selection. */
      param: string;
      options: ListingFacetOption[];
      selected: string[];
      /** Where the full list lives when `options` was capped. */
      viewAllHref?: string;
    }
  | {
      kind: "price";
      id: "price";
      title: string;
      bounds: StorefrontProductPriceRange;
      currentMin?: string;
      currentMax?: string;
    }
  | {
      kind: "location";
      id: "location";
      title: string;
      resultCount?: number;
      narrowsResults: boolean;
    }
  | {
      kind: "pickup";
      id: "pickup";
      title: string;
      pickupNearby: boolean;
    };

/** Options a popover lists before it points at the index page instead. */
export const LISTING_FACET_OPTION_LIMIT = 12;

export function splitSelection(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

export function optionsFacet(input: {
  id: string;
  title: string;
  param: string;
  items: { name: string; slug: string }[];
  current: string | undefined;
  viewAllHref?: string;
}): ListingFacet | null {
  if (input.items.length === 0) return null;
  return {
    kind: "options",
    id: input.id,
    title: input.title,
    param: input.param,
    options: input.items
      .slice(0, LISTING_FACET_OPTION_LIMIT)
      .map((item) => ({ value: item.slug, label: item.name })),
    selected: splitSelection(input.current),
    viewAllHref:
      input.items.length > LISTING_FACET_OPTION_LIMIT ? input.viewAllHref : undefined,
  };
}

/** A price facet only where products differ in price — else it is a dead control. */
export function priceFacet(input: {
  title: string;
  priceRange: StorefrontProductPriceRange | null | undefined;
  currentMin?: string;
  currentMax?: string;
}): ListingFacet | null {
  const range = input.priceRange;
  if (!range || !(range.max > range.min)) return null;
  return {
    kind: "price",
    id: "price",
    title: input.title,
    bounds: { min: range.min, max: range.max, step: range.step > 0 ? range.step : 1 },
    currentMin: input.currentMin,
    currentMax: input.currentMax,
  };
}

function isPriceFacetActive(
  facet: Extract<ListingFacet, { kind: "price" }>,
): boolean {
  const min = Number(facet.currentMin);
  const max = Number(facet.currentMax);
  return (
    (facet.currentMin !== undefined && Number.isFinite(min) && min > facet.bounds.min) ||
    (facet.currentMax !== undefined && Number.isFinite(max) && max < facet.bounds.max)
  );
}

/**
 * Filters a facet has narrowing the grid. Location counts nothing: it also
 * lives in a cookie and storage, so "clear all" cannot undo it (the sidebars
 * make the same call) and a count it cannot clear would be a lie.
 */
export function facetActiveCount(facet: ListingFacet): number {
  switch (facet.kind) {
    case "options":
      return facet.selected.length;
    case "price":
      return isPriceFacetActive(facet) ? 1 : 0;
    case "pickup":
      return facet.pickupNearby ? 1 : 0;
    case "location":
      return 0;
  }
}

/** The URL updates "clear all" applies: every clearable facet's params, emptied. */
export function clearAllFacetUpdates(
  facets: ListingFacet[],
): Record<string, undefined> {
  const updates: Record<string, undefined> = {};
  for (const facet of facets) {
    if (facet.kind === "options") updates[facet.param] = undefined;
    if (facet.kind === "price") {
      updates.minPrice = undefined;
      updates.maxPrice = undefined;
    }
    if (facet.kind === "pickup") updates.pickup = undefined;
  }
  return updates;
}

/** Toggles one value in a comma list; undefined once the list is empty. */
export function toggleSelection(selected: string[], value: string): string | undefined {
  const next = selected.includes(value)
    ? selected.filter((entry) => entry !== value)
    : [...selected, value];
  return next.length > 0 ? next.join(",") : undefined;
}
