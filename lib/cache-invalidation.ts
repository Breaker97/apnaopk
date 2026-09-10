import { revalidatePath, revalidateTag } from "next/cache";
import { locales } from "@/config/i18n.config";

export const CACHE_TAGS = {
  blogCategories: "blog-categories",
  blogPosts: "blog-posts",
  brands: "brands",
  categories: "categories",
  collections: "collections",
  menus: "menus",
  products: "products",
  settings: "settings",
  sliders: "sliders",
  sponsoredProducts: "sponsored-products",
  storePages: "store-pages",
} as const;

type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

const IMMEDIATE_REVALIDATION = { expire: 0 } as const;

function normalizePath(path: string) {
  if (!path || path === "/") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function revalidateCacheTags(tags: CacheTag[]) {
  for (const tag of new Set(tags)) {
    revalidateTag(tag, IMMEDIATE_REVALIDATION);
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
}) {
  revalidateCacheTags([
    CACHE_TAGS.products,
    CACHE_TAGS.collections,
    CACHE_TAGS.categories,
    CACHE_TAGS.brands,
  ]);

  revalidateLocalizedPaths([
    "/",
    "/products",
    ...(options?.slugs || []).map((slug) =>
      slug ? `/products/${slug}` : undefined,
    ),
  ]);
}

export function revalidateSettingsContent() {
  revalidateCacheTags([CACHE_TAGS.settings]);
  revalidateStorefrontLayouts();
}

/**
 * Expire the sponsored-product pools after a boost campaign transition
 * (activate / pause / resume / cancel / expire). Scoped to its own tag so a
 * campaign starting or ending never busts the whole products cache; the home
 * page and listing page 1 render sponsored slots, so their URLs expire too.
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
    revalidateCacheTags([CACHE_TAGS.sponsoredProducts]);
    revalidateLocalizedPaths(["/", "/products"]);
  } catch (error) {
    console.warn(
      "Sponsored-product cache bust skipped (no revalidation scope):",
      error instanceof Error ? error.message : error,
    );
  }
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
