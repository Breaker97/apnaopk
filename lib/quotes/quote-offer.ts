import "server-only";

/**
 * The one place that decides whether a shopper may buy a quote-only product,
 * and at what price.
 *
 * A "price on request" product carries `price: 0` on its document
 * (lib/products/quote-pricing.ts), and every money surface refuses it. An
 * offer is the single, narrow exception: the merchant answered one shopper's
 * request with a number, so for that shopper — and only for the product,
 * variant and quantity they asked about — the buy box, the cart and checkout
 * behave normally.
 *
 * Everything that prices a line reads its answer from here rather than
 * re-deriving the rules: the buy box (through /api/quotes/mine), POST
 * /api/cart/items, resolveCartProducts, POST /api/orders and POST
 * /api/payments/checkout. Those last two re-price every line from the live
 * product document on purpose — a stale cart must never lock in an old price —
 * so without this module a quoted line would be re-priced to the product's 0
 * and the order would go through free.
 *
 * Three properties are what make that safe to hand out:
 *
 *   - **Owned.** Offers resolve by `userId` only. A request sent while signed
 *     out is attached to the account when its sender next signs in with the
 *     same address (claimGuestCustomerData), which is the same rule guest
 *     orders are folded in by; nothing here trusts an email off a request body.
 *   - **Exact.** Product, variant AND quantity must match what was quoted. A
 *     quote is normally a volume price, so buying fewer at the same unit price
 *     would be taking the bulk rate for a single piece.
 *   - **Single-use.** An offer is spent by the order it is placed on, and only
 *     handed back if that order is cancelled. Nothing sweeps this: the bound
 *     order's own status is the state.
 */

import { connectDB } from "@/lib/db";
import { Order, QuoteRequest } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import type { QuoteOfferState } from "@/lib/quotes/quote-status";

/** What a caller needs to price and attribute one quoted line. */
export type LiveQuoteOffer = {
  quoteId: string;
  productId: string;
  variantId?: string;
  productName: string;
  variantName?: string;
  unitPrice: number;
  /** The exact quantity the price is good for. */
  quantity: number;
  note?: string;
  expiresAt?: string;
};

type OfferShape = {
  unitPrice?: number;
  quantity?: number;
  note?: string;
  expiresAt?: Date | string | null;
  offeredAt?: Date | string | null;
  withdrawnAt?: Date | string | null;
};

type QuoteShape = {
  _id: unknown;
  productId?: unknown;
  variantId?: unknown;
  productName?: string;
  variantName?: string;
  offer?: OfferShape | null;
  orderId?: unknown;
};

/**
 * Key for the offer map, matching `cartLineKey` in lib/cart/cart-products.ts
 * exactly — the cart looks its lines up in this map by that function's output.
 * Restated rather than imported so the cart may depend on quotes without the
 * two forming a cycle; a contract test asserts the two never drift.
 */
export function quoteOfferLineKey(
  productId: unknown,
  variantId?: unknown,
): string {
  return `${productId?.toString() ?? ""}::${variantId?.toString() ?? ""}`;
}

function toDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * What an offer amounts to right now.
 *
 * `boundOrderOpen` answers "is the order this offer was spent on still
 * standing?" — the caller resolves it because it needs an Order read, and the
 * shopper-facing paths batch that read across every quote at once.
 *
 * Order matters: an offer spent on a live order reads `ordered` even after its
 * expiry date, because the shopper bought it in time; and a withdrawn offer
 * reads `withdrawn` whatever else is true of it.
 */
export function deriveQuoteOfferState(
  quote: QuoteShape,
  boundOrderOpen: boolean,
  now: Date = new Date(),
): QuoteOfferState {
  const offer = quote.offer;
  if (!offer || typeof offer.unitPrice !== "number") return "none";
  if (offer.withdrawnAt) return "withdrawn";
  if (quote.orderId && boundOrderOpen) return "ordered";
  const expiresAt = toDate(offer.expiresAt);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return "expired";
  return "live";
}

/**
 * Which of these quotes are still holding an order.
 *
 * A cancelled order releases its offer — the shopper never paid, and the
 * merchant should not have to re-quote because a payment failed. Any other
 * status (including a pending one awaiting a gateway) keeps it spent, so a
 * second checkout cannot be started against the same price.
 */
async function loadBoundOrderStates(
  quotes: QuoteShape[],
): Promise<Set<string>> {
  const orderIds = quotes
    .map((quote) => quote.orderId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id))
    .map((id) => id!.toString());
  if (orderIds.length === 0) return new Set();

  const orders = await Order.find({ _id: { $in: orderIds } })
    .select("status")
    .lean<Array<{ _id: unknown; status?: string }>>();

  return new Set(
    orders
      .filter((order) => order.status !== ORDER_STATUS.CANCELLED)
      .map((order) => order._id?.toString() ?? ""),
  );
}

/**
 * What each of these quotes' offers amounts to, in one pass.
 *
 * The admin list and the shopper's own list both need the state of every row
 * they render, and it depends on whether the bound order still stands — so the
 * order reads are batched here rather than one per row.
 */
export async function resolveOfferStates(
  quotes: QuoteShape[],
): Promise<Map<string, QuoteOfferState>> {
  const states = new Map<string, QuoteOfferState>();
  if (quotes.length === 0) return states;
  const openOrders = await loadBoundOrderStates(quotes);
  const now = new Date();
  for (const quote of quotes) {
    states.set(
      String(quote._id),
      deriveQuoteOfferState(
        quote,
        Boolean(quote.orderId && openOrders.has(quote.orderId.toString())),
        now,
      ),
    );
  }
  return states;
}

function toLiveOffer(quote: QuoteShape): LiveQuoteOffer | null {
  const offer = quote.offer;
  if (!offer || typeof offer.unitPrice !== "number") return null;
  if (typeof offer.quantity !== "number" || offer.quantity < 1) return null;
  const expiresAt = toDate(offer.expiresAt);
  return {
    quoteId: String(quote._id),
    productId: quote.productId?.toString() ?? "",
    variantId: quote.variantId?.toString() || undefined,
    productName: quote.productName ?? "",
    variantName: quote.variantName || undefined,
    unitPrice: offer.unitPrice,
    quantity: offer.quantity,
    note: offer.note || undefined,
    expiresAt: expiresAt?.toISOString(),
  };
}

const OFFER_FIELDS = "productId variantId productName variantName offer orderId";

/**
 * Every offer this shopper can still spend, keyed by `quoteOfferLineKey`.
 *
 * Signed-out shoppers have none by definition, so a guest cart costs no query
 * at all. `productIds` narrows the read to the products actually in play —
 * the callers that price a cart already know them, and it keeps a shopper with
 * a long quote history from loading it on every checkout.
 *
 * When two live offers cover the same product and variant the newest wins:
 * re-quoting is how a negotiation moves, and the last number the merchant sent
 * is the one they meant.
 */
export async function loadShopperOffers(
  userId: string | null | undefined,
  options: { productIds?: string[] } = {},
): Promise<Map<string, LiveQuoteOffer>> {
  const offers = new Map<string, LiveQuoteOffer>();
  if (!userId) return offers;
  if (options.productIds && options.productIds.length === 0) return offers;

  await connectDB();

  const filter: Record<string, unknown> = {
    userId,
    "offer.unitPrice": { $exists: true },
    "offer.withdrawnAt": { $exists: false },
  };
  if (options.productIds) {
    filter.productId = { $in: options.productIds };
  }

  const quotes = await QuoteRequest.find(filter)
    .select(OFFER_FIELDS)
    .sort({ "offer.offeredAt": -1, createdAt: -1 })
    .lean<QuoteShape[]>();

  if (quotes.length === 0) return offers;

  const openOrders = await loadBoundOrderStates(quotes);
  const now = new Date();

  for (const quote of quotes) {
    const state = deriveQuoteOfferState(
      quote,
      Boolean(quote.orderId && openOrders.has(quote.orderId.toString())),
      now,
    );
    if (state !== "live") continue;
    const live = toLiveOffer(quote);
    if (!live) continue;
    const key = quoteOfferLineKey(live.productId, live.variantId);
    // Sorted newest-first, so the first one to claim a key is the current
    // offer and any older duplicate is left behind.
    if (!offers.has(key)) offers.set(key, live);
  }

  return offers;
}

/**
 * The offer that makes exactly this line buyable, or null.
 *
 * `quantity` must equal what was quoted — see the module note. Callers that
 * price a whole cart should use `loadShopperOffers` once instead of calling
 * this per line.
 */
export async function resolveOfferForLine(params: {
  userId: string | null | undefined;
  productId: string;
  variantId?: string | null;
  quantity: number;
}): Promise<LiveQuoteOffer | null> {
  const offers = await loadShopperOffers(params.userId, {
    productIds: [params.productId],
  });
  const offer = offers.get(
    quoteOfferLineKey(params.productId, params.variantId ?? undefined),
  );
  if (!offer) return null;
  return offer.quantity === params.quantity ? offer : null;
}

/**
 * The offers that actually cover these lines, keyed by line.
 *
 * A line matches only when the quantity on it is the quantity that was quoted
 * — the merchant priced a lot, not a unit — so a shopper who edits the number
 * loses the price rather than getting the bulk rate for a different order.
 * Every path that has a whole cart in hand (the cart read, order placement,
 * checkout) filters through this one function, so none of them can end up
 * treating a line as quoted while another treats it as unbuyable.
 */
export function matchOffersToLines<
  T extends {
    productId?: unknown;
    variantId?: unknown;
    quantity?: number;
  },
>(
  items: T[],
  offers: Map<string, LiveQuoteOffer>,
): Map<string, LiveQuoteOffer> {
  const matched = new Map<string, LiveQuoteOffer>();
  if (offers.size === 0) return matched;
  for (const item of items) {
    const key = quoteOfferLineKey(item.productId, item.variantId);
    const offer = offers.get(key);
    if (!offer) continue;
    if (offer.quantity !== Number(item.quantity)) continue;
    matched.set(key, offer);
  }
  return matched;
}

/**
 * Bind every offer an order was placed against to that order, spending them.
 *
 * Guarded on the offer not already being bound, so a retried checkout cannot
 * move an offer from the order that took it to a second one. Called at order
 * creation rather than at capture: a COD order is an obligation the moment it
 * is placed, and waiting for money would let one price be spent on any number
 * of unpaid orders.
 *
 * `won` is separate from the binding because placing an order is not winning
 * the deal — a gateway order sits pending until the money lands, and marking
 * the quote won there would report an abandoned checkout as a sale. The
 * methods that have no capture step (cash on delivery and the rest of
 * POST /api/orders) pass it at placement; every prepaid gateway gets it from
 * `markQuotesWon` once settled.
 */
export async function bindOffersToOrder(
  quoteIds: string[],
  orderId: string,
  options: { won?: boolean } = {},
): Promise<void> {
  const unique = Array.from(new Set(quoteIds.filter(Boolean)));
  if (unique.length === 0) return;
  await connectDB();
  await QuoteRequest.updateMany(
    { _id: { $in: unique }, orderId: { $exists: false } },
    { $set: options.won ? { orderId, status: "won" } : { orderId } },
  );
}

/** The deal closed: the order the offer was spent on has been paid for. */
export async function markQuotesWon(quoteIds: string[]): Promise<void> {
  const unique = Array.from(new Set(quoteIds.filter(Boolean)));
  if (unique.length === 0) return;
  await connectDB();
  await QuoteRequest.updateMany(
    { _id: { $in: unique } },
    { $set: { status: "won" } },
  );
}
