import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * A coupon's discount on a deposit pre-order, shared between the deposit and
 * the balance.
 *
 * A pre-order line stores what is owed later as its price minus the deposit,
 * worked out when it went into the cart and before any coupon. Checkout then
 * charged the order total less that balance now — and the total is after the
 * coupon — so the whole discount came off the deposit. A 30-off coupon on a
 * 100 pre-order with a 20 deposit charged nothing at all up front, quietly
 * turned the order into pay-later, and still asked for 80 later; a larger
 * coupon left the stored balance bigger than the order itself.
 *
 * Here each line's share of the goods discount comes off its deposit and its
 * balance in the same proportion the line was split in, so a 20% deposit stays
 * 20% of what the shopper actually pays. The balance is what is returned; the
 * deposit is simply the rest of the discounted line.
 *
 * A seller's scoped coupon comes off that seller's lines only, and of those
 * only the products it applied to, spread by line value — the lines the order
 * records the coupon against (`splitCouponAcrossLines`).
 *
 * Pure and free of database access so the checkout page, the checkout routes
 * and the Stripe order builder all compute the same figure.
 */
export interface PreorderSplitLine {
  price?: number | null;
  quantity?: number | null;
  purchaseType?: string | null;
  preorderOutstandingAmount?: number | null;
  /** Whose line it is, when the coupon was scoped to sellers. */
  vendorId?: string | null;
  /** The line's product, matched against the coupon's `eligibleProductIds`. */
  productId?: string | null;
}

export function preorderOutstandingAfterCoupon(
  lines: ReadonlyArray<PreorderSplitLine>,
  coupon: {
    /** The discount on goods — never a free-shipping coupon's. */
    goodsDiscount: number;
    /** The goods discount by seller, for a coupon limited to some of them. */
    vendorShares?: Record<string, number> | null;
    /**
     * The products a scoped coupon applied to. Absent — a payment quoted
     * before this was carried — every one of the seller's lines shares it.
     */
    eligibleProductIds?: ReadonlyArray<string> | null;
  } | null,
  currency: string,
): number[] {
  const raw = lines.map((line) => Math.max(0, Number(line.preorderOutstandingAmount || 0)));
  const goodsDiscount = Math.max(0, Number(coupon?.goodsDiscount || 0));
  if (goodsDiscount <= 0 || !raw.some((value) => value > 0)) return raw;

  const lineTotals = lines.map((line) =>
    Math.max(0, Number(line.price || 0) * Number(line.quantity || 0)),
  );

  // Each line's share of the goods discount. Left unrounded, as it always was:
  // a payment already quoted has to come out at exactly the figure it was
  // charged by.
  const lineDiscounts = new Array<number>(lines.length).fill(0);
  const spread = (amount: number, indexes: number[]) => {
    const weight = indexes.reduce((sum, index) => sum + lineTotals[index]!, 0);
    if (amount <= 0 || weight <= 0) return;
    for (const index of indexes) {
      lineDiscounts[index]! += (amount * lineTotals[index]!) / weight;
    }
  };
  const shares = coupon?.vendorShares;
  if (shares && Object.keys(shares).length > 0) {
    const eligible = coupon?.eligibleProductIds;
    for (const [vendorId, amount] of Object.entries(shares)) {
      const own = lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => String(line.vendorId || "") === vendorId);
      // Only the products the coupon applied to; all of the seller's lines if
      // none of them can be named, which is how a payment quoted before this
      // was carried shared it.
      const reached = eligible
        ? own.filter(({ line }) => eligible.includes(String(line.productId || "")))
        : [];
      spread(
        Math.max(0, Number(amount) || 0),
        (reached.length > 0 ? reached : own).map(({ index }) => index),
      );
    }
  } else {
    spread(goodsDiscount, lines.map((_, index) => index));
  }

  return raw.map((outstanding, index) => {
    const line = lines[index]!;
    const lineTotal = lineTotals[index]!;
    if (outstanding <= 0 || lineTotal <= 0 || line.purchaseType !== "preorder") {
      return outstanding;
    }
    const kept = Math.max(0, lineTotal - Math.min(lineTotal, lineDiscounts[index]!));
    return quantizeToCurrency((outstanding * kept) / lineTotal, currency);
  });
}

/** The same, summed: what the whole order owes later. */
export function sumPreorderOutstandingAfterCoupon(
  ...args: Parameters<typeof preorderOutstandingAfterCoupon>
): number {
  return preorderOutstandingAfterCoupon(...args).reduce((sum, value) => sum + value, 0);
}
