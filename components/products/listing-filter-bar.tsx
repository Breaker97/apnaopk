"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, ChevronDown, Plus, SlidersHorizontal, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { ProductFiltersLocation } from "@/components/products/product-filters-location";
import { ProductFiltersPickupFacet } from "@/components/products/product-filters-pickup-facet";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import {
  PICKUP_NEARBY_PARAM,
  hasLocationCoordinates,
} from "@/lib/locations/shopper-location";
import {
  clearAllFacetUpdates,
  facetActiveCount,
  toggleSelection,
  type ListingFacet,
} from "@/lib/products/listing-facets";
import { cn } from "@/lib/utils";

type FilterUpdates = Record<string, string | undefined>;

/** Writes filter changes into the URL, dropping the page like every rail does. */
function useFilterUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return useCallback(
    (updates: FilterUpdates) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete("page");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
}

/**
 * The pickup facet is only a question once there is a point to measure
 * from — the sidebars hide it without one, and so do these layouts.
 */
function useVisibleFacets(facets: ListingFacet[]): ListingFacet[] {
  const searchParams = useSearchParams();
  const hasCoordinates = hasLocationCoordinates(
    searchParams.get("lat"),
    searchParams.get("lng"),
  );
  return facets.filter((facet) => facet.kind !== "pickup" || hasCoordinates);
}

/**
 * The listing's filters laid out across the page instead of down a sidebar
 * — desktop only; phones keep the listing's filter sheet.
 *
 * - `filterBar`: one bordered box per facet along a row, each opening its
 *   own options beneath it;
 * - `filterDropdown`: the same row as plain labels with a chevron, each
 *   opening a dropdown card — lighter, for a page that wants no boxes;
 * - `filterButton`: a single Filter button whose panel holds every facet
 *   side by side — the compact form for a toolbar that also carries
 *   category chips.
 */
export function ListingFilterBar({
  facets,
  layout,
  className,
}: {
  facets: ListingFacet[];
  layout: "filterBar" | "filterDropdown" | "filterButton";
  className?: string;
}) {
  const t = useTranslations();
  const update = useFilterUpdater();
  const visible = useVisibleFacets(facets);
  const activeCount = visible.reduce((sum, facet) => sum + facetActiveCount(facet), 0);
  const clearAll = () => update(clearAllFacetUpdates(visible));
  const clearLabel = t("common.clearAll");

  if (visible.length === 0) return null;

  if (layout === "filterButton") {
    return (
      <Popover>
        <PopoverTrigger
          className={cn(
            "inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-button bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 data-[state=open]:[&_[data-chevron]]:rotate-180",
            className,
          )}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {t("common.filters")}
          {activeCount > 0 ? (
            <span className="grid min-w-5 place-items-center rounded-full bg-background px-1.5 text-[11px] font-semibold leading-5 text-foreground">
              {activeCount}
            </span>
          ) : null}
          <ChevronDown
            data-chevron=""
            className="h-4 w-4 transition-transform"
            aria-hidden="true"
          />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={10}
          className="p-0"
          // Sized to the facets it holds: four columns at most, so two
          // filters open a panel two columns wide rather than half empty.
          style={{ width: `min(${Math.min(visible.length, 4) * 15 + 3}rem, calc(100vw - 2rem))` }}
        >
          <div
            className="grid max-h-[min(34rem,70vh)] grid-cols-[repeat(var(--facet-cols),minmax(0,1fr))] gap-x-8 gap-y-6 overflow-y-auto p-6"
            style={{ "--facet-cols": Math.min(visible.length, 4) } as CSSProperties}
          >
            {visible.map((facet) => (
              <section key={facet.id} className="min-w-0">
                <h3 className="mb-3 text-sm font-semibold">{facet.title}</h3>
                <FacetBody facet={facet} update={update} />
              </section>
            ))}
          </div>
          {activeCount > 0 ? (
            <div className="flex items-center justify-between gap-3 border-t px-6 py-3">
              <span className="text-xs text-muted-foreground">
                {t("productsPage.filters.activeCount", { count: activeCount })}
              </span>
              <ClearButton label={clearLabel} onClick={clearAll} />
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    );
  }

  if (layout === "filterDropdown") {
    return (
      <div
        className={cn(
          "hidden flex-wrap items-center gap-x-9 gap-y-1 lg:flex",
          className,
        )}
      >
        {visible.map((facet) => (
          <FacetDropdown key={facet.id} facet={facet} update={update} />
        ))}
        {activeCount > 0 ? (
          <ClearButton label={clearLabel} onClick={clearAll} />
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("hidden flex-wrap items-center gap-3 lg:flex", className)}>
      {visible.map((facet) => (
        <FacetButton
          key={facet.id}
          facet={facet}
          update={update}
          // Four or more share the row out between them, as the design draws
          // it; fewer keep a button's width instead of a stretched bar.
          stretch={visible.length >= 4}
        />
      ))}
      {activeCount > 0 ? (
        <ClearButton label={clearLabel} onClick={clearAll} className="px-2" />
      ) : null}
    </div>
  );
}

/** A facet as a plain label and chevron, over a dropdown card. */
function FacetDropdown({
  facet,
  update,
}: {
  facet: ListingFacet;
  update: (updates: FilterUpdates) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = facetActiveCount(facet);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex cursor-pointer items-center gap-2 py-2 text-sm font-medium transition-opacity hover:opacity-70",
          count > 0 && "font-semibold",
        )}
      >
        {facet.title}
        {count > 0 ? <span>({count})</span> : null}
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          facet.kind === "location" ? "w-80" : "w-72",
          "rounded-xl p-4 shadow-lg",
        )}
      >
        <FacetBody facet={facet} update={update} />
      </PopoverContent>
    </Popover>
  );
}

function FacetButton({
  facet,
  update,
  stretch,
}: {
  facet: ListingFacet;
  update: (updates: FilterUpdates) => void;
  stretch: boolean;
}) {
  const [open, setOpen] = useState(false);
  const count = facetActiveCount(facet);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-12 cursor-pointer items-center justify-between gap-3 rounded-md border bg-background px-4 text-start text-sm transition-colors hover:border-foreground/40",
          stretch ? "min-w-[9.5rem] flex-1 basis-0" : "w-56",
          (open || count > 0) && "border-foreground/60",
        )}
      >
        <span className="truncate">
          {facet.title}
          {count > 0 ? <span className="ms-1 font-semibold">({count})</span> : null}
        </span>
        <Plus
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-45")}
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className={cn(facet.kind === "location" ? "w-80" : "w-72", "p-4")}
      >
        <FacetBody facet={facet} update={update} />
      </PopoverContent>
    </Popover>
  );
}

function FacetBody({
  facet,
  update,
}: {
  facet: ListingFacet;
  update: (updates: FilterUpdates) => void;
}) {
  const t = useTranslations();
  switch (facet.kind) {
    case "options":
      return (
        <div className="flex flex-col gap-2.5">
          <div className="flex max-h-72 flex-col gap-2.5 overflow-y-auto pe-1">
            {facet.options.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2.5 text-sm"
              >
                <Checkbox
                  checked={facet.selected.includes(option.value)}
                  onCheckedChange={() =>
                    update({
                      [facet.param]: toggleSelection(facet.selected, option.value),
                    })
                  }
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))}
          </div>
          {facet.viewAllHref ? (
            <Link
              href={facet.viewAllHref}
              className="inline-flex items-center gap-1.5 pt-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
            >
              {t("common.viewAll")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      );
    case "price":
      return <PriceBody facet={facet} update={update} />;
    case "location":
      return (
        <ProductFiltersLocation
          resultCount={facet.resultCount}
          narrowsResults={facet.narrowsResults}
        />
      );
    case "pickup":
      return (
        <ProductFiltersPickupFacet
          pickupNearby={facet.pickupNearby}
          onChange={(next) =>
            update({ pickup: next ? PICKUP_NEARBY_PARAM : undefined })
          }
        />
      );
  }
}

function PriceBody({
  facet,
  update,
}: {
  facet: Extract<ListingFacet, { kind: "price" }>;
  update: (updates: FilterUpdates) => void;
}) {
  const t = useTranslations();
  const { bounds } = facet;
  const clamp = (value: number) => Math.min(bounds.max, Math.max(bounds.min, value));
  const read = (): [number, number] => [
    facet.currentMin ? clamp(parseInt(facet.currentMin, 10) || bounds.min) : bounds.min,
    facet.currentMax ? clamp(parseInt(facet.currentMax, 10) || bounds.max) : bounds.max,
  ];
  const [values, setValues] = useState<[number, number]>(read);

  // The URL is the source of truth: re-sync after navigation.
  useApplyOnChange([facet.currentMin, facet.currentMax, bounds.min, bounds.max], () =>
    setValues(read()),
  );

  // A bound left at its edge is not a filter, so it leaves the URL.
  const commit = (min: number, max: number) =>
    update({
      minPrice: min > bounds.min ? String(min) : undefined,
      maxPrice: max < bounds.max ? String(max) : undefined,
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("productsPage.filters.minPrice")}
          <NumberInput
            min={bounds.min}
            max={values[1]}
            step={1}
            value={values[0]}
            whenEmpty="keep"
            normalize={Math.trunc}
            onValueChange={(value) => {
              if (value === undefined) return;
              const next = Math.min(values[1], clamp(value));
              setValues([next, values[1]]);
              commit(next, values[1]);
            }}
            className="h-9 text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("productsPage.filters.maxPrice")}
          <NumberInput
            min={values[0]}
            max={bounds.max}
            step={1}
            value={values[1]}
            whenEmpty="keep"
            normalize={Math.trunc}
            onValueChange={(value) => {
              if (value === undefined) return;
              const next = Math.max(values[0], clamp(value));
              setValues([values[0], next]);
              commit(values[0], next);
            }}
            className="h-9 text-foreground"
          />
        </label>
      </div>
      <Slider
        min={bounds.min}
        max={bounds.max}
        step={bounds.step}
        value={values}
        onValueChange={(next) => setValues([next[0], next[1]])}
        onValueCommit={(next) => {
          setValues([next[0], next[1]]);
          commit(next[0], next[1]);
        }}
      />
    </div>
  );
}

function ClearButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80",
        className,
      )}
    >
      <X className="h-3 w-3" aria-hidden="true" />
      {label}
    </button>
  );
}
