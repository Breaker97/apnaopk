import { quantizeToCurrency } from "@/lib/intl/money";

const FREE_SHIPPING_COUPON_TYPE = "free_shipping";

type DiscountableCoupon = {
  type?: string | null;
  discount?: number | null;
  maxDiscount?: number | null;
};

type CheckoutTotals = {
  subtotal: number;
  shippingCost: number;
  subtotalDiscount: number;
  shippingDiscount: number;
  discount: number;
  discountedSubtotal: number;
  discountedShippingCost: number;
  tax: number;
  total: number;
};

/**
 * Round a checkout figure to something the store's currency can actually hold.
 *
 * A flat 2-decimal round is wrong for a zero-decimal currency: 8% tax on a
 * 1250 XOF cart is 100, but on 1201 it is 96.08 — and 0.08 XOF does not exist.
 * The total then fails every gateway that (correctly) refuses to charge a
 * fraction of the smallest unit, which for XOF/XAF/MGA/GNF — Orange Money's
 * whole footprint — blocked ~96% of carts. Quantizing here keeps the cart page,
 * the checkout page, the checkout API and the Stripe intent all agreeing on one
 * charegable number.
 */
function roundForCurrency(value: number, currency: string) {
  return quantizeToCurrency(value, currency);
}

export function isFreeShippingCouponType(type?: string | null) {
  return String(type || "").toLowerCase() === FREE_SHIPPING_COUPON_TYPE;
}

function positiveMoney(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function calculateCheckoutTotals(params: {
  subtotal: number;
  shippingCost: number;
  taxRate: number;
  coupon?: DiscountableCoupon | null;
  /**
   * The store currency the cart is priced in. Decides how many decimals a
   * figure may carry; defaults to a 2-decimal currency so existing callers
   * keep their exact behaviour.
   */
  currency?: string | null;
}): CheckoutTotals {
  const currency = String(params.currency || "USD");
  const round = (value: number) => roundForCurrency(value, currency);
  const subtotal = round(positiveMoney(params.subtotal));
  const shippingCost = round(positiveMoney(params.shippingCost));
  const taxRate = positiveMoney(params.taxRate);
  const coupon = params.coupon;

  let subtotalDiscount = 0;
  let shippingDiscount = 0;

  if (coupon) {
    if (isFreeShippingCouponType(coupon.type)) {
      const maxDiscount = positiveMoney(coupon.maxDiscount);
      const cap = maxDiscount > 0 ? maxDiscount : shippingCost;
      shippingDiscount = round(Math.min(shippingCost, cap));
    } else {
      subtotalDiscount = round(
        Math.min(subtotal, positiveMoney(coupon.discount)),
      );
    }
  }

  const discountedSubtotal = round(Math.max(0, subtotal - subtotalDiscount));
  const discountedShippingCost = round(
    Math.max(0, shippingCost - shippingDiscount),
  );
  const tax = round(discountedSubtotal * taxRate);
  const discount = round(subtotalDiscount + shippingDiscount);
  const total = round(discountedSubtotal + discountedShippingCost + tax);

  return {
    subtotal,
    shippingCost,
    subtotalDiscount,
    shippingDiscount,
    discount,
    discountedSubtotal,
    discountedShippingCost,
    tax,
    total,
  };
}
