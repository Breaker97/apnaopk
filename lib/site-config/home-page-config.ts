const HOME_SECTION_IDS = [
  "hero",
  "featuredCategories",
  "newArrivals",
  "promotionsOffers",
  "featuredProducts",
  "sponsoredProducts",
  "topVendors",
  "becomeVendor",
  "topArticles",
  "fromInstagram",
] as const;

type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

/**
 * Product-selection logic for the "Products on Sale" (newArrivals) section.
 * - discounted: products whose comparePrice > price (or any variant on sale)
 * - featured:   products flagged as featured
 * - latest:     newest products by creation date
 * - manual:     a hand-picked, ordered list of product IDs
 */
export const NEW_ARRIVALS_SOURCES = [
  "discounted",
  "featured",
  "latest",
  "manual",
] as const;

export type NewArrivalsSource = (typeof NEW_ARRIVALS_SOURCES)[number];

export const NEW_ARRIVALS_LIMIT_MIN = 4;
export const NEW_ARRIVALS_LIMIT_MAX = 20;
export const NEW_ARRIVALS_COLUMNS_MIN = 2;
export const NEW_ARRIVALS_COLUMNS_MAX = 6;

/**
 * Category-selection logic for the "Featured Categories" section.
 * - featured: categories flagged as Featured (falls back to top-level when none)
 * - topLevel: every top-level (parent) category
 * - manual:   a hand-picked, ordered list of category IDs
 */
export const FEATURED_CATEGORIES_SOURCES = [
  "featured",
  "topLevel",
  "manual",
] as const;

export type FeaturedCategoriesSource =
  (typeof FEATURED_CATEGORIES_SOURCES)[number];

export const FEATURED_CATEGORIES_LIMIT_MIN = 4;
export const FEATURED_CATEGORIES_LIMIT_MAX = 20;

/**
 * Product-selection logic for the "Featured Products" section.
 * - all:        browse every active product with infinite (lazy) scrolling
 * - featured:   products flagged as featured
 * - latest:     newest products by creation date
 * - discounted: products whose comparePrice > price (or any variant on sale)
 * - manual:     a hand-picked, ordered list of product IDs
 */
export const FEATURED_PRODUCTS_SOURCES = [
  "all",
  "featured",
  "latest",
  "discounted",
  "manual",
] as const;

export type FeaturedProductsSource = (typeof FEATURED_PRODUCTS_SOURCES)[number];

/**
 * The catalogue browser sizes itself in ROWS, not in a raw product count:
 * a count that is not a multiple of the column count leaves a ragged last
 * row, which reads as a loading bug rather than a choice.
 */
export const PRODUCT_BROWSER_ROWS_MIN = 1;
export const PRODUCT_BROWSER_ROWS_MAX = 4;
export const PRODUCT_BROWSER_LAYOUTS = ["browser", "plain"] as const;
export type ProductBrowserLayout = (typeof PRODUCT_BROWSER_LAYOUTS)[number];

const FEATURED_PRODUCTS_LIMIT_MIN = 4;
export const FEATURED_PRODUCTS_LIMIT_MAX = 24;

export const SPONSORED_PRODUCTS_LIMIT_MIN = 4;
export const SPONSORED_PRODUCTS_LIMIT_MAX = 12;

export const TOP_ARTICLES_COLUMNS_MIN = 2;
export const TOP_ARTICLES_COLUMNS_MAX = 4;

interface HomeHeroSlideContent {
  imageSrc: string;
  alt: string;
  href: string;
}

export interface HomeFromInstagramItem {
  imageSrc: string;
  href: string;
}

export interface HomePageSettings {
  sectionOrder: HomeSectionId[];
  sections: {
    hero: {
      visible: boolean;
      slides: HomeHeroSlideContent[];
    };
    featuredCategories: {
      visible: boolean;
      title: string;
      source: FeaturedCategoriesSource;
      limit: number;
      categoryIds: string[];
    };
    newArrivals: {
      visible: boolean;
      title: string;
      subtitle: string;
      source: NewArrivalsSource;
      limit: number;
      desktopColumns: number;
      productIds: string[];
    };
    promotionsOffers: {
      visible: boolean;
      cards: {
        imageSrc: string;
        href: string;
      }[];
    };
    topVendors: {
      visible: boolean;
      title: string;
      limit: number;
    };
    featuredProducts: {
      visible: boolean;
      title: string;
      source: FeaturedProductsSource;
      limit: number;
      productIds: string[];
    };
    /** Paid boost placements. Content comes from live campaigns, never from
     * merchant picks — only visibility and slot count are editable; the
     * heading is fixed to the localized "Sponsored". The section renders
     * nothing while boosting is disabled. */
    sponsoredProducts: {
      visible: boolean;
      limit: number;
    };
    topArticles: {
      visible: boolean;
      title: string;
      limit: number;
      desktopColumns: number;
    };
    becomeVendor: {
      visible: boolean;
      imageSrc: string;
      title: string;
      subtitle: string;
      buttonLabel: string;
      buttonHref: string;
    };
    fromInstagram: {
      visible: boolean;
      title: string;
      items: HomeFromInstagramItem[];
    };
  };
}

const DEFAULT_HOME_PAGE_SETTINGS: HomePageSettings = {
  sectionOrder: [
    "hero",
    "featuredCategories",
    "newArrivals",
    "promotionsOffers",
    "featuredProducts",
    // Vendors pay for this placement, so it sits with the other product rows
    // rather than wherever normalizeSectionOrder happens to append it. An id
    // missing from this list is pushed to the END, which put the only paid
    // section below the Instagram strip on every install.
    "sponsoredProducts",
    "topVendors",
    "becomeVendor",
    "topArticles",
    "fromInstagram",
  ],
  sections: {
    hero: {
      visible: true,
      slides: [
        { imageSrc: "", alt: "", href: "" },
      ],
    },
    featuredCategories: {
      visible: true,
      title: "Featured Categories",
      source: "featured",
      limit: 8,
      categoryIds: [],
    },
    newArrivals: {
      visible: true,
      title: "Products on Sale",
      subtitle: "",
      source: "discounted",
      limit: 8,
      desktopColumns: 4,
      productIds: [],
    },
    promotionsOffers: {
      visible: true,
      cards: [
        { imageSrc: "", href: "/products" },
        { imageSrc: "", href: "/products" },
        { imageSrc: "", href: "/products" },
        { imageSrc: "", href: "/products" },
        { imageSrc: "", href: "/products" },
      ],
    },
    topVendors: {
      visible: true,
      title: "Top Vendors",
      limit: 8,
    },
    featuredProducts: {
      visible: true,
      title: "",
      source: "all",
      limit: 8,
      productIds: [],
    },
    sponsoredProducts: {
      visible: true,
      limit: 8,
    },
    topArticles: {
      visible: true,
      title: "Top Articles",
      limit: 9,
      desktopColumns: 4,
    },
    becomeVendor: {
      visible: true,
      imageSrc: "",
      title: "Start Selling With Us Today",
      subtitle:
        "Join our marketplace, manage products easily, accept secure payments, and grow your business faster.",
      buttonLabel: "Become a Vendor",
      buttonHref: "/become-vendor",
    },
    fromInstagram: {
      visible: true,
      title: "From Instagram",
      items: [
        { imageSrc: "", href: "" },
        { imageSrc: "", href: "" },
        { imageSrc: "", href: "" },
        { imageSrc: "", href: "" },
        { imageSrc: "", href: "" },
      ],
    },
  },
};

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNewArrivalsSource(value: unknown): NewArrivalsSource {
  return typeof value === "string" &&
    NEW_ARRIVALS_SOURCES.includes(value as NewArrivalsSource)
    ? (value as NewArrivalsSource)
    : DEFAULT_HOME_PAGE_SETTINGS.sections.newArrivals.source;
}

function normalizeFeaturedCategoriesSource(
  value: unknown,
): FeaturedCategoriesSource {
  return typeof value === "string" &&
    FEATURED_CATEGORIES_SOURCES.includes(value as FeaturedCategoriesSource)
    ? (value as FeaturedCategoriesSource)
    : DEFAULT_HOME_PAGE_SETTINGS.sections.featuredCategories.source;
}

function normalizeFeaturedProductsSource(value: unknown): FeaturedProductsSource {
  return typeof value === "string" &&
    FEATURED_PRODUCTS_SOURCES.includes(value as FeaturedProductsSource)
    ? (value as FeaturedProductsSource)
    : DEFAULT_HOME_PAGE_SETTINGS.sections.featuredProducts.source;
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeProductIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return Array.from(new Set(ids));
}

function normalizeHeroSlides(value: unknown): HomeHeroSlideContent[] {
  if (!Array.isArray(value)) {
    return DEFAULT_HOME_PAGE_SETTINGS.sections.hero.slides.map((s) => ({ ...s }));
  }

  const slides = value
    .map((candidate) => {
      const slide =
        typeof candidate === "object" && candidate !== null
          ? (candidate as Partial<HomeHeroSlideContent>)
          : {};
      return {
        imageSrc: normalizeString(slide.imageSrc, ""),
        alt: normalizeString(slide.alt, ""),
        href: normalizeString(slide.href, ""),
      };
    });

  return slides.length > 0
    ? slides
    : DEFAULT_HOME_PAGE_SETTINGS.sections.hero.slides.map((s) => ({ ...s }));
}

function normalizePromotionsOffersCards(
  value: unknown,
): HomePageSettings["sections"]["promotionsOffers"]["cards"] {
  const source = Array.isArray(value) ? value : [];

  return DEFAULT_HOME_PAGE_SETTINGS.sections.promotionsOffers.cards.map(
    (fallbackCard, index) => {
      const candidate = source[index];
      const card =
        typeof candidate === "object" && candidate !== null
          ? (candidate as Partial<
              HomePageSettings["sections"]["promotionsOffers"]["cards"][number]
            >)
          : {};

      return {
        imageSrc: normalizeString(card.imageSrc, fallbackCard.imageSrc),
        href: normalizeString(card.href, fallbackCard.href),
      };
    },
  );
}

function normalizeFromInstagramItems(value: unknown): HomeFromInstagramItem[] {
  const source = Array.isArray(value) ? value : [];

  if (source.length === 0) {
    return DEFAULT_HOME_PAGE_SETTINGS.sections.fromInstagram.items.map((item) => ({
      ...item,
    }));
  }

  return source.map((candidate) => {
    const item =
      typeof candidate === "object" && candidate !== null
        ? (candidate as Partial<HomeFromInstagramItem>)
        : {};
    return {
      imageSrc: normalizeString(item.imageSrc, ""),
      href: normalizeString(item.href, ""),
    };
  });
}

function normalizeSectionOrder(value: unknown): HomeSectionId[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_HOME_PAGE_SETTINGS.sectionOrder];
  }

  const cleaned = value.filter(
    (item): item is HomeSectionId =>
      typeof item === "string" && HOME_SECTION_IDS.includes(item as HomeSectionId),
  );

  const deduped = Array.from(new Set(cleaned));

  // Slot a section the stored order predates into its CANONICAL position
  // (right after the nearest preceding section that is already present) rather
  // than appending it. Appending sent every newly-shipped section to the very
  // bottom of the page on upgraded installs — which put the one placement
  // vendors pay for below the Instagram strip, while fresh installs got it in
  // the intended spot. The admin can still reorder it afterwards.
  HOME_SECTION_IDS.forEach((sectionId, canonicalIndex) => {
    if (deduped.includes(sectionId)) return;
    let insertAt = 0;
    for (let i = canonicalIndex - 1; i >= 0; i -= 1) {
      const precedingIndex = deduped.indexOf(HOME_SECTION_IDS[i]);
      if (precedingIndex !== -1) {
        insertAt = precedingIndex + 1;
        break;
      }
    }
    deduped.splice(insertAt, 0, sectionId);
  });

  return deduped;
}

export function getDefaultHomePageSettings(): HomePageSettings {
  return JSON.parse(JSON.stringify(DEFAULT_HOME_PAGE_SETTINGS)) as HomePageSettings;
}

export function normalizeHomePageSettings(value: unknown): HomePageSettings {
  const source =
    typeof value === "object" && value !== null
      ? (value as Partial<HomePageSettings>)
      : {};

  const sourceSections =
    source.sections && typeof source.sections === "object"
      ? source.sections
      : undefined;

  const hero = sourceSections?.hero;
  const featuredCategories = sourceSections?.featuredCategories;
  const newArrivals = sourceSections?.newArrivals;
  const promotionsOffers = sourceSections?.promotionsOffers;
  const topVendors = sourceSections?.topVendors;
  const featuredProducts = sourceSections?.featuredProducts;
  const sponsoredProducts = sourceSections?.sponsoredProducts;
  const topArticles = sourceSections?.topArticles;
  const becomeVendor = sourceSections?.becomeVendor;
  const fromInstagram = sourceSections?.fromInstagram;

  return {
    sectionOrder: normalizeSectionOrder(source.sectionOrder),
    sections: {
      hero: {
        visible: normalizeBoolean(
          hero?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.hero.visible,
        ),
        slides: normalizeHeroSlides(hero?.slides),
      },
      featuredCategories: {
        visible: normalizeBoolean(
          featuredCategories?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.featuredCategories.visible,
        ),
        title: normalizeString(
          featuredCategories?.title,
          DEFAULT_HOME_PAGE_SETTINGS.sections.featuredCategories.title,
        ),
        source: normalizeFeaturedCategoriesSource(featuredCategories?.source),
        limit: normalizeLimit(
          featuredCategories?.limit,
          DEFAULT_HOME_PAGE_SETTINGS.sections.featuredCategories.limit,
          FEATURED_CATEGORIES_LIMIT_MIN,
          FEATURED_CATEGORIES_LIMIT_MAX,
        ),
        categoryIds: normalizeProductIds(featuredCategories?.categoryIds),
      },
      newArrivals: {
        visible: normalizeBoolean(
          newArrivals?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.newArrivals.visible,
        ),
        title: normalizeString(
          newArrivals?.title,
          DEFAULT_HOME_PAGE_SETTINGS.sections.newArrivals.title,
        ),
        subtitle: normalizeString(
          newArrivals?.subtitle,
          DEFAULT_HOME_PAGE_SETTINGS.sections.newArrivals.subtitle,
        ),
        source: normalizeNewArrivalsSource(newArrivals?.source),
        limit: normalizeLimit(
          newArrivals?.limit,
          DEFAULT_HOME_PAGE_SETTINGS.sections.newArrivals.limit,
          NEW_ARRIVALS_LIMIT_MIN,
          NEW_ARRIVALS_LIMIT_MAX,
        ),
        desktopColumns: normalizeLimit(
          newArrivals?.desktopColumns,
          DEFAULT_HOME_PAGE_SETTINGS.sections.newArrivals.desktopColumns,
          NEW_ARRIVALS_COLUMNS_MIN,
          NEW_ARRIVALS_COLUMNS_MAX,
        ),
        productIds: normalizeProductIds(newArrivals?.productIds),
      },
      promotionsOffers: {
        visible: normalizeBoolean(
          promotionsOffers?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.promotionsOffers.visible,
        ),
        cards: normalizePromotionsOffersCards(promotionsOffers?.cards),
      },
      topVendors: {
        visible: normalizeBoolean(
          topVendors?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.topVendors.visible,
        ),
        title: normalizeString(
          topVendors?.title,
          DEFAULT_HOME_PAGE_SETTINGS.sections.topVendors.title,
        ),
        limit: (() => {
          const value = topVendors?.limit;
          if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
            return DEFAULT_HOME_PAGE_SETTINGS.sections.topVendors.limit;
          }
          return Math.min(20, Math.floor(value));
        })(),
      },
      featuredProducts: {
        visible: normalizeBoolean(
          featuredProducts?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.featuredProducts.visible,
        ),
        title: normalizeString(
          featuredProducts?.title,
          DEFAULT_HOME_PAGE_SETTINGS.sections.featuredProducts.title,
        ),
        source: normalizeFeaturedProductsSource(featuredProducts?.source),
        limit: normalizeLimit(
          featuredProducts?.limit,
          DEFAULT_HOME_PAGE_SETTINGS.sections.featuredProducts.limit,
          FEATURED_PRODUCTS_LIMIT_MIN,
          FEATURED_PRODUCTS_LIMIT_MAX,
        ),
        productIds: normalizeProductIds(featuredProducts?.productIds),
      },
      sponsoredProducts: {
        visible: normalizeBoolean(
          sponsoredProducts?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.sponsoredProducts.visible,
        ),
        limit: normalizeLimit(
          sponsoredProducts?.limit,
          DEFAULT_HOME_PAGE_SETTINGS.sections.sponsoredProducts.limit,
          SPONSORED_PRODUCTS_LIMIT_MIN,
          SPONSORED_PRODUCTS_LIMIT_MAX,
        ),
      },
      topArticles: {
        visible: normalizeBoolean(
          topArticles?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.topArticles.visible,
        ),
        title: normalizeString(
          topArticles?.title,
          DEFAULT_HOME_PAGE_SETTINGS.sections.topArticles.title,
        ),
        limit: (() => {
          const value = topArticles?.limit;
          if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
            return DEFAULT_HOME_PAGE_SETTINGS.sections.topArticles.limit;
          }
          return Math.min(12, Math.floor(value));
        })(),
        desktopColumns: normalizeLimit(
          topArticles?.desktopColumns,
          DEFAULT_HOME_PAGE_SETTINGS.sections.topArticles.desktopColumns,
          TOP_ARTICLES_COLUMNS_MIN,
          TOP_ARTICLES_COLUMNS_MAX,
        ),
      },
      becomeVendor: {
        visible: normalizeBoolean(
          becomeVendor?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.becomeVendor.visible,
        ),
        imageSrc: normalizeString(
          becomeVendor?.imageSrc,
          DEFAULT_HOME_PAGE_SETTINGS.sections.becomeVendor.imageSrc,
        ),
        title: normalizeString(
          becomeVendor?.title,
          DEFAULT_HOME_PAGE_SETTINGS.sections.becomeVendor.title,
        ),
        subtitle: normalizeString(
          becomeVendor?.subtitle,
          DEFAULT_HOME_PAGE_SETTINGS.sections.becomeVendor.subtitle,
        ),
        buttonLabel: normalizeString(
          becomeVendor?.buttonLabel,
          DEFAULT_HOME_PAGE_SETTINGS.sections.becomeVendor.buttonLabel,
        ),
        buttonHref: normalizeString(
          becomeVendor?.buttonHref,
          DEFAULT_HOME_PAGE_SETTINGS.sections.becomeVendor.buttonHref,
        ),
      },
      fromInstagram: {
        visible: normalizeBoolean(
          fromInstagram?.visible,
          DEFAULT_HOME_PAGE_SETTINGS.sections.fromInstagram.visible,
        ),
        title: normalizeString(
          fromInstagram?.title,
          DEFAULT_HOME_PAGE_SETTINGS.sections.fromInstagram.title,
        ),
        items: normalizeFromInstagramItems(fromInstagram?.items),
      },
    },
  };
}
