import type { CSSProperties } from "react";
import { readableForegroundColor } from "@/lib/site-config/appearance-colors";
import {
  FEATURED_CATEGORIES_SOURCES,
  type FeaturedCategoriesSource,
} from "@/lib/site-config/home-page-config";
import {
  CATEGORY_LIST_PRESETS,
  type CategoryListStyle,
} from "@/lib/storefront/sections/category-list-style";
import {
  backgroundAccentColor,
  backgroundCss,
  hasBackground,
  normalizeBackground,
  type SlideBackground,
} from "@/lib/sliders/types";

/**
 * How the products listing page (`products-main`) is laid out: where its
 * filters sit, how its categories show, and the cover behind its title.
 *
 * Every option's default reproduces the page as it shipped — sidebar
 * filters, no categories, no cover — so an untouched template renders
 * exactly as before. Read the same way by both listing designs and by the
 * page route (which must know whether the breadcrumb moved into the cover),
 * so this module stays pure.
 *
 * Option values are also admin label keys (`admin.storeBuilder.options.*`),
 * which are shared by every section — hence `hidden` rather than `none`,
 * whose label is already "As typed".
 */

/**
 * Where the filters sit: down a left sidebar; across the top as boxes or as
 * dropdown labels; or folded into one Filter button. Order is the editor's.
 */
export const LISTING_FILTER_LAYOUTS = [
  "sidebar",
  "filterBar",
  "filterDropdown",
  "filterButton",
] as const;
export type ListingFilterLayout = (typeof LISTING_FILTER_LAYOUTS)[number];

export const LISTING_CATEGORY_STYLES = [
  "hidden",
  "chips",
  "circles",
  "cards",
  "overlay",
] as const;
export type ListingCategoryStyle = (typeof LISTING_CATEGORY_STYLES)[number];

/** `theme`: the active theme's own placement (Classic left, Electronics centred). */
export const LISTING_TITLE_ALIGNS = ["theme", "left", "center"] as const;
export type ListingTitleAlign = (typeof LISTING_TITLE_ALIGNS)[number];

/**
 * Where the trail sits on its line. "theme" follows the page title, which
 * is what it always did — a centred title had a left-hung breadcrumb over
 * it, and most merchants want the two to agree.
 */
export const LISTING_BREADCRUMB_ALIGNS = ["theme", "left", "center", "right"] as const;
export type ListingBreadcrumbAlign = (typeof LISTING_BREADCRUMB_ALIGNS)[number];

/**
 * How the grid runs on: pages with a numbered pager, or one long scroll that
 * loads as the shopper reaches the end. `theme` is the design's own.
 */
export const LISTING_PAGINATIONS = ["theme", "pages", "infinite"] as const;
export type ListingPagination = (typeof LISTING_PAGINATIONS)[number];

/**
 * The featured-products strip under the sidebar filters. `theme` is the
 * design's own; the strip needs the sidebar, so the horizontal filter
 * layouts never draw it.
 */
export const LISTING_FEATURED_OPTIONS = ["theme", "show", "hidden"] as const;
export type ListingFeatured = (typeof LISTING_FEATURED_OPTIONS)[number];

/**
 * The listing's two drawings — the section's designs (`products-main` and
 * `category-main` variants). Every feature exists in both; a design only
 * decides how the page is drawn and what "theme" means for a setting.
 */
export type ListingDesign = "classic" | "electronics";

const LISTING_DESIGN_DEFAULTS: Record<
  ListingDesign,
  { titleAlign: "left" | "center"; pagination: "pages" | "infinite"; featured: boolean }
> = {
  // The stock page: a left title over a sidebar, scrolling on indefinitely.
  classic: { titleAlign: "left", pagination: "infinite", featured: false },
  // Figma 759:179: a centred title, numbered pages, featured minis under the
  // filters.
  electronics: { titleAlign: "center", pagination: "pages", featured: true },
};

/** The title placement a design uses when the merchant left it to the theme. */
export function listingDesignTitleAlign(design: ListingDesign): "left" | "center" {
  return LISTING_DESIGN_DEFAULTS[design].titleAlign;
}

export function listingPagination(
  setting: ListingPagination,
  design: ListingDesign,
): "pages" | "infinite" {
  return setting === "theme" ? LISTING_DESIGN_DEFAULTS[design].pagination : setting;
}

export function listingShowsFeatured(
  setting: ListingFeatured,
  design: ListingDesign,
): boolean {
  return setting === "theme"
    ? LISTING_DESIGN_DEFAULTS[design].featured
    : setting === "show";
}

export const LISTING_COVER_WIDTHS = ["contained", "full"] as const;
export type ListingCoverWidth = (typeof LISTING_COVER_WIDTHS)[number];

export const LISTING_COVER_SCOPES = ["coverTitle", "coverTitleCategories"] as const;
export type ListingCoverScope = (typeof LISTING_COVER_SCOPES)[number];

export const LISTING_CATEGORY_LIMIT = { min: 2, max: 24, default: 12 } as const;

/**
 * The cards design's tile geometry, and only that design's: circles and
 * overlay keep their preset shapes, which is what makes them recognisable
 * as the Categories section's own designs.
 *
 * Every default reproduces the row as it shipped — the 12px radius the
 * listing hard-coded, the cards preset's 24px gap, and a tile sized from
 * the column it sits in, which is what a size of 0 still means.
 */
export const LISTING_CARD_RADIUS = { min: 0, max: 48, default: 12 } as const;
export const LISTING_CARD_SIZE = { min: 0, max: 320, default: 0 } as const;
export const LISTING_CARD_GAP = { min: 0, max: 80, default: 24 } as const;
export const LISTING_COVER_HEIGHT = { min: 0, max: 640, default: 0 } as const;
export const LISTING_COVER_RADIUS = { min: 0, max: 48, default: 16 } as const;
export const LISTING_COVER_OVERLAY = { min: 0, max: 80, default: 0 } as const;

export interface ProductsListingLayout {
  titleAlign: ListingTitleAlign;
  /** Where the breadcrumb sits; "theme" follows the title. */
  breadcrumbAlign: ListingBreadcrumbAlign;
  filterLayout: ListingFilterLayout;
  pagination: ListingPagination;
  featuredProducts: ListingFeatured;
  categoryStyle: ListingCategoryStyle;
  /** Where a category row shorter than the page sits. */
  categoryAlign: "left" | "center";
  categorySource: FeaturedCategoriesSource;
  categoryLimit: number;
  categoryIds: string[];
  /** Cards only: a tile's corner radius, px. */
  categoryRadius: number;
  /** Cards only: a tile's width in px; 0 = its share of the row. */
  categorySize: number;
  /** Cards only: px between tiles on desktop; phones take half. */
  categoryGap: number;
  /** A saved slider's handle, drawn as a banner above the title; "" = none. */
  coverSlider: string;
  /** Normalized; `hasBackground` false = no cover at all. */
  cover: SlideBackground;
  coverWidth: ListingCoverWidth;
  coverScope: ListingCoverScope;
  /** Minimum height in px; 0 = as tall as its content. */
  coverHeight: number;
  /** Corner radius of a contained cover, px. */
  coverRadius: number;
  /** Darkening over a picture or video cover, 0–80 (%). */
  coverOverlay: number;
  /** Text colour on the cover; "" = picked for contrast. */
  coverText: string;
  /** The breadcrumb moves inside the cover (only when there is one). */
  coverBreadcrumb: boolean;
}

const oneOf = <T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T =>
  typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

const clampNumber = (
  value: unknown,
  { min, max, default: fallback }: { min: number; max: number; default: number },
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function readProductsListingLayout(
  settings: Record<string, unknown> | undefined,
): ProductsListingLayout {
  const s = settings ?? {};
  return {
    titleAlign: oneOf(LISTING_TITLE_ALIGNS, s.titleAlign, "theme"),
    breadcrumbAlign: oneOf(LISTING_BREADCRUMB_ALIGNS, s.breadcrumbAlign, "theme"),
    filterLayout: oneOf(LISTING_FILTER_LAYOUTS, s.filterLayout, "sidebar"),
    pagination: oneOf(LISTING_PAGINATIONS, s.pagination, "theme"),
    featuredProducts: oneOf(LISTING_FEATURED_OPTIONS, s.featuredProducts, "theme"),
    categoryStyle: oneOf(LISTING_CATEGORY_STYLES, s.categoryStyle, "hidden"),
    categoryAlign: oneOf(["left", "center"] as const, s.categoryAlign, "left"),
    categorySource: oneOf(FEATURED_CATEGORIES_SOURCES, s.categorySource, "topLevel"),
    categoryLimit: clampNumber(s.categoryLimit, LISTING_CATEGORY_LIMIT),
    categoryIds: Array.isArray(s.categoryIds)
      ? s.categoryIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
    categoryRadius: clampNumber(s.categoryRadius, LISTING_CARD_RADIUS),
    categorySize: clampNumber(s.categorySize, LISTING_CARD_SIZE),
    categoryGap: clampNumber(s.categoryGap, LISTING_CARD_GAP),
    coverSlider: typeof s.coverSlider === "string" ? s.coverSlider.trim().slice(0, 120) : "",
    cover: normalizeBackground(s.cover),
    coverWidth: oneOf(LISTING_COVER_WIDTHS, s.coverWidth, "contained"),
    coverScope: oneOf(LISTING_COVER_SCOPES, s.coverScope, "coverTitleCategories"),
    coverHeight: clampNumber(s.coverHeight, LISTING_COVER_HEIGHT),
    coverRadius: clampNumber(s.coverRadius, LISTING_COVER_RADIUS),
    coverOverlay: clampNumber(s.coverOverlay, LISTING_COVER_OVERLAY),
    coverText: typeof s.coverText === "string" && HEX.test(s.coverText) ? s.coverText : "",
    coverBreadcrumb: s.coverBreadcrumb !== false,
  };
}

/**
 * The category block's preset for the design the merchant picked, with the
 * listing's own differences.
 *
 * "cards" fills each tile with the picture: the home page's card row floats
 * a small cut-out in a bare frame, which reads as a row of icons there, but
 * on a filter row a half-empty outlined box read as a broken image. Cards
 * also take their radius, size and gap from the section's settings, whose
 * defaults are the values this used to hard-code.
 *
 * Circles and overlay are left exactly as the block draws them — their
 * shape IS the design, so a department reads the same on both pages.
 */
export function listingCategoryTileStyle(
  style: Exclude<ProductsListingLayout["categoryStyle"], "hidden" | "chips">,
  layout: ProductsListingLayout,
): CategoryListStyle {
  const preset = CATEGORY_LIST_PRESETS[style];
  const tiles =
    style === "cards"
      ? {
          ...preset,
          imageFit: "cover" as const,
          shape: "square" as const,
          tileHeight: 0,
          roundness: layout.categoryRadius,
          // 0 keeps the preset's behaviour: a tile is its share of the row.
          tileWidth: layout.categorySize,
          gap: layout.categoryGap,
          // The preset's own 24/12 pair, kept as a ratio so a wider gap does
          // not push a phone's row off the screen.
          mobileGap: Math.round(layout.categoryGap / 2),
        }
      : preset;
  return { ...tiles, align: layout.categoryAlign };
}

export function listingHasCover(layout: ProductsListingLayout): boolean {
  return hasBackground(layout.cover);
}

/**
 * The breadcrumb's alignment as a class for its own row: the trail is an
 * `<ol>` inside the nav, so the justification lands there. Left is the
 * shipped look and draws nothing.
 */
export function listingBreadcrumbAlignClass(
  layout: ProductsListingLayout,
  themeAlign: "left" | "center",
): string {
  const align =
    layout.breadcrumbAlign === "theme"
      ? listingTitleAlign(layout, themeAlign)
      : layout.breadcrumbAlign;
  if (align === "center") return "[&_ol]:justify-center";
  if (align === "right") return "[&_ol]:justify-end";
  return "";
}

/** Whether the page route should leave the breadcrumb to the cover. */
export function listingBreadcrumbInCover(layout: ProductsListingLayout): boolean {
  return listingHasCover(layout) && layout.coverBreadcrumb;
}

function listingShowsCategories(layout: ProductsListingLayout): boolean {
  return layout.categoryStyle !== "hidden";
}

/**
 * Whether the categories render INSIDE the cover. Chips never do: they are
 * a filter row, and sit above the listing's toolbar, cover or not.
 */
export function listingCategoriesInCover(layout: ProductsListingLayout): boolean {
  return (
    listingHasCover(layout) &&
    layout.coverScope === "coverTitleCategories" &&
    listingShowsCategories(layout) &&
    layout.categoryStyle !== "chips"
  );
}

/** The title's resolved alignment, given the theme's own. */
export function listingTitleAlign(
  layout: ProductsListingLayout,
  themeAlign: "left" | "center",
): "left" | "center" {
  return layout.titleAlign === "theme" ? themeAlign : layout.titleAlign;
}

/**
 * The cover's paint and ink. The text colour, unless set, is chosen against
 * the background's leading colour; over a photo it is white, which the
 * overlay setting is there to keep legible.
 */
export function listingCoverStyle(layout: ProductsListingLayout): {
  background: CSSProperties;
  color: string;
  overlay: number;
} {
  const { cover } = layout;
  const artwork = cover.type === "image" || cover.type === "video";
  const accent = backgroundAccentColor(cover);
  const auto = artwork
    ? "#ffffff"
    : accent && HEX.test(accent)
      ? readableForegroundColor(accent)
      : "";
  return {
    background: backgroundCss(cover),
    color: layout.coverText || auto,
    overlay: artwork ? layout.coverOverlay : 0,
  };
}

/** Params that filter the listing; every other param (sort, search) survives a category pick. */
const RESET_ON_CATEGORY = ["category", "page"];

/**
 * The chip row's links: each category REPLACES the category filter (a chip
 * row is a single choice, unlike the checkbox facet), keeps the rest of the
 * query, and drops the page — a different category's page 3 is a stranger's.
 */
export function listingCategoryHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
  slug: string | null,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (RESET_ON_CATEGORY.includes(key) || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, entry);
  }
  if (slug) params.set("category", slug);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/** The chip that reads as selected: the one category filtered on, else "All". */
export function listingActiveCategory(
  searchParams: Record<string, string | string[] | undefined>,
): string | null {
  const raw = searchParams.category;
  const value = typeof raw === "string" ? raw.trim() : "";
  // Several categories ticked in the facets is not any one chip.
  if (!value || value.includes(",")) return value ? "" : null;
  return value;
}
