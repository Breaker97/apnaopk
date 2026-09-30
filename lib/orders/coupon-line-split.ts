import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * A coupon's goods discount, line by line.
 *
 * The order keeps one `discount`, and a consignment keeps its seller's slice
 * (`subOrders.couponDiscount`), but neither says which LINES it came off. A
 * coupon on product X alone was then spread over every line the seller sold:
 * a return of X handed back more than the shopper paid for it, and a return of
 * an undiscounted Y handed back less. Each line records its own share at
 * checkout (`items.couponDiscount`), and a return reads that instead.
 *
 * Pure, so the checkout route and the Stripe order builder cannot disagree.
 */
interface CouponSplitLine {
  price?: number | null;
  quantity?: number | null;
  /** Whose line it is, keyed the way the coupon's `vendorShares` are. */
  vendorId?: string | null;
  /** Whether the coupon's scope reaches this line. */
  eligible?: boolean;
}

/**
 * Each line's share of `goodsDiscount`, summing exactly back to it (or to each
 * seller's share, for a coupon limited to some sellers) in the currency's
 * smallest unit.
 *
 * Within a seller, and across the cart for a whole-cart coupon, the discount
 * goes on the eligible lines by value. A seller whose share has no eligible
 * line left to carry it — the cart changed shape between the quote and the
 * order — has it spread over all of their lines, so the recorded shares still
 * add up to what came off.
 */
export function splitCouponAcrossLines(
  lines: ReadonlyArray<CouponSplitLine>,
  coupon: {
    goodsDiscount: number;
    vendorShares?: Record<string, number> | null;
  },
  currency: string,
): number[] {
  const shares = new Array<number>(lines.length).fill(0);
  const goodsDiscount = Math.max(0, Number(coupon.goodsDiscount) || 0);
  if (goodsDiscount <= 0 || lines.length === 0) return shares;

  const values = lines.map((line) =>
    Math.max(0, Number(line.price || 0) * Number(line.quantity || 0)),
  );
  const isEligible = (index: number) => lines[index]!.eligible !== false;

  const spread = (amount: number, candidates: number[]) => {
    const pool = candidates.some(isEligible)
      ? candidates.filter(isEligible)
      : candidates;
    const weight = pool.reduce((sum, index) => sum + values[index]!, 0);
    if (amount <= 0 || weight <= 0) return;
    // Never more off a line than the line was worth.
    const target = quantizeToCurrency(Math.min(amount, weight), currency);
    let assigned = 0;
    for (const index of pool) {
      const share = quantizeToCurrency((target * values[index]!) / weight, currency);
      shares[index]! += share;
      assigned += share;
    }
    // Rounding lands on the largest line, where it is the smallest distortion.
    const remainder = quantizeToCurrency(target - assigned, currency);
    if (remainder !== 0) {
      const largest = pool.reduce((best, index) =>
        values[index]! > values[best]! ? index : best,
      );
      shares[largest] = quantizeToCurrency(
        Math.min(values[largest]!, Math.max(0, shares[largest]! + remainder)),
        currency,
      );
    }
  };

  const vendorShares = coupon.vendorShares;
  if (vendorShares && Object.keys(vendorShares).length > 0) {
    for (const [vendorId, amount] of Object.entries(vendorShares)) {
      spread(
        Math.max(0, Number(amount) || 0),
        lines
          .map((_, index) => index)
          .filter((index) => String(lines[index]!.vendorId || "") === vendorId),
      );
    }
  } else {
    spread(goodsDiscount, lines.map((_, index) => index));
  }

  return shares.map((share) => quantizeToCurrency(share, currency));
}

/**
 * A line's seller, keyed the way `vendorShares` is: the product's own
 * `vendorId`, whether it arrived as an id or populated.
 */
export function couponVendorKey(vendor: unknown): string | null {
  if (!vendor) return null;
  const id =
    typeof vendor === "object" && "_id" in (vendor as object)
      ? (vendor as { _id: unknown })._id
      : vendor;
  return id ? String(id) : null;
}

/** The most a Stripe metadata value may hold. */
const STRIPE_METADATA_VALUE_LIMIT = 500;

/**
 * A scoped coupon's eligible products, as far as a card payment can carry them.
 *
 * A card payment is charged at checkout and its order written later from the
 * payment's metadata, and both have to arrive at the same pre-order balance or
 * the payment is refused. So the list is used only when it fits in metadata;
 * a list too long to carry is dropped on both sides, which shares the coupon
 * over all of the seller's lines exactly as before it was carried.
 */
export function carriedEligibleProductIds(
  ids: ReadonlyArray<string> | null | undefined,
): string[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  return encodeEligibleProductIds(ids).length <= STRIPE_METADATA_VALUE_LIMIT
    ? [...ids]
    : undefined;
}

export function encodeEligibleProductIds(
  ids: ReadonlyArray<string> | null | undefined,
): string {
  return ids && ids.length > 0 ? ids.join(",") : "";
}

export function decodeEligibleProductIds(
  raw: string | null | undefined,
): string[] | undefined {
  const ids = String(raw || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/**
 * A scoped coupon's seller shares, re-keyed to the consignments the order is
 * actually split into.
 *
 * The shares are keyed by each product's own seller. A store with the
 * marketplace switched off files every line under its house vendor, so a
 * share keyed by a product's former seller matched no consignment and the
 * coupon was recorded against nobody (`couponDiscount: 0`) — while the order
 * still carried the discount. Shares whose seller has no line on the order
 * are kept under their own key, as before.
 */
export function remapVendorShares(
  shares: Record<string, number> | null | undefined,
  lines: ReadonlyArray<{ from: string | null; to: string }>,
  currency: string,
): Record<string, number> | undefined {
  if (!shares) return undefined;
  const target = new Map<string, string>();
  for (const line of lines) {
    if (line.from && !target.has(line.from)) target.set(line.from, line.to);
  }
  const remapped: Record<string, number> = {};
  for (const [vendorId, amount] of Object.entries(shares)) {
    const to = target.get(vendorId) ?? vendorId;
    remapped[to] = quantizeToCurrency(
      (remapped[to] || 0) + (Number(amount) || 0),
      currency,
    );
  }
  return remapped;
}
