import type {
  CategoryTile,
  HomeBlock,
  HomeCta,
  Slide,
} from "@/contracts/mobile/shop/v1/home";
import { BENEFIT_ICONS } from "@/contracts/mobile/shop/v1/home";
import { getHomeSponsoredRail } from "@/lib/boosts/sponsored-placement";
import type { Currency } from "@/lib/intl/currencies";
import { sanitizeHtml } from "@/lib/sanitize";
import type { SliderSlide } from "@/lib/sliders/types";
import { normalizeBackground } from "@/lib/sliders/types";
import { loadBrandList } from "@/lib/storefront/section-data/brands";
import {
  loadCategoryMosaic,
  readFeaturedCategories,
  type MosaicSource,
} from "@/lib/storefront/section-data/categories";
import {
  loadCollectionRows,
  type CollectionRowEntry,
} from "@/lib/storefront/section-data/collection-shelf";
import { readTestimonials, readTopArticles } from "@/lib/storefront/section-data/content";
import { countdownDeadline, loadDeals } from "@/lib/storefront/section-data/countdown-offer";
import { loadCouponBanner } from "@/lib/storefront/section-data/coupon-banner";
import type { HomeCopy } from "@/lib/storefront/section-data/home-copy";
import { loadProductGroupTabs } from "@/lib/storefront/section-data/product-group";
import {
  loadProductBrowser,
  loadProductShelf,
} from "@/lib/storefront/section-data/product-shelves";
import { loadPromotionBannerSlides } from "@/lib/storefront/section-data/promotion-banner";
import { resolveGridCells } from "@/lib/storefront/section-data/slider-cells";
import { readTopVendors } from "@/lib/storefront/section-data/top-vendors";
import { buildRenderSlides } from "@/lib/sliders/render";
import { composeCollectionShelf } from "@/lib/storefront/sections/collection-shelf";
import { getDealLayout } from "@/lib/storefront/sections/deal-layouts";
import type { DrawnSection } from "@/lib/storefront/sections/drawn";
import { pickedLookIds } from "@/lib/storefront/sections/definitions/looks-list";
import { lt } from "@/lib/storefront/sections/localized";
import { lookShape } from "@/lib/storefront/sections/looks-shapes";
import type { ProductGroupSource } from "@/lib/storefront/sections/product-group-query";
import { getSliderGrid, readGridCells } from "@/lib/storefront/sections/slider-grids";
import type { LocalizedText } from "@/lib/storefront/sections/types";
import { getStorefrontCollections } from "@/lib/storefront/storefront-collections";
import { readStorefrontLook, readStorefrontLooks } from "@/lib/storefront/storefront-looks";
import type {
  FeaturedCategoriesSource,
  FeaturedProductsSource,
  NewArrivalsSource,
  ProductBrowserLayout,
} from "@/lib/site-config/home-page-config";
import { toProductCard, type CatalogContext } from "../catalog/product-card";
import { toCollectionSummary } from "../catalog/summaries";
import { imageSet } from "../images";
import { nextPageCursor } from "../page-cursor";
import {
  appHref,
  phoneShape,
  pictureSlide,
  toMediaRows,
  toPaint,
  toSlide,
} from "./slides";

/**
 * One block of GET /home per section of the web's home page, read through
 * the same loaders the web's components use (lib/storefront/section-data), in
 * "strict" mode: a failed read fails the answer instead of being cached as an
 * empty section. A section with nothing to show is left out, as the web's
 * draws nothing for it.
 */

type HomeBlockContext = {
  locale: string;
  defaultLanguage: string;
  catalog: CatalogContext;
  currency: Pick<Currency, "code" | "locale">;
  copy: HomeCopy;
};

type BlockMapper = (section: DrawnSection, ctx: HomeBlockContext) => Promise<HomeBlock | null>;

const STRICT = "strict" as const;

function settingsOf(section: DrawnSection) {
  return section.instance.settings;
}

function blocksOf(section: DrawnSection) {
  return (section.instance.blocks ?? []).filter((block) => block.visible);
}

/** A translatable setting in the path's language; empty becomes undefined. */
function textOf(value: unknown, ctx: HomeBlockContext): string | undefined {
  const resolved = lt(value as LocalizedText, ctx.locale, ctx.defaultLanguage).trim();
  return resolved || undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function cta(label: string | undefined, link: unknown): HomeCta | undefined {
  if (!label) return undefined;
  const href = appHref(str(link));
  return { label, ...(href ? { href } : {}) };
}

function optional<K extends string, V>(key: K, value: V | undefined) {
  return (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;
}

const slideshow: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const grid = getSliderGrid(settings.grid);
  const cells = await resolveGridCells(
    readGridCells(grid, section.instance.blocks ?? []),
    ctx.locale,
    STRICT,
  );
  if (!grid.category && !cells.some(Boolean)) return null;
  const rows = toMediaRows(section.instance.id, grid, cells, ctx.currency);
  const [stage] = rows[0]?.columns[0] ?? [];
  if (!stage) return null;
  const single = rows.length === 1 && rows[0].columns.length === 1 && rows[0].columns[0].length === 1;
  return {
    type: "SLIDESHOW",
    id: section.instance.id,
    aspectRatio: stage.aspectRatio ?? 16 / 10,
    slides: stage.slides,
    ...optional("autoplaySeconds", stage.autoplaySeconds),
    ...(single ? {} : { rows }),
    showsCategories: Boolean(grid.category),
  };
};

const promotionGrid: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const grid = getSliderGrid(settings.grid);
  const cells = await resolveGridCells(
    readGridCells(grid, section.instance.blocks ?? []),
    ctx.locale,
    STRICT,
  );
  if (!cells.some(Boolean)) return null;
  return {
    type: "PROMOTION_GRID",
    id: section.instance.id,
    rows: toMediaRows(section.instance.id, grid, cells, ctx.currency),
  };
};

/** The promotion banner's frame on a phone (`aspect-[16/7]`). */
const BANNER_RATIO = 16 / 7;

const promotionBanner: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const stored = (settings.slides as SliderSlide[]) ?? [];
  let slide: Slide | null;
  if (stored.length > 0) {
    const [first] = await loadPromotionBannerSlides(stored, ctx.locale, STRICT);
    slide = first ? toSlide(first, phoneShape(BANNER_RATIO), ctx.currency) : null;
  } else {
    // A banner saved before the slides model: one picture with its copy over it.
    const picture = pictureSlide(section.instance.id, {
      src: str(settings.image),
      link: str(settings.link),
    });
    const heading = textOf(settings.heading, ctx);
    const description = textOf(settings.subheading, ctx);
    const button = cta(textOf(settings.ctaLabel, ctx), settings.link);
    slide =
      picture || heading
        ? {
            ...(picture ?? { id: section.instance.id, imageFit: "COVER" as const }),
            ...optional("heading", heading),
            ...optional("description", description),
            ...optional("cta", button),
          }
        : null;
  }
  if (!slide) return null;
  const { id: _slideId, ...content } = slide;
  return { ...content, type: "BANNER", id: section.instance.id, aspectRatio: BANNER_RATIO };
};

function toTile(category: { id: string; slug: string; name: string; image?: string }): CategoryTile {
  const image = imageSet(category.image, category.name);
  return { id: category.id, slug: category.slug, name: category.name, ...(image ? { image } : {}) };
}

const CATEGORY_LIST_LAYOUT = { cards: "CARDS", circles: "CIRCLES", overlay: "OVERLAY" } as const;

const categoryList: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const categories = await readFeaturedCategories(
    settings.source as FeaturedCategoriesSource,
    settings.limit as number,
    ids(settings.categoryIds),
  );
  if (categories.length === 0) return null;
  return {
    type: "CATEGORY_LIST",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    categories: categories.map(toTile),
    layout:
      CATEGORY_LIST_LAYOUT[section.variant?.key as keyof typeof CATEGORY_LIST_LAYOUT] ?? "CARDS",
  };
};

const categoryMosaic: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const categories = await loadCategoryMosaic(
    {
      source: settings.source as MosaicSource,
      limit: settings.limit as number,
      categoryIds: ids(settings.categoryIds),
    },
    STRICT,
  );
  if (categories.length === 0) return null;
  return {
    type: "CATEGORY_MOSAIC",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    categories: categories.map((category) =>
      toTile({ id: category._id, slug: category.slug, name: category.name, image: category.image }),
    ),
  };
};

/**
 * A shelf's picked category, brand and collection, as the web's sections pass
 * them; the shared resolver reads only the one its source names.
 */
function sourcePicks(settings: Record<string, unknown>) {
  return {
    categoryId: str(settings.categoryId),
    brandId: str(settings.brandId),
    collectionId: str(settings.collectionId),
  };
}

const productGrid: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const shelf = await loadProductShelf({
    source: settings.source as NewArrivalsSource,
    limit: settings.limit as number,
    productIds: ids(settings.productIds),
    ...sourcePicks(settings),
  });
  if (shelf.products.length === 0) return null;
  return {
    type: "PRODUCT_RAIL",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    ...optional("subtitle", textOf(settings.subtitle, ctx)),
    products: shelf.products.map((product) => toProductCard(product, ctx.catalog)),
    href: shelf.href,
  };
};

const productBrowser: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const data = await loadProductBrowser({
    source: settings.source as FeaturedProductsSource,
    layout: settings.layout as ProductBrowserLayout,
    rows: settings.rows as number,
    desktopColumns: settings.desktopColumns as number,
    productIds: ids(settings.productIds),
    endless: settings.endless === true,
    ...sourcePicks(settings),
  });
  if (!data || data.products.length === 0) return null;
  // A picked category, brand or collection is a fixed grid with no `browse`
  // (loadProductBrowser never answers the browser for it): an installed app
  // pages GET /products with the catalogue's own query, so a continuation
  // would turn the shelf into the whole catalogue. Its own page is where
  // "See all" leads instead.
  const href = data.kind !== "browser" ? data.href : undefined;
  return {
    type: "PRODUCT_GRID",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    products: data.products.map((product) => toProductCard(product, ctx.catalog)),
    ...(data.kind === "browser"
      ? {
          browse: {
            categories: data.categories,
            pageSize: data.pageSize,
            nextCursor:
              data.hasNext &&
              (data.maxProducts === undefined || data.products.length < data.maxProducts)
                ? nextPageCursor(1, 2)
                : null,
            ...optional("maxProducts", data.maxProducts),
          },
        }
      : {}),
    ...optional("href", href),
  };
};

const productGroup: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const { tabs } = await loadProductGroupTabs({
    limit: settings.limit as number,
    tabs: blocksOf(section).map((block) => ({
      id: block.id,
      label: lt(block.settings.label as LocalizedText, ctx.locale, ctx.defaultLanguage),
      source: block.settings.source as ProductGroupSource,
      productIds: ids(block.settings.productIds),
      ...sourcePicks(block.settings),
    })),
  });
  if (tabs.length === 0) return null;
  return {
    type: "PRODUCT_TABS",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    tabs: tabs.map(({ tab, products, href }) => ({
      id: tab.id,
      label: tab.label,
      products: products.map((product) => toProductCard(product, ctx.catalog)),
      ...optional("href", href),
    })),
  };
};

const sponsoredRail: BlockMapper = async (section, ctx) => {
  const rail = await getHomeSponsoredRail({ limit: settingsOf(section).limit as number });
  // Drawn only while it holds a paid card: a row of organic cards under
  // "Sponsored" would be a false disclosure.
  if (!rail.live || !rail.sold) return null;
  return {
    type: "SPONSORED_RAIL",
    id: section.instance.id,
    title: ctx.copy.sponsored,
    products: rail.lane.map((product) => toProductCard(product, ctx.catalog)),
  };
};

/** The collection panel's frame on a phone: full width, 18rem tall. */
const COLLECTION_PANEL_RATIO = 358 / 288;

function readCollectionRow(settings: Record<string, unknown>): CollectionRowEntry {
  return {
    collection: str(settings.collection),
    limit: typeof settings.limit === "number" && Number.isFinite(settings.limit) ? settings.limit : 4,
    products: Array.isArray(settings.products)
      ? settings.products.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [],
    kind: settings.kind === "slider" ? "slider" : "image",
    image: str(settings.image),
    slider: str(settings.slider),
  };
}

const featuredCollection: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const { rows, sliders, products } = await loadCollectionRows(
    blocksOf(section).map((block) => readCollectionRow(block.settings)),
    STRICT,
  );
  if (rows.length === 0) return null;
  const shape = phoneShape(COLLECTION_PANEL_RATIO);
  return {
    type: "COLLECTION_ROWS",
    id: section.instance.id,
    ...optional("title", str(settings.title).trim() || undefined),
    rows: rows.map(({ row, shelf }, index) => {
      const id = `${section.instance.id}:${index}`;
      const href = `/collections/${shelf.slug}`;
      // The first product backstops the panel's artwork, and hand-placed
      // products take the first slots, as on the web.
      const { cards, lead } = composeCollectionShelf(shelf.products, shelf.picked, row.limit);
      const slider = row.kind === "slider" && row.slider ? sliders.get(row.slider) : undefined;
      let slides: Slide[];
      let autoplaySeconds: number | undefined;
      if (slider) {
        slides = buildRenderSlides(slider.slides, products, { locale: ctx.locale }).map((slide) =>
          toSlide(slide, shape, ctx.currency),
        );
        autoplaySeconds = slides.length > 1 && slider.autoplaySeconds > 0 ? slider.autoplaySeconds : undefined;
      } else {
        const picture =
          row.kind === "image" && row.image
            ? pictureSlide(`${id}-image`, { src: row.image, alt: shelf.title, link: href })
            : null;
        // No feature chosen: the collection promotes itself.
        const artwork = imageSet(lead?.images?.[0]);
        slides = [
          picture ?? {
            id: `${id}-promo`,
            href,
            imageFit: "COVER",
            heading: shelf.title,
            cta: { label: ctx.copy.shopNow, href },
            align: { horizontal: "CENTER", vertical: "START" },
            ...(artwork ? { artwork } : {}),
          },
        ];
      }
      return {
        id,
        collection: { slug: shelf.slug, title: shelf.title },
        href,
        panel: {
          aspectRatio: COLLECTION_PANEL_RATIO,
          slides,
          ...optional("autoplaySeconds", autoplaySeconds),
        },
        products: cards.map((product) => toProductCard(product, ctx.catalog)),
      };
    }),
  };
};

const collectionList: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const result = await getStorefrontCollections({ page: 1, limit: settings.limit as number });
  if (result.data.length === 0) return null;
  return {
    type: "COLLECTION_LIST",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    collections: result.data.map((collection) => toCollectionSummary(collection)),
  };
};

const brandList: BlockMapper = async (section) => {
  const brandIds = blocksOf(section)
    .map((block) => str(block.settings.brand))
    .filter(Boolean);
  const brands = await loadBrandList(brandIds, STRICT);
  if (brands.length === 0) return null;
  return {
    type: "BRAND_LIST",
    id: section.instance.id,
    layout: section.variant?.key === "strip" ? "STRIP" : "CARDS",
    brands: brands.map((brand) => {
      const logo = imageSet(brand.logo, brand.name);
      return {
        id: brand.id,
        slug: brand.slug,
        name: brand.name,
        ...(logo ? { logo } : {}),
        href: brand.href,
      };
    }),
  };
};

const vendorList: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const vendors = await readTopVendors(settings.limit as number);
  if (vendors.length === 0) return null;
  return {
    type: "VENDOR_LIST",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    vendors: vendors.map((vendor) => {
      const logo = imageSet(vendor.logo, vendor.storeName);
      const banner = imageSet(vendor.banner);
      return {
        id: vendor.id,
        slug: vendor.slug,
        name: vendor.storeName,
        ...optional("tagline", vendor.tagline || undefined),
        ...(logo ? { logo } : {}),
        ...(banner ? { banner } : {}),
        ...(vendor.reviewCount > 0
          ? { rating: { average: vendor.rating, count: vendor.reviewCount } }
          : {}),
        unitsSold: vendor.unitsSold,
        priceTier: vendor.priceTier,
      };
    }),
  };
};

const countdownOffer: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const deadline = countdownDeadline(settings.endsAt);
  // No deadline, or one already past: the web shows nothing either.
  if (deadline === null || deadline <= Date.now()) return null;
  const base = {
    type: "COUNTDOWN" as const,
    id: section.instance.id,
    endsAt: new Date(deadline).toISOString(),
    ...optional("heading", textOf(settings.heading, ctx)),
    ...optional("subheading", textOf(settings.subheading, ctx)),
    ...optional("cta", cta(textOf(settings.ctaLabel, ctx), settings.link)),
  };
  if (section.variant?.key !== "deals-panel") {
    const image = imageSet(str(settings.image));
    return { ...base, layout: "BANNER", ...(image ? { image } : {}), products: [] };
  }
  const layout = getDealLayout(settings.layout);
  const { products, topSaving } = await loadDeals(
    { productIds: ids(settings.productIds), slots: layout.slots },
    STRICT,
  );
  const background = normalizeBackground(settings.background);
  const paint = toPaint(background);
  const image = background.type === "image" || background.type === "video"
    ? imageSet(background.image)
    : undefined;
  const foreground = str(settings.foreground);
  return {
    ...base,
    layout: "DEALS",
    ...(image ? { image } : {}),
    ...(paint ? { background: paint } : {}),
    ...(foreground ? { textColor: foreground } : {}),
    products: products.map((product) => toProductCard(product, ctx.catalog)),
    ...(settings.showSavings !== false && topSaving > 0
      ? { savingsLabel: ctx.copy.dealsUpTo(topSaving) }
      : {}),
  };
};

const couponBanner: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const banner = await loadCouponBanner(
    {
      code: str(settings.code),
      offer: lt(settings.offer as LocalizedText, ctx.locale, ctx.defaultLanguage),
      condition: lt(settings.condition as LocalizedText, ctx.locale, ctx.defaultLanguage),
      showExpiry: settings.showExpiry !== false,
      locale: ctx.locale,
    },
    STRICT,
  );
  if (banner.kind !== "live") return null;
  const background = normalizeBackground(settings.background);
  const image =
    background.type === "image" || background.type === "video" ? imageSet(background.image) : undefined;
  // Copy on the strip is white: a picture behind it gets the web's 60% scrim.
  const paint = toPaint(
    background.type === "image" ? { ...background, overlay: background.overlay || 60 } : background,
  );
  return {
    type: "COUPON",
    id: section.instance.id,
    code: banner.code,
    offer: banner.offer,
    ...optional("condition", banner.condition || undefined),
    ...optional("endsOn", banner.endsOn || undefined),
    ...optional("endsAt", banner.endsAt),
    ...optional("cta", cta(textOf(settings.ctaLabel, ctx), settings.link)),
    ...(image ? { image } : {}),
    ...(paint ? { background: paint } : {}),
  };
};

const getTheLook: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const collectionId = str(settings.collection);
  const limit = settings.limit as number;
  const look = collectionId ? await readStorefrontLook(collectionId, limit) : null;
  if (!look) return null;
  const image = imageSet(str(settings.image) || look.image, look.title);
  if (!image) return null;
  return {
    type: "LOOK",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    ...optional("subtitle", textOf(settings.subtitle, ctx)),
    look: { slug: look.slug, title: look.title },
    image,
    imagePosition: settings.imagePosition === "right" ? "END" : "START",
    products: look.products.slice(0, limit).map((product) => toProductCard(product, ctx.catalog)),
    ...optional("ctaLabel", textOf(settings.ctaLabel, ctx)),
  };
};

const looksList: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const picked = pickedLookIds(settings, section.instance.blocks ?? []);
  const looks =
    picked && picked.length === 0
      ? []
      : await readStorefrontLooks({ limit: settings.limit as number, ids: picked });
  const items = looks.flatMap((look) => {
    const image = imageSet(look.image, look.title);
    return image ? [{ id: look.id, slug: look.slug, title: look.title, image }] : [];
  });
  if (items.length === 0) return null;
  const [width, height] = lookShape(settings.shape);
  return {
    type: "LOOK_LIST",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    aspectRatio: width / height,
    looks: items,
  };
};

const richText: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const heading = textOf(settings.heading, ctx);
  const html = sanitizeHtml(lt(settings.body as LocalizedText, ctx.locale, ctx.defaultLanguage));
  if (!heading && !html) return null;
  return { type: "RICH_TEXT", id: section.instance.id, ...optional("heading", heading), html };
};

const imageText: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const image = imageSet(str(settings.image));
  const heading = textOf(settings.heading, ctx);
  const html = sanitizeHtml(lt(settings.body as LocalizedText, ctx.locale, ctx.defaultLanguage));
  const button = cta(textOf(settings.ctaLabel, ctx), settings.link);
  if (!image && !heading && !html && !button) return null;
  return {
    type: "IMAGE_TEXT",
    id: section.instance.id,
    ...(image ? { image } : {}),
    imagePosition: settings.imagePosition === "right" ? "END" : "START",
    ...optional("heading", heading),
    ...optional("html", html || undefined),
    ...optional("cta", button),
  };
};

const HEADING_ALIGN = { left: "START", center: "CENTER", right: "END" } as const;
const HEADING_SIZE = { small: "SMALL", medium: "MEDIUM", large: "LARGE" } as const;

const heading: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const title = textOf(settings.title, ctx);
  const accent = textOf(settings.accent, ctx);
  if (!title && !accent) return null;
  return {
    type: "HEADING",
    id: section.instance.id,
    title: title ?? "",
    ...optional("accent", accent),
    align: HEADING_ALIGN[settings.align as keyof typeof HEADING_ALIGN] ?? "START",
    size: HEADING_SIZE[settings.size as keyof typeof HEADING_SIZE] ?? "MEDIUM",
  };
};

/** A phone takes 60% of a gap's height, as the web's does. */
const gap: BlockMapper = async (section) => ({
  type: "SPACER",
  id: section.instance.id,
  height: Math.round((Number(settingsOf(section).height) || 0) * 0.6),
});

const imageGallery: BlockMapper = async (section, ctx) => {
  const images = blocksOf(section).flatMap((block) => {
    const image = imageSet(str(block.settings.image));
    const href = appHref(str(block.settings.link));
    return image ? [{ id: block.id, image, ...(href ? { href } : {}) }] : [];
  });
  if (images.length === 0) return null;
  return {
    type: "IMAGE_GALLERY",
    id: section.instance.id,
    ...optional("title", textOf(settingsOf(section).title, ctx)),
    images,
  };
};

function isoTime(value: string): string | undefined {
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const blogPosts: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const articles = await readTopArticles(settings.limit as number);
  if (articles.length === 0) return null;
  return {
    type: "ARTICLE_LIST",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    articles: articles.map((article) => {
      const image = imageSet(article.image, article.imageAlt);
      return {
        id: article._id,
        slug: article.slug,
        title: article.title,
        ...optional("excerpt", article.excerpt || undefined),
        ...(image ? { image } : {}),
        authorName: article.authorName,
        ...optional("publishedAt", isoTime(article.publishedAt)),
        href: `/blog/${article.slug}`,
      };
    }),
  };
};

const testimonials: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const entries = await readTestimonials(settings.minRating as number, settings.limit as number);
  if (entries.length === 0) return null;
  return {
    type: "TESTIMONIALS",
    id: section.instance.id,
    ...optional("title", textOf(settings.title, ctx)),
    testimonials: entries.map((entry) => ({
      id: entry.id,
      rating: entry.rating,
      ...optional("title", entry.title || undefined),
      comment: entry.comment,
      ...optional("reviewerName", entry.reviewerName),
    })),
  };
};

const serviceBenefits: BlockMapper = async (section, ctx) => {
  const items = blocksOf(section).flatMap((block) => {
    const title = textOf(block.settings.title, ctx);
    const text = textOf(block.settings.text, ctx);
    if (!title && !text) return [];
    const icon = str(block.settings.icon).toUpperCase();
    return [
      {
        id: block.id,
        // The web draws a truck for an icon it does not know.
        icon: (BENEFIT_ICONS as readonly string[]).includes(icon)
          ? (icon as (typeof BENEFIT_ICONS)[number])
          : "TRUCK",
        title: title ?? "",
        ...optional("text", text),
      },
    ];
  });
  if (items.length === 0) return null;
  return { type: "BENEFITS", id: section.instance.id, items };
};

const faq: BlockMapper = async (section, ctx) => {
  const items = blocksOf(section).flatMap((block) => {
    const question = textOf(block.settings.question, ctx);
    const answer = textOf(block.settings.answer, ctx);
    return question && answer ? [{ id: block.id, question, answer }] : [];
  });
  if (items.length === 0) return null;
  return {
    type: "FAQ",
    id: section.instance.id,
    ...optional("title", textOf(settingsOf(section).title, ctx)),
    items,
  };
};

const becomeVendor: BlockMapper = async (section, ctx) => {
  const settings = settingsOf(section);
  const title = textOf(settings.title, ctx);
  const label = textOf(settings.buttonLabel, ctx);
  if (!title || !label) return null;
  const image = imageSet(str(settings.image));
  return {
    type: "SELLER_INVITE",
    id: section.instance.id,
    title,
    ...optional("subtitle", textOf(settings.subtitle, ctx)),
    ...(image ? { image } : {}),
    cta: { label, href: appHref(str(settings.buttonHref)) ?? "/become-vendor" },
  };
};

/**
 * Section type → its block. A section type missing here is not sent (the
 * home page can only hold the types below; tests/mobile-api/home.test.ts
 * fails when the registry offers the home page one this table lacks).
 */
export const HOME_BLOCK_MAPPERS: Record<string, BlockMapper> = {
  slideshow,
  "promotion-grid": promotionGrid,
  "promotion-banner": promotionBanner,
  "category-list": categoryList,
  "category-mosaic": categoryMosaic,
  "product-grid": productGrid,
  "product-browser": productBrowser,
  "product-group": productGroup,
  "sponsored-rail": sponsoredRail,
  "featured-collection": featuredCollection,
  "collection-list": collectionList,
  "brand-list": brandList,
  "vendor-list": vendorList,
  "countdown-offer": countdownOffer,
  "coupon-banner": couponBanner,
  "get-the-look": getTheLook,
  "looks-list": looksList,
  "rich-text": richText,
  "image-text": imageText,
  heading,
  gap,
  "image-gallery": imageGallery,
  "blog-posts": blogPosts,
  testimonials,
  "service-benefits": serviceBenefits,
  faq,
  "become-vendor": becomeVendor,
};
