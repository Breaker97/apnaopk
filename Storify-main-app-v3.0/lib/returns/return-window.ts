/**
 * How long each line of an order stays returnable (R6).
 *
 * The store sets one window in Settings → Orders → Returns — a number of days,
 * or no time limit. A product can set its own (`returns.windowDays`), and so
 * can a collection (`orders.returns.windowOverrides`); when more than one
 * applies, the shortest wins, as on Shopify. The line's window is copied onto
 * it when the order is placed (`items[].returnWindowDays`), like final sale:
 * changing a product later does not change what its earlier buyers were sold.
 *
 * Counting starts when the line's own parcel is delivered, or — when the store
 * chose it — when the order's last parcel is. Either way a line can be sent
 * back as soon as it has arrived; only the end moves.
 *
 * Pure and client-safe, so the product page, the return form and the server
 * answer alike.
 */

import {
  MAX_RETURN_WINDOW_DAYS,
  MIN_RETURN_WINDOW_DAYS,
  type ReturnWindowStart,
} from "@/lib/returns/return-policy";

/** How many collections may carry a return window of their own. */
export const MAX_RETURN_WINDOW_OVERRIDES = 200;

/** One collection's own return window. */
type ReturnWindowOverride = { collectionId: string; windowDays: number };

type IdLike = unknown;

const idString = (value: IdLike): string => {
  if (value && typeof value === "object" && "_id" in (value as Record<string, unknown>)) {
    return String((value as { _id?: unknown })._id ?? "");
  }
  return String(value ?? "");
};

/** A whole number of days within the allowed range, or null. */
export function validWindowDays(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const days = Number(value);
  if (!Number.isFinite(days)) return null;
  const whole = Math.round(days);
  return whole >= MIN_RETURN_WINDOW_DAYS && whole <= MAX_RETURN_WINDOW_DAYS ? whole : null;
}

/** The collections with a window of their own, one entry each (the shortest). */
export function returnWindowOverridesOf(
  settings:
    | {
        orders?: {
          returns?: {
            windowOverrides?: ReadonlyArray<{
              collectionId?: IdLike;
              windowDays?: number | null;
            }> | null;
          } | null;
        } | null;
      }
    | null
    | undefined,
): ReturnWindowOverride[] {
  const byCollection = new Map<string, number>();
  for (const entry of settings?.orders?.returns?.windowOverrides || []) {
    const collectionId = idString(entry?.collectionId);
    const days = validWindowDays(entry?.windowDays);
    if (!collectionId || days === null) continue;
    const seen = byCollection.get(collectionId);
    byCollection.set(collectionId, seen === undefined ? days : Math.min(seen, days));
  }
  return Array.from(byCollection, ([collectionId, windowDays]) => ({
    collectionId,
    windowDays,
  }));
}

/** The product fields a line's window is read from — loose, so a lean doc fits. */
export type ReturnWindowProductLike = {
  returns?: { windowDays?: number | null } | null;
  collectionIds?: ReadonlyArray<IdLike> | null;
};

/**
 * A product's own return window: the shortest of its own and its
 * collections', or undefined when neither sets one and the store's applies.
 * `ruleCollectionIds` are the automated collections it joins by their rules
 * (`ruleCollectionsOf`).
 */
export function productReturnWindowDays(
  product: ReturnWindowProductLike | null | undefined,
  overrides: ReadonlyArray<ReturnWindowOverride>,
  ruleCollectionIds: ReadonlyArray<IdLike> = [],
): number | undefined {
  if (!product) return undefined;
  const candidates: number[] = [];
  const own = validWindowDays(product.returns?.windowDays);
  if (own !== null) candidates.push(own);
  if (overrides.length > 0) {
    const collections = new Set(
      [...(product.collectionIds || []), ...ruleCollectionIds].map(idString),
    );
    for (const override of overrides) {
      if (collections.has(override.collectionId)) candidates.push(override.windowDays);
    }
  }
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

/** The order fields the window is counted from. */
type ReturnWindowOrderLike = {
  deliveredAt?: Date | string | null;
  shippedAt?: Date | string | null;
  createdAt?: Date | string | null;
  items?: ReadonlyArray<
    { vendorId?: IdLike; returnWindowDays?: number | null } | null | undefined
  > | null;
  subOrders?: ReadonlyArray<
    | {
        vendorId?: IdLike;
        status?: string | null;
        deliveredAt?: Date | string | null;
        shippedAt?: Date | string | null;
      }
    | null
    | undefined
  > | null;
};

/** The window the order's terms give, and when it starts counting. */
type ReturnWindowTerms = {
  /** Days, or null for no time limit. */
  windowDays: number | null;
  windowStart: ReturnWindowStart;
};

/** One line's window in days — its own, else the order's — or null for none. */
export function lineReturnWindowDays(
  order: ReturnWindowOrderLike,
  index: number,
  terms: Pick<ReturnWindowTerms, "windowDays">,
): number | null {
  const own = validWindowDays(order.items?.[index]?.returnWindowDays);
  return own ?? terms.windowDays;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const timeOf = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};

function isSplit(order: ReturnWindowOrderLike): boolean {
  return (order.subOrders || []).filter(Boolean).length > 1;
}

/**
 * When a line's window started counting, or null while it has not — an order
 * counted from its last parcel starts only once every parcel has arrived.
 */
function lineReturnWindowStartsAt(
  order: ReturnWindowOrderLike,
  index: number,
  windowStart: ReturnWindowStart,
): Date | null {
  const orderBasis =
    timeOf(order.deliveredAt) ?? timeOf(order.shippedAt) ?? timeOf(order.createdAt);
  if (!isSplit(order)) return orderBasis === null ? null : new Date(orderBasis);

  const parcels = (order.subOrders || []).filter(
    (sub): sub is NonNullable<typeof sub> => Boolean(sub) && sub?.status !== "cancelled",
  );
  if (windowStart === "last_delivery") {
    // Every parcel has to have arrived for the last one to be known.
    const delivered = parcels.map((sub) => timeOf(sub.deliveredAt));
    if (delivered.some((time) => time === null)) return null;
    return new Date(Math.max(...(delivered as number[])));
  }
  const vendorId = idString(order.items?.[index]?.vendorId);
  const parcel = parcels.find((sub) => idString(sub.vendorId) === vendorId);
  const basis =
    timeOf(parcel?.deliveredAt) ??
    timeOf(order.deliveredAt) ??
    timeOf(parcel?.shippedAt) ??
    orderBasis;
  return basis === null ? null : new Date(basis);
}

/** When a line's window closes, or null while it cannot — none set, or not started. */
export function lineReturnWindowEndsAt(
  order: ReturnWindowOrderLike,
  index: number,
  terms: ReturnWindowTerms,
): Date | null {
  const days = lineReturnWindowDays(order, index, terms);
  if (days === null) return null;
  const start = lineReturnWindowStartsAt(order, index, terms.windowStart);
  if (!start) return null;
  return new Date(start.getTime() + days * DAY_MS);
}

/** Whether a line's window has closed. */
export function lineReturnWindowClosed(
  order: ReturnWindowOrderLike,
  index: number,
  terms: ReturnWindowTerms,
  now: Date = new Date(),
): boolean {
  const ends = lineReturnWindowEndsAt(order, index, terms);
  return ends !== null && now.getTime() > ends.getTime();
}
