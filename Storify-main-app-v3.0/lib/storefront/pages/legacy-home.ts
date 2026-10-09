import type { HomePageSettings } from "@/lib/site-config/home-page-config";
import type { SectionInstance } from "@/lib/storefront/sections/types";

/**
 * Translate legacy `settings.homePage` into section instances.
 *
 * Shared by the storefront's fallback path (an install whose migration has
 * not run keeps rendering its customized home) and by the migration script
 * (which persists exactly this output) — one mapping, so the two can never
 * drift. Deliberately pure and registry-free: tests and the CLI script load
 * it without dragging the component tree along.
 *
 * IDs are deterministic, not generated: the fallback path rebuilds this on
 * every cache refresh, and unstable ids would remount every section. After
 * migration these same ids become the persisted ones.
 */
export function homePageSettingsToSections(
  settings: HomePageSettings,
): SectionInstance[] {
  const s = settings.sections;

  const byLegacyId: Record<
    HomePageSettings["sectionOrder"][number],
    SectionInstance
  > = {
    hero: {
      id: "home-hero",
      type: "slideshow",
      version: 1,
      visible: s.hero.visible,
      settings: {},
      blocks: s.hero.slides.map((slide, index) => ({
        id: `home-hero-slide-${index + 1}`,
        type: "slide",
        visible: true,
        settings: { image: slide.imageSrc, alt: slide.alt, link: slide.href },
      })),
    },
    featuredCategories: {
      id: "home-featured-categories",
      type: "category-list",
      version: 1,
      visible: s.featuredCategories.visible,
      settings: {
        title: s.featuredCategories.title,
        source: s.featuredCategories.source,
        limit: s.featuredCategories.limit,
        categoryIds: s.featuredCategories.categoryIds,
      },
    },
    newArrivals: {
      id: "home-products-on-sale",
      type: "product-grid",
      version: 1,
      visible: s.newArrivals.visible,
      settings: {
        title: s.newArrivals.title,
        subtitle: s.newArrivals.subtitle,
        source: s.newArrivals.source,
        limit: s.newArrivals.limit,
        desktopColumns: s.newArrivals.desktopColumns,
        productIds: s.newArrivals.productIds,
      },
    },
    promotionsOffers: {
      id: "home-promotions",
      type: "promotion-grid",
      version: 1,
      visible: s.promotionsOffers.visible,
      settings: {},
      blocks: s.promotionsOffers.cards.map((card, index) => ({
        id: `home-promotions-card-${index + 1}`,
        type: "card",
        visible: true,
        settings: { image: card.imageSrc, link: card.href },
      })),
    },
    featuredProducts: {
      id: "home-featured-products",
      type: "product-browser",
      version: 1,
      visible: s.featuredProducts.visible,
      settings: {
        title: s.featuredProducts.title,
        source: s.featuredProducts.source,
        limit: s.featuredProducts.limit,
        productIds: s.featuredProducts.productIds,
      },
    },
    sponsoredProducts: {
      id: "home-sponsored-products",
      type: "sponsored-rail",
      version: 1,
      visible: s.sponsoredProducts.visible,
      settings: {
        limit: s.sponsoredProducts.limit,
      },
    },
    topVendors: {
      id: "home-top-vendors",
      type: "vendor-list",
      version: 1,
      visible: s.topVendors.visible,
      settings: { title: s.topVendors.title, limit: s.topVendors.limit },
    },
    becomeVendor: {
      id: "home-become-vendor",
      type: "become-vendor",
      version: 1,
      visible: s.becomeVendor.visible,
      settings: {
        image: s.becomeVendor.imageSrc,
        title: s.becomeVendor.title,
        subtitle: s.becomeVendor.subtitle,
        buttonLabel: s.becomeVendor.buttonLabel,
        buttonHref: s.becomeVendor.buttonHref,
      },
    },
    topArticles: {
      id: "home-top-articles",
      type: "blog-posts",
      version: 1,
      visible: s.topArticles.visible,
      settings: {
        title: s.topArticles.title,
        limit: s.topArticles.limit,
        desktopColumns: s.topArticles.desktopColumns,
      },
    },
    fromInstagram: {
      id: "home-instagram",
      type: "image-gallery",
      version: 1,
      visible: s.fromInstagram.visible,
      settings: { title: s.fromInstagram.title },
      blocks: s.fromInstagram.items.map((item, index) => ({
        id: `home-instagram-image-${index + 1}`,
        type: "image",
        visible: true,
        settings: { image: item.imageSrc, link: item.href },
      })),
    },
  };

  return settings.sectionOrder.map((legacyId) => byLegacyId[legacyId]);
}
