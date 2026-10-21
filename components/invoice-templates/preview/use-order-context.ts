"use client";

/**
 * Loads a real order's render context for a preview or a test print, through
 * `GET /api/admin/orders/[id]/print-context` (§4.9): read-only, with the
 * caller's order permissions and staff scope applied by the route. An order
 * is named by its number (as staff see it) or its id. On a vendor's screens
 * (the scope, template-scope.tsx) it is `/api/vendor/orders/…`: their own
 * orders, and their own consignment of one. The staff-only internal note is
 * asked for (`internalNote=1`) only when the design prints it; the vendor
 * route never sends it (review H1).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_TEMPLATE_SCOPE, useTemplateScope } from "@/components/invoice-templates/template-scope";
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import type { TemplateCategory, TemplateLocale } from "@/lib/invoice-templates/types";

export type OrderContextError = "notFound" | "failed";

export type OrderContextState =
  | { status: "idle" }
  | { status: "loading"; ref: string }
  | { status: "loaded"; ref: string; orderId: string; context: PrintContext }
  | { status: "error"; ref: string; error: OrderContextError };

const OBJECT_ID = /^[a-f0-9]{24}$/i;

class LoadError extends Error {
  constructor(readonly code: OrderContextError) {
    super(code);
  }
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { credentials: "same-origin", signal, headers: { Accept: "application/json" } });
  if (response.status === 404) throw new LoadError("notFound");
  if (!response.ok) throw new LoadError("failed");
  const body = (await response.json()) as { success?: boolean; data?: unknown };
  if (!body.success) throw new LoadError("failed");
  return body.data;
}

/** The order's id for a number (exact match, case-insensitive) or an id as given. */
async function resolveOrderId(ref: string, ordersEndpoint: string, signal?: AbortSignal): Promise<string> {
  if (OBJECT_ID.test(ref)) return ref;
  const data = (await getJson(`${ordersEndpoint}?search=${encodeURIComponent(ref)}&limit=10`, signal)) as {
    data?: Array<{ _id?: string; id?: string; orderNumber?: string }>;
  };
  const wanted = ref.trim().toLowerCase();
  const match = (data.data ?? []).find((order) => order.orderNumber?.toLowerCase() === wanted);
  const id = match?._id ?? match?.id;
  if (!id) throw new LoadError("notFound");
  return String(id);
}

export async function loadOrderContext(
  ref: string,
  options: {
    category: TemplateCategory;
    locale: TemplateLocale;
    signal?: AbortSignal;
    /** The scope's orders routes; the admin's by default. */
    ordersEndpoint?: string;
    /** The design prints the internal note (`designUsesInternalNote`): ask for it. */
    internalNote?: boolean;
  },
): Promise<{ orderId: string; context: PrintContext }> {
  const ordersEndpoint = options.ordersEndpoint ?? ADMIN_TEMPLATE_SCOPE.ordersEndpoint;
  const orderId = await resolveOrderId(ref.trim(), ordersEndpoint, options.signal);
  const query = new URLSearchParams({ category: options.category, locale: options.locale });
  if (options.internalNote) query.set("internalNote", "1");
  const data = (await getJson(`${ordersEndpoint}/${orderId}/print-context?${query}`, options.signal)) as { context?: PrintContext };
  if (!data.context) throw new LoadError("failed");
  return { orderId, context: data.context };
}

/**
 * Only the latest load counts: a new load (or clear, or leaving) aborts the
 * one before it, and an answer that still arrives for it is ignored, so a slow
 * first order can't replace the one asked for after it. `internalNote` applies
 * from the next load, as a change of language does.
 */
export function useOrderContext(category: TemplateCategory, locale: TemplateLocale, internalNote = false) {
  const [state, setState] = useState<OrderContextState>({ status: "idle" });
  const { ordersEndpoint } = useTemplateScope();
  const current = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    current.current?.abort();
    current.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const load = useCallback(
    async (ref: string) => {
      const trimmed = ref.trim();
      if (!trimmed) return;
      cancel();
      const controller = new AbortController();
      current.current = controller;
      setState({ status: "loading", ref: trimmed });
      try {
        const { orderId, context } = await loadOrderContext(trimmed, {
          category,
          locale,
          ordersEndpoint,
          internalNote,
          signal: controller.signal,
        });
        if (current.current !== controller) return;
        setState({ status: "loaded", ref: trimmed, orderId, context });
      } catch (error) {
        if (current.current !== controller) return;
        setState({ status: "error", ref: trimmed, error: error instanceof LoadError ? error.code : "failed" });
      } finally {
        if (current.current === controller) current.current = null;
      }
    },
    [cancel, category, locale, ordersEndpoint, internalNote],
  );
  const clear = useCallback(() => {
    cancel();
    setState({ status: "idle" });
  }, [cancel]);

  return { state, load, clear };
}
