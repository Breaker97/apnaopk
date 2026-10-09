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
import { quantizeToCurrency } from "@/lib/intl/money";

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
  /**
   * The coupon discount the returning units actually carried, from each line's
   * own recorded share (`items.couponDiscount`). Given, it replaces both of the
   * above, and tax is shared by what the goods sold for rather than their list
   * price: a coupon on product X alone came off X, so a return of X hands back
   * X's discounted price and a return of an undiscounted Y hands back Y's full
   * one. Null for an order that recorded no line shares.
   */
  recordedGoodsDiscount?: number | null;
  /** What the shopper actually paid for delivery, after any shipping coupon. */
  chargedShipping: number;
  /**
   * The delivery this seller's own parcel carried, and the goods it carried it
   * for. Given, the delivery refund is a share of THAT rather than of the
   * order's total delivery.
   *
   * On a split order the two are different numbers. A 100 + 5 delivery / 100 +
   * 15 delivery order quotes a seller returning everything 10 of delivery by
   * the order-wide share, when their parcel only ever charged 5 — and the
   * ledger, which books delivery per parcel, can only reverse the 5. The
   * shopper was quoted money no consignment held.
   */
  shippingBasis?: { charged: number; subtotal: number } | null;
  /**
   * The goods inside `shippingBasis`'s parcel, when `itemsSubtotal` counts
   * more than that one seller's goods — the running total of an order's
   * returns does. Defaults to `itemsSubtotal`.
   */
  basisItemsSubtotal?: number | null;
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

/** The parts of a return that are a share of what the order charged. */
interface ProportionalParts {
  itemsSubtotal: number;
  discountAdjustment: number;
  tax: number;
  shipping: number;
}

/**
 * Goods, discount, tax and delivery for the units in `input`, each rounded to
 * what the order's currency can hold. Two decimals everywhere used to quote a
 * XOF return at 2358.67 — which the admin could not type, the gateway rounded
 * to 2359 and the books kept at 2358.67.
 */
function proportionalParts(input: ReturnRefundEstimateInput): ProportionalParts {
  const q = (value: number) => quantizeToCurrency(value, input.currency || "USD");
  const itemsSubtotal = q(Math.max(0, num(input.itemsSubtotal)));
  const orderSubtotal = num(input.orderSubtotal);
  const ratio =
    orderSubtotal > 0 ? Math.min(1, itemsSubtotal / orderSubtotal) : 0;

  const own = input.ownGoodsDiscount;
  const recorded =
    typeof input.recordedGoodsDiscount === "number"
      ? Math.min(itemsSubtotal, Math.max(0, num(input.recordedGoodsDiscount)))
      : null;
  const discountAdjustment = recorded !== null
    ? q(recorded)
    : own
    ? q(
        Math.max(0, num(own.amount)) *
          (num(own.subtotal) > 0
            ? Math.min(1, itemsSubtotal / num(own.subtotal))
            : 0),
      )
    : q(Math.max(0, num(input.goodsDiscount)) * ratio);
  // Tax was charged on the goods after the coupon, so where the discount is
  // known line by line the share of tax follows what the goods sold for.
  const orderGoodsSold = orderSubtotal - Math.max(0, num(input.goodsDiscount));
  // A seller's own coupon counts too: it came off only that seller's goods, so
  // a gross share gave one seller's returns the other's tax.
  const taxRatio =
    recorded !== null || own
      ? orderGoodsSold > 0
        ? Math.min(
            1,
            Math.max(0, (itemsSubtotal - discountAdjustment) / orderGoodsSold),
          )
        : 0
      : ratio;
  const tax = q(Math.max(0, num(input.orderTax)) * taxRatio);
  const basis = input.shippingBasis;
  const basisGoods =
    input.basisItemsSubtotal === undefined || input.basisItemsSubtotal === null
      ? itemsSubtotal
      : Math.max(0, num(input.basisItemsSubtotal));
  const shippingRatio =
    basis && num(basis.subtotal) > 0
      ? Math.min(1, basisGoods / num(basis.subtotal))
      : ratio;
  const shipping = input.refundsShipping
    ? q(
        Math.max(0, num(basis ? basis.charged : input.chargedShipping)) *
          shippingRatio,
      )
    : 0;

  return { itemsSubtotal, discountAdjustment, tax, shipping };
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
  return withReturnFees(proportionalParts(input), input);
}

/**
 * One return's breakdown, as what the order's returns come to with it less
 * what they came to without it.
 *
 * Each return rounded its own share, so three one-unit returns of a line the
 * shopper paid 22.00 for were quoted 7.34 each — 22.02, and the last refund
 * was refused for exceeding what the order took. Taken as a difference of
 * running totals, the shares always add up to exactly what was charged: the
 * last units get what is left. `before` is null for the first return.
 */
export function buildMarginalReturnRefundEstimate(params: {
  /** The units returned before this one and this one's, together. */
  through: ReturnRefundEstimateInput;
  /** The units returned before this one, on the same terms. */
  before: ReturnRefundEstimateInput | null;
}): ReturnRefundEstimate {
  const { through, before } = params;
  if (!before) return buildReturnRefundEstimate(through);
  const q = (value: number) => quantizeToCurrency(value, through.currency || "USD");
  const all = proportionalParts(through);
  const earlier = proportionalParts({
    ...before,
    // The same terms as `through`, whatever the caller left on `before`:
    // only the goods differ between the two.
    refundsShipping: through.refundsShipping,
    currency: through.currency,
  });
  const itemsSubtotal = q(Math.max(0, all.itemsSubtotal - earlier.itemsSubtotal));
  return withReturnFees(
    {
      itemsSubtotal,
      discountAdjustment: Math.min(
        itemsSubtotal,
        q(Math.max(0, all.discountAdjustment - earlier.discountAdjustment)),
      ),
      tax: q(Math.max(0, all.tax - earlier.tax)),
      shipping: q(Math.max(0, all.shipping - earlier.shipping)),
    },
    through,
  );
}

/** The deductions, and the total, on top of a return's proportional parts. */
function withReturnFees(
  parts: ProportionalParts,
  input: ReturnRefundEstimateInput,
): ReturnRefundEstimate {
  const q = (value: number) => quantizeToCurrency(value, input.currency || "USD");
  const { itemsSubtotal, discountAdjustment, tax, shipping } = parts;
  const goodsBack = Math.max(0, q(itemsSubtotal - discountAdjustment));

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
    : q((goodsBack * num(input.policy.restockingFeePercent)) / 100);
  const returnShippingFee = input.merchantAtFault
    ? 0
    : q(Math.max(0, num(input.policy.returnShippingFee)));

  const total = Math.max(
    0,
    q(goodsBack + tax + shipping - restockingFee - returnShippingFee),
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

/**
 * What the store changed on one return's price by hand, as it processed it.
 *
 * Fees can only come down: the shopper was quoted them before they asked, so
 * a fee is the smaller of what the policy charges and what the store set —
 * and when fewer goods arrive than were approved, the policy's own figure
 * shrinks under it. Delivery is the amount the store names in full, the part
 * a policy would keep back included (D1); the route holds it to what the
 * shopper paid and no refund has handed back.
 */
export interface ReturnPriceOverrides {
  feeOverride?: {
    restockingFee?: number | null;
    returnShippingFee?: number | null;
  } | null;
  deliveryOverride?: { amount?: number | null } | null;
}

/** The estimate with the store's own changes applied — see `ReturnPriceOverrides`. */
export function applyReturnOverrides(
  estimate: ReturnRefundEstimate,
  overrides: ReturnPriceOverrides | null | undefined,
): ReturnRefundEstimate {
  const fees = overrides?.feeOverride;
  const delivery = overrides?.deliveryOverride;
  const setFee = (value: unknown) =>
    value !== null && value !== undefined && Number.isFinite(Number(value));
  const hasFee = setFee(fees?.restockingFee) || setFee(fees?.returnShippingFee);
  const hasDelivery = setFee(delivery?.amount);
  if (!hasFee && !hasDelivery) return estimate;

  const q = (value: number) => quantizeToCurrency(value, estimate.currency || "USD");
  const restockingFee = setFee(fees?.restockingFee)
    ? Math.min(estimate.restockingFee, q(Math.max(0, num(fees?.restockingFee))))
    : estimate.restockingFee;
  const returnShippingFee = setFee(fees?.returnShippingFee)
    ? Math.min(estimate.returnShippingFee, q(Math.max(0, num(fees?.returnShippingFee))))
    : estimate.returnShippingFee;
  const shipping = hasDelivery ? q(Math.max(0, num(delivery?.amount))) : estimate.shipping;
  const goodsBack = Math.max(
    0,
    q(num(estimate.itemsSubtotal) - num(estimate.discountAdjustment)),
  );
  return {
    ...estimate,
    shipping,
    restockingFee,
    returnShippingFee,
    total: Math.max(
      0,
      q(goodsBack + num(estimate.tax) + shipping - restockingFee - returnShippingFee),
    ),
  };
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
