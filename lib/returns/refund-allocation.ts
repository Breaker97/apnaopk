/**
 * What a refund was actually made of.
 *
 * A refund used to be one number. The ledger and the payout engine each had to
 * guess its composition, and both guessed the same way: prorate it across the
 * whole order. That is only ever right when the refund really is "X% of
 * everything" — and a return is the opposite, because a return is scoped to
 * particular items. On an 800 goods / 80 commission / 80 tax / 30 shipping
 * order refunded 880, the guess reversed 77.36 of the commission instead of
 * 80, left 2.64 of tax standing against a sale that came back, and clawed
 * 29.01 out of shipping income that was never refunded at all. On a split
 * order it was worse: the refund was spread across every consignment, so a
 * return of ONE vendor's item took money out of the other vendor's payable.
 *
 * So the composition travels with the refund instead of being re-derived. The
 * return request already computed it — `ReturnRequest.estimatedRefund` carries
 * the goods, tax and shipping split — and this module turns that into a
 * per-consignment allocation the posting rules can apply directly.
 *
 * Pure and free of database access, exactly as `lib/finance/postings.ts` is,
 * so the arithmetic is testable on its own.
 */

import { quantizeToCurrency } from "@/lib/intl/money";
import { allocate } from "@/lib/finance/postings";
import { refundAdminFeeFor, type ReturnPolicy } from "@/lib/returns/return-policy";

/** One consignment's slice of a refund, split the way the sale was. */
export interface RefundAllocationShare {
  /** The consignment this slice belongs to; null for an order with no vendor. */
  vendorId: string | null;
  /** Goods, before the platform's cut is separated out of it. */
  merchandise: number;
  shipping: number;
  tax: number;
  duty: number;
  /**
   * The slice of its own commission the platform is KEEPING — the refund
   * administration fee, off by default.
   *
   * Recorded as what was kept rather than what was handed back, so it sums
   * across several refunds on one order and so an absent or zero value means
   * exactly what it did before the fee existed: the whole commission comes
   * back. The shopper is unaffected either way; the fee moves the cost of a
   * processed-then-reversed sale from the platform to the vendor who made it.
   */
  commissionRetained?: number;
}

/** The return-request item fields the allocation reads. */
interface ReturnAllocationItem {
  vendorId?: unknown;
  unitPrice?: number | null;
  quantityApproved?: number | null;
  quantityRequested?: number | null;
}

/** The `ReturnRequest.estimatedRefund` fields the allocation reads. */
interface ReturnRefundEstimateLike {
  itemsSubtotal?: number | null;
  tax?: number | null;
  shipping?: number | null;
  discountAdjustment?: number | null;
  /** Kept by the merchant out of the goods value. */
  restockingFee?: number | null;
  /** Charged for the return leg, also out of the goods value. */
  returnShippingFee?: number | null;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Split `amount` across the consignments a return touches, in the proportions
 * the RETURN is made of.
 *
 * Still a proportional split — but of the returned goods, not of the order.
 * That distinction is the whole fix: refunding 880 of a 910 order now means
 * "all of these items, all of their tax, none of the delivery" rather than
 * "96.7% of everything the shopper bought".
 *
 * `amount` is what is actually being paid back, which can be less than the
 * estimate: an admin may refund part of an approved return, and a restocking
 * or return-shipping fee (both 0 today) would reduce it too. Scaling the
 * estimate's own weights to the real figure keeps the parts summing EXACTLY to
 * the money that left, whatever the rounding.
 *
 * Returns null when there is nothing trustworthy to say — no items, no value,
 * or a non-positive amount — and the caller then falls back to the old
 * proportional rule rather than posting a guess dressed up as a fact.
 */
export function allocateReturnRefund(params: {
  amount: number;
  currency: string;
  items: ReturnAllocationItem[];
  estimate: ReturnRefundEstimateLike;
  /**
   * `commission ÷ subtotal` per consignment, from the order. Needed only to
   * size the refund administration fee, so a caller with no fee configured can
   * leave it out.
   */
  commissionRatioByVendor?: ReadonlyMap<string, number>;
  policy?: Pick<ReturnPolicy, "refundAdminFeePercent" | "refundAdminFeeCap">;
}): RefundAllocationShare[] | null {
  const currency = String(params.currency || "").toUpperCase();
  if (!currency) return null;

  const amount = quantizeToCurrency(Math.max(0, num(params.amount)), currency);
  if (amount <= 0) return null;

  // Goods value per consignment, from the lines actually coming back.
  // `quantityApproved` is what the merchant agreed to take, so it wins over
  // what the shopper asked for; a line approved down to zero contributes
  // nothing rather than falling back to the requested figure.
  const byVendor = new Map<string, number>();
  const seen: string[] = [];
  for (const item of params.items || []) {
    const vendorId = item?.vendorId ? String(item.vendorId) : "";
    const quantity = Math.max(
      0,
      num(item?.quantityApproved ?? item?.quantityRequested),
    );
    const value = Math.max(0, num(item?.unitPrice)) * quantity;
    if (value <= 0) continue;
    if (!byVendor.has(vendorId)) {
      byVendor.set(vendorId, 0);
      seen.push(vendorId);
    }
    byVendor.set(vendorId, byVendor.get(vendorId)! + value);
  }
  if (seen.length === 0) return null;

  // The order-level discount already came off the goods when the estimate was
  // built, so it is netted here rather than carried as a part of its own —
  // the sale never posted a discount line either.
  //
  // Both fees come off the GOODS and nothing else. A restocking charge is the
  // merchant keeping part of the item's value, and a return-shipping charge is
  // a service they are selling; neither is a reason to hand the state less of
  // its tax back or to keep delivery the shopper is owed.
  const merchandise = Math.max(
    0,
    num(params.estimate?.itemsSubtotal) -
      num(params.estimate?.discountAdjustment) -
      Math.max(0, num(params.estimate?.restockingFee)) -
      Math.max(0, num(params.estimate?.returnShippingFee)),
  );
  const tax = Math.max(0, num(params.estimate?.tax));
  const shipping = Math.max(0, num(params.estimate?.shipping));
  if (merchandise + tax + shipping <= 0) return null;

  // Allocated across every part of every consignment in ONE call, so the
  // pieces sum exactly to `amount`. Four parts rounded independently drift by
  // a cent or two, and the cash posted then disagrees with the money that
  // actually left — see `allocate`.
  //
  // Tax and delivery follow the goods: a consignment holding 60% of the
  // returned value carries 60% of the tax coming back with it. The order's own
  // tax was apportioned the same way when the estimate was computed.
  const totalValue = seen.reduce((sum, id) => sum + byVendor.get(id)!, 0);
  const weights: number[] = [];
  for (const vendorId of seen) {
    const weight = byVendor.get(vendorId)! / totalValue;
    weights.push(merchandise * weight, shipping * weight, tax * weight, 0);
  }

  const parts = allocate(amount, weights, currency);
  return seen.map((vendorId, index) => {
    const merchandiseBack = parts[index * 4] ?? 0;
    // Sized from the commission this consignment's returned goods carry, and
    // applied per consignment — a shopper returning to two sellers has two
    // sales being reversed, and each one cost the platform its own processing.
    const commissionRatio =
      params.commissionRatioByVendor?.get(vendorId) ?? 0;
    const retained = params.policy
      ? quantizeToCurrency(
          refundAdminFeeFor(merchandiseBack * commissionRatio, params.policy),
          currency,
        )
      : 0;

    return {
      vendorId: vendorId || null,
      merchandise: merchandiseBack,
      shipping: parts[index * 4 + 1] ?? 0,
      tax: parts[index * 4 + 2] ?? 0,
      duty: parts[index * 4 + 3] ?? 0,
      // Left off entirely when nothing was kept, so a store with no fee
      // configured writes exactly the record it wrote before the fee existed.
      ...(retained > 0 ? { commissionRetained: retained } : {}),
    };
  });
}

/** One order line the admin is refunding, and how much of it. */
interface OrderRefundLine {
  vendorId?: unknown;
  /** Unit price as the order recorded it. */
  price?: number | null;
  /** How many of that line this refund covers. */
  quantity?: number | null;
}

/**
 * Split a refund the admin described by hand, rather than one a return
 * described for them.
 *
 * The order-level refund form has no items behind it, so its refunds have
 * always been prorated across the whole sale — which is why refunding 880 of a
 * 910 order recorded 773.63 of goods and 29.01 of delivery instead of 800 and
 * nothing. Correct in total, unreadable per line, and it left the vendor
 * statement showing figures nobody could tie back to anything.
 *
 * Once the admin says WHAT the refund is for — these lines, this much of the
 * delivery — the split is a fact rather than an average. Delivery is carried
 * separately from goods because the two are refunded independently all the
 * time: the shopper keeps the item and is compensated for a late parcel, or
 * returns the goods while the courier's fee stands.
 *
 * Returns null when nothing was named, and the caller then prorates as before.
 */
export function allocateOrderRefund(params: {
  amount: number;
  currency: string;
  /** The lines being refunded. Zero-quantity lines contribute nothing. */
  lines: OrderRefundLine[];
  /** Delivery being handed back, across the order. */
  shipping?: number | null;
  /** `order.tax` and `order.subtotal`, to size the tax that follows the goods. */
  orderTax?: number | null;
  orderSubtotal?: number | null;
  /** Rated delivery per consignment, so a delivery-only refund lands right. */
  shippingByVendor?: ReadonlyMap<string, number>;
}): RefundAllocationShare[] | null {
  const currency = String(params.currency || "").toUpperCase();
  if (!currency) return null;

  const amount = quantizeToCurrency(Math.max(0, num(params.amount)), currency);
  if (amount <= 0) return null;

  const goodsByVendor = new Map<string, number>();
  const seen: string[] = [];
  const note = (vendorId: string) => {
    if (!goodsByVendor.has(vendorId)) {
      goodsByVendor.set(vendorId, 0);
      seen.push(vendorId);
    }
  };

  for (const line of params.lines || []) {
    const quantity = Math.max(0, num(line?.quantity));
    const value = Math.max(0, num(line?.price)) * quantity;
    if (value <= 0) continue;
    const vendorId = line?.vendorId ? String(line.vendorId) : "";
    note(vendorId);
    goodsByVendor.set(vendorId, goodsByVendor.get(vendorId)! + value);
  }

  // Delivery apportioned by what each consignment's delivery was RATED at, the
  // same split `decomposeOrder` uses. A consignment can be named by the
  // delivery alone, with none of its goods coming back.
  const shipping = Math.max(0, num(params.shipping));
  const shippingByVendor = new Map<string, number>();
  if (shipping > 0) {
    const rated = params.shippingByVendor;
    const ratedTotal = rated
      ? [...rated.values()].reduce((sum, value) => sum + Math.max(0, value), 0)
      : 0;
    if (rated && ratedTotal > 0) {
      for (const [vendorId, value] of rated) {
        const slice = (shipping * Math.max(0, value)) / ratedTotal;
        if (slice <= 0) continue;
        note(vendorId);
        shippingByVendor.set(vendorId, slice);
      }
    } else if (seen.length > 0) {
      // Nothing to weight delivery by, so it follows the goods.
      const goodsTotal = seen.reduce(
        (sum, id) => sum + goodsByVendor.get(id)!,
        0,
      );
      for (const vendorId of seen) {
        shippingByVendor.set(
          vendorId,
          goodsTotal > 0
            ? (shipping * goodsByVendor.get(vendorId)!) / goodsTotal
            : shipping / seen.length,
        );
      }
    }
  }

  if (seen.length === 0) return null;

  // Tax follows the goods, in the proportion the order charged it — the same
  // apportionment a return estimate makes.
  const orderSubtotal = Math.max(0, num(params.orderSubtotal));
  const orderTax = Math.max(0, num(params.orderTax));
  const taxRatio = orderSubtotal > 0 ? orderTax / orderSubtotal : 0;

  const weights: number[] = [];
  for (const vendorId of seen) {
    const goods = goodsByVendor.get(vendorId) ?? 0;
    weights.push(
      goods,
      shippingByVendor.get(vendorId) ?? 0,
      goods * taxRatio,
      0,
    );
  }
  if (weights.every((weight) => weight <= 0)) return null;

  const parts = allocate(amount, weights, currency);
  return seen.map((vendorId, index) => ({
    vendorId: vendorId || null,
    merchandise: parts[index * 4] ?? 0,
    shipping: parts[index * 4 + 1] ?? 0,
    tax: parts[index * 4 + 2] ?? 0,
    duty: parts[index * 4 + 3] ?? 0,
  }));
}
