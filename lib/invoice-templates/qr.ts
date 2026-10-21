/**
 * QR codes on a template (docs/INVOICE_TEMPLATE_BUILDER.md §5.7): the URL
 * comes from the tracking link, the store's order-tracking page, the store
 * website or fixed text, and is drawn as SVG from the `qrcode` package's
 * module matrix (synchronously, so the renderer can be pure). Problems are
 * structured issues: an empty value, data too long for a QR code, and (a
 * warning) a code under 15 mm, which phones struggle to scan.
 *
 * Client-safe.
 */
import QRCode from "qrcode";
import type { PrintContext } from "./context-types";
import type { QrConfig } from "./types";

/** Below this a phone camera struggles (§5.5, §5.7). */
export const MIN_QR_SIZE_MM = 15;

export type QrIssueCode = "empty" | "invalid" | "tooSmall";

export interface QrIssue {
  code: QrIssueCode;
  message: string;
}

export type QrResult =
  | {
      ok: true;
      svg: string;
      value: string;
      /** Modules per side, quiet zone excluded. */
      modules: number;
      /** One module's size at print size. */
      moduleSizeMm: number;
      warnings: QrIssue[];
    }
  | { ok: false; error: QrIssue };

function origin(website: string | null): string | null {
  const raw = website?.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

/** The store's own track-order page for the order (what the receipt's QR code opens). */
export function orderTrackingPageUrl(context: PrintContext): string | null {
  const base = origin(context.store.website);
  if (!base) return null;
  return `${base}/${encodeURIComponent(context.locale)}/track-order?orderNumber=${encodeURIComponent(context.order.number)}`;
}

/** The URL the QR code encodes for a context, or null when the order lacks it. */
export function qrValue(config: QrConfig, context: PrintContext): string | null {
  switch (config.source) {
    case "trackingLink":
      return context.delivery.trackingUrl?.trim() || null;
    case "orderTrackingPage":
      return orderTrackingPageUrl(context);
    case "storeWebsite":
      return context.store.website?.trim() || null;
    default:
      return config.url?.trim() || null;
  }
}

function matrixToPath(data: ArrayLike<number>, size: number, margin: number): string {
  let path = "";
  for (let row = 0; row < size; row += 1) {
    let run = 0;
    for (let col = 0; col <= size; col += 1) {
      const dark = col < size && data[row * size + col];
      if (dark) {
        run += 1;
        continue;
      }
      if (run > 0) {
        path += `M${col - run + margin} ${row + margin}h${run}v1h-${run}z`;
        run = 0;
      }
    }
  }
  return path;
}

/** The QR code for a square box of `sizeMm` (the smaller side of the element). */
export function renderQr(config: QrConfig, value: string | null, box: { widthMm: number; heightMm: number }): QrResult {
  const text = value?.trim();
  if (!text) return { ok: false, error: { code: "empty", message: "Nothing to encode" } };
  let modules: { size: number; data: ArrayLike<number> };
  try {
    const code = QRCode.create(text, { errorCorrectionLevel: config.errorCorrection });
    modules = { size: code.modules.size, data: code.modules.data as ArrayLike<number> };
  } catch (error) {
    return { ok: false, error: { code: "invalid", message: error instanceof Error ? error.message : String(error) } };
  }
  const margin = Math.max(0, Math.round(config.quietZone));
  const total = modules.size + margin * 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<path fill="#ffffff" d="M0 0h${total}v${total}H0z"/>` +
    `<path fill="#000000" d="${matrixToPath(modules.data, modules.size, margin)}"/></svg>`;
  const sizeMm = Math.min(box.widthMm, box.heightMm);
  const warnings: QrIssue[] = [];
  if (sizeMm < MIN_QR_SIZE_MM) {
    warnings.push({ code: "tooSmall", message: `${sizeMm.toFixed(1)} mm is under the ${MIN_QR_SIZE_MM} mm a phone can scan` });
  }
  return { ok: true, svg, value: text, modules: modules.size, moduleSizeMm: sizeMm / total, warnings };
}
