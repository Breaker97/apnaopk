import type { Field } from "./types";
import type { ListingDesign } from "./products-listing-layout";
import {
  LISTING_PAGINATIONS,
  type ListingPagination,
} from "./products-listing-layout";

/**
 * What a category page shows, under either of its designs.
 *
 * The category template has two drawings — "classic" (a card with the
 * category's picture, description and count over a plain grid) and
 * "electronics" (a centred title over the department row, a filter sidebar
 * and a sort toolbar). Both draw every piece; a merchant turns each on or off
 * here, and "theme" leaves it to the design, so an untouched page renders
 * exactly as its design always did.
 *
 * Pure: the section definitions, the renderers and tests all read it.
 */

/** "theme" = the design's own choice; option values double as admin label keys. */
const CATEGORY_PAGE_TOGGLES = ["theme", "show", "hidden"] as const;

/** The category page's filters: down a sidebar, or none (a location picker stays). */
const CATEGORY_PAGE_FILTERS = ["theme", "sidebar", "hidden"] as const;

export interface CategoryHeaderLayout {
  image: boolean;
  description: boolean;
  productCount: boolean;
  subcategories: boolean;
}

export interface CategoryMainLayout {
  filters: boolean;
  sort: boolean;
  featured: boolean;
  pagination: "pages" | "infinite";
}

const HEADER_DEFAULTS: Record<ListingDesign, CategoryHeaderLayout> = {
  classic: { image: true, description: true, productCount: true, subcategories: false },
  electronics: { image: false, description: false, productCount: false, subcategories: true },
};

const MAIN_DEFAULTS: Record<ListingDesign, CategoryMainLayout> = {
  classic: { filters: false, sort: false, featured: false, pagination: "pages" },
  electronics: { filters: true, sort: true, featured: true, pagination: "pages" },
};

function pick<T extends string>(
  options: readonly T[],
  value: unknown,
): T {
  return options.includes(value as T) ? (value as T) : options[0];
}

function toggle(value: unknown, designDefault: boolean): boolean {
  const choice = pick(CATEGORY_PAGE_TOGGLES, value);
  return choice === "theme" ? designDefault : choice === "show";
}

export function readCategoryHeaderLayout(
  settings: Record<string, unknown> | undefined,
  design: ListingDesign,
): CategoryHeaderLayout {
  const s = settings ?? {};
  const defaults = HEADER_DEFAULTS[design];
  return {
    image: toggle(s.showImage, defaults.image),
    description: toggle(s.showDescription, defaults.description),
    productCount: toggle(s.showProductCount, defaults.productCount),
    subcategories: toggle(s.showSubcategories, defaults.subcategories),
  };
}

export function readCategoryMainLayout(
  settings: Record<string, unknown> | undefined,
  design: ListingDesign,
): CategoryMainLayout {
  const s = settings ?? {};
  const defaults = MAIN_DEFAULTS[design];
  const filters = pick(CATEGORY_PAGE_FILTERS, s.filterLayout);
  const hasFilters = filters === "theme" ? defaults.filters : filters === "sidebar";
  const pagination: ListingPagination = pick(LISTING_PAGINATIONS, s.pagination);
  return {
    filters: hasFilters,
    sort: toggle(s.sort, defaults.sort),
    // The featured strip lives under the filters; without them it has no home.
    featured: hasFilters && toggle(s.featuredProducts, defaults.featured),
    pagination: pagination === "theme" ? defaults.pagination : pagination,
  };
}

const toggleField = (key: string, hint: string): Field => ({
  key,
  type: "select",
  options: CATEGORY_PAGE_TOGGLES,
  default: "theme",
  width: "half",
  hint,
});

export const CATEGORY_HEADER_FIELDS: Field[] = [
  toggleField("showImage", "The category's picture beside its name."),
  toggleField("showDescription", "The description written for the category."),
  toggleField("showProductCount", "How many products the category holds."),
  toggleField(
    "showSubcategories",
    "A row of the category's sub-categories, each linking to its page.",
  ),
];

export const CATEGORY_MAIN_FIELDS: Field[] = [
  {
    key: "filterLayout",
    type: "select",
    options: CATEGORY_PAGE_FILTERS,
    default: "theme",
    width: "half",
    hint: "Sub-category, brand, price, availability and location filters down the left. Phones use the filter sheet.",
  },
  toggleField("sort", "The sort menu above the products."),
  {
    ...toggleField("featuredProducts", "A short list of the category's featured products under the filters."),
    showWhen: { key: "filterLayout", values: ["theme", "sidebar"] },
  },
  {
    key: "pagination",
    type: "select",
    options: LISTING_PAGINATIONS,
    default: "theme",
    width: "half",
    hint: "Numbered pages, or more products as the shopper scrolls.",
  },
];
