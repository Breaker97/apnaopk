import type { CSSProperties } from "react";
import type {
  ProductDetailStyle,
  ProductDetailTypography,
} from "@/lib/storefront/sections/product-detail-style";

/**
 * The product page's Style settings as inline style, for the page's client
 * controls. Kept apart from product-detail-style.ts: the parser and its
 * defaults run on the server, so the browser gets these functions and none
 * of that.
 */

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

type ProductDetailStockState = "in" | "out" | "preorder";

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
 * "full" is the buy box's row; "compact" is the same control in the pinned
 * tab bar, which keeps the bar's own height and text size.
 */
type PurchaseControlSize = "full" | "compact";

/**
 * A purchase button's inline style. Radius and height ride inline because
 * the store theme's [data-slot="button"] rules (globals.css) outrank any
 * rounded-* or h-* class on a Button; the case only when the merchant chose
 * one, so "theme" leaves the theme's button tokens in charge.
 */
export function purchaseButtonCss(
  style: ProductDetailStyle,
  kind: "cart" | "buy",
  size: PurchaseControlSize = "full",
): CSSProperties {
  const background = kind === "cart" ? style.cartBackground : style.buyBackground;
  const border = kind === "cart" ? style.cartBorder : style.buyBorder;
  const borderWidth = kind === "cart" ? style.cartBorderWidth : style.buyBorderWidth;
  const { fontSize, ...type } = typographyCss(style.typography[kind]);
  return {
    ...(size === "full" ? { height: style.buttonHeight } : {}),
    borderRadius: style.cartRadius,
    ...(background ? { backgroundColor: background } : {}),
    ...(border && borderWidth > 0
      ? { borderColor: border, borderWidth, borderStyle: "solid" }
      : {}),
    ...(style.buttonCase === "theme"
      ? {}
      : { textTransform: style.buttonCase === "uppercase" ? "uppercase" : "none" }),
    ...type,
    ...(size === "full" && fontSize ? { fontSize } : {}),
  };
}

/** The quantity stepper's box: the purchase controls' corners and its own outline. */
export function quantityStepperCss(
  style: ProductDetailStyle,
  size: PurchaseControlSize = "full",
): CSSProperties {
  return {
    borderRadius: style.cartRadius,
    ...(size === "full" ? { height: style.buttonHeight } : {}),
    ...(style.quantityBorder ? { borderColor: style.quantityBorder } : {}),
  };
}
