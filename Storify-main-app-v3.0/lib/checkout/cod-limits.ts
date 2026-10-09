/**
 * The store's cash-on-delivery order limits, as one rule.
 *
 * Pure and free of server imports so the storefront form and the payment
 * routes decide the same thing about the same order. The routes had the rule
 * and checkout did not, so a cart outside the limits was offered cash on
 * delivery, took the whole form, and was refused at the very last step — by a
 * message quoting a bare number with no currency on it. The form now greys the
 * method out with the reason; `assertCashOnDeliveryAllowed` remains the
 * backstop, and both read this.
 *
 * `total` is what the courier would collect — duty included, as the order's
 * own total is.
 */
type CodLimitBreach = "below_minimum" | "above_maximum" | null;

export function codLimitBreach(params: {
  total: number;
  minOrderAmount?: number | null;
  maxOrderAmount?: number | null;
}): CodLimitBreach {
  const { total, minOrderAmount, maxOrderAmount } = params;

  if (typeof minOrderAmount === "number" && total < minOrderAmount) {
    return "below_minimum";
  }
  // A zero maximum is "no maximum", not "nothing may be sold" — that is how
  // an unset limit arrives from the settings form.
  if (
    typeof maxOrderAmount === "number" &&
    maxOrderAmount > 0 &&
    total > maxOrderAmount
  ) {
    return "above_maximum";
  }
  return null;
}
