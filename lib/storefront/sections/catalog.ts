import "server-only";

import { SECTION_REGISTRY } from "./registry";
import { VARIANT_FIELD_KEY } from "./types";
import type {
  SectionAvailabilityContext,
  SectionCatalogEntry,
  SectionStarter,
} from "./types";

/**
 * Picker copy, in registry order. English fallbacks only — the admin UI
 * looks up `admin.storeBuilder.sections.<type>.name|description` first and
 * falls back to these, the same convention the legacy builder used for its
 * section rows.
 */
const SECTION_COPY: Record<string, { name: string; description: string }> = {
  slideshow: {
    name: "Hero Slider",
    description: "A grid of saved sliders, images, and your category list",
  },
  "promotion-banner": {
    name: "Promotion Banner",
    description: "Banner slider designed in place — slides live in this section",
  },
  "promotion-grid": {
    name: "Promotion Grid",
    description: "Five-slot bento of promo cards",
  },
  "countdown-offer": {
    name: "Countdown Offer",
    description: "Deadline strip with a ticking timer",
  },
  "coupon-banner": {
    name: "Coupon Banner",
    description: "Discount code strip with copy-to-clipboard",
  },
  "product-grid": {
    name: "Product Carousel",
    description: "Curated product shelf with arrows",
  },
  "product-browser": {
    name: "Product Grid",
    description: "Catalog browser with category chips",
  },
  "product-group": {
    name: "Product Group",
    description: "Tabbed product shelves",
  },
  "featured-collection": {
    name: "Featured Collection",
    description: "Collection rows — promo panel and product cards",
  },
  "sponsored-rail": {
    name: "Sponsored Products",
    description: "Paid boost placements with organic fill",
  },
  "category-list": {
    name: "Category List",
    description: "Category row — image cards or circular tiles",
  },
  "category-mosaic": {
    name: "Category Mosaic",
    description: "Bento of category image tiles",
  },
  "collection-list": {
    name: "Collection List",
    description: "Collection cards with product counts",
  },
  "brand-list": {
    name: "Brand List",
    description: "Brand logo strip",
  },
  "image-text": {
    name: "Image + Text",
    description: "Split image with rich text and CTA",
  },
  "rich-text": {
    name: "Rich Text",
    description: "Free-form formatted text",
  },
  heading: {
    name: "Heading",
    description: "A standalone title above a run of sections",
  },
  gap: {
    name: "Gap",
    description: "Vertical space between blocks",
  },
  "image-gallery": {
    name: "Image Gallery",
    description: "Linked image strip (Instagram-style)",
  },
  "blog-posts": {
    name: "Blog Posts",
    description: "Latest articles grid",
  },
  testimonials: {
    name: "Testimonials",
    description: "Approved customer reviews",
  },
  "service-benefits": {
    name: "Service Benefits",
    description: "Perks strip: shipping, returns, support",
  },
  faq: {
    name: "FAQ",
    description: "Question & answer accordion",
  },
  "vendor-list": {
    name: "Top Vendors",
    description: "Vendor cards with ratings",
  },
  "become-vendor": {
    name: "Become a Vendor",
    description: "Marketplace recruitment banner",
  },
  "product-main": {
    name: "Product information",
    description: "Gallery, buy box, and description — the page core",
  },
  "product-specification": {
    name: "Specification",
    description: "The product's attribute table as its own block",
  },
  "product-reviews": {
    name: "Reviews",
    description: "The product's review thread",
  },
  "product-sponsored": {
    name: "Sponsored carousel",
    description: "Paid placements mixed with organic picks",
  },
  "product-related": {
    name: "Related products",
    description: "“You may also like” by category",
  },
  "products-main": {
    name: "Product listing",
    description: "Filters, sorting, and the product grid — the page core",
  },
  "category-header": {
    name: "Category header",
    description: "Category image, description, and product count",
  },
  "category-main": {
    name: "Category products",
    description: "The category's product grid — the page core",
  },
  "collection-header": {
    name: "Collection header",
    description: "Collection banner, description, and sorting",
  },
  "collection-main": {
    name: "Collection products",
    description: "The collection's product grid — the page core",
  },
  "cart-main": {
    name: "Shopping bag",
    description: "Cart lines and order summary — the page core",
  },
  "header-bar": {
    name: "Header",
    description: "Logo, navigation, search, and actions — the header core",
  },
  "footer-bar": {
    name: "Footer",
    description: "Link columns, contact, and social — the footer core",
  },
  "announcement-bar": {
    name: "Announcement bar",
    description: "A slim notice strip above the header",
  },
  "top-tags": {
    name: "Top tags",
    description: "Trending link chips under the header",
  },
};

/**
 * Serialize the registry for the client-side editor.
 *
 * `preferredVariants` (the active theme's map) is baked into each entry's
 * STARTER, so a section inserted from the picker arrives wearing the
 * template's design instead of the first (legacy) variant. Only the starter
 * changes — stored documents and the variant field's own default do not.
 */
export function getSectionCatalog(
  ctx: SectionAvailabilityContext,
  preferredVariants?: Record<string, string>,
): SectionCatalogEntry[] {
  return [...SECTION_REGISTRY.values()].map((def) => {
    const copy = SECTION_COPY[def.type] ?? {
      name: def.type,
      description: "",
    };
    const preferred = preferredVariants?.[def.type];
    const starter: SectionStarter | undefined =
      def.variants &&
      preferred &&
      preferred !== def.variants[0].key &&
      def.variants.some((variant) => variant.key === preferred)
        ? {
            ...def.starter,
            settings: {
              ...def.starter?.settings,
              [VARIANT_FIELD_KEY]: preferred,
            },
          }
        : def.starter;
    return {
      type: def.type,
      version: def.version,
      category: def.category,
      suggested: Boolean(def.suggested),
      name: copy.name,
      description: copy.description,
      singleton: def.maxPerPage === 1,
      available: def.available ? def.available(ctx) : true,
      templates: def.templates,
      zones: def.zones,
      required: def.required,
      locked: def.locked,
      // Pre-developed designs, for the inspector's visual picker. Renderers
      // are dropped here — the client only needs keys and labels.
      variants: def.variants?.map((variant) => ({
        key: variant.key,
        name: variant.name,
      })),
      fields: def.fields,
      blocks: (def.blocks ?? []).map((block) => ({
        type: block.type,
        fields: block.fields,
        max: block.max,
      })),
      starter,
    };
  });
}
