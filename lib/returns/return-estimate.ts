/**
 * What a return is worth, worked out in one place.
 *
 * This arithmetic used to live inside `POST /api/returns`, wrapped around a
 * database write, which made it unreachable from a test and unreachable from
 * the shopper — who submits a return without ever being shown the figure the
 * reason they picked produces. Pure and dependency-light, like
 * `lib/refund-allocation.ts`, so the sums can be checked on their own and
 * quoted back before anything is created.
 *
 * The rule the whole thing turns on: a return is either the merchant's failure
 * or the shopper's choice, and the deductions only belong on the second.
 */

import type { ReturnPolicy } from "@/lib/returns/return-policy";
import { roundMoney } from "@/lib/intl/money";

/** The breakdown stored on `ReturnRequest.estimatedRefund`. */
export interface ReturnRefundEstimate {
  itemsSubtotal: number;
  shipping: number;
  tax: number;
  discountAdjustment: number;
  restockingFee: number;
  returnShippingFee: number;
  total: number;
  currency: string;
}

interface ReturnRefundEstimateInput {
  /** Goods value of the lines coming back, for this owner group. */
  itemsSubtotal: number;
  /** The whole order's goods value, which the group is prorated against. */
  orderSubtotal: number;
  /** The order's tax, prorated the same way. */
  orderTax: number;
  /**
   * Discount that came off the GOODS. A free-shipping coupon is not this — it
   * discounts delivery, and the caller nets it off `chargedShipping` instead.
   */
  goodsDiscount: number;
  /**
   * The returning seller's own slice of a coupon limited to part of the cart,
   * with the goods it was taken off. Given, it replaces the order-wide share:
   * a 20-off coupon on seller A's items used to take 10 off a return of
   * seller B's goods, which were never discounted.
   */
  ownGoodsDiscount?: { amount: number; subtotal: number } | null;
  /** What the shopper actually paid for delivery, after any shipping coupon. */
  chargedShipping: number;
  /** Whether the policy hands delivery back for this return's reason. */
  refundsShipping: boolean;
  /**
   * Whether the return is the merchant's failure rather than the shopper's
   * choice — from `isMerchantFaultReturn`, never from the shipping mode.
   */
  merchantAtFault: boolean;
  policy: Pick<ReturnPolicy, "restockingFeePercent" | "returnShippingFee">;
  currency: string;
}

/**
 * The refund breakdown for one owner group's share of a return.
 *
 * Every part is proportional to the goods coming back rather than to the order,
 * so two returns that between them cover the whole order hand the tax and the
 * delivery back once, not once each.
 */
export function buildReturnRefundEstimate(
  input: ReturnRefundEstimateInput,
): ReturnRefundEstimate {
  const itemsSubtotal = roundMoney(Math.max(0, num(input.itemsSubtotal)));
  const orderSubtotal = num(input.orderSubtotal);
  const ratio =
    orderSubtotal > 0 ? Math.min(1, itemsSubtotal / orderSubtotal) : 0;

  const own = input.ownGoodsDiscount;
  const discountAdjustment = own
    ? roundMoney(
        Math.max(0, num(own.amount)) *
          (num(own.subtotal) > 0
            ? Math.min(1, itemsSubtotal / num(own.subtotal))
            : 0),
      )
    : roundMoney(Math.max(0, num(input.goodsDiscount)) * ratio);
  const tax = roundMoney(Math.max(0, num(input.orderTax)) * ratio);
  const shipping = input.refundsShipping
    ? roundMoney(Math.max(0, num(input.chargedShipping)) * ratio)
    : 0;

  const goodsBack = Math.max(0, roundMoney(itemsSubtotal - discountAdjustment));

  // Both deductions are the shopper paying for a return they chose to make.
  // When the return is the merchant's own failure there is nothing to charge
  // them for: they are being made whole for goods they could not use, and a
  // restocking or return-shipping fee taken out of that is the merchant's
  // mistake billed to the shopper.
  //
  // Until now Storify drew this line for delivery only. The fees were charged
  // whatever the reason, so a store running `merchant_fault` with a return
  // shipping fee set handed a shopper their delivery back and took the return
  // leg out of the very same refund.
  //
  // Deliberately not a setting. "Should we charge for our own defects" is not
  // a business decision a merchant needs to be offered, and both fees default
  // to 0 — so a store that never configured them sees no change either way.
  const restockingFee = input.merchantAtFault
    ? 0
    : roundMoney((goodsBack * num(input.policy.restockingFeePercent)) / 100);
  const returnShippingFee = input.merchantAtFault
    ? 0
    : roundMoney(Math.max(0, num(input.policy.returnShippingFee)));

  const total = Math.max(
    0,
    roundMoney(goodsBack + tax + shipping - restockingFee - returnShippingFee),
  );

  return {
    itemsSubtotal,
    shipping,
    tax,
    discountAdjustment,
    restockingFee,
    returnShippingFee,
    total,
    currency: String(input.currency || "USD").toUpperCase(),
  };
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
