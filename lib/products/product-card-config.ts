import type { CSSProperties } from "react";

/**
 * The storefront product card's configurator vocabulary — shared by the
 * card renderer (`components/products/modern-product-card.tsx`), the admin
 * "Product card" editor and its live preview, so all three always agree on
 * what a key means. There is ONE card design per store: every theme,
 * including Electronics, renders this config — a theme merely seeds it
 * with its own template on activation (`ThemeManifest.productCard`).
 *
 * Mirrors the product page's `product-detail-rows.ts`/`product-detail-style.ts`
 * pair, but for the CARD: elements are arranged in groups (the admin editor
 * drags elements between groups), plus a Visibility panel, an Action panel
 * and a Style panel. Stored as one object under `settings.productCard` and
 * normalized per-field at every read, so an absent or stale document
 * changes nothing.
 *
 * This module must stay CLIENT-SAFE and pure (no server imports).
 */

// ---- Elements (the draggable "Order" rows) --------------------------------

export const PRODUCT_CARD_ELEMENTS = [
  "preview",
  "swatch",
  "brand",
  // The seller's store name. It used to BE the "brand" element, which read
  // the vendor all along; see PRODUCT_CARD_CONFIG_VERSION for the split.
  "seller",
  "name",
  "category",
  "price",
  "delivery",
  "rating",
  "stock",
  "cart",
] as const;

export type ProductCardElement = (typeof PRODUCT_CARD_ELEMENTS)[number];

/** English fallbacks; the admin overlays `admin.productCardStudio.elements.<key>`. */
export const PRODUCT_CARD_ELEMENT_LABELS: Record<ProductCardElement, string> = {
  preview: "Preview Image",
  swatch: "Swatch",
  brand: "Brand",
  seller: "Seller",
  name: "Product Name",
  category: "Category",
  price: "Price",
  delivery: "Delivery info",
  rating: "Rating",
  stock: "Out of stock",
  cart: "Action button",
};

interface ProductCardItem {
  key: ProductCardElement;
  on: boolean;
}

export interface ProductCardGroup {
  /** Stable id for drag-and-drop identity; persisted with the config. */
  id: string;
  items: ProductCardItem[];
}

// ---- Visibility -----------------------------------------------------------

export interface ProductCardVisibility {
  /** Persistent action button row (vs the hover/touch-only controls). */
  cartButtonAlways: boolean;
  /** "N% OFF" chip beside the price. */
  discountChip: boolean;
  /** "-N%" badge on the preview image. */
  discountChipOnImage: boolean;
  /** "N sold" beside the rating (renders only when the product carries it). */
  itemSold: boolean;
  /** "(N)" review count beside the stars. */
  ratingCount: boolean;
  /** One star + the numeric rating, docked into the price row. */
  ratingMinimized: boolean;
  /** "+N" extra-variant count beside the swatches. */
  variantCount: boolean;
}

// ---- Action (what the persistent button does) -----------------------------

export const PRODUCT_CARD_CART_ACTIONS = [
  "add-to-cart",
  "view",
  "quick-view",
] as const;
export type ProductCardCartAction = (typeof PRODUCT_CARD_CART_ACTIONS)[number];

/** English fallbacks; the admin overlays `admin.productCardStudio.cartActions.<key>`. */
export const PRODUCT_CARD_CART_ACTION_LABELS: Record<
  ProductCardCartAction,
  string
> = {
  "add-to-cart": "Add to cart",
  view: "View product",
  "quick-view": "Quick view",
};

export interface ProductCardAction {
  /** What the persistent button (and the hover overlay) does on click. */
  cart: ProductCardCartAction;
  /** Custom button text; empty = the action's default wording. */
  label: string;
}

// ---- Style ----------------------------------------------------------------

interface ProductCardTypography {
  /** CSS font-weight keyword/number; empty = theme default. */
  weight: string;
  /** "normal" | "italic"; empty = theme default. */
  style: string;
  /** px; 0 = theme default. */
  size: number;
  /** CSS color (hex or a `var(--token)` reference); empty = theme default. */
  color: string;
}

export type ProductCardTypographyKey =
  | "brand"
  | "seller"
  | "product"
  | "category"
  | "price"
  | "discounted"
  | "cart"
  | "stock";

/**
 * What the Brand element draws: the brand's uploaded logo, or its name. A
 * brand with no logo falls back to its name either way, so a mixed catalogue
 * never shows a gap where the logo would be.
 */
export const PRODUCT_CARD_BRAND_DISPLAYS = ["logo", "name"] as const;
export type ProductCardBrandDisplay = (typeof PRODUCT_CARD_BRAND_DISPLAYS)[number];

/**
 * v2: the "brand" element means the PRODUCT'S brand, and the store name it
 * used to print moved to its own "seller" element. Configs saved before that
 * (no version) are read with their "brand" element renamed to "seller", so
 * every existing storefront keeps printing exactly what it printed.
 */
export const PRODUCT_CARD_CONFIG_VERSION = 2;

/** A product's brand as the card draws it. */
export interface CardBrand {
  name: string;
  slug: string;
  logo: string;
}

const PRODUCT_CARD_HOVER_EFFECTS = [
  "zoom",
  "second-image",
  "none",
] as const;
export type ProductCardHoverEffect =
  (typeof PRODUCT_CARD_HOVER_EFFECTS)[number];

export const PRODUCT_CARD_PREVIEW_ASPECTS = [
  "square",
  "tall",
  "portrait",
  "landscape",
] as const;
export type ProductCardPreviewAspect =
  (typeof PRODUCT_CARD_PREVIEW_ASPECTS)[number];

/** English fallbacks; the admin overlays `admin.productCardStudio.previewAspects.<key>`. */
export const PRODUCT_CARD_PREVIEW_ASPECT_LABELS: Record<
  ProductCardPreviewAspect,
  string
> = {
  square: "Square (1:1)",
  tall: "Tall (8:9)",
  portrait: "Portrait (3:4)",
  landscape: "Landscape (4:3)",
};

/** CSS `aspect-ratio` per option. */
const PRODUCT_CARD_PREVIEW_ASPECT_RATIOS: Record<
  ProductCardPreviewAspect,
  string
> = {
  square: "1 / 1",
  tall: "8 / 9",
  portrait: "3 / 4",
  landscape: "4 / 3",
};

export const PRODUCT_CARD_PREVIEW_FITS = ["cover", "contain"] as const;
export type ProductCardPreviewFit = (typeof PRODUCT_CARD_PREVIEW_FITS)[number];

export const PRODUCT_CARD_CART_VARIANTS = ["solid", "outline"] as const;
export type ProductCardCartVariant =
  (typeof PRODUCT_CARD_CART_VARIANTS)[number];

export interface ProductCardStyle {
  /** The card wrapper. Chrome renders only where a value is actually set. */
  cardRadius: number;
  cardPadding: number;
  cardBackground: string;
  cardBorder: string;
  cardBorderWidth: number;
  /** Drop shadow softness (px blur); 0 = none. */
  cardShadow: number;
  /** The preview media stage. */
  previewBackground: string;
  previewRadius: number;
  /** Stage proportions when no fixed height is set. */
  previewAspect: ProductCardPreviewAspect;
  /** px; 0 = use the aspect ratio. */
  previewHeight: number;
  /** `cover` bleeds the shot to the edges; `contain` floats it on the stage. */
  previewFit: ProductCardPreviewFit;
  /** Air around a contained shot (px). */
  previewPadding: number;
  previewHover: ProductCardHoverEffect;
  /** Vertical space between groups / between elements inside a group (px). */
  groupGap: number;
  itemGap: number;
  /**
   * The space BETWEEN cards, in every product grid and shelf. Off, each grid
   * keeps the spacing it shipped with (tighter on phones); on, the two
   * values below apply at every width.
   */
  gridGapCustom: boolean;
  /** px between cards side by side. */
  gridColumnGap: number;
  /** px between one row of cards and the next (grids only; a shelf is one row). */
  gridRowGap: number;
  typography: Partial<Record<ProductCardTypographyKey, ProductCardTypography>>;
  /** Bordered accent pill around a marked-down price (vs plain bold text). */
  pricePill: boolean;
  /** The "N% OFF" chip; empty = the rose default. */
  discountChipBackground: string;
  discountChipColor: string;
  /** The persistent action button. */
  cartVariant: ProductCardCartVariant;
  cartBackground: string;
  cartBorder: string;
  cartBorderWidth: number;
  cartRadius: number;
  /** Star fill; empty = the amber default. */
  ratingColor: string;
  /** The Brand element: logo or name, and the logo's height in px. */
  brandDisplay: ProductCardBrandDisplay;
  brandLogoHeight: number;
  /** The Out of stock badge; empty colors = the red status default. */
  stockBackground: string;
  stockBorder: string;
  stockBorderWidth: number;
  stockRadius: number;
}

export interface ProductCardConfig {
  /** See PRODUCT_CARD_CONFIG_VERSION. */
  version: number;
  /** The template the config was last seeded from (display only). */
  template: ProductCardTemplateId;
  groups: ProductCardGroup[];
  visibility: ProductCardVisibility;
  action: ProductCardAction;
  style: ProductCardStyle;
}

// ---- Defaults (reproduce the card as shipped — an untouched store must
// not change when this feature lands) ---------------------------------------

// The card as shipped: image alone, then one body block (swatches, name,
// price+rating, delivery) — groupGap/itemGap reproduce its 12px/6px rhythm.
const DEFAULT_PRODUCT_CARD_GROUPS: ProductCardGroup[] = [
  { id: "g1", items: [{ key: "preview", on: true }] },
  {
    id: "g2",
    items: [
      { key: "swatch", on: true },
      { key: "name", on: true },
      { key: "price", on: true },
      { key: "rating", on: true },
      { key: "delivery", on: true },
      { key: "cart", on: true },
    ],
  },
];

const DEFAULT_PRODUCT_CARD_VISIBILITY: ProductCardVisibility = {
  cartButtonAlways: false,
  discountChip: false,
  discountChipOnImage: true,
  itemSold: false,
  ratingCount: false,
  ratingMinimized: true,
  variantCount: false,
};

const DEFAULT_PRODUCT_CARD_ACTION: ProductCardAction = {
  cart: "add-to-cart",
  label: "",
};

export const EMPTY_CARD_TYPOGRAPHY: ProductCardTypography = {
  weight: "",
  style: "",
  size: 0,
  color: "",
};

const DEFAULT_PRODUCT_CARD_STYLE: ProductCardStyle = {
  cardRadius: 12,
  cardPadding: 0,
  cardBackground: "",
  cardBorder: "",
  cardBorderWidth: 0,
  cardShadow: 0,
  previewBackground: "",
  previewRadius: 6,
  previewAspect: "square",
  previewHeight: 0,
  previewFit: "cover",
  previewPadding: 0,
  previewHover: "zoom",
  // The card as shipped: space-y-3 image→body, space-y-1.5 inside the body.
  groupGap: 12,
  itemGap: 6,
  // The browser grid's desktop rhythm (sm:gap-x-5 sm:gap-y-11), so switching
  // custom spacing on starts from what the storefront already shows.
  gridGapCustom: false,
  gridColumnGap: 20,
  gridRowGap: 44,
  typography: {},
  pricePill: true,
  discountChipBackground: "",
  discountChipColor: "",
  cartVariant: "solid",
  cartBackground: "",
  cartBorder: "",
  cartBorderWidth: 0,
  cartRadius: 6,
  ratingColor: "",
  brandDisplay: "logo",
  brandLogoHeight: 20,
  stockBackground: "",
  stockBorder: "",
  stockBorderWidth: 0,
  // The badge as shipped uses rounded-md (6px).
  stockRadius: 6,
};

export const DEFAULT_PRODUCT_CARD_CONFIG: ProductCardConfig = {
  version: PRODUCT_CARD_CONFIG_VERSION,
  template: "minimal",
  groups: DEFAULT_PRODUCT_CARD_GROUPS,
  visibility: DEFAULT_PRODUCT_CARD_VISIBILITY,
  action: DEFAULT_PRODUCT_CARD_ACTION,
  style: DEFAULT_PRODUCT_CARD_STYLE,
};

export function getDefaultProductCardConfig(): ProductCardConfig {
  return JSON.parse(
    JSON.stringify(DEFAULT_PRODUCT_CARD_CONFIG),
  ) as ProductCardConfig;
}

// ---- Effective defaults (what an EMPTY field actually renders as) ---------
// The admin controls show these instead of a blank/white swatch, so every
// field reads as the value the storefront is really using. Light-scheme
// values of the Tailwind classes the renderer falls back to.

export const PRODUCT_CARD_COLOR_FALLBACKS = {
  cardBackground: "#ffffff",
  cardBorder: "#e4e4e7",
  previewBackground: "#f3f4f6",
  discountChipBackground: "#ffe4e6",
  discountChipColor: "#e11d48",
  cartBackground: "#18181b",
  cartBorder: "#e4e4e7",
  ratingColor: "#fbbf24",
  stockBackground: "#fef2f2",
  stockBorder: "#fecaca",
} as const;

interface ProductCardTypographyDefaults {
  weight: string;
  style: string;
  size: number;
  color: string;
}

/**
 * The typography each text element wears when the merchant set nothing —
 * desktop sizes of the renderer's classes. Price and Cart depend on sibling
 * style choices (accent pill / outline button), hence the function.
 */
export function productCardTypographyDefaults(
  style: Pick<ProductCardStyle, "pricePill" | "cartVariant">,
): Record<ProductCardTypographyKey, ProductCardTypographyDefaults> {
  return {
    brand: { weight: "600", style: "normal", size: 12, color: "#09090b" },
    seller: { weight: "600", style: "normal", size: 12, color: "#09090b" },
    product: { weight: "600", style: "normal", size: 14, color: "#09090b" },
    category: { weight: "400", style: "normal", size: 12, color: "#71717a" },
    price: {
      weight: style.pricePill ? "600" : "700",
      style: "normal",
      size: 14,
      color: style.pricePill ? "#059669" : "#09090b",
    },
    discounted: { weight: "400", style: "normal", size: 14, color: "#71717a" },
    cart: {
      weight: "600",
      style: "normal",
      size: 12,
      color: style.cartVariant === "outline" ? "#09090b" : "#ffffff",
    },
    stock: { weight: "600", style: "normal", size: 12, color: "#ef4444" },
  };
}

/**
 * Theme tokens a color field may bind to instead of a fixed hex, so a card
 * keeps matching the palette when the merchant recolors the theme. Stored
 * verbatim as the CSS reference.
 */
export const PRODUCT_CARD_COLOR_TOKENS = [
  { key: "primary", label: "Theme primary", value: "var(--primary)" },
  { key: "foreground", label: "Text", value: "var(--foreground)" },
  { key: "muted", label: "Muted text", value: "var(--muted-foreground)" },
  { key: "border", label: "Border", value: "var(--border)" },
] as const;

// ---- Templates (the "Card Templates" modal's fixed presets) ---------------

export const PRODUCT_CARD_TEMPLATE_IDS = [
  "minimal",
  "full",
  "drop-shadow",
  "sharp-border",
  "electronics",
] as const;
export type ProductCardTemplateId = (typeof PRODUCT_CARD_TEMPLATE_IDS)[number];

export const PRODUCT_CARD_TEMPLATE_LABELS: Record<ProductCardTemplateId, string> =
  {
    minimal: "Minimal",
    full: "Full",
    "drop-shadow": "Drop Shadow",
    "sharp-border": "Sharp Border",
    electronics: "Electronics",
  };

const group = (id: string, ...keys: ProductCardElement[]): ProductCardGroup => ({
  id,
  items: keys.map((key) => ({ key, on: true })),
});

const FULL_VISIBILITY: ProductCardVisibility = {
  cartButtonAlways: false,
  discountChip: true,
  discountChipOnImage: false,
  itemSold: true,
  ratingCount: true,
  ratingMinimized: false,
  variantCount: true,
};

/**
 * Selecting a template REPLACES the whole config (the merchant then tweaks
 * from there). Each is a complete, self-consistent arrangement matching its
 * Figma tile; "electronics" is the Electronics theme's listing card (Figma
 * 540:1890), seeded automatically when that theme is activated.
 */
export const PRODUCT_CARD_TEMPLATES: Record<
  ProductCardTemplateId,
  ProductCardConfig
> = {
  minimal: {
    version: PRODUCT_CARD_CONFIG_VERSION,
    template: "minimal",
    groups: [
      group("g1", "preview", "swatch"),
      group("g2", "brand", "name", "category"),
      group("g3", "price", "delivery"),
      group("g4", "rating"),
      group("g5", "stock"),
      group("g6", "cart"),
    ],
    visibility: { ...FULL_VISIBILITY, discountChipOnImage: true },
    action: { ...DEFAULT_PRODUCT_CARD_ACTION },
    style: {
      ...DEFAULT_PRODUCT_CARD_STYLE,
      previewRadius: 10,
    },
  },
  full: {
    version: PRODUCT_CARD_CONFIG_VERSION,
    template: "full",
    groups: [
      group("g1", "name", "category"),
      group("g2", "preview", "swatch"),
      group("g3", "price", "delivery"),
      group("g4", "rating"),
      group("g5", "stock"),
      group("g6", "cart"),
    ],
    visibility: { ...FULL_VISIBILITY },
    action: { ...DEFAULT_PRODUCT_CARD_ACTION },
    style: {
      ...DEFAULT_PRODUCT_CARD_STYLE,
      cardRadius: 16,
      cardPadding: 16,
      cardBackground: "#f4f4f5",
      previewBackground: "#f4f4f5",
      previewRadius: 0,
    },
  },
  "drop-shadow": {
    version: PRODUCT_CARD_CONFIG_VERSION,
    template: "drop-shadow",
    groups: [
      group("g1", "preview", "swatch"),
      group("g2", "brand", "name", "category"),
      group("g3", "price", "delivery"),
      group("g4", "rating"),
      group("g5", "stock"),
      group("g6", "cart"),
    ],
    visibility: { ...FULL_VISIBILITY },
    action: { ...DEFAULT_PRODUCT_CARD_ACTION },
    style: {
      ...DEFAULT_PRODUCT_CARD_STYLE,
      cardRadius: 16,
      cardPadding: 16,
      cardBackground: "#ffffff",
      cardShadow: 24,
      previewBackground: "#ffffff",
      previewRadius: 0,
    },
  },
  "sharp-border": {
    version: PRODUCT_CARD_CONFIG_VERSION,
    template: "sharp-border",
    groups: [
      group("g1", "name", "category"),
      group("g2", "preview", "swatch"),
      group("g3", "price", "delivery"),
      group("g4", "rating"),
      group("g5", "stock"),
      group("g6", "cart"),
    ],
    visibility: { ...FULL_VISIBILITY, cartButtonAlways: true },
    action: { ...DEFAULT_PRODUCT_CARD_ACTION },
    style: {
      ...DEFAULT_PRODUCT_CARD_STYLE,
      cardRadius: 0,
      cardPadding: 16,
      cardBorder: "#18181b",
      cardBorderWidth: 1.5,
      previewBackground: "#ffffff",
      previewRadius: 0,
      cartBackground: "#18181b",
      cartRadius: 0,
    },
  },
  // The Electronics listing card: a tall light stage floating the shot,
  // four swatch dots with a "+N" note, name over category, a bold
  // primary-colored price (no rating), and a full-width outlined "View"
  // affordance pinned to the bottom edge.
  electronics: {
    version: PRODUCT_CARD_CONFIG_VERSION,
    template: "electronics",
    groups: [
      group("g1", "preview"),
      group("g2", "swatch"),
      group("g3", "name", "category"),
      group("g4", "price", "delivery"),
      group("g5", "stock"),
      group("g6", "cart"),
    ],
    visibility: {
      cartButtonAlways: true,
      discountChip: false,
      discountChipOnImage: true,
      itemSold: false,
      ratingCount: false,
      ratingMinimized: false,
      variantCount: true,
    },
    action: { cart: "view", label: "" },
    style: {
      ...DEFAULT_PRODUCT_CARD_STYLE,
      previewBackground: "#f7f8fa",
      previewRadius: 14,
      previewAspect: "tall",
      previewFit: "contain",
      previewPadding: 28,
      previewHover: "none",
      groupGap: 14,
      itemGap: 4,
      pricePill: false,
      typography: {
        product: { weight: "600", style: "", size: 16, color: "" },
        price: { weight: "700", style: "", size: 18, color: "var(--primary)" },
        discounted: { weight: "", style: "", size: 14, color: "" },
        cart: {
          weight: "700",
          style: "",
          size: 14,
          color: "var(--muted-foreground)",
        },
      },
      cartVariant: "outline",
      cartRadius: 6,
    },
  },
};

/**
 * True when a stored config is exactly a template (or the shipped default)
 * with nothing tweaked — the signal a theme switch uses to decide whether
 * it may reseed the card without discarding a merchant's work.
 */
export function isUntouchedProductCardConfig(config: ProductCardConfig): boolean {
  const same = (candidate: ProductCardConfig) =>
    JSON.stringify(normalizeProductCardConfig(candidate)) ===
    JSON.stringify(config);
  return (
    same(DEFAULT_PRODUCT_CARD_CONFIG) ||
    same(PRODUCT_CARD_TEMPLATES[config.template])
  );
}

// ---- Normalization --------------------------------------------------------

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;
const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;
const oneOf = <T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T =>
  typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** Wider than this and a two-up phone grid has no room left for the cards. */
export const MAX_CARD_GRID_COLUMN_GAP = 80;
export const MAX_CARD_GRID_ROW_GAP = 120;

const clampGap = (value: unknown, fallback: number, max: number) =>
  Math.min(max, Math.max(0, Math.round(num(value, fallback))));

const ELEMENT_SET = new Set<string>(PRODUCT_CARD_ELEMENTS);

/**
 * Raw groups → validated groups. Unknown or duplicate element keys are
 * dropped; an arrangement with no elements at all is a corrupt document,
 * not a choice, and falls back to the default.
 */
function normalizeProductCardGroups(
  raw: unknown,
  legacy = false,
): ProductCardGroup[] {
  if (!Array.isArray(raw)) return DEFAULT_PRODUCT_CARD_GROUPS;

  const seen = new Set<string>();
  const groups: ProductCardGroup[] = [];
  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null) continue;
    const rawItems = (entry as { items?: unknown }).items;
    if (!Array.isArray(rawItems)) continue;
    const items: ProductCardItem[] = [];
    for (const item of rawItems) {
      if (typeof item !== "object" || item === null) continue;
      const storedKey = (item as { key?: unknown }).key;
      // A pre-v2 "brand" printed the seller's store name; it keeps doing so.
      const key = legacy && storedKey === "brand" ? "seller" : storedKey;
      if (typeof key !== "string" || !ELEMENT_SET.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({
        key: key as ProductCardElement,
        on: (item as { on?: unknown }).on !== false,
      });
    }
    const id = (entry as { id?: unknown }).id;
    groups.push({
      id: typeof id === "string" && id ? id : `g${index + 1}`,
      items,
    });
  }
  return groups.some((entry) => entry.items.length > 0)
    ? groups
    : DEFAULT_PRODUCT_CARD_GROUPS;
}

function parseTypography(raw: unknown): ProductCardTypography | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const value: ProductCardTypography = {
    weight: str(source.weight, ""),
    style: str(source.style, ""),
    size: num(source.size, 0),
    color: str(source.color, ""),
  };
  return value.weight || value.style || value.size || value.color
    ? value
    : undefined;
}

const TYPOGRAPHY_KEYS: ProductCardTypographyKey[] = [
  "brand",
  "seller",
  "product",
  "category",
  "price",
  "discounted",
  "cart",
  "stock",
];

/**
 * Whether a stored card predates v2, when "brand" printed the seller.
 *
 * The version is the signal, but the settings API used to strip it on
 * save, so a card saved by the v2 builder can arrive without one. Such a
 * card still gives itself away: the v2 builder always writes the Brand
 * element's `style.brandDisplay`, and only v2 knows a "seller" element —
 * neither can appear in a card from before the split.
 */
function isLegacyProductCardConfig(source: Record<string, unknown>): boolean {
  if (num(source.version, 1) >= PRODUCT_CARD_CONFIG_VERSION) return false;
  const style = source.style;
  if (typeof style === "object" && style !== null && "brandDisplay" in style) {
    return false;
  }
  const groups = Array.isArray(source.groups) ? source.groups : [];
  return !groups.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      Array.isArray((entry as { items?: unknown }).items) &&
      ((entry as { items: unknown[] }).items).some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          (item as { key?: unknown }).key === "seller",
      ),
  );
}

/** Stored value → validated config; anything malformed falls back per-field. */
export function normalizeProductCardConfig(raw: unknown): ProductCardConfig {
  if (typeof raw !== "object" || raw === null) {
    return getDefaultProductCardConfig();
  }
  const source = raw as Record<string, unknown>;
  const v = (
    typeof source.visibility === "object" && source.visibility !== null
      ? source.visibility
      : {}
  ) as Record<string, unknown>;
  const a = (
    typeof source.action === "object" && source.action !== null
      ? source.action
      : {}
  ) as Record<string, unknown>;
  const s = (
    typeof source.style === "object" && source.style !== null
      ? source.style
      : {}
  ) as Record<string, unknown>;
  const dv = DEFAULT_PRODUCT_CARD_VISIBILITY;
  const da = DEFAULT_PRODUCT_CARD_ACTION;
  const ds = DEFAULT_PRODUCT_CARD_STYLE;

  const typographyRaw =
    typeof s.typography === "object" && s.typography !== null
      ? (s.typography as Record<string, unknown>)
      : {};
  const legacy = isLegacyProductCardConfig(source);
  const typography: ProductCardStyle["typography"] = {};
  for (const key of TYPOGRAPHY_KEYS) {
    // The seller text was styled as "brand" before the split.
    const storedKey = legacy && key === "seller" ? "brand" : key;
    if (legacy && key === "brand") continue;
    const value = parseTypography(typographyRaw[storedKey]);
    if (value) typography[key] = value;
  }

  return {
    version: PRODUCT_CARD_CONFIG_VERSION,
    template: oneOf(PRODUCT_CARD_TEMPLATE_IDS, source.template, "minimal"),
    groups: normalizeProductCardGroups(source.groups, legacy),
    visibility: {
      cartButtonAlways: bool(v.cartButtonAlways, dv.cartButtonAlways),
      discountChip: bool(v.discountChip, dv.discountChip),
      discountChipOnImage: bool(v.discountChipOnImage, dv.discountChipOnImage),
      itemSold: bool(v.itemSold, dv.itemSold),
      ratingCount: bool(v.ratingCount, dv.ratingCount),
      ratingMinimized: bool(v.ratingMinimized, dv.ratingMinimized),
      variantCount: bool(v.variantCount, dv.variantCount),
    },
    action: {
      cart: oneOf(PRODUCT_CARD_CART_ACTIONS, a.cart, da.cart),
      label: str(a.label, da.label).slice(0, 40),
    },
    style: {
      cardRadius: num(s.cardRadius, ds.cardRadius),
      cardPadding: num(s.cardPadding, ds.cardPadding),
      cardBackground: str(s.cardBackground, ds.cardBackground),
      cardBorder: str(s.cardBorder, ds.cardBorder),
      cardBorderWidth: num(s.cardBorderWidth, ds.cardBorderWidth),
      cardShadow: num(s.cardShadow, ds.cardShadow),
      previewBackground: str(s.previewBackground, ds.previewBackground),
      previewRadius: num(s.previewRadius, ds.previewRadius),
      previewAspect: oneOf(
        PRODUCT_CARD_PREVIEW_ASPECTS,
        s.previewAspect,
        ds.previewAspect,
      ),
      previewHeight: num(s.previewHeight, ds.previewHeight),
      previewFit: oneOf(PRODUCT_CARD_PREVIEW_FITS, s.previewFit, ds.previewFit),
      previewPadding: num(s.previewPadding, ds.previewPadding),
      previewHover: oneOf(
        PRODUCT_CARD_HOVER_EFFECTS,
        s.previewHover,
        ds.previewHover,
      ),
      groupGap: num(s.groupGap, ds.groupGap),
      itemGap: num(s.itemGap, ds.itemGap),
      gridGapCustom: bool(s.gridGapCustom, ds.gridGapCustom),
      gridColumnGap: clampGap(s.gridColumnGap, ds.gridColumnGap, MAX_CARD_GRID_COLUMN_GAP),
      gridRowGap: clampGap(s.gridRowGap, ds.gridRowGap, MAX_CARD_GRID_ROW_GAP),
      typography,
      pricePill: bool(s.pricePill, ds.pricePill),
      discountChipBackground: str(
        s.discountChipBackground,
        ds.discountChipBackground,
      ),
      discountChipColor: str(s.discountChipColor, ds.discountChipColor),
      cartVariant: oneOf(PRODUCT_CARD_CART_VARIANTS, s.cartVariant, ds.cartVariant),
      cartBackground: str(s.cartBackground, ds.cartBackground),
      cartBorder: str(s.cartBorder, ds.cartBorder),
      cartBorderWidth: num(s.cartBorderWidth, ds.cartBorderWidth),
      cartRadius: num(s.cartRadius, ds.cartRadius),
      ratingColor: str(s.ratingColor, ds.ratingColor),
      brandDisplay: oneOf(PRODUCT_CARD_BRAND_DISPLAYS, s.brandDisplay, ds.brandDisplay),
      brandLogoHeight: Math.min(80, Math.max(8, num(s.brandLogoHeight, ds.brandLogoHeight))),
      stockBackground: str(s.stockBackground, ds.stockBackground),
      stockBorder: str(s.stockBorder, ds.stockBorder),
      stockBorderWidth: num(s.stockBorderWidth, ds.stockBorderWidth),
      stockRadius: num(s.stockRadius, ds.stockRadius),
    },
  };
}

// ---- Render helpers (shared by the card and the admin preview) ------------

/** Typography → inline style, only the properties the merchant actually set. */
export function cardTypographyCss(
  value: ProductCardTypography | undefined,
): CSSProperties {
  if (!value) return {};
  const css: CSSProperties = {};
  if (value.weight) css.fontWeight = value.weight as CSSProperties["fontWeight"];
  if (value.style) css.fontStyle = value.style;
  if (value.size > 0) css.fontSize = `${value.size}px`;
  if (value.color) css.color = value.color;
  return css;
}

/**
 * The custom properties every product grid and shelf reads its gaps from
 * (`CARD_GRID_GAP` and friends in components/store/product-grid-columns.ts).
 * Set on the store surface only when the merchant switched custom spacing
 * on: unset, each grid's own fallback — the gap it shipped with — applies.
 */
export function cardGridGapVars(style: ProductCardStyle): Record<string, string> {
  if (!style.gridGapCustom) return {};
  return {
    "--card-grid-gap-x": `${style.gridColumnGap}px`,
    "--card-grid-gap-y": `${style.gridRowGap}px`,
  };
}

/** True when the wrapper draws any chrome of its own. */
function cardHasChrome(style: ProductCardStyle): boolean {
  return Boolean(
    style.cardBackground ||
      (style.cardBorder && style.cardBorderWidth > 0) ||
      style.cardShadow > 0 ||
      style.cardPadding > 0,
  );
}

/** The card wrapper's inline chrome; empty when nothing is customized. */
export function cardChromeCss(style: ProductCardStyle): CSSProperties {
  if (!cardHasChrome(style)) return {};
  const css: CSSProperties = { borderRadius: style.cardRadius };
  if (style.cardPadding > 0) css.padding = style.cardPadding;
  if (style.cardBackground) css.backgroundColor = style.cardBackground;
  if (style.cardBorder && style.cardBorderWidth > 0) {
    css.border = `${style.cardBorderWidth}px solid ${style.cardBorder}`;
  }
  if (style.cardShadow > 0) {
    css.boxShadow = `0 8px ${style.cardShadow}px rgba(0,0,0,0.12)`;
  }
  return css;
}

/**
 * The preview stage's inline geometry: a fixed height wins over the aspect
 * ratio; padding only matters for a contained shot.
 */
export function cardPreviewStageCss(style: ProductCardStyle): CSSProperties {
  const css: CSSProperties = { borderRadius: style.previewRadius };
  if (style.previewBackground) css.backgroundColor = style.previewBackground;
  if (style.previewHeight > 0) css.height = style.previewHeight;
  else css.aspectRatio = PRODUCT_CARD_PREVIEW_ASPECT_RATIOS[style.previewAspect];
  return css;
}

/** The persistent action button's inline chrome. */
export function cardButtonCss(style: ProductCardStyle): CSSProperties {
  const outline = style.cartVariant === "outline";
  const css: CSSProperties = { borderRadius: style.cartRadius };
  if (outline) {
    css.backgroundColor = style.cartBackground || "transparent";
    css.border = `${style.cartBorderWidth > 0 ? style.cartBorderWidth : 1}px solid ${
      style.cartBorder || "var(--border)"
    }`;
  } else {
    if (style.cartBackground) css.backgroundColor = style.cartBackground;
    if (style.cartBorderWidth > 0 && style.cartBorder) {
      css.border = `${style.cartBorderWidth}px solid ${style.cartBorder}`;
    }
  }
  return { ...css, ...cardTypographyCss(style.typography.cart) };
}

/** The "N% OFF" chip's inline colors; empty when it keeps the rose default. */
export function cardDiscountChipCss(style: ProductCardStyle): CSSProperties {
  const css: CSSProperties = {};
  if (style.discountChipBackground) {
    css.backgroundColor = style.discountChipBackground;
  }
  if (style.discountChipColor) css.color = style.discountChipColor;
  return css;
}

/** Groups → the visible element keys per group, empty groups dropped. */
export function visibleProductCardGroups(
  groups: ProductCardGroup[],
): ProductCardElement[][] {
  return groups
    .map((entry) => entry.items.filter((item) => item.on).map((item) => item.key))
    .filter((keys) => keys.length > 0);
}

/** Whether an element is present AND switched on anywhere in the groups. */
/**
 * A card's brand from whatever the loader handed over: the bare id every
 * card query carries (resolved through the store's brand directory), or an
 * already-populated brand. Null when the product has none — the element
 * then renders nothing rather than an empty line.
 */
export function resolveCardBrand(
  value: unknown,
  directory: Record<string, CardBrand>,
): CardBrand | null {
  if (typeof value === "string") return directory[value] ?? null;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    if (typeof source.name === "string" && source.name) {
      return {
        name: source.name,
        slug: typeof source.slug === "string" ? source.slug : "",
        logo: typeof source.logo === "string" ? source.logo : "",
      };
    }
    if (typeof source._id === "string") return directory[source._id] ?? null;
  }
  return null;
}

/**
 * Put the product's Brand on a card, for the builder's one-click fix.
 *
 * A card saved before Brand and Seller were separate had its "brand" element
 * read as Seller (the store name it always printed), so on those cards the
 * Brand settings change nothing until a Brand element exists. This puts one
 * where the merchant expects it: in the Seller's place when the card has one
 * — the line they were looking at — else just before the product name, else
 * at the end of the last group. A card that has a Brand already only has it
 * switched on.
 */
export function showBrandOnCard(groups: ProductCardGroup[]): ProductCardGroup[] {
  const has = (key: ProductCardElement) =>
    groups.some((entry) => entry.items.some((item) => item.key === key));

  if (has("brand")) {
    return groups.map((entry) => ({
      ...entry,
      items: entry.items.map((item) =>
        item.key === "brand" ? { ...item, on: true } : item,
      ),
    }));
  }

  if (has("seller")) {
    return groups.map((entry) => ({
      ...entry,
      items: entry.items.map((item) =>
        item.key === "seller" ? { key: "brand" as const, on: true } : item,
      ),
    }));
  }

  const brand = { key: "brand" as const, on: true };
  if (has("name")) {
    return groups.map((entry) => {
      const at = entry.items.findIndex((item) => item.key === "name");
      if (at < 0) return entry;
      const items = [...entry.items];
      items.splice(at, 0, brand);
      return { ...entry, items };
    });
  }

  if (groups.length === 0) return [{ id: "g1", items: [brand] }];
  return groups.map((entry, index) =>
    index === groups.length - 1
      ? { ...entry, items: [...entry.items, brand] }
      : entry,
  );
}

export function productCardElementOn(
  groups: ProductCardGroup[],
  key: ProductCardElement,
): boolean {
  return groups.some((entry) =>
    entry.items.some((item) => item.key === key && item.on),
  );
}
