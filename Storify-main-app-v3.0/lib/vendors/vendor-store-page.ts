/**
 * The vendor landing page (Vendor CMS): the Home tab a vendor designs for
 * their own storefront at /vendors/<slug>.
 *
 * The admin's theme engine draws it (same section registry, same renderers),
 * but it is a separate document per vendor (`VendorStorePage`), written
 * through its own routes under /api/vendor/store-page. Nothing here reads or
 * writes the admin's `StorePage` documents, so a vendor's page can never
 * change the marketplace's own pages.
 *
 * Client-safe: the vendor builder and the server write gate both read it.
 */

import { VENDOR_SECTION_PREVIEW_SEGMENT } from "@/lib/storefront/pages/section-preview-path";

/**
 * The sections a vendor may place. Store-wide sections (vendor list, become a
 * vendor, sponsored rails, the blog, the marketplace's categories, the
 * admin's saved sliders) are deliberately absent: they show the whole
 * marketplace's data, not this store's.
 */
export const VENDOR_PAGE_SECTION_TYPES = [
  "promotion-banner",
  "product-grid",
  "image-text",
  "rich-text",
  "heading",
  "gap",
  "image-gallery",
  "faq",
  "service-benefits",
  // Scoped to the vendor at render (ctx.vendor): the store's own
  // categories and collections, its discounts, its deals.
  "category-list",
  "collection-list",
  "coupon-banner",
  "countdown-offer",
  // Also scoped at render: the store's products, categories, brands and
  // sliders, and the marketplace's collections and Looks read for its
  // products alone.
  "product-browser",
  "product-group",
  "featured-collection",
  "promotion-grid",
  "category-mosaic",
  "brand-list",
  "get-the-look",
  "looks-list",
  // Vendor pages only (`vendorOnly`).
  "review-highlights",
  "store-slider",
] as const;

export type VendorPageSectionType = (typeof VENDOR_PAGE_SECTION_TYPES)[number];

export function isVendorPageSectionType(
  type: string,
): type is VendorPageSectionType {
  return (VENDOR_PAGE_SECTION_TYPES as readonly string[]).includes(type);
}

/** Below the engine's own cap (25): a store's Home tab, not a marketplace home. */
export const VENDOR_PAGE_MAX_SECTIONS = 15;

/**
 * Fields of an allowed section the vendor builder does not offer; the write
 * gate resets them to their defaults, so a hand-built request cannot set
 * them either.
 *
 * Empty: every section a vendor may place offers the admin's own fields.
 * What differs is the data behind them — the category sources read the
 * store's categories (`vendor-category-source.ts`), the banner's slides
 * keep to the store's links and products — not which fields there are.
 */
export const VENDOR_PAGE_HIDDEN_FIELDS: Readonly<Record<string, readonly string[]>> = {};

/** The tab the bare store URL opens on, once the store has a Home tab. */
export const VENDOR_DEFAULT_TABS = ["home", "products"] as const;
export type VendorDefaultTab = (typeof VENDOR_DEFAULT_TABS)[number];

/** How tall the store banner runs; "standard" is the header as it shipped. */
export const VENDOR_BANNER_SIZES = ["compact", "standard", "tall"] as const;
export type VendorBannerSize = (typeof VENDOR_BANNER_SIZES)[number];

/** The Products tab's order when the shopper has not picked one. */
export const VENDOR_DEFAULT_SORTS = [
  "popular",
  "createdAt",
  "rating",
  "price-asc",
  "price-desc",
] as const;
export type VendorDefaultSort = (typeof VENDOR_DEFAULT_SORTS)[number];

export const VENDOR_ANNOUNCEMENT_TEXT_MAX = 160;
export const VENDOR_SEO_TITLE_MAX = 70;
export const VENDOR_SEO_DESCRIPTION_MAX = 160;

/**
 * A slim notice at the top of the store's Home tab ("Eid sale — 20% off").
 * Empty text shows nothing; the dates (ISO, "" = open-ended) bound when it
 * shows, so a sale notice takes itself down.
 */
export interface VendorPageAnnouncement {
  text: string;
  /** A path on this marketplace, or "" for no link. */
  link: string;
  /** Hex background; "" uses the page's accent. */
  color: string;
  startsAt: string;
  endsAt: string;
}

/**
 * What a search result or a shared link shows for the store. Each empty
 * value falls back to what the page uses today: the store name, its
 * description, its banner or logo.
 */
export interface VendorPageSeo {
  title: string;
  description: string;
  /** An uploaded image URL. */
  image: string;
}

export interface VendorPageSettings {
  /** Hex colour for buttons and links on this store's page; "" follows the theme. */
  accentColor: string;
  /** The "Similar products from other stores" row under the product grid. */
  showSimilarProducts: boolean;
  /** Where the bare store URL opens when there is a Home tab. */
  defaultTab: VendorDefaultTab;
  /** Hide the About tab (its facts stay in the header and store details). */
  hideAboutTab: boolean;
  /** Hide the Shipping & returns tab. The Reviews tab can never be hidden. */
  hideShippingTab: boolean;
  bannerSize: VendorBannerSize;
  defaultSort: VendorDefaultSort;
  announcement: VendorPageAnnouncement;
  seo: VendorPageSeo;
}

export const DEFAULT_VENDOR_PAGE_SETTINGS: VendorPageSettings = {
  accentColor: "",
  showSimilarProducts: true,
  defaultTab: "home",
  hideAboutTab: false,
  hideShippingTab: false,
  bannerSize: "standard",
  defaultSort: "popular",
  announcement: { text: "", link: "", color: "", startsAt: "", endsAt: "" },
  seo: { title: "", description: "", image: "" },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeAccentColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : "";
}

function pick<T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Plain one-line text: trimmed, inner whitespace collapsed, capped. */
function plainText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** An ISO timestamp for a parseable date, else "". */
function isoDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

/** An uploaded image: an http(s) URL or a path on this site, else "". */
function imageUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url || url.length > 1000 || /\s/.test(url)) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith("/") && !url.startsWith("//") ? url : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function normalizeVendorPageSettings(raw: unknown): VendorPageSettings {
  const source = record(raw);
  const announcement = record(source.announcement);
  const seo = record(source.seo);
  const defaults = DEFAULT_VENDOR_PAGE_SETTINGS;
  const link = typeof announcement.link === "string" ? announcement.link.trim() : "";
  const startsAt = isoDate(announcement.startsAt);
  const endsAt = isoDate(announcement.endsAt);
  return {
    accentColor: normalizeAccentColor(source.accentColor),
    showSimilarProducts:
      typeof source.showSimilarProducts === "boolean"
        ? source.showSimilarProducts
        : defaults.showSimilarProducts,
    defaultTab: pick(VENDOR_DEFAULT_TABS, source.defaultTab, defaults.defaultTab),
    hideAboutTab: source.hideAboutTab === true,
    hideShippingTab: source.hideShippingTab === true,
    bannerSize: pick(VENDOR_BANNER_SIZES, source.bannerSize, defaults.bannerSize),
    defaultSort: pick(VENDOR_DEFAULT_SORTS, source.defaultSort, defaults.defaultSort),
    announcement: {
      text: plainText(announcement.text, VENDOR_ANNOUNCEMENT_TEXT_MAX),
      // Same rule as every link on the page: a path on this marketplace.
      link: link.length <= 500 && isInternalLink(link) ? link : "",
      color: normalizeAccentColor(announcement.color),
      startsAt,
      // An end before the start would never show; keep the start, drop it.
      endsAt: startsAt && endsAt && endsAt <= startsAt ? "" : endsAt,
    },
    seo: {
      title: plainText(seo.title, VENDOR_SEO_TITLE_MAX),
      description: plainText(seo.description, VENDOR_SEO_DESCRIPTION_MAX),
      image: imageUrl(seo.image),
    },
  };
}

/** The announcement shows now: it has words, and now is inside its dates. */
export function isAnnouncementLive(
  announcement: VendorPageAnnouncement,
  now: Date = new Date(),
): boolean {
  if (!announcement.text) return false;
  const time = now.getTime();
  if (announcement.startsAt && time < Date.parse(announcement.startsAt)) return false;
  if (announcement.endsAt && time >= Date.parse(announcement.endsAt)) return false;
  return true;
}

/**
 * Text colour that reads on the accent: WCAG relative luminance against white
 * and near-black, whichever contrasts more.
 */
export function accentForeground(hex: string): string {
  const color = normalizeAccentColor(hex);
  if (!color) return "#ffffff";
  const channel = (offset: number) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  const onWhite = 1.05 / (luminance + 0.05);
  const onDark = (luminance + 0.05) / 0.0617; // #111827
  return onWhite >= onDark ? "#ffffff" : "#111827";
}

/**
 * CSS custom properties that repaint the page's buttons, focus rings and
 * links in the vendor's accent. Applied on a wrapper inside the storefront
 * surface, so the marketplace header and footer keep the theme's colours.
 */
export function accentStyle(
  hex: string,
): Record<string, string> | undefined {
  const color = normalizeAccentColor(hex);
  if (!color) return undefined;
  return {
    "--primary": color,
    "--ring": color,
    "--primary-foreground": accentForeground(color),
    "--store-link": color,
  };
}

/**
 * Links on a vendor's page stay on this marketplace: a path, never another
 * host. Keeps a banner from sending shoppers off the platform to buy.
 */
export function isInternalLink(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const link = value.trim();
  if (link === "") return true;
  return (
    link.startsWith("/") &&
    !link.startsWith("//") &&
    !link.includes("\\") &&
    !/\s/.test(link)
  );
}

/** The whole draft page, under the real storefront chrome. */
export const VENDOR_STORE_PREVIEW_SEGMENT = "vendor-store-preview";

/** Section and block ids as the builder mints them; anything else is dropped. */
const SAFE_ID = /^[\w.:-]+$/;

/**
 * Where the vendor builder's preview frames go: the whole draft page, or —
 * with a section id — that one section on the chrome-less frame route.
 * `locale` must already be valid; the caller falls back to the default.
 */
export function buildVendorPreviewPath(input: {
  locale: string;
  section?: string;
  block?: string;
}): string {
  const section =
    input.section && SAFE_ID.test(input.section) ? input.section : "";
  const block =
    section && input.block && SAFE_ID.test(input.block) ? input.block : "";
  if (!section) return `/${input.locale}/${VENDOR_STORE_PREVIEW_SEGMENT}`;
  const query = new URLSearchParams({ section });
  if (block) query.set("block", block);
  return `/${input.locale}/${VENDOR_SECTION_PREVIEW_SEGMENT}?${query.toString()}`;
}

/**
 * The link a tile on a vendor's landing page opens: the store's own Products
 * tab, filtered — never the marketplace-wide category, collection or brand
 * page.
 */
export function vendorFilterHref(
  locale: string,
  vendorSlug: string,
  filter: "category" | "collection" | "brand",
  slug: string,
): string {
  return `/${locale}/vendors/${encodeURIComponent(vendorSlug)}?tab=products&${filter}=${encodeURIComponent(slug)}`;
}

/**
 * A store's Products tab, optionally filtered — where a vendor shelf's "View
 * all" leads instead of the marketplace's category, brand or collection
 * page. A storefront path without the locale (the locale-aware Link adds it).
 */
export function vendorProductsPath(
  vendorSlug: string,
  filter?: { key: "category" | "brand" | "collection"; slug: string },
): string {
  const base = `/vendors/${encodeURIComponent(vendorSlug)}?tab=products`;
  return filter ? `${base}&${filter.key}=${encodeURIComponent(filter.slug)}` : base;
}

/** URL params that belong to the product grid; their presence opens the Products tab. */
export const VENDOR_PRODUCT_QUERY_KEYS = [
  "category",
  "collection",
  "brand",
  "search",
  "minPrice",
  "maxPrice",
  "sortBy",
  "page",
  "pickup",
  "pickupNearby",
  "lat",
  "lng",
  "radius",
  "city",
] as const;

export function hasVendorProductQuery(
  search: Record<string, string | string[] | undefined>,
): boolean {
  return VENDOR_PRODUCT_QUERY_KEYS.some((key) => search[key] !== undefined);
}
