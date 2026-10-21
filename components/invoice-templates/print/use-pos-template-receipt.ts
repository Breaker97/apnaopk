"use client";

/**
 * The POS receipt on the default template (docs/INVOICE_TEMPLATE_BUILDER.md
 * §4.11, §7 Phase 6 step 5): the hook the till's `printReceipt` asks first.
 *
 * - `print(receipt)` resolves `true` when the template went to the print
 *   dialog and `false` when the till must print its legacy receipt: no
 *   template (nothing happens, no toast: D-02), or any failure — the fonts
 *   not ready in time, no iframe, a render error, anything thrown — after a
 *   toast. **The till never fails to print.**
 * - `remember(orderNumber, extras)` keeps what a sale just rung up knows
 *   beyond its receipt (the cart lines, the customer, the cashier, whether it
 *   reached the server) for its print and its reprint from the sale-complete
 *   screen.
 * - Everything is local: the template rides in the POS page's settings and
 *   the context is built from the receipt, so an offline sale prints the same
 *   way, without its order QR code until it has synced. The only requests
 *   are the template's font files, read once when the till opens (through
 *   the service worker's cache when offline) and carried inside each
 *   receipt as `data:` URLs: the print iframe is not under the service
 *   worker, so offline it could not fetch them itself. Reading them never
 *   holds a receipt past the till's font limit (4 s).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast-notification";
import { fontFaceCss } from "@/lib/invoice-templates/fonts";
import {
  isLocalReceiptNumber,
  posReceiptContext,
  withoutOrderQrCodes,
  type PosInvoiceTemplate,
  type PosReceiptExtras,
} from "@/lib/invoice-templates/pos-receipt";
import { inlineTemplateFontFaces } from "@/lib/invoice-templates/inline-fonts";
import { awaitTemplateFonts, printTemplate } from "@/lib/invoice-templates/print";
import type { ReceiptPrintPayload } from "@/lib/pos/receipt-html";
import { measureTemplate } from "./measure-template";

/** How long a receipt waits for the template fonts before printing the legacy one. */
export const TILL_FONT_TIMEOUT_MS = 4000;
const FONT_STYLE_ID = "invoice-template-font-faces";
const REMEMBERED_SALES = 20;

/**
 * Declares the template faces in this page, so they can be loaded (and
 * cached) ahead of a print: from their files, or from `css` (the inline
 * faces) once those have been read.
 */
export function installTemplateFontFaces(css?: string): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(FONT_STYLE_ID);
  if (existing) {
    if (css && existing.textContent !== css) existing.textContent = css;
    return;
  }
  const style = document.createElement("style");
  style.id = FONT_STYLE_ID;
  style.textContent = css ?? fontFaceCss(window.location.origin);
  document.head.appendChild(style);
}

/** Loads the template faces in this page; false when they can't be had in time (offline and never cached). */
export async function warmTemplateFonts(timeoutMs = TILL_FONT_TIMEOUT_MS): Promise<boolean> {
  if (typeof document === "undefined") return false;
  installTemplateFontFaces();
  return awaitTemplateFonts(document, timeoutMs).catch(() => false);
}

export interface PosTemplateReceiptSettings {
  invoiceTemplate?: PosInvoiceTemplate | null;
  storeLogoUrl?: string;
  currency: string;
  storeName?: string;
  storePhone?: string;
  storeEmail?: string;
  storeAddress?: string;
  storeDomain?: string;
  storeTaxId?: string;
}

export interface PosTemplateReceipt {
  /** Whether a POS default rides in this till's settings. */
  active: boolean;
  remember: (orderNumber: string, extras: PosReceiptExtras) => void;
  print: (receipt: ReceiptPrintPayload | null) => Promise<boolean>;
}

export function usePosTemplateReceipt(settings: PosTemplateReceiptSettings): PosTemplateReceipt {
  const t = useTranslations("admin.invoiceTemplates.orderPrint");
  const template = settings.invoiceTemplate ?? null;
  const extras = useRef(new Map<string, PosReceiptExtras>());

  // Online, with a template: read the faces now (the service worker keeps
  // the files too), so a receipt can carry them when the line goes down.
  useEffect(() => {
    if (!template) return;
    void inlineTemplateFontFaces().then(async (css) => {
      if (css) installTemplateFontFaces(css);
      else await warmTemplateFonts(TILL_FONT_TIMEOUT_MS * 2);
    });
  }, [template]);

  const remember = useCallback((orderNumber: string, value: PosReceiptExtras) => {
    const map = extras.current;
    map.delete(orderNumber);
    map.set(orderNumber, value);
    while (map.size > REMEMBERED_SALES) map.delete(map.keys().next().value as string);
  }, []);

  const {
    currency,
    storeName,
    storePhone,
    storeEmail,
    storeAddress,
    storeDomain,
    storeLogoUrl,
    storeTaxId,
  } = settings;

  const print = useCallback(
    async (receipt: ReceiptPrintPayload | null): Promise<boolean> => {
      if (!template || !receipt) return false;
      const fallBack = (reason: string, error?: unknown) => {
        console.warn(`[invoice-templates] receipt ${receipt.orderNumber} printed the standard way: ${reason}`, error ?? "");
        toast.error(t("fallback.receipt"));
        return false;
      };
      try {
        // The faces inside the receipt; failing that, from their files (online).
        // Both share the till's limit, so a stalled network can't hold the receipt.
        const deadline = Date.now() + TILL_FONT_TIMEOUT_MS;
        const inline = await inlineTemplateFontFaces(undefined, { timeoutMs: TILL_FONT_TIMEOUT_MS });
        if (inline) installTemplateFontFaces(inline);
        else if (!(await warmTemplateFonts(Math.max(0, deadline - Date.now())))) return fallBack("fonts");
        const known = extras.current.get(receipt.orderNumber);
        const synced = known?.synced ?? !isLocalReceiptNumber(receipt.orderNumber);
        const design = synced ? template.design : withoutOrderQrCodes(template.design);
        const context = posReceiptContext(receipt, {
          settings: {
            currency,
            storeName,
            storePhone,
            storeEmail,
            storeAddress,
            // The QR code's tracking page lives where the legacy receipt sends it.
            storeDomain: storeDomain || window.location.origin,
            logoUrl: storeLogoUrl,
            taxId: storeTaxId,
          },
          locale: design.locale,
          extras: known,
        });
        const measure = await measureTemplate(design, context, { timeoutMs: 1500 }).catch(() => null);
        const result = await printTemplate({
          design,
          context,
          measure,
          title: receipt.orderNumber,
          fontTimeoutMs: TILL_FONT_TIMEOUT_MS,
          ...(inline ? { fontFaceCss: inline } : {}),
        });
        return result.ok ? true : fallBack(result.reason, result.error);
      } catch (error) {
        return fallBack("error", error);
      }
    },
    [template, t, currency, storeName, storePhone, storeEmail, storeAddress, storeDomain, storeLogoUrl, storeTaxId],
  );

  return useMemo(() => ({ active: template !== null, remember, print }), [template, remember, print]);
}
