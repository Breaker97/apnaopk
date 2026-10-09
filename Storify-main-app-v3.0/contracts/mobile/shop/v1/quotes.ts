/**
 * The shopper's quote requests: what they asked a price for, and what the
 * store answered (the website's /account/quotes).
 *
 * GET /me/quotes lists them, newest first. A request the store answered with a
 * price that is still good is `ready`: put exactly `offer.quantity` of the
 * product (and `variantId`) in the cart with PUT /cart/lines and the cart
 * charges `offer.unitPrice` each, as `MeQuoteOffer` says. Everything after
 * that is the ordinary checkout. A request is never answered or changed from
 * the app; the store does that.
 *
 * `state` is one of `SHOPPER_QUOTE_STATES`; the app shows its own words for the
 * ones it knows and a neutral label for any other.
 */
import * as z from "zod";

import { ListQuery, Money, listOf } from "./common";

/** Where a request stands for the shopper (`ShopperQuote.state`). */
export const SHOPPER_QUOTE_STATES = [
  /** No price yet. */
  "awaiting",
  /** The price is good: it can go in the cart. */
  "ready",
  /** An order holds the price: `orderId`. */
  "ordered",
  /** The price lapsed. */
  "expired",
  /** The store took the price back. */
  "withdrawn",
  /** The store closed the request without a price. */
  "closed",
] as const;

/** GET /me/quotes. Newest first. */
export const QuoteListQuery = ListQuery;
export type QuoteListQuery = z.infer<typeof QuoteListQuery>;

/** The price the store sent back. It is for the lot: `quantity` at `unitPrice` each. */
export const ShopperQuoteOffer = z.object({
  unitPrice: Money,
  quantity: z.number().int(),
  /** The lot at that price, before delivery and tax. */
  total: Money,
  /** What the store wrote with the price. */
  note: z.string().optional(),
  /** The price is held until then. */
  expiresAt: z.string().optional(),
});
export type ShopperQuoteOffer = z.infer<typeof ShopperQuoteOffer>;

export const ShopperQuote = z.object({
  id: z.string(),
  productId: z.string(),
  /** The product's name when the request was sent. */
  productName: z.string(),
  /** The product's page (GET /products/{slug}). Left out when it has none. */
  slug: z.string().optional(),
  /** The variant the price is for; the cart takes a product with variants only with one. */
  variantId: z.string().optional(),
  variantName: z.string().optional(),
  /** How many the shopper asked about. */
  quantity: z.number().int(),
  askedAt: z.string(),
  /** One of `SHOPPER_QUOTE_STATES`. */
  state: z.string(),
  /** Left out until the store sends a price. */
  offer: ShopperQuoteOffer.optional(),
  /** The order the price was spent on (GET /orders/{id}), once there is one. */
  orderId: z.string().optional(),
});
export type ShopperQuote = z.infer<typeof ShopperQuote>;

export const ShopperQuoteList = listOf(ShopperQuote);
export type ShopperQuoteList = z.infer<typeof ShopperQuoteList>;
