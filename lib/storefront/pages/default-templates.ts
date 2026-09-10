import type { SectionInstance } from "@/lib/storefront/sections/types";
import type { StoreGroupType, StoreTemplateType } from "./handles";

/** Template types with a storefront renderer today ("home" has its own path). */
export type RenderableTemplateType =
  | "product"
  | "products"
  | "category"
  | "collection"
  | "cart";

/**
 * Built-in template layouts, used wherever a template page has no published
 * StorePage document yet: the storefront's fallback render, the builder's
 * initial draft, and the write-time "template starts complete" guarantee.
 *
 * Deterministic ids on purpose (the legacy-home precedent): the first
 * publish then persists exactly what the store has been rendering, and
 * diffing/debugging stays sane. Pure module — no server imports — so the
 * admin client may share it.
 */

export const PRODUCT_GALLERY_LAYOUTS = [
  "bottom",
  "left",
  "grid",
  "carousel",
  "vertical",
  "full",
] as const;
export type ProductGalleryLayout = (typeof PRODUCT_GALLERY_LAYOUTS)[number];

/**
 * The default product template — the hand-wired /products/[slug] page as
 * sections, in its original order.
 */
export function getDefaultProductTemplateSections(
  galleryLayout: ProductGalleryLayout = "bottom",
): SectionInstance[] {
  return [
    {
      id: "product-main",
      type: "product-main",
      version: 1,
      visible: true,
      // The buy-box arrangement is theme-driven (Minimal base, Electronics
      // override) — see themes/overrides.tsx — so no design is stored here.
      settings: { galleryLayout },
    },
    {
      id: "product-reviews",
      type: "product-reviews",
      version: 1,
      visible: true,
      settings: {},
    },
    {
      id: "product-sponsored",
      type: "product-sponsored",
      version: 1,
      visible: true,
      settings: {},
    },
    {
      id: "product-related",
      type: "product-related",
      version: 1,
      visible: true,
      settings: { title: "" },
    },
  ];
}

/** The hand-wired /products page as sections. */
function getDefaultProductsTemplateSections(): SectionInstance[] {
  return [
    {
      id: "products-main",
      type: "products-main",
      version: 1,
      visible: true,
      settings: { heading: "" },
    },
  ];
}

/** The hand-wired /categories/[slug] page as sections. */
function getDefaultCategoryTemplateSections(): SectionInstance[] {
  return [
    {
      id: "category-header",
      type: "category-header",
      version: 1,
      visible: true,
      settings: {},
    },
    {
      id: "category-main",
      type: "category-main",
      version: 1,
      visible: true,
      settings: {},
    },
  ];
}

/** The hand-wired /collections/[slug] page as sections. */
function getDefaultCollectionTemplateSections(): SectionInstance[] {
  return [
    {
      id: "collection-header",
      type: "collection-header",
      version: 1,
      visible: true,
      settings: {},
    },
    {
      id: "collection-main",
      type: "collection-main",
      version: 1,
      visible: true,
      settings: {},
    },
  ];
}

/** The hand-wired /cart page as sections. */
function getDefaultCartTemplateSections(): SectionInstance[] {
  return [
    {
      id: "cart-main",
      type: "cart-main",
      version: 1,
      visible: true,
      settings: {},
    },
  ];
}

/**
 * The header/footer groups' defaults: just their locked cores — exactly
 * what the (store) layout has always rendered.
 */
export function buildDefaultGroupSections(
  group: StoreGroupType,
): SectionInstance[] {
  const core = group === "header" ? "header-bar" : "footer-bar";
  return [{ id: core, type: core, version: 1, visible: true, settings: {} }];
}

/**
 * One entry point over the per-template defaults, for the builder and the
 * template fetcher. Returns null for types without a built-in default
 * ("home" maps from legacy settings instead).
 */
export function buildDefaultTemplateSections(
  type: StoreTemplateType,
  opts: { galleryLayout?: ProductGalleryLayout } = {},
): SectionInstance[] | null {
  switch (type) {
    case "product":
      return getDefaultProductTemplateSections(opts.galleryLayout);
    case "products":
      return getDefaultProductsTemplateSections();
    case "category":
      return getDefaultCategoryTemplateSections();
    case "collection":
      return getDefaultCollectionTemplateSections();
    case "cart":
      return getDefaultCartTemplateSections();
    default:
      return null;
  }
}

/**
 * The retired theme setting `productGalleryLayout` (a per-theme value in
 * `settings.onlineStore.themeSettings`) seeded the arrangement before the
 * product template existed. The schema key is gone — normalize-on-read
 * drops the stored value — but a store that chose a layout there keeps it:
 * this reads the RAW stored value and the default template carries it until
 * the first product-template publish persists it as a section setting.
 */
export function readLegacyGalleryLayout(
  onlineStore: unknown,
  themeId: string,
): ProductGalleryLayout | undefined {
  const source =
    typeof onlineStore === "object" && onlineStore !== null
      ? (onlineStore as { themeSettings?: Record<string, unknown> })
      : {};
  const themeValues =
    source.themeSettings &&
    typeof source.themeSettings === "object" &&
    !Array.isArray(source.themeSettings)
      ? (source.themeSettings[themeId] as
          | { productGalleryLayout?: unknown }
          | undefined)
      : undefined;
  const value = themeValues?.productGalleryLayout;
  return typeof value === "string" &&
    (PRODUCT_GALLERY_LAYOUTS as readonly string[]).includes(value)
    ? (value as ProductGalleryLayout)
    : undefined;
}
