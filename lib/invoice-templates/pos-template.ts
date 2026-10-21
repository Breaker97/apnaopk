import "server-only";

import { Vendor } from "@/models";
import type { TemplateOwner } from "./owner";
import { posTemplatePayload, type PosInvoiceTemplate } from "./pos-receipt";
import { resolveDefault } from "./service";

/**
 * What a POS page adds to `POSSettings` for the receipt (§4.11): the resolved
 * POS default as the till carries it (`invoiceTemplate`, null without a
 * default or over 64 KB) and the printing business's logo for it.
 *
 * It rides inside the server-rendered POS page, which the service worker
 * caches, so an offline till prints with the template it last loaded. Read
 * only; a failure here never stops the till: it prints the legacy receipt.
 */
export async function posReceiptTemplate(
  owner: TemplateOwner,
  settings: { general?: { logoUrl?: string | null } | null },
): Promise<{ invoiceTemplate: PosInvoiceTemplate | null; storeLogoUrl?: string }> {
  try {
    const invoiceTemplate = posTemplatePayload(await resolveDefault(owner, "pos"));
    if (!invoiceTemplate) return { invoiceTemplate: null };
    const logo =
      owner.kind === "vendor"
        ? (await Vendor.findById(owner.vendorId).select("logo").lean<{ logo?: string | null } | null>())?.logo
        : settings.general?.logoUrl;
    return { invoiceTemplate, ...(logo ? { storeLogoUrl: logo } : {}) };
  } catch (error) {
    console.warn("[invoice-templates] the POS receipt template could not be loaded; the till prints the standard receipt", error);
    return { invoiceTemplate: null };
  }
}
