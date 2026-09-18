import type { CSSProperties } from "react";

/**
 * The Minimal product page's Visibility + Style configuration — shared by
 * the storefront renderer (product-main's "minimal" design) and the admin
 * editor, so both agree on what each knob means.
 *
 * Stored as a JSON string in the section's `detailStyle` text setting (the
 * same ride-the-existing-machinery choice as `rows`). Every value has a
 * default matching the design as shipped, so an absent or malformed config
 * changes nothing — and a store that saved its config before a knob existed
 * renders exactly as it did.
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
  /** The quantity stepper beside the buttons. */
  quantity: boolean;
  /** The gallery's zoom: magnify on hover and the zoom toggle button. */
  zoom: boolean;
  /** The thumbnail strip under (or beside) the main image. */
  thumbnails: boolean;
  /** The first accordion (Overview) arrives open. */
  accordionOpenFirst: boolean;
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
  | "brand"
  | "product"
  | "category"
  | "price"
  | "discounted"
  | "cart"
  | "buy"
  | "stock"
  | "accordion";

/** Which purchase buttons the page offers. */
export const PRODUCT_DETAIL_ACTIONS = ["both", "cart", "buy"] as const;
export type ProductDetailActions = (typeof PRODUCT_DETAIL_ACTIONS)[number];

/** Side by side, or one above the other at full width. */
export const PRODUCT_DETAIL_BUTTON_LAYOUTS = ["inline", "stacked"] as const;
export type ProductDetailButtonLayout =
  (typeof PRODUCT_DETAIL_BUTTON_LAYOUTS)[number];

/** "theme" leaves the case to the theme's button tokens. */
export const PRODUCT_DETAIL_BUTTON_CASES = ["theme", "none", "uppercase"] as const;
export type ProductDetailButtonCase = (typeof PRODUCT_DETAIL_BUTTON_CASES)[number];

export const PRODUCT_DETAIL_ACCORDION_ICONS = ["plus", "chevron"] as const;
export type ProductDetailAccordionIcon =
  (typeof PRODUCT_DETAIL_ACCORDION_ICONS)[number];

/**
 * How an image sits in its frame when the image itself says nothing
 * (ProductMedia.fit "auto"): floated inside with air around it, or filling
 * the frame edge to edge.
 */
export const PRODUCT_DETAIL_IMAGE_FITS = ["contain", "cover"] as const;
export type ProductDetailImageFit = (typeof PRODUCT_DETAIL_IMAGE_FITS)[number];

export const PRODUCT_DETAIL_SHARE_NETWORKS = [
  "facebook",
  "twitter",
  "whatsapp",
  "email",
  "copyLink",
] as const;
export type ProductDetailShareNetwork =
  (typeof PRODUCT_DETAIL_SHARE_NETWORKS)[number];

export interface ProductDetailStyle {
  /** The delivery/returns info card. */
  cardRadius: number;
  cardPadding: number;
  cardBackground: string;
  cardBorder: string;
  cardBorderWidth: number;
  /** The gallery's media stage. */
  previewBackground: string;
  /**
   * px; 0 = the layout's own responsive height. The main image in
   * Bottom/Left/Full, the horizontal carousel's track (each slide then as
   * wide as its image), and each grid tile. The vertical carousel ignores it:
   * every image there is full width at its own proportions.
   */
  previewHeight: number;
  /** Vertical space between row groups / between rows inside a group (px). */
  groupGap: number;
  itemGap: number;
  typography: Partial<
    Record<ProductDetailTypographyKey, ProductDetailTypography>
  >;

  /* ---- Brand ---- */
  /** The brand logo's box, px. */
  brandLogoHeight: number;
  brandLogoMaxWidth: number;

  /* ---- Page layout ---- */
  /** The gallery column's share of the two columns, percent. */
  galleryWidth: number;
  /** Pin the shorter column while the other scrolls. */
  stickyColumn: boolean;
  /** px; 0 = the store's container width. */
  contentMaxWidth: number;
  /**
   * The gallery runs out to the screen's left edge instead of stopping at
   * the page margin. Stacked (phones, and the Full Width layout) there is no
   * left column to run out of, so it spans edge to edge.
   */
  galleryBleedLeft: boolean;
  /** The gallery starts flush under the header, without the page's top space. */
  galleryBleedTop: boolean;

  /* ---- Gallery ---- */
  imageRadius: number;
  /** Between stacked or tiled images, and between the image and its thumbnails. */
  imageGap: number;
  imageFit: ProductDetailImageFit;
  /** Air around a contained image, px; -1 = the layout's responsive default. */
  imagePadding: number;
  /** Thumbnail width, px; 0 = the layout's own. */
  thumbSize: number;
  thumbRadius: number;
  /** Outline on the selected thumbnail; "" = the tile's surface step. */
  thumbActiveBorder: string;

  /* ---- Buttons ---- */
  actions: ProductDetailActions;
  buttonHeight: number;
  buttonLayout: ProductDetailButtonLayout;
  buttonCase: ProductDetailButtonCase;
  /** Button text; "" = the storefront's localized wording. */
  cartLabel: string;
  buyLabel: string;
  /** The Add to cart button. */
  cartBackground: string;
  cartBorder: string;
  cartBorderWidth: number;
  /** Every purchase control's corners: both buttons and the stepper. */
  cartRadius: number;
  /** The Buy now button. */
  buyBackground: string;
  buyBorder: string;
  buyBorderWidth: number;
  /** The quantity stepper's outline; "" = the text colour. */
  quantityBorder: string;

  /* ---- Stock & price badges ---- */
  /** Star fill; empty = the amber default. */
  ratingColor: string;
  /**
   * Legacy: one background for every stock state. Kept so a saved config
   * still reads, and used as the per-state backgrounds' fallback.
   */
  stockBackground: string;
  stockRadius: number;
  inStockBackground: string;
  inStockColor: string;
  outOfStockBackground: string;
  outOfStockColor: string;
  preorderBackground: string;
  preorderColor: string;
  /** The "Only N left" line. */
  lowStockColor: string;
  discountBackground: string;
  discountColor: string;
  discountRadius: number;

  /* ---- Accordions ---- */
  accordionIcon: ProductDetailAccordionIcon;
  /** The hairline between accordions; "" = the theme's border colour. */
  accordionDivider: string;

  /* ---- Share ---- */
  shareSize: number;
  shareRadius: number;
  shareBackground: string;
  shareIconColor: string;
  /** Networks this page offers — within what the store's share settings allow. */
  shareNetworks: Record<ProductDetailShareNetwork, boolean>;
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
  quantity: true,
  zoom: true,
  thumbnails: true,
  accordionOpenFirst: false,
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

  // The logo box as shipped: h-12 w-56.
  brandLogoHeight: 48,
  brandLogoMaxWidth: 224,

  galleryWidth: 50,
  stickyColumn: true,
  contentMaxWidth: 0,
  galleryBleedLeft: false,
  galleryBleedTop: false,

  // rounded-lg frames, 16px rhythm, contained shots at their responsive air.
  imageRadius: 8,
  imageGap: 16,
  imageFit: "contain",
  imagePadding: -1,
  thumbSize: 0,
  thumbRadius: 6,
  thumbActiveBorder: "",

  actions: "both",
  buttonHeight: 44,
  buttonLayout: "inline",
  buttonCase: "theme",
  cartLabel: "",
  buyLabel: "",
  cartBackground: "",
  cartBorder: "",
  cartBorderWidth: 0,
  cartRadius: 5,
  buyBackground: "",
  buyBorder: "",
  buyBorderWidth: 0,
  quantityBorder: "",

  ratingColor: "",
  stockBackground: "",
  stockRadius: 8,
  inStockBackground: "",
  inStockColor: "",
  outOfStockBackground: "",
  outOfStockColor: "",
  preorderBackground: "",
  preorderColor: "",
  lowStockColor: "",
  discountBackground: "",
  discountColor: "",
  discountRadius: 999,

  accordionIcon: "plus",
  accordionDivider: "",

  // The tile variant as shipped: h-10 w-10 rounded-lg on the muted surface.
  shareSize: 40,
  shareRadius: 8,
  shareBackground: "",
  shareIconColor: "",
  shareNetworks: {
    facebook: true,
    twitter: true,
    whatsapp: true,
    email: true,
    copyLink: true,
  },
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
const clamp = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) => Math.min(max, Math.max(min, num(value, fallback)));
const oneOf = <T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T =>
  typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

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
  "buy",
  "stock",
  "accordion",
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

  const networksRaw =
    typeof ss.shareNetworks === "object" && ss.shareNetworks !== null
      ? (ss.shareNetworks as Record<string, unknown>)
      : {};
  const shareNetworks = Object.fromEntries(
    PRODUCT_DETAIL_SHARE_NETWORKS.map((network) => [
      network,
      bool(networksRaw[network], ds.shareNetworks[network]),
    ]),
  ) as ProductDetailStyle["shareNetworks"];

  // A config saved before per-state stock colours painted every state with
  // one background; each state inherits it until given its own.
  const legacyStock = str(ss.stockBackground, ds.stockBackground);

  return {
    visibility: {
      discountChip: bool(vs.discountChip, dv.discountChip),
      discountChipOnImage: bool(vs.discountChipOnImage, dv.discountChipOnImage),
      itemSold: bool(vs.itemSold, dv.itemSold),
      ratingCount: bool(vs.ratingCount, dv.ratingCount),
      ratingMinimized: bool(vs.ratingMinimized, dv.ratingMinimized),
      variantCount: bool(vs.variantCount, dv.variantCount),
      quantity: bool(vs.quantity, dv.quantity),
      zoom: bool(vs.zoom, dv.zoom),
      thumbnails: bool(vs.thumbnails, dv.thumbnails),
      accordionOpenFirst: bool(vs.accordionOpenFirst, dv.accordionOpenFirst),
    },
    style: {
      cardRadius: num(ss.cardRadius, ds.cardRadius),
      cardPadding: num(ss.cardPadding, ds.cardPadding),
      cardBackground: str(ss.cardBackground, ds.cardBackground),
      cardBorder: str(ss.cardBorder, ds.cardBorder),
      cardBorderWidth: num(ss.cardBorderWidth, ds.cardBorderWidth),
      previewBackground: str(ss.previewBackground, ds.previewBackground),
      previewHeight: clamp(ss.previewHeight, ds.previewHeight, 0, 1600),
      groupGap: num(ss.groupGap, ds.groupGap),
      itemGap: num(ss.itemGap, ds.itemGap),
      typography,

      brandLogoHeight: clamp(ss.brandLogoHeight, ds.brandLogoHeight, 12, 160),
      brandLogoMaxWidth: clamp(ss.brandLogoMaxWidth, ds.brandLogoMaxWidth, 40, 600),

      galleryWidth: clamp(ss.galleryWidth, ds.galleryWidth, 30, 70),
      stickyColumn: bool(ss.stickyColumn, ds.stickyColumn),
      contentMaxWidth: clamp(ss.contentMaxWidth, ds.contentMaxWidth, 0, 2400),
      galleryBleedLeft: bool(ss.galleryBleedLeft, ds.galleryBleedLeft),
      galleryBleedTop: bool(ss.galleryBleedTop, ds.galleryBleedTop),

      imageRadius: clamp(ss.imageRadius, ds.imageRadius, 0, 48),
      imageGap: clamp(ss.imageGap, ds.imageGap, 0, 64),
      imageFit: oneOf(PRODUCT_DETAIL_IMAGE_FITS, ss.imageFit, ds.imageFit),
      imagePadding: clamp(ss.imagePadding, ds.imagePadding, -1, 120),
      thumbSize: clamp(ss.thumbSize, ds.thumbSize, 0, 200),
      thumbRadius: clamp(ss.thumbRadius, ds.thumbRadius, 0, 48),
      thumbActiveBorder: str(ss.thumbActiveBorder, ds.thumbActiveBorder),

      actions: oneOf(PRODUCT_DETAIL_ACTIONS, ss.actions, ds.actions),
      buttonHeight: clamp(ss.buttonHeight, ds.buttonHeight, 32, 72),
      buttonLayout: oneOf(PRODUCT_DETAIL_BUTTON_LAYOUTS, ss.buttonLayout, ds.buttonLayout),
      buttonCase: oneOf(PRODUCT_DETAIL_BUTTON_CASES, ss.buttonCase, ds.buttonCase),
      cartLabel: str(ss.cartLabel, ds.cartLabel).slice(0, 40),
      buyLabel: str(ss.buyLabel, ds.buyLabel).slice(0, 40),
      cartBackground: str(ss.cartBackground, ds.cartBackground),
      cartBorder: str(ss.cartBorder, ds.cartBorder),
      cartBorderWidth: num(ss.cartBorderWidth, ds.cartBorderWidth),
      cartRadius: num(ss.cartRadius, ds.cartRadius),
      buyBackground: str(ss.buyBackground, ds.buyBackground),
      buyBorder: str(ss.buyBorder, ds.buyBorder),
      buyBorderWidth: num(ss.buyBorderWidth, ds.buyBorderWidth),
      quantityBorder: str(ss.quantityBorder, ds.quantityBorder),

      ratingColor: str(ss.ratingColor, ds.ratingColor),
      stockBackground: legacyStock,
      stockRadius: clamp(ss.stockRadius, ds.stockRadius, 0, 999),
      inStockBackground: str(ss.inStockBackground, legacyStock),
      inStockColor: str(ss.inStockColor, ds.inStockColor),
      outOfStockBackground: str(ss.outOfStockBackground, legacyStock),
      outOfStockColor: str(ss.outOfStockColor, ds.outOfStockColor),
      preorderBackground: str(ss.preorderBackground, legacyStock),
      preorderColor: str(ss.preorderColor, ds.preorderColor),
      lowStockColor: str(ss.lowStockColor, ds.lowStockColor),
      discountBackground: str(ss.discountBackground, ds.discountBackground),
      discountColor: str(ss.discountColor, ds.discountColor),
      discountRadius: clamp(ss.discountRadius, ds.discountRadius, 0, 999),

      accordionIcon: oneOf(PRODUCT_DETAIL_ACCORDION_ICONS, ss.accordionIcon, ds.accordionIcon),
      accordionDivider: str(ss.accordionDivider, ds.accordionDivider),

      shareSize: clamp(ss.shareSize, ds.shareSize, 24, 72),
      shareRadius: clamp(ss.shareRadius, ds.shareRadius, 0, 999),
      shareBackground: str(ss.shareBackground, ds.shareBackground),
      shareIconColor: str(ss.shareIconColor, ds.shareIconColor),
      shareNetworks,
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

/** Only the colours that are set, as inline style. */
function paint(background: string, color: string): CSSProperties {
  const css: CSSProperties = {};
  if (background) css.backgroundColor = background;
  if (color) css.color = color;
  return css;
}

export type ProductDetailStockState = "in" | "out" | "preorder";

/**
 * The stock chip's inline style for a state: its radius, its own colours
 * where set, and the Stock Text typography over them. An unset colour keeps
 * the status class's default, so a fresh page still reads green/red/blue.
 */
export function stockChipCss(
  style: ProductDetailStyle,
  state: ProductDetailStockState,
): CSSProperties {
  const colors =
    state === "preorder"
      ? paint(style.preorderBackground, style.preorderColor)
      : state === "in"
        ? paint(style.inStockBackground, style.inStockColor)
        : paint(style.outOfStockBackground, style.outOfStockColor);
  return {
    borderRadius: style.stockRadius,
    ...colors,
    ...typographyCss(style.typography.stock),
  };
}

/** The "N% OFF" chip beside the price. */
export function discountChipCss(style: ProductDetailStyle): CSSProperties {
  return {
    borderRadius: style.discountRadius,
    ...paint(style.discountBackground, style.discountColor),
  };
}

/**
 * A purchase button's inline style. Radius and height ride inline because
 * the store theme's [data-slot="button"] rules (globals.css) outrank any
 * rounded-* or h-* class on a Button; the case only when the merchant chose
 * one, so "theme" leaves the theme's button tokens in charge.
 */
export function purchaseButtonCss(
  style: ProductDetailStyle,
  kind: "cart" | "buy",
): CSSProperties {
  const background = kind === "cart" ? style.cartBackground : style.buyBackground;
  const border = kind === "cart" ? style.cartBorder : style.buyBorder;
  const borderWidth = kind === "cart" ? style.cartBorderWidth : style.buyBorderWidth;
  return {
    height: style.buttonHeight,
    borderRadius: style.cartRadius,
    ...(background ? { backgroundColor: background } : {}),
    ...(border && borderWidth > 0
      ? { borderColor: border, borderWidth, borderStyle: "solid" }
      : {}),
    ...(style.buttonCase === "theme"
      ? {}
      : { textTransform: style.buttonCase === "uppercase" ? "uppercase" : "none" }),
    ...typographyCss(style.typography[kind]),
  };
}
