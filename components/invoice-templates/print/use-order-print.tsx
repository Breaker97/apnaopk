"use client";

/**
 * Printing an order with the default template (docs/INVOICE_TEMPLATE_BUILDER.md
 * §7 Phase 6 steps 1–4, 6): the hook behind **Print invoice** and **Print
 * sticker** on the admin, staff and vendor order pages.
 *
 * - `defaults` says which categories have a default here (null until known);
 *   a page offers Print invoice only with `online`, and swaps an internal
 *   label's print for the sticker only with `sticker`. Without either, every
 *   button behaves exactly as before (D-02).
 * - `printInvoice` / `printSticker` resolve `true` when the template went to
 *   the print dialog, `false` when the caller must print its legacy output:
 *   the default is gone, the route refused or failed, or the print helper
 *   could not print (no iframe, fonts not ready). A toast has said why.
 * - A print that finds a default gone flips `defaults` in every
 *   `useOrderPrint` of that order on the page, so no button offers it.
 *
 * Reads only: two GETs, a hidden measuring render and the print iframe.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast-notification";
import { printTemplate } from "@/lib/invoice-templates/print";
import type { TemplateCategory } from "@/lib/invoice-templates/types";
import { measureTemplate } from "./measure-template";
import {
  fetchOrderPrint,
  fetchPrintDefaults,
  onPrintDefaultGone,
  printDefaultGone,
  type OrderPrintBase,
  type PrintDefaults,
} from "./order-print";

export interface OrderPrint {
  /** Which categories print with a template on this order; null until known. */
  defaults: PrintDefaults | null;
  /** The category being printed, while a print is being prepared. */
  busy: TemplateCategory | null;
  /** "Print sticker" when the sticker default applies, else null (keep the button's own wording). */
  stickerLabel: string | null;
  /** The whole order (a scoped staff member: their consignments; a vendor: theirs) on the online default. */
  printInvoice: () => Promise<boolean>;
  /** A consignment (or, without one, what the caller may see of the order) on the sticker default. */
  printSticker: (options?: { consignmentId?: string | null }) => Promise<boolean>;
}

export function useOrderPrint({ base, orderId }: { base: OrderPrintBase; orderId: string }): OrderPrint {
  const t = useTranslations("admin.invoiceTemplates.orderPrint");
  const [defaults, setDefaults] = useState<PrintDefaults | null>(null);
  const [busy, setBusy] = useState<TemplateCategory | null>(null);

  useEffect(() => {
    let alive = true;
    const gone = new Set<TemplateCategory>();
    const without = (flags: PrintDefaults) => {
      const next = { ...flags };
      for (const category of gone) next[category] = false;
      return next;
    };
    // Any print of this order on the page (this one, or the other component's) may find a default gone.
    const unsubscribe = onPrintDefaultGone(base, orderId, (category) => {
      gone.add(category);
      setDefaults((current) => (current ? without(current) : current));
    });
    void fetchPrintDefaults(base, orderId).then((found) => {
      if (alive) setDefaults(without(found));
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [base, orderId]);

  const run = useCallback(
    async (category: TemplateCategory, consignmentId?: string | null): Promise<boolean> => {
      setBusy(category);
      try {
        let job;
        try {
          job = await fetchOrderPrint(base, orderId, { category, consignmentId });
        } catch {
          toast.error(t("fallback.failed"));
          return false;
        }
        if (!job.template) {
          // Removed since the page loaded: this page prints the standard way from now on.
          printDefaultGone(base, orderId, category);
          toast.info(t("fallback.noDefault"));
          return false;
        }
        const measure = await measureTemplate(job.template, job.context).catch(() => null);
        const result = await printTemplate({ design: job.template, context: job.context, measure });
        if (!result.ok) {
          // The reason (no iframe, fonts not ready, a render error) is for whoever looks into it; the toast says what happened.
          console.warn(`[invoice-templates] ${category} printed the standard way: ${result.reason}`, result.error ?? "");
          toast.error(t("fallback.failed"));
          return false;
        }
        return true;
      } finally {
        setBusy(null);
      }
    },
    [base, orderId, t],
  );

  const printInvoice = useCallback(() => run("online"), [run]);
  const printSticker = useCallback((options?: { consignmentId?: string | null }) => run("sticker", options?.consignmentId), [run]);
  const stickerLabel = defaults?.sticker ? t("printSticker") : null;

  return useMemo(
    () => ({ defaults, busy, stickerLabel, printInvoice, printSticker }),
    [defaults, busy, stickerLabel, printInvoice, printSticker],
  );
}
