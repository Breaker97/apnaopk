/**
 * Printing a template (docs/INVOICE_TEMPLATE_BUILDER.md §4.6), following the
 * POS terminal's proven hidden-iframe pattern:
 *
 *   1. render the paginated pages to static markup (`TemplateRenderer` in
 *      print mode, with the measure the preview captured, so the paper gets
 *      the pages the screen showed);
 *   2. write it into a zero-size iframe with `@page { size: W H; margin: 0 }`;
 *   3. wait for the template fonts (Noto Sans Bengali included) and images;
 *   4. call `print()`;
 *   5. remove the iframe on `afterprint`, or 2 s after `print()` returns.
 *
 * When the iframe can't be opened or the fonts don't load, nothing prints:
 * `onFallback` is called so the caller can print its legacy output for the
 * category and show a toast (§4.6). Printing never writes anything (§4.1).
 *
 * Client only (`printTemplate`); `buildPrintDocument` is pure and also runs
 * in Node for tests.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { layoutTemplate, RENDERER_CSS, TemplateRenderer } from "@/components/invoice-templates/renderer/template-renderer";
import type { RenderMeasure } from "@/components/invoice-templates/renderer/types";
import type { PrintContext } from "./context-types";
import { BENGALI_FAMILY, FONTS_TO_LOAD } from "./fonts";
import type { TemplateDesign } from "./types";

/** Text that makes `document.fonts.load` fetch the Latin and the Bengali subsets alike. */
const FONT_PROBE_TEXT = "Aa0 ৳ অআক";
const FONT_TIMEOUT_MS = 8000;
const IMAGE_TIMEOUT_MS = 5000;
const CLEANUP_AFTER_MS = 2000;

/** The attribute the print iframe carries (tests and cleanup find it by it). */
export const PRINT_FRAME_ATTRIBUTE = "data-invoice-template-print";

export interface PrintDocumentOptions {
  design: TemplateDesign;
  context: PrintContext;
  /** What the preview measured (`TemplatePreview`'s `onMeasure`); estimates without it. */
  measure?: RenderMeasure | null;
  /** The document title (the print dialog's default file name). */
  title?: string;
  /** Origin for the font URLs; `location.origin` in the browser. */
  origin?: string;
  /**
   * The `@font-face` rules to use instead of the font URLs (`fontFaceCss` with
   * `data:` sources): a print that needs no network, as the till's offline.
   */
  fontFaceCss?: string;
}

export interface PrintDocument {
  html: string;
  pageCount: number;
  widthMm: number;
  heightMm: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The `@page` rule for a page. A roll (auto height) prints at the height its
 * content came to, not `Wmm auto`: `size` takes one or two lengths, so
 * `80mm auto` is invalid CSS and the browser would fall back to the print
 * dialog's paper size.
 */
export function pageSizeCss(widthMm: number, heightMm: number): string {
  return `@page{size:${round(widthMm)}mm ${round(heightMm)}mm;margin:0;}`;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** The whole print document as a string: the pages, the fonts, the page size. */
export function buildPrintDocument({ design, context, measure, title, origin = "", fontFaceCss }: PrintDocumentOptions): PrintDocument {
  const pagination = layoutTemplate(design, context, measure);
  const first = pagination.pages[0];
  const widthMm = first?.widthMm ?? design.canvas.widthMm;
  const heightMm = first?.heightMm ?? design.canvas.heightMm;
  const body = renderToStaticMarkup(
    createElement(TemplateRenderer, { template: design, context, mode: "print", measure, fontOrigin: origin, withStyles: fontFaceCss === undefined }),
  );
  const ownStyles = fontFaceCss === undefined ? "" : `<style>${fontFaceCss}\n${RENDERER_CSS}</style>`;
  const html =
    `<!doctype html><html lang="${design.locale}"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(title || context.order.number || "Invoice")}</title>` +
    `<style>${pageSizeCss(widthMm, heightMm)}html,body{margin:0;padding:0;background:#ffffff;}</style>` +
    ownStyles +
    `</head><body>${body}</body></html>`;
  return { html, pageCount: pagination.pages.length, widthMm, heightMm };
}

export type PrintFailure = "unavailable" | "iframe" | "fonts" | "render";

export type PrintResult = { ok: true; pageCount: number } | { ok: false; reason: PrintFailure; error?: unknown };

export interface PrintTemplateOptions extends PrintDocumentOptions {
  /** Called instead of printing when the template can't print: print the legacy output, show a toast. */
  onFallback?: (reason: PrintFailure, error?: unknown) => void;
  /** How long the fonts may take before the print gives up (default 8 s); the till waits less. */
  fontTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Loads every template face (both subsets) and reports whether Noto Sans Bengali is ready. */
export async function awaitTemplateFonts(doc: Document, timeoutMs = FONT_TIMEOUT_MS): Promise<boolean> {
  const fonts = doc.fonts;
  if (!fonts) return false;
  const loaded = await withTimeout(
    Promise.all(FONTS_TO_LOAD.map((spec) => fonts.load(spec, FONT_PROBE_TEXT))).then(() => fonts.ready),
    timeoutMs,
  ).catch(() => "timeout" as const);
  if (loaded === "timeout") return false;
  return fonts.check(`12px "${BENGALI_FAMILY}"`, FONT_PROBE_TEXT);
}

/** Waits for every image to load or fail (a broken image prints as nothing; it does not stop the print). */
function awaitImages(doc: Document, timeoutMs = IMAGE_TIMEOUT_MS): Promise<unknown> {
  const pending = Array.from(doc.images)
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    );
  return withTimeout(Promise.all(pending), timeoutMs);
}

/** Prints a template through a hidden iframe. Resolves once the print dialog was opened (or the fallback taken). */
export async function printTemplate(options: PrintTemplateOptions): Promise<PrintResult> {
  const fail = (reason: PrintFailure, error?: unknown): PrintResult => {
    options.onFallback?.(reason, error);
    return { ok: false, reason, error };
  };
  if (typeof window === "undefined" || typeof document === "undefined") return fail("unavailable");

  let printDocument: PrintDocument;
  try {
    printDocument = buildPrintDocument({ ...options, origin: options.origin ?? window.location.origin });
  } catch (error) {
    return fail("render", error);
  }

  const iframe = document.createElement("iframe");
  iframe.title = printDocument.html.match(/<title>(.*?)<\/title>/)?.[1] ?? "Print";
  iframe.setAttribute(PRINT_FRAME_ATTRIBUTE, "");
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "0",
    height: "0",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });
  document.body.appendChild(iframe);
  const cleanup = () => iframe.parentNode?.removeChild(iframe);

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument ?? win?.document;
  if (!win || !doc) {
    cleanup();
    return fail("iframe");
  }

  try {
    doc.open();
    doc.write(printDocument.html);
    doc.close();
  } catch (error) {
    cleanup();
    return fail("iframe", error);
  }

  const fontsReady = await awaitTemplateFonts(doc, options.fontTimeoutMs).catch(() => false);
  if (!fontsReady) {
    cleanup();
    return fail("fonts");
  }
  await awaitImages(doc);

  const safety = { timer: 0 as ReturnType<typeof setTimeout> | 0 };
  const onAfterPrint = () => {
    if (safety.timer) clearTimeout(safety.timer);
    win.removeEventListener("afterprint", onAfterPrint);
    cleanup();
  };
  win.addEventListener("afterprint", onAfterPrint);
  try {
    win.focus();
    win.print();
  } catch (error) {
    win.removeEventListener("afterprint", onAfterPrint);
    cleanup();
    return fail("iframe", error);
  }
  // print() blocks while the dialog is open in most browsers; where it does
  // not, the iframe stays long enough for the dialog to take its snapshot.
  safety.timer = setTimeout(onAfterPrint, CLEANUP_AFTER_MS);
  return { ok: true, pageCount: printDocument.pageCount };
}
