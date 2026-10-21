/**
 * Barcodes on a template (docs/INVOICE_TEMPLATE_BUILDER.md §5.7, D-12): the
 * value comes from the order number, the tracking number or fixed text; it is
 * validated with `inspectBarcode` and drawn as SVG through bwip-js. Bound
 * values are Code 128 only; EAN-13 and UPC-A are for fixed numeric text.
 *
 * Everything that can go wrong is a structured issue, never a throw: an
 * empty value, a value the format can't encode, a format the source doesn't
 * allow, and (a warning) a module narrower than 0.25 mm at print size,
 * which a scanner can't read.
 *
 * Client-safe: bwip-js's generic build is pure JS.
 */
import { toSVG } from "@bwip-js/generic";
import { inspectBarcode } from "@/lib/barcode/standards";
import type { PrintContext } from "./context-types";
import type { BarcodeConfig } from "./types";
import { pxToMm } from "./units";

/** A scanner needs at least this module width (§5.7). */
export const MIN_MODULE_WIDTH_MM = 0.25;
const MIN_BARS_HEIGHT_MM = 3;

export type BarcodeIssueCode = "empty" | "invalid" | "formatNotAllowed" | "tooSmall" | "renderFailed";

export interface BarcodeIssue {
  code: BarcodeIssueCode;
  /** A developer-readable detail; the editor translates `code`. */
  message: string;
}

export type BarcodeResult =
  | {
      ok: true;
      svg: string;
      value: string;
      modules: number;
      /** The narrowest bar at print size. */
      moduleWidthMm: number;
      warnings: BarcodeIssue[];
    }
  | { ok: false; error: BarcodeIssue };

/** The formats a source may use (D-12). */
export function allowedBarcodeFormats(source: BarcodeConfig["source"]): readonly BarcodeConfig["format"][] {
  return source === "fixed" ? ["code128", "ean13", "upca"] : ["code128"];
}

/** The text the barcode encodes for a context, or null when the order lacks it. */
export function barcodeValue(config: BarcodeConfig, context: PrintContext): string | null {
  switch (config.source) {
    case "orderNumber":
      return context.order.number?.trim() || null;
    case "trackingNumber":
      return context.delivery.trackingNumber?.trim() || null;
    default:
      return config.value?.trim() || null;
  }
}

/** Why a value can't be drawn with a config, or null when it can. */
export function inspectBarcodeConfig(config: BarcodeConfig, value: string | null): BarcodeIssue | null {
  if (!allowedBarcodeFormats(config.source).includes(config.format)) {
    return { code: "formatNotAllowed", message: `${config.format} is only for fixed numeric text; bound values use Code 128` };
  }
  if (!value) return { code: "empty", message: "Nothing to encode" };
  const inspection = inspectBarcode(value, { format: config.format });
  if (!inspection.valid) return { code: "invalid", message: inspection.message ?? "Invalid barcode value" };
  return null;
}

const BWIP_FORMAT: Record<BarcodeConfig["format"], string> = { code128: "code128", ean13: "ean13", upca: "upca" };

function viewBoxOf(svg: string): { width: number; height: number } | null {
  const match = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** How many modules wide the symbol is (a 1:1 render with no padding is that many units wide). */
function countModules(bcid: string, text: string): number {
  const probe = toSVG({ bcid, text, scale: 1, includetext: false, paddingwidth: 0, paddingheight: 0, height: 5 });
  return viewBoxOf(probe)?.width ?? 0;
}

/** Makes the SVG fill its box without distortion (it stays the aspect bwip-js drew). */
function fitSvg(svg: string): string {
  return svg.replace(/^<svg /, '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ');
}

/**
 * The barcode for a box of `widthMm × heightMm`. The bars take the box
 * minus the human-readable text (when shown); the symbol is scaled to the
 * box width and the module width reported at that size.
 */
export function renderBarcode(
  config: BarcodeConfig,
  value: string | null,
  box: { widthMm: number; heightMm: number },
): BarcodeResult {
  const issue = inspectBarcodeConfig(config, value);
  if (issue) return { ok: false, error: issue };
  const text = inspectBarcode(value, { format: config.format }).value;
  const bcid = BWIP_FORMAT[config.format];
  const textMm = config.showText ? pxToMm(config.textSizePx) * 1.4 : 0;
  const barsMm = Math.max(MIN_BARS_HEIGHT_MM, box.heightMm - textMm);
  try {
    const modules = countModules(bcid, text);
    const svg = toSVG({
      bcid,
      text,
      width: Math.max(1, box.widthMm),
      height: barsMm,
      includetext: config.showText,
      textxalign: "center",
      textsize: Math.max(4, config.textSizePx * 0.75),
      paddingwidth: 0,
      paddingheight: 0,
      backgroundcolor: "FFFFFF",
      barcolor: "000000",
      textcolor: "000000",
    });
    const viewBox = viewBoxOf(svg);
    // `meet` scaling: the symbol fills the box width unless the box is too short for it.
    const drawnWidthMm = viewBox ? Math.min(box.widthMm, (box.heightMm * viewBox.width) / viewBox.height) : box.widthMm;
    const moduleWidthMm = modules > 0 ? drawnWidthMm / modules : 0;
    const warnings: BarcodeIssue[] = [];
    if (moduleWidthMm < MIN_MODULE_WIDTH_MM) {
      warnings.push({
        code: "tooSmall",
        message: `Modules are ${moduleWidthMm.toFixed(2)} mm wide at this size; scanners need ${MIN_MODULE_WIDTH_MM} mm`,
      });
    }
    return { ok: true, svg: fitSvg(svg), value: text, modules, moduleWidthMm, warnings };
  } catch (error) {
    return { ok: false, error: { code: "renderFailed", message: error instanceof Error ? error.message : String(error) } };
  }
}
