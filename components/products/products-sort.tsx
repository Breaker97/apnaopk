"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  hasLocationCoordinates,
  normalizeDistanceSortForLocation,
} from "@/lib/locations/shopper-location";
import { cn } from "@/lib/utils";

interface ProductsSortLabels {
  label: string;
  mostPopular: string;
  bestRating: string;
  newest: string;
  priceLowHigh: string;
  priceHighLow: string;
  /**
   * Distance ordering. Optional, and the switch for the option itself: a caller
   * that has no location filter has nothing to measure from, so supplying no
   * label is how it says "this store does not sort by distance". Even with a
   * label the option only appears once the URL carries a point.
   */
  nearest?: string;
}

const SORT_VALUES = [
  "popular",
  "rating",
  "createdAt",
  "price-asc",
  "price-desc",
] as const;

/**
 * Lines-then-arrow sort mark. Drawn here rather than taken from lucide, whose
 * `ArrowDownWideNarrow` puts the arrow on the leading side — the mirror of this
 * layout. Same 24px grid and stroke weight as the icon set around it.
 */
function SortMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 6h9" />
      <path d="M3 12h6" />
      <path d="M3 18h3" />
      <path d="M18 4v16" />
      <path d="m14 16 4 4 4-4" />
    </svg>
  );
}

/**
 * Sort control for the products toolbar.
 *
 * Sorting used to sit in the filter sidebar as a radio list. It is not a filter,
 * and buyers look for it beside the heading rather than at the bottom of a long
 * facet column — so it lives here, and the sidebar renders with
 * `showSort={false}`.
 *
 * Writes only `sortBy`, preserving every other search param, so changing the
 * sort never silently clears an active category or price filter.
 */
export function ProductsSort({
  currentSort = "popular",
  labels,
  triggerClassName,
}: {
  currentSort?: string;
  labels: ProductsSortLabels;
  /** Themed trigger overrides — the Electronics toolbar squares the pill off. */
  triggerClassName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Same rule the sidebar and the storefront query apply: distance ordering is
  // bound to coordinates in the URL, never to a saved cookie location, so a
  // stale shared link falls back instead of pointing at a hidden option.
  const canSortByDistance =
    Boolean(labels.nearest) &&
    hasLocationCoordinates(searchParams.get("lat"), searchParams.get("lng"));
  const visibleSort = normalizeDistanceSortForLocation(
    currentSort,
    searchParams.get("lat"),
    searchParams.get("lng"),
  );
  const allowed: readonly string[] = canSortByDistance
    ? [...SORT_VALUES, "distance"]
    : SORT_VALUES;
  const value =
    visibleSort && allowed.includes(visibleSort) ? visibleSort : "popular";

  const handleChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "popular") {
      params.delete("sortBy");
    } else {
      params.set("sortBy", next);
    }
    params.delete("page");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  // At rest the pill reads "Sort by" — the control names itself, as a button
  // does. Once a shopper picks something other than the default it shows their
  // choice instead, so an active sort is never hidden behind a generic label.
  const optionLabels: Record<string, string> = {
    rating: labels.bestRating,
    createdAt: labels.newest,
    "price-asc": labels.priceLowHigh,
    "price-desc": labels.priceHighLow,
    ...(labels.nearest ? { distance: labels.nearest } : {}),
  };
  const triggerLabel = optionLabels[value] ?? labels.label;

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        aria-label={labels.label}
        // Height carries the same `data-[size=default]` variant the base trigger
        // uses, so tailwind-merge drops its h-9 instead of leaving two rules
        // whose winner is decided by stylesheet order.
        className={cn(
          "gap-2 rounded-full px-5 font-medium shadow-none data-[size=default]:h-10",
          triggerClassName,
        )}
        icon={<SortMark className="size-4 shrink-0 opacity-70" />}
      >
        {/* Own text rather than <SelectValue>, which can only print the chosen
            option and has no way to say "nothing chosen yet" for a control
            whose default is a real sort. */}
        <span className="truncate">{triggerLabel}</span>
      </SelectTrigger>
      {/* Popper, not the library default: item-aligned positioning measures
          against the node <SelectValue> registers, and with no <SelectValue> in
          the trigger it bails out and drops the menu, unpositioned, at the foot
          of the page. Dropping below the pill is also the right shape for a
          control that reads as a button. */}
      <SelectContent position="popper" align="end" sideOffset={6}>
        <SelectItem value="popular">{labels.mostPopular}</SelectItem>
        {canSortByDistance ? (
          <SelectItem value="distance">{labels.nearest}</SelectItem>
        ) : null}
        <SelectItem value="rating">{labels.bestRating}</SelectItem>
        <SelectItem value="createdAt">{labels.newest}</SelectItem>
        <SelectItem value="price-asc">{labels.priceLowHigh}</SelectItem>
        <SelectItem value="price-desc">{labels.priceHighLow}</SelectItem>
      </SelectContent>
    </Select>
  );
}
