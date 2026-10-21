"use client";

/**
 * What an order page asks before and while it prints with a template
 * (docs/INVOICE_TEMPLATE_BUILDER.md §4.8, §4.9), through the order's own
 * read-only routes:
 *
 * - `GET {base}/orders/[id]/print-templates` → which categories have a
 *   default (all false: every print stays as it was, D-02);
 * - `GET {base}/orders/[id]/print-context?category=&consignmentId=` → the
 *   template and the whitelisted context.
 *
 * `base` is `/api/admin` (admins and staff, scope applied by the route) or
 * `/api/vendor` (the vendor owner's consignment, their store identity).
 * Only GET requests: printing never writes (§4.1).
 */
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import type { InvoiceTemplate, TemplateCategory } from "@/lib/invoice-templates/types";

export type OrderPrintBase = "/api/admin" | "/api/vendor";

export type PrintDefaults = Record<TemplateCategory, boolean>;

export const NO_DEFAULTS: PrintDefaults = Object.freeze({ online: false, pos: false, sticker: false });

export interface OrderPrintJob {
  /** null: no default for the category (any more) — print the legacy way. */
  template: InvoiceTemplate | null;
  context: PrintContext;
}

async function getData(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url}: ${response.status}`);
  const body = (await response.json()) as { success?: boolean; data?: unknown };
  if (!body.success) throw new Error(`GET ${url}: refused`);
  return body.data;
}

/** The header and the shipments card of one page ask once between them; a later visit asks again. */
const DEFAULTS_TTL_MS = 30_000;
const defaultsCache = new Map<string, { at: number; promise: Promise<PrintDefaults> }>();

/** Which categories print with a template here; any failure reads as "none" (the legacy prints stay). */
export function fetchPrintDefaults(base: OrderPrintBase, orderId: string): Promise<PrintDefaults> {
  const key = `${base}:${orderId}`;
  const cached = defaultsCache.get(key);
  if (cached && Date.now() - cached.at < DEFAULTS_TTL_MS) return cached.promise;
  const promise = getData(`${base}/orders/${encodeURIComponent(orderId)}/print-templates`)
    .then((data) => {
      const flags = (data ?? {}) as Partial<PrintDefaults>;
      return { online: flags.online === true, pos: flags.pos === true, sticker: flags.sticker === true };
    })
    .catch(() => {
      defaultsCache.delete(key);
      return NO_DEFAULTS;
    });
  defaultsCache.set(key, { at: Date.now(), promise });
  return promise;
}

/** Drops what is known about an order (after a print found the default gone), or everything. */
export function forgetPrintDefaults(base?: OrderPrintBase, orderId?: string): void {
  if (base && orderId) defaultsCache.delete(`${base}:${orderId}`);
  else defaultsCache.clear();
}

type DefaultGoneListener = (category: TemplateCategory) => void;
const goneListeners = new Map<string, Set<DefaultGoneListener>>();

/** Hears when a print of this order finds a category's default gone; returns the unsubscribe. */
export function onPrintDefaultGone(base: OrderPrintBase, orderId: string, listener: DefaultGoneListener): () => void {
  const key = `${base}:${orderId}`;
  const listeners = goneListeners.get(key) ?? new Set<DefaultGoneListener>();
  listeners.add(listener);
  goneListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && goneListeners.get(key) === listeners) goneListeners.delete(key);
  };
}

/**
 * A print found the category's default gone: every part of the page printing
 * this order (the header and the Shipments card keep their own state) stops
 * offering it, and the next visit asks again.
 */
export function printDefaultGone(base: OrderPrintBase, orderId: string, category: TemplateCategory): void {
  forgetPrintDefaults(base, orderId);
  for (const listener of [...(goneListeners.get(`${base}:${orderId}`) ?? [])]) listener(category);
}

/** The template and context for one print; throws when the route refuses or fails. */
export async function fetchOrderPrint(
  base: OrderPrintBase,
  orderId: string,
  options: { category: TemplateCategory; consignmentId?: string | null },
): Promise<OrderPrintJob> {
  const query = new URLSearchParams({ category: options.category });
  if (options.consignmentId) query.set("consignmentId", options.consignmentId);
  const data = (await getData(`${base}/orders/${encodeURIComponent(orderId)}/print-context?${query}`)) as Partial<OrderPrintJob>;
  if (!data?.context) throw new Error("print-context: no context");
  return { template: data.template ?? null, context: data.context };
}

/**
 * Whether a parcel's label is the store's own (D-09): a carrier-issued label
 * — a booked parcel, or one whose label came from the carrier — is never
 * redrawn by a template.
 */
export function isInternalLabel(shipment: { provider?: string | null; label?: { source?: string } | null }): boolean {
  return !shipment.provider && shipment.label?.source !== "carrier";
}
