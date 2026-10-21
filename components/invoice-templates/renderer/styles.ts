/**
 * Element style → CSS (docs/INVOICE_TEMPLATE_BUILDER.md §4.3 `style`,
 * D-15). Lengths are CSS `mm` (the browser lays them out at 96 dpi, exactly
 * `units.ts`), font sizes CSS `px`. Zoom never enters here.
 */
import type { CSSProperties } from "react";
import { fontFamilyFor } from "@/lib/invoice-templates/fonts";
import type { ElementStyle, TemplateCanvas, TemplateElement } from "@/lib/invoice-templates/types";
import type { PlacedElement } from "@/lib/invoice-templates/pagination";

export const mm = (value: number): string => `${Math.round(value * 1000) / 1000}mm`;
export const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

const transparent = (color: string) => !color || color === "transparent";

/** The absolutely positioned box an element prints in. */
export function placementStyle(placed: PlacedElement, element: TemplateElement): CSSProperties {
  return {
    position: "absolute",
    left: mm(placed.xMm),
    top: mm(placed.yMm),
    width: mm(placed.widthMm),
    height: mm(placed.heightMm),
    zIndex: element.zIndex,
    transform: element.rotationDeg ? `rotate(${element.rotationDeg}deg)` : undefined,
    transformOrigin: "center center",
    overflow: "hidden",
  };
}

/** Background, border, radius and padding from the element's style. */
export function boxStyle(style: ElementStyle): CSSProperties {
  const bordered = style.borderStyle !== "none" && style.borderWidthPx > 0;
  return {
    background: transparent(style.background) ? undefined : style.background,
    border: bordered ? `${px(style.borderWidthPx)} ${style.borderStyle} ${style.borderColor}` : undefined,
    borderRadius: style.radiusPx ? px(style.radiusPx) : undefined,
    padding: style.paddingMm ? mm(style.paddingMm) : undefined,
    boxSizing: "border-box",
  };
}

/** Font, colour and alignment from the element's style, on the canvas's default face. */
export function textStyle(style: ElementStyle, canvas: TemplateCanvas, fontSizePx = style.fontSizePx): CSSProperties {
  return {
    fontFamily: fontFamilyFor(style.fontFamily ?? canvas.defaultFont),
    fontSize: px(fontSizePx),
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textAlign: style.textAlign,
    lineHeight: style.lineHeight,
    color: style.color,
  };
}

const JUSTIFY: Record<ElementStyle["verticalAlign"], CSSProperties["justifyContent"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/** A column that stacks content and honours the vertical alignment. */
export function stackStyle(style: ElementStyle): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: JUSTIFY[style.verticalAlign],
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: 0,
  };
}

/** The full element box: placement, box and text in one (the placement's mm size wins over the stack's 100 %). */
export function elementStyle(placed: PlacedElement, element: TemplateElement, canvas: TemplateCanvas, fontSizePx?: number): CSSProperties {
  return {
    ...stackStyle(element.style),
    ...placementStyle(placed, element),
    ...boxStyle(element.style),
    ...textStyle(element.style, canvas, fontSizePx),
  };
}

/** The horizontal alignment a cell or row uses. */
export function alignStyle(align: "left" | "center" | "right"): CSSProperties {
  return { textAlign: align };
}
