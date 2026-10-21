/**
 * What the barcode and QR panels (and, in step 6, the Review tab) tell the
 * designer about one code element: the value it would encode for a context,
 * whether that value can be drawn, and the scan-size warnings (§5.7): a
 * barcode whose narrowest bar is under 0.25 mm at print size, a QR code
 * under 15 mm.
 *
 * It draws the code the renderer draws, from the same helpers and the same
 * inner box (the element minus its padding and border), so the panel and the
 * printed page can't disagree.
 *
 * Pure and client-safe.
 */
import type { PrintContext } from "../context-types";
import { barcodeValue, renderBarcode, type BarcodeIssue } from "../barcode";
import { qrValue, renderQr, type QrIssue } from "../qr";
import type { TemplateElementOf } from "../types";
import { pxToMm } from "../units";

/** The box a code is drawn in: the element's size without its padding and border (as the renderer does). */
export function codeBox(element: { widthMm: number; heightMm: number; style: { paddingMm: number; borderWidthPx: number } }) {
  const chrome = 2 * (element.style.paddingMm + pxToMm(element.style.borderWidthPx));
  return { widthMm: Math.max(1, element.widthMm - chrome), heightMm: Math.max(1, element.heightMm - chrome) };
}

export interface BarcodeCheck {
  /** What the element would encode for this context, or null when the order lacks it. */
  value: string | null;
  /** Why it can't be drawn, or null. */
  issue: BarcodeIssue | null;
  warnings: BarcodeIssue[];
  /** The narrowest bar at print size, when drawn. */
  moduleWidthMm: number | null;
}

export function barcodeCheck(element: TemplateElementOf<"barcode">, context: PrintContext): BarcodeCheck {
  const value = barcodeValue(element.config, context);
  const result = renderBarcode(element.config, value, codeBox(element));
  if (!result.ok) return { value, issue: result.error, warnings: [], moduleWidthMm: null };
  return { value: result.value, issue: null, warnings: result.warnings, moduleWidthMm: result.moduleWidthMm };
}

export interface QrCheck {
  value: string | null;
  issue: QrIssue | null;
  warnings: QrIssue[];
  /** The side of the drawn code, in mm. */
  sizeMm: number;
}

export function qrCheck(element: TemplateElementOf<"qr">, context: PrintContext): QrCheck {
  const value = qrValue(element.config, context);
  const box = codeBox(element);
  const result = renderQr(element.config, value, box);
  const sizeMm = Math.min(box.widthMm, box.heightMm);
  if (!result.ok) return { value, issue: result.error, warnings: [], sizeMm };
  return { value: result.value, issue: null, warnings: result.warnings, sizeMm };
}

/**
 * Whether a fixed QR address would be refused on Save: it must be an
 * http(s) address (the schema's rule for any address; a QR code with a bare
 * path is no use on paper). An empty address is "empty", not this.
 */
export function qrUrlProblem(url: string | undefined): "badUrl" | null {
  const value = url ?? "";
  if (value === "") return null;
  return /^https?:\/\/[^/\s]+/i.test(value) ? null : "badUrl";
}
