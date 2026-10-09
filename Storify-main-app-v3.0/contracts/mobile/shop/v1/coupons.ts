/**
 * Coupons: the shopper's coupon sheet, and why a code does not apply.
 *
 * GET /coupons (auth optional, private, `ETag`): the codes the store offers to
 * shoppers (Discounts → "Show to shoppers"), each judged for this shopper and
 * the cart they have now: the account's cart when signed in, else the guest's
 * by `X-Cart-Token`. Without a cart (or an empty one) only the rules no cart
 * decides are judged (`cartChecked` false): open, started, uses left, this
 * shopper's share not used up. A code the store keeps private is never
 * listed; it still works when typed.
 *
 * The app prints what it is sent: `benefit`, each of `conditions`, and for a
 * code it cannot use now, `reasonMessage` (already worded in the path's
 * locale, money included: "Add ৳200.00 more to use this code"). It never
 * works out a shortfall or a discount itself. Tapping a usable code puts it in
 * `CheckoutQuoteRequest.couponCode`; the quote is the final word.
 *
 * At most `COUPON_LIST_MAX` codes: the usable ones first, then by the soonest
 * end. Ask again when the sheet opens, with the last `ETag` as
 * `If-None-Match`.
 *
 * A typed code that fails: the quote answers `CheckoutQuote.coupon` with
 * status INVALID and the same `reason` and `reasonMessage`; placing the order
 * refuses it with 400 VALIDATION_ERROR, reason COUPON_INVALID, and the
 * coupon's own reason in `details` (`CouponInvalidDetails`).
 */
import * as z from "zod";

import { Money } from "./common";

/**
 * Why a code cannot be used now: the `reason` of `ShopperCoupon` and
 * `CheckoutCoupon`, and `CouponInvalidDetails.couponReason`. Each comes with
 * the store's own sentence for it; show that, or the app's own words for a
 * reason it knows.
 *
 * - `NOT_FOUND`: no such code (typed codes only).
 * - `NOT_ACTIVE`: the store switched it off.
 * - `NOT_STARTED`: it starts later; `startsAt` says when.
 * - `EXPIRED`: its end date has passed.
 * - `USAGE_LIMIT_REACHED`: every use the store allowed has been taken.
 * - `ALREADY_USED`: this shopper has used their share of it.
 * - `MINIMUM_NOT_MET`: the cart's subtotal is under the code's minimum;
 *   `shortBy` is what is missing ("spend more").
 * - `NOT_FOR_THIS_CART`: nothing in the cart is something the code covers.
 * - `QUOTED_PRICE`: everything in the cart is at a price the store quoted,
 *   which no code comes off.
 * - `SHIPPING_ALREADY_FREE`: a free-delivery code, on an order whose delivery
 *   costs nothing (quote and order only).
 * - `NO_SELLER_DELIVERY`: a seller's free-delivery code, and that seller
 *   delivers nothing in this order (quote and order only).
 *
 * A reason the app does not know: print `reasonMessage`.
 */
export const COUPON_REASONS = [
  "NOT_FOUND",
  "NOT_ACTIVE",
  "NOT_STARTED",
  "EXPIRED",
  "USAGE_LIMIT_REACHED",
  "ALREADY_USED",
  "MINIMUM_NOT_MET",
  "NOT_FOR_THIS_CART",
  "QUOTED_PRICE",
  "SHIPPING_ALREADY_FREE",
  "NO_SELLER_DELIVERY",
] as const;
export type CouponReason = (typeof COUPON_REASONS)[number];

/** What a code gives: a share off, an amount off, or free delivery. Show another value by `benefit`. */
export const COUPON_KINDS = ["PERCENTAGE", "FIXED", "FREE_SHIPPING"] as const;

/** The most codes GET /coupons answers. */
export const COUPON_LIST_MAX = 50;

/** One code on the coupon sheet. */
export const ShopperCoupon = z.object({
  /** What the shopper types or taps: send it as `couponCode`. */
  code: z.string(),
  /** The store's name for it ("Summer sale"), when it gave one. */
  title: z.string().optional(),
  /** `COUPON_KINDS`. */
  kind: z.string(),
  /** What it gives, worded: "15% off", "৳200.00 off", "Free shipping". */
  benefit: z.string(),
  /** A FIXED code's amount off, the figure `benefit` prints. */
  benefitAmount: Money.optional(),
  /**
   * What it needs and how far it goes, each a line already worded, in the
   * order to print: "On orders over ৳1,000.00", "Up to ৳300.00 off",
   * "Selected products only", "Once per customer", "Ends 12 Oct". Empty when
   * it asks for nothing.
   */
  conditions: z.array(z.string()),
  /** The subtotal it needs, when it needs one: the figure in `conditions`. */
  minimumSpend: Money.optional(),
  /** The most a percentage code takes off, when capped. */
  maxDiscount: Money.optional(),
  /** ISO time it ends. */
  endsAt: z.string().optional(),
  /** ISO time it starts, while it has not. */
  startsAt: z.string().optional(),
  /** It can be applied now: tap to apply. False: grey it out and print `reasonMessage`. */
  usable: z.boolean(),
  /** Why it cannot be used now: `COUPON_REASONS`. Sent whenever `usable` is false. */
  reason: z.string().optional(),
  /** `reason` in the store's words, in the path's locale. Sent with `reason`. */
  reasonMessage: z.string().optional(),
  /** Sent with `reason` MINIMUM_NOT_MET: what the cart is short of. */
  shortBy: Money.optional(),
  /**
   * Usable on the cart as it is (`cartChecked`): what it takes off the goods.
   * Left out for a free-delivery code, whose worth is the delivery checkout
   * prices.
   */
  discount: Money.optional(),
});
export type ShopperCoupon = z.infer<typeof ShopperCoupon>;

/** GET /coupons */
export const CouponList = z.object({
  items: z.array(ShopperCoupon),
  /**
   * True: judged against the shopper's cart (minimum, products covered,
   * `discount`). False: there is no cart, or it is empty, and only the rules
   * no cart decides were judged.
   */
  cartChecked: z.boolean(),
});
export type CouponList = z.infer<typeof CouponList>;

/**
 * The `details` of the COUPON_INVALID refusal (400 VALIDATION_ERROR, on
 * `errors.couponCode`) of POST /checkout/orders, /checkout/stripe/intent,
 * /checkout/redirect and /checkout/push.
 */
export const CouponInvalidDetails = z.object({
  /** `COUPON_REASONS`. */
  couponReason: z.string(),
  /** `couponReason` in the store's words, in the path's locale. */
  couponMessage: z.string(),
  /** MINIMUM_NOT_MET: what the cart is short of. */
  shortBy: Money.optional(),
});
export type CouponInvalidDetails = z.infer<typeof CouponInvalidDetails>;
