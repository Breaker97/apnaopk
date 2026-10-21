/**
 * "Add to canvas" (docs/INVOICE_TEMPLATE_BUILDER.md §5.3): every item the
 * palette offers, the element type it makes and what that element starts
 * as. Labels live in the locale files under
 * `admin.invoiceTemplates.editor.palette.items.<key>`; this file is data.
 *
 * Pure and client-safe.
 */
import { printableArea } from "../canvas-sizes";
import {
  defaultElement,
  type ElementType,
  type TemplateCategory,
  type TemplateDesign,
  type TemplateElement,
  type TemplateLocale,
} from "../types";
import { roundMm } from "../units";

export type PaletteGroup = "smart" | "basic";

export const PALETTE_ITEM_KEYS = [
  // Smart blocks
  "businessHeader",
  "customerAddress",
  "orderSummary",
  "productTable",
  "priceSummary",
  "codBadge",
  "smartBarcode",
  "smartQr",
  "deliveryMethod",
  "notes",
  "divider",
  "logo",
  "productRows",
  // Basic elements
  "text",
  "image",
  "barcode",
  "qr",
  "line",
  "box",
  "products",
] as const;
export type PaletteItemKey = (typeof PALETTE_ITEM_KEYS)[number];

export type PaletteItem = { key: PaletteItemKey; group: PaletteGroup; type: ElementType };

const item = (key: PaletteItemKey, group: PaletteGroup, type: ElementType): PaletteItem => ({ key, group, type });

/** §5.3, in the order the palette lists them. */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  item("businessHeader", "smart", "businessHeader"),
  item("customerAddress", "smart", "customerAddress"),
  item("orderSummary", "smart", "orderSummary"),
  item("productTable", "smart", "productTable"),
  item("priceSummary", "smart", "priceSummary"),
  item("codBadge", "smart", "codBadge"),
  item("smartBarcode", "smart", "barcode"),
  item("smartQr", "smart", "qr"),
  item("deliveryMethod", "smart", "deliveryMethod"),
  item("notes", "smart", "notes"),
  item("divider", "smart", "line"),
  item("logo", "smart", "image"),
  item("productRows", "smart", "productRows"),
  item("text", "basic", "text"),
  item("image", "basic", "image"),
  item("barcode", "basic", "barcode"),
  item("qr", "basic", "qr"),
  item("line", "basic", "line"),
  item("box", "basic", "box"),
  item("products", "basic", "productTable"),
];

export function paletteItem(key: PaletteItemKey): PaletteItem {
  return PALETTE_ITEMS.find((entry) => entry.key === key)!;
}

export function isPaletteItemKey(value: unknown): value is PaletteItemKey {
  return typeof value === "string" && (PALETTE_ITEM_KEYS as readonly string[]).includes(value);
}

/** The drag-and-drop payload type a palette item carries onto the canvas. */
export const PALETTE_DRAG_TYPE = "application/x-storify-invoice-element";

/** A basic barcode's fixed sample value (Code 128). */
export const SAMPLE_BARCODE_VALUE = "1234567890";

const TEXT_SAMPLE: Record<TemplateLocale, string> = { en: "Text", bn: "লেখা" };

export interface BuildPaletteElementInput {
  design: TemplateDesign;
  category: TemplateCategory;
  id: string;
  name: string;
  zIndex: number;
  /** Where the element's centre lands, in page mm; it is then kept inside the printable area when it fits. */
  centre: { xMm: number; yMm: number };
}

/** The element a palette item adds, with its §5.3 starting content, sized and placed on the page. */
export function buildPaletteElement(key: PaletteItemKey, input: BuildPaletteElementInput): TemplateElement {
  const { type } = paletteItem(key);
  const element = defaultElement(type, { id: input.id, name: input.name, zIndex: input.zIndex }) as TemplateElement;
  const area = printableArea(input.design.canvas);

  switch (element.type) {
    case "barcode":
      if (key === "smartBarcode") {
        element.config = { ...element.config, source: input.category === "sticker" ? "trackingNumber" : "orderNumber" };
      } else {
        element.config = { ...element.config, source: "fixed", value: SAMPLE_BARCODE_VALUE };
      }
      break;
    case "qr":
      if (key === "qr") element.config = { ...element.config, source: "storeWebsite" };
      break;
    case "image":
      if (key === "image") element.config = { source: "media", fit: "contain" };
      break;
    case "line":
      // The divider spans the printable width.
      if (key === "divider") element.widthMm = area.widthMm;
      break;
    case "box":
      element.widthMm = 50;
      element.heightMm = 30;
      element.style = { ...element.style, borderWidthPx: 1, borderStyle: "solid" };
      break;
    case "productTable":
      if (key === "products") {
        element.config = {
          ...element.config,
          columns: [
            { key: "item.name", widthPct: 60, align: "left" },
            { key: "item.qty", widthPct: 15, align: "center" },
            { key: "item.lineTotal", widthPct: 25, align: "right" },
          ],
          lines: "none",
          headerFill: "",
        };
      }
      break;
    case "text":
      element.binding = { mode: "fixed", text: TEXT_SAMPLE[input.design.locale] };
      break;
    default:
      break;
  }

  // Never wider than the printable area, nor taller on a fixed page.
  element.widthMm = roundMm(Math.min(element.widthMm, Math.max(1, area.widthMm)));
  if (input.design.canvas.heightMode === "fixed") {
    element.heightMm = roundMm(Math.min(element.heightMm, Math.max(1, area.heightMm)));
  }
  const keepInside = (start: number, size: number, from: number, length: number) =>
    size > length ? from : Math.min(from + length - size, Math.max(from, start));
  const x = key === "divider" ? area.xMm : keepInside(input.centre.xMm - element.widthMm / 2, element.widthMm, area.xMm, area.widthMm);
  const y =
    input.design.canvas.heightMode === "fixed"
      ? keepInside(input.centre.yMm - element.heightMm / 2, element.heightMm, area.yMm, area.heightMm)
      : Math.max(area.yMm, input.centre.yMm - element.heightMm / 2);
  element.xMm = roundMm(x);
  element.yMm = roundMm(y);
  return element;
}
