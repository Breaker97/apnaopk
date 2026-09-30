import { revalidatePath, revalidateTag } from "next/cache";
import { locales } from "@/config/i18n.config";

export const CACHE_TAGS = {
  blogCategories: "blog-categories",
  blogPosts: "blog-posts",
  brands: "brands",
  categories: "categories",
  collections: "collections",
  coupons: "coupons",
  menus: "menus",
  products: "products",
  settings: "settings",
  sliders: "sliders",
  sponsoredProducts: "sponsored-products",
  storePages: "store-pages",
} as const;

type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

const IMMEDIATE_REVALIDATION = { expire: 0 } as const;

/**
 * How a change reaches the next visitor.
 *
 * - `"now"`: the tags expire, and the next request renders with fresh data.
 *   For a change a person just made and expects to see — an admin saving.
 * - `"background"`: the tags go stale, and the next request is answered from
 *   the cache while a fresh copy renders behind it (Next's
 *   stale-while-revalidate for `revalidateTag` with a cacheLife profile). For
 *   changes nobody is watching happen — a sale moving stock, a review moving a
 *   rating, a cron ending a campaign. Expiring those sent the next shopper
 *   through a cold render: 6.6 s for the live demo's home page, caught by a
 *   probe the minute the catalogue changed. Background changes never bust
 *   paths either: a path's implicit tag is on every cached read that page
 *   makes (settings, header, sections), so it would force the cold render
 *   anyway.
 */
type Freshness = "now" | "background";

const BACKGROUND_REVALIDATION = "max";

function expireTag(tag: string, freshness: Freshness) {
  revalidateTag(
    tag,
    freshness === "background" ? BACKGROUND_REVALIDATION : IMMEDIATE_REVALIDATION,
  );
}

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function revalidateCacheTags(
  tags: CacheTag[],
  freshness: Freshness = "now",
) {
  for (const tag of new Set(tags)) {
    expireTag(tag, freshness);
  }
}

/**
 * Expire the cached render of concrete storefront URLs, once per locale.
 *
 * `revalidatePath` turns its argument into an implicit cache tag. For a
 * *resolved* URL that tag is the pathname itself (`_N_T_/en/products/x`), which
 * is what Next stamps on the route's cache entry. Passing the optional `type`
 * argument appends a segment (`_N_T_/en/products/x/page`) — that form only
 * matches when the path is a route *pattern* (`/[locale]/products/[slug]`), so
 * using it with a real URL silently expires nothing. These are real URLs, so
 * no `type` is passed.
 */
export function revalidateLocalizedPaths(
  paths: Array<string | null | undefined>,
) {
  for (const path of uniqueStrings(paths).map(normalizePath)) {
    for (const locale of locales) {
      revalidatePath(path === "/" ? `/${locale}` : `/${locale}${path}`);
    }
  }
}

/**
 * Expire every localized page, for changes that flow through the shared layout
 * (store name, logo, colors, header/footer menus, content-page visibility).
 *
 * Layout tags are derived from the route *pattern*, not the resolved URL, so
 * this has to be expressed as `/[locale]` — `/en` + "layout" would build
 * `_N_T_/en/layout`, a tag no route carries. `_N_T_/[locale]/layout` is on
 * every page under app/[locale], which is exactly the intended blast radius.
 */
export function revalidateStorefrontLayouts() {
  revalidatePath("/[locale]", "layout");
}

export function revalidateProductContent(options?: {
  slugs?: Array<string | null | undefined>;
  freshness?: Freshness;
}) {
  const freshness = options?.freshness ?? "now";
  revalidateCacheTags(
    [
      CACHE_TAGS.products,
      CACHE_TAGS.collections,
      CACHE_TAGS.categories,
      CACHE_TAGS.brands,
    ],
    freshness,
  );

  if (freshness === "background") {
    for (const slug of uniqueStrings(options?.slugs ?? [])) {
      expireTag(productSlugTag(slug), freshness);
    }
    return;
  }

  revalidateLocalizedPaths([
    "/",
    "/products",
    ...(options?.slugs || []).map((slug) =>
      slug ? `/products/${slug}` : undefined,
    ),
  ]);
}

/** Past this many products, naming each product page costs more than expiring them all. */
const PER_SLUG_REVALIDATION_LIMIT = 50;

/**
 * Expire what a bulk product change (an import) touched.
 *
 * Every slug fans out to one path per locale, and Next de-duplicates its queue
 * of pending tags with a linear scan — a thousand-row import listing each slug
 * made that queue quadratic. Past a handful of products the product page
 * *route* is expired instead, which covers every slug in every locale.
 */
export function revalidateBulkProductContent(
  slugs: Array<string | null | undefined>,
) {
  const unique = uniqueStrings(slugs);
  if (unique.length <= PER_SLUG_REVALIDATION_LIMIT) {
    revalidateProductContent({ slugs: unique });
    return;
  }
  revalidateProductContent();
  revalidatePath("/[locale]/(store)/products/[slug]", "page");
}

/**
 * Tag carried by one product's cached storefront detail. Keyed by slug because
 * that is what the product page reads by, and what every stock movement already
 * knows.
 */
export function productSlugTag(slug: string) {
  return `product:${slug}`;
}

/**
 * Expire what a stock movement (a sale, a cancellation, a restock) actually
 * changed, instead of the whole catalog.
 *
 * A product's detail page shows counts, so its own cache always goes. Cards and
 * listings only show whether something can be bought — a card has an
 * out-of-stock badge, never a number, and "hide sold-out products" filters on
 * the same yes/no — so they are expired only when a movement flipped a product
 * or variant between sellable and sold out. Anything else they show is at most
 * one revalidate window (60 s) behind, and the cart and checkout re-check stock
 * live, so a stale listing can never oversell.
 *
 * Busting everything on every sale meant each order sent the next visitor to
 * every product, listing and home page down the uncached path. A sale is also
 * nobody's edit to watch land, so it refreshes in the background.
 */
export function revalidateProductStock(options: {
  slugs: Array<string | null | undefined>;
  availabilityChanged: boolean;
}) {
  if (options.availabilityChanged) {
    revalidateProductContent({ slugs: options.slugs, freshness: "background" });
    return;
  }

  for (const slug of uniqueStrings(options.slugs)) {
    expireTag(productSlugTag(slug), "background");
  }
}

export function revalidateSettingsContent() {
  revalidateCacheTags([CACHE_TAGS.settings]);
  revalidateStorefrontLayouts();
}

/**
 * Expire everything the storefront has cached, for a store that has just been
 * written wholesale: the install wizard's finish, which stores settings and,
 * with sample data, a whole catalog through raw inserts no content helper
 * sees.
 *
 * Until the lock the proxy sends every page to the wizard, but the wizard's
 * own render caches the store settings through the root layout, and a store
 * reinstalled on a running server still has the previous store cached. Every
 * tag goes, for the reads route handlers make (their entries carry no layout
 * tag), and the root layout, whose implicit tag every page's cached reads
 * carry — Next's documented "revalidate all data".
 */
export function revalidateAllStorefrontContent() {
  revalidateCacheTags(Object.values(CACHE_TAGS));
  revalidatePath("/", "layout");
}

/**
 * Refresh the sponsored-product pools after a boost campaign transition
 * (activate / pause / resume / cancel / expire). Scoped to its own tag so a
 * campaign starting or ending never busts the whole products cache, and in
 * the background: the pools are read through that tag wherever a sponsored
 * slot renders, and most transitions are a cron's, with nobody watching.
 *
 * **Never throws.** Every caller invokes this AFTER the state change is already
 * written, and `revalidateTag` raises an invariant when there is no static
 * generation store — which is the case in a cron tick that has already
 * responded, in a detached fire-and-forget, and under test. Letting that
 * propagate makes a booking that WAS released and credited report itself as a
 * failure, so the caller compensates for work that actually succeeded. A missed
 * cache bust costs at most 60 seconds of staleness; the pool's own `revalidate`
 * window closes it.
 */
export function revalidateSponsoredProducts() {
  try {
    revalidateCacheTags([CACHE_TAGS.sponsoredProducts], "background");
  } catch (error) {
    console.warn(
      "Sponsored-product cache bust skipped (no revalidation scope):",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * A discount was created, edited, deleted or switched off. The storefront
 * reads coupons in one place, the coupon banner, and that read carries this
 * tag wherever the banner renders — so the tag is the whole blast radius. A
 * path bust would also make every other cached read on those pages miss.
 */
export function revalidateCouponContent() {
  revalidateCacheTags([CACHE_TAGS.coupons]);
}

export function revalidateMenuContent() {
  revalidateCacheTags([CACHE_TAGS.menus]);
  revalidateStorefrontLayouts();
}

/**
 * A slider can be referenced by a section on any storefront page (home,
 * landing pages, template pages), so like menus this expires the layout-wide
 * blast radius rather than guessing at concrete URLs.
 */
export function revalidateSliderContent() {
  revalidateCacheTags([CACHE_TAGS.sliders]);
  revalidateStorefrontLayouts();
}

export function revalidateCategoryContent(options?: {
  slugs?: Array<string | null | undefined>;
}) {
  revalidateCacheTags([
    CACHE_TAGS.categories,
    CACHE_TAGS.products,
    CACHE_TAGS.collections,
  ]);
  revalidateLocalizedPaths([
    "/",
    "/products",
    "/categories",
    "/collections",
    ...(options?.slugs || []).map((slug) =>
      slug ? `/categories/${slug}` : undefined,
    ),
  ]);
}

export function revalidateBrandContent(options?: {
  slugs?: Array<string | null | undefined>;
}) {
  revalidateCacheTags([CACHE_TAGS.brands, CACHE_TAGS.products]);
  revalidateLocalizedPaths([
    "/",
    "/brands",
    "/products",
    ...(options?.slugs || []).map((slug) =>
      slug ? `/brands/${slug}` : undefined,
    ),
  ]);
}

export function revalidateCollectionContent(options?: {
  slugs?: Array<string | null | undefined>;
}) {
  revalidateCacheTags([CACHE_TAGS.collections, CACHE_TAGS.products]);
  revalidateLocalizedPaths([
    "/",
    "/collections",
    ...(options?.slugs || []).map((slug) =>
      slug ? `/collections/${slug}` : undefined,
    ),
  ]);
}

export function revalidateBlogContent(options?: {
  slugs?: Array<string | null | undefined>;
}) {
  revalidateCacheTags([CACHE_TAGS.blogPosts, CACHE_TAGS.blogCategories]);
  revalidateLocalizedPaths([
    "/blog",
    ...(options?.slugs || []).map((slug) => (slug ? `/blog/${slug}` : undefined)),
  ]);
}
