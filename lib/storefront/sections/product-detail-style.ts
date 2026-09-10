import type { CSSProperties } from "react";

/**
 * The Minimal product page's Visibility + Style configuration — shared by
 * the storefront renderer (product-main's "minimal" design) and the admin
 * editor, so both agree on what each knob means.
 *
 * Stored as a JSON string in the section's `detailStyle` text setting (the
 * same ride-the-existing-machinery choice as `rows`). Every value has a
 * default matching the design as shipped, so an absent or malformed config
 * changes nothing.
 *
 * This module must stay CLIENT-SAFE and pure (no server imports).
 */

export interface ProductDetailVisibility {
  /** "-N%" chip beside the price. */
  discountChip: boolean;
  /** The gallery's discount badge on the main image. */
  discountChipOnImage: boolean;
  /** "N sold" beside the rating (renders only when the product carries it). */
  itemSold: boolean;
  /** "(N)" review count beside the stars. */
  ratingCount: boolean;
  /** One star + the numeric rating instead of the five-star row. */
  ratingMinimized: boolean;
  /** "+N" variant count beside the rating. */
  variantCount: boolean;
}

export interface ProductDetailTypography {
  /** CSS font-weight keyword/number; empty = theme default. */
  weight: string;
  /** "normal" | "italic"; empty = theme default. */
  style: string;
  /** px; 0 = theme default. */
  size: number;
  /** CSS color; empty = theme default. */
  color: string;
}

export type ProductDetailTypographyKey =
  "brand" | "product" | "category" | "price" | "discounted" | "cart" | "stock";

interface ProductDetailStyle {
  /** The delivery/returns info card. */
  cardRadius: number;
  cardPadding: number;
  cardBackground: string;
  cardBorder: string;
  cardBorderWidth: number;
  /** The gallery's main media stage. */
  previewBackground: string;
  /** px; 0 = the layout's own responsive height. */
  previewHeight: number;
  /** Vertical space between row groups / between rows inside a group (px). */
  groupGap: number;
  itemGap: number;
  typography: Partial<
    Record<ProductDetailTypographyKey, ProductDetailTypography>
  >;
  /** The Add to cart button. */
  cartBackground: string;
  cartBorder: string;
  cartBorderWidth: number;
  cartRadius: number;
  /** Star fill; empty = the amber default. */
  ratingColor: string;
  /** The stock chip's background; empty = the status default. */
  stockBackground: string;
}

export interface ProductDetailConfig {
  visibility: ProductDetailVisibility;
  style: ProductDetailStyle;
}

const DEFAULT_PRODUCT_DETAIL_VISIBILITY: ProductDetailVisibility = {
  discountChip: true,
  discountChipOnImage: true,
  itemSold: true,
  ratingCount: true,
  ratingMinimized: false,
  variantCount: false,
};

export const EMPTY_TYPOGRAPHY: ProductDetailTypography = {
  weight: "",
  style: "",
  size: 0,
  color: "",
};

const DEFAULT_PRODUCT_DETAIL_STYLE: ProductDetailStyle = {
  cardRadius: 12,
  cardPadding: 16,
  cardBackground: "",
  cardBorder: "",
  cardBorderWidth: 1,
  previewBackground: "",
  previewHeight: 0,
  // The Figma rhythm: generous air between groups, tight rows inside one.
  groupGap: 36,
  itemGap: 10,
  typography: {},
  cartBackground: "",
  cartBorder: "",
  cartBorderWidth: 0,
  cartRadius: 5,
  ratingColor: "",
  stockBackground: "",
};

export const DEFAULT_PRODUCT_DETAIL_CONFIG: ProductDetailConfig = {
  visibility: DEFAULT_PRODUCT_DETAIL_VISIBILITY,
  style: DEFAULT_PRODUCT_DETAIL_STYLE,
};

const bool = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback;
const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

function parseTypography(raw: unknown): ProductDetailTypography | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const value: ProductDetailTypography = {
    weight: str(source.weight, ""),
    style: str(source.style, ""),
    size: num(source.size, 0),
    color: str(source.color, ""),
  };
  return value.weight || value.style || value.size || value.color
    ? value
    : undefined;
}

const TYPOGRAPHY_KEYS: ProductDetailTypographyKey[] = [
  "brand",
  "product",
  "category",
  "price",
  "discounted",
  "cart",
  "stock",
];

/** Stored JSON → validated config; anything malformed falls back per-field. */
export function parseProductDetailConfig(raw: unknown): ProductDetailConfig {
  if (typeof raw !== "string" || !raw.trim()) {
    return DEFAULT_PRODUCT_DETAIL_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PRODUCT_DETAIL_CONFIG;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return DEFAULT_PRODUCT_DETAIL_CONFIG;
  }
  const v = (parsed as { visibility?: unknown }).visibility;
  const s = (parsed as { style?: unknown }).style;
  const vs = (typeof v === "object" && v !== null ? v : {}) as Record<
    string,
    unknown
  >;
  const ss = (typeof s === "object" && s !== null ? s : {}) as Record<
    string,
    unknown
  >;
  const dv = DEFAULT_PRODUCT_DETAIL_VISIBILITY;
  const ds = DEFAULT_PRODUCT_DETAIL_STYLE;

  const typographyRaw =
    typeof ss.typography === "object" && ss.typography !== null
      ? (ss.typography as Record<string, unknown>)
      : {};
  const typography: ProductDetailStyle["typography"] = {};
  for (const key of TYPOGRAPHY_KEYS) {
    const value = parseTypography(typographyRaw[key]);
    if (value) typography[key] = value;
  }

  return {
    visibility: {
      discountChip: bool(vs.discountChip, dv.discountChip),
      discountChipOnImage: bool(vs.discountChipOnImage, dv.discountChipOnImage),
      itemSold: bool(vs.itemSold, dv.itemSold),
      ratingCount: bool(vs.ratingCount, dv.ratingCount),
      ratingMinimized: bool(vs.ratingMinimized, dv.ratingMinimized),
      variantCount: bool(vs.variantCount, dv.variantCount),
    },
    style: {
      cardRadius: num(ss.cardRadius, ds.cardRadius),
      cardPadding: num(ss.cardPadding, ds.cardPadding),
      cardBackground: str(ss.cardBackground, ds.cardBackground),
      cardBorder: str(ss.cardBorder, ds.cardBorder),
      cardBorderWidth: num(ss.cardBorderWidth, ds.cardBorderWidth),
      previewBackground: str(ss.previewBackground, ds.previewBackground),
      previewHeight: num(ss.previewHeight, ds.previewHeight),
      groupGap: num(ss.groupGap, ds.groupGap),
      itemGap: num(ss.itemGap, ds.itemGap),
      typography,
      cartBackground: str(ss.cartBackground, ds.cartBackground),
      cartBorder: str(ss.cartBorder, ds.cartBorder),
      cartBorderWidth: num(ss.cartBorderWidth, ds.cartBorderWidth),
      cartRadius: num(ss.cartRadius, ds.cartRadius),
      ratingColor: str(ss.ratingColor, ds.ratingColor),
      stockBackground: str(ss.stockBackground, ds.stockBackground),
    },
  };
}

/** Typography → inline style, only the properties the merchant actually set. */
export function typographyCss(
  value: ProductDetailTypography | undefined,
): CSSProperties {
  if (!value) return {};
  const css: CSSProperties = {};
  if (value.weight)
    css.fontWeight = value.weight as CSSProperties["fontWeight"];
  if (value.style) css.fontStyle = value.style;
  if (value.size > 0) css.fontSize = `${value.size}px`;
  if (value.color) css.color = value.color;
  return css;
}
