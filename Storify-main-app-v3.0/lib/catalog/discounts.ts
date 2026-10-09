import { quantizeToCurrency } from "@/lib/intl/money";

const FREE_SHIPPING_COUPON_TYPE = "free_shipping";

type DiscountableCoupon = {
  type?: string | null;
  discount?: number | null;
  maxDiscount?: number | null;
  /**
   * A free-shipping coupon a seller offered on their own parcel: it pays that
   * seller's delivery and nobody else's.
   */
  shippingVendorId?: string | null;
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
   * What each seller's delivery costs, when the cart was rated per seller —
   * how a seller's own free-shipping coupon finds the delivery it pays for.
   */
  shippingByVendor?: Record<string, number> | null;
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
      // A seller's own coupon pays their delivery, not the whole order's:
      // taking the order's shipping handed every other seller's delivery away
      // too. Read live from the current rates where they are known, so a
      // changed address re-prices it; otherwise what it was validated at.
      const vendorId = coupon.shippingVendorId ? String(coupon.shippingVendorId) : "";
      const covered = vendorId
        ? positiveMoney(
            params.shippingByVendor && vendorId in params.shippingByVendor
              ? params.shippingByVendor[vendorId]
              : coupon.discount,
          )
        : shippingCost;
      const maxDiscount = positiveMoney(coupon.maxDiscount);
      const cap = maxDiscount > 0 ? maxDiscount : shippingCost;
      shippingDiscount = round(Math.min(shippingCost, cap, covered));
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
