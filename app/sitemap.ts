import { MetadataRoute } from "next";
import { PRODUCT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import type { Locale } from "@/config/i18n.config";
import {
  PUBLIC_BLOG_FILTER,
  publishedBlogDateCondition,
} from "@/lib/blog/storefront-blog-posts";
import { STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import {
  CONTENT_PAGE_KEYS,
  CONTENT_PAGE_META,
  HEADER_APP_PAGE_OPTIONS,
} from "@/lib/site-config/content-pages-config";
import { connectDB } from "@/lib/db";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import {
  getEnabledLocales,
  isIndexablePage,
  resolveStorefrontBaseUrl,
} from "@/lib/storefront/storefront-metadata";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import {
  BlogPost,
  Brand,
  Category,
  Collection,
  Product,
  Vendor,
} from "@/models";

/**
 * Rebuilt hourly. The catalogue changes far more often than that, but a
 * sitemap is a discovery hint, not a cache — search engines re-crawl it on
 * their own schedule, and rebuilding it per request would run six collection
 * scans for every crawler that pings it.
 *
 * Being cached also means being prerendered: `next build` renders this route
 * once to seed the cache, so an unreachable database at build time used to
 * fail the whole build here. Both readers below degrade instead of throwing,
 * so a build without a database produces a hub-pages-only sitemap and the
 * first revalidation after boot — within the hour, from a server that can
 * reach Mongo — replaces it with the full file.
 */
export const revalidate = 3600;

/**
 * The sitemap protocol caps one file at 50,000 URLs, and every entry below is
 * emitted once per enabled locale. The per-entity budget is therefore derived
 * from the locale count rather than fixed, so the file stays valid whether a
 * store runs one language or nine. Entities are sorted newest-first, so what
 * a large catalogue loses to this cap is its stalest URLs — which search
 * engines will still find by crawling the listing pages.
 *
 * A store big enough to hit this should split the file with Next's
 * `generateSitemaps()`; nothing here needs to change but the export shape.
 */
const SITEMAP_URL_BUDGET = 45_000;
const ENTITY_TYPES = 6;

type SitemapEntity = { slug: string; updatedAt?: Date };

/** Paths whose sitemap entry is decided by the admin's visibility toggle. */
const CONTENT_PAGE_PATHS = new Set(
  CONTENT_PAGE_KEYS.map((key) => CONTENT_PAGE_META[key].publicPath),
);

/** Catalogue hubs are re-crawled hardest; the rest are static-ish pages. */
function hubRanking(publicPath: string) {
  if (publicPath === "/") {
    return { changeFrequency: "daily" as const, priority: 1 };
  }
  if (
    ["/products", "/categories", "/collections", "/brands", "/vendors"].includes(
      publicPath,
    )
  ) {
    return { changeFrequency: "daily" as const, priority: 0.9 };
  }
  if (publicPath === "/blog") {
    return { changeFrequency: "daily" as const, priority: 0.7 };
  }
  return { changeFrequency: "monthly" as const, priority: 0.5 };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = resolveStorefrontBaseUrl();
  const { enabled: localeList, storeDefault } = await getEnabledLocales();
  const perEntityLimit = Math.max(
    200,
    Math.floor(SITEMAP_URL_BUDGET / (localeList.length * ENTITY_TYPES)),
  );

  const settings = await loadSettings();
  // Without settings the toggle is unknowable, so the sitemap describes the
  // shape every store has: a single-vendor storefront with no vendor
  // directory. Advertising one that 404s is the worse of the two guesses.
  const multiVendor = settings?.isMultiVendorEnabled ?? false;
  const entities = await loadEntities(perEntityLimit, multiVendor);

  const entries: MetadataRoute.Sitemap = [];
  const seen = new Set<string>();

  const push = (
    page: string,
    options: {
      lastModified?: Date;
      changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
      priority: number;
    },
  ) => {
    if (seen.has(page)) return;
    seen.add(page);

    for (const locale of localeList) {
      entries.push({
        url: `${baseUrl}/${locale}${page}`,
        lastModified: options.lastModified ?? new Date(),
        changeFrequency: options.changeFrequency,
        priority: options.priority,
        alternates: {
          languages: {
            ...Object.fromEntries(
              localeList.map((l: Locale) => [l, `${baseUrl}/${l}${page}`]),
            ),
            "x-default": `${baseUrl}/${storeDefault}${page}`,
          },
        },
      });
    }
  };

  // Built-in pages come from the same registry the header menu builder uses,
  // so a page added to the app shows up here without anyone remembering to
  // edit this file. `isIndexablePage` drops the half of that list that is
  // cart/checkout/account, and `/login` and `/register` — listed here before —
  // are noindex sign-in forms that were never a search result anyone wanted.
  for (const { publicPath } of HEADER_APP_PAGE_OPTIONS) {
    if (!isIndexablePage(publicPath)) continue;
    // Owned by the content-page loop below, which honours its visibility flag.
    if (CONTENT_PAGE_PATHS.has(publicPath)) continue;
    // The vendor directory and sign-up funnel only exist in multi-vendor
    // stores — both 404 while the toggle is off.
    if (
      (publicPath === "/become-vendor" || publicPath === "/vendors") &&
      !multiVendor
    ) {
      continue;
    }
    push(publicPath === "/" ? "" : publicPath, hubRanking(publicPath));
  }

  // Merchant-authored pages, only while the admin has them switched on.
  // Skipped wholesale when settings are unreadable: which of these exist is
  // knowable only from the database, and a URL left out of the sitemap is
  // still found by crawling, whereas one invented here is a 404 in Search
  // Console.
  if (settings) {
    for (const key of CONTENT_PAGE_KEYS) {
      if (settings.contentPages[key]?.visible) {
        push(CONTENT_PAGE_META[key].publicPath, {
          changeFrequency: "monthly",
          priority: 0.3,
        });
      }
    }
    for (const page of settings.contentPages.customPages) {
      if (!page.visible || !page.handle.trim()) continue;
      push(`/pages/${page.handle}`, {
        lastModified: page.updatedAt ? new Date(page.updatedAt) : undefined,
        changeFrequency: "monthly",
        priority: 0.4,
      });
    }
  }

  const pushAll = (
    prefix: string,
    rows: SitemapEntity[],
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"],
    priority: number,
  ) => {
    for (const row of rows) {
      if (!row.slug) continue;
      push(`${prefix}/${row.slug}`, {
        lastModified: row.updatedAt,
        changeFrequency,
        priority,
      });
    }
  };

  pushAll("/products", entities.products, "daily", 0.8);
  pushAll("/categories", entities.categories, "weekly", 0.7);
  pushAll("/collections", entities.collections, "weekly", 0.7);
  pushAll("/brands", entities.brands, "weekly", 0.6);
  pushAll("/blog", entities.posts, "weekly", 0.6);
  if (multiVendor) {
    pushAll("/vendors", entities.vendors, "weekly", 0.6);
  }

  return entries;
}

/**
 * Settings, or null when they cannot be read. A sitemap that lists only the
 * hub pages is a worse sitemap; a sitemap route that throws takes the build
 * (or the request) with it.
 */
async function loadSettings() {
  try {
    return await getStorefrontSettings();
  } catch (error) {
    console.warn(
      "[sitemap] settings unavailable — emitting hub pages only, without content pages or the vendor directory",
      error,
    );
    return null;
  }
}

/**
 * The catalogue half of the sitemap, or empty lists when the database cannot
 * be reached. Same reasoning as `loadSettings`, and the warning keeps a
 * degraded file visible in build and runtime logs rather than silent.
 */
async function loadEntities(limit: number, multiVendor: boolean) {
  try {
    return await queryEntities(limit, multiVendor);
  } catch (error) {
    console.warn(
      "[sitemap] catalogue unavailable — emitting hub pages only, without product, category, collection, brand, blog or vendor URLs",
      error,
    );
    return {
      products: [] as SitemapEntity[],
      categories: [] as SitemapEntity[],
      collections: [] as SitemapEntity[],
      brands: [] as SitemapEntity[],
      posts: [] as SitemapEntity[],
      vendors: [] as SitemapEntity[],
    };
  }
}

/**
 * Every query reuses the same visibility filter its storefront page uses, so
 * the sitemap can never advertise a URL that 404s — a product hidden from the
 * online-store channel, an unapproved brand, a scheduled post.
 */
async function queryEntities(limit: number, multiVendor: boolean) {
  await connectDB();

  const productConstraint = await getStorefrontProductConstraint();
  const select = "slug updatedAt";
  const newestFirst = { updatedAt: -1 as const };

  const [products, categories, collections, brands, posts, vendors] =
    await Promise.all([
      Product.find({ ...productConstraint, status: PRODUCT_STATUS.ACTIVE })
        .select(select)
        .sort(newestFirst)
        .limit(limit)
        .lean<SitemapEntity[]>(),
      Category.find({ isActive: true })
        .select(select)
        .sort(newestFirst)
        .limit(limit)
        .lean<SitemapEntity[]>(),
      Collection.find({ status: "active" })
        .select(select)
        .sort(newestFirst)
        .limit(limit)
        .lean<SitemapEntity[]>(),
      Brand.find(STOREFRONT_BRAND_FILTER)
        .select(select)
        .sort(newestFirst)
        .limit(limit)
        .lean<SitemapEntity[]>(),
      BlogPost.find({ ...PUBLIC_BLOG_FILTER, ...publishedBlogDateCondition() })
        .select(select)
        .sort(newestFirst)
        .limit(limit)
        .lean<SitemapEntity[]>(),
      multiVendor
        ? Vendor.find({
            ...getExternalVendorFilter(),
            status: VENDOR_STATUS.APPROVED,
            storeActive: { $ne: false },
          })
            .select(select)
            .sort(newestFirst)
            .limit(limit)
            .lean<SitemapEntity[]>()
        : Promise.resolve([] as SitemapEntity[]),
    ]);

  return { products, categories, collections, brands, posts, vendors };
}
