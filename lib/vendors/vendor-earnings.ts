import { Types } from "mongoose";
import { Order, PaymentTransaction } from "@/models";
import { isPlatformCollectedCod } from "@/lib/payments/cod-collection";
import {
  platformCollectedCodMatch,
  platformSettledOrderFilter,
  selfCollectedOrderFilter,
  vendorCollectedCodMatch,
} from "@/lib/payments/payment-custody";
import {
  SETTLED_ORDER_PAYMENT_STATUSES,
  SETTLED_SUB_ORDER_PAYMENT_MATCH,
} from "@/lib/orders/order-payment-status";
import { roundMoney } from "@/lib/intl/money";

/**
 * The arithmetic behind vendor payouts, in one place.
 *
 * Two callers need the exact same answer: `POST /api/admin/payouts`, which
 * moves the money, and the vendor detail Payouts tab, which tells an admin how
 * much is owed before they create that payout. A second implementation of a
 * money formula drifts from the first the moment either is touched, so both
 * read from here.
 *
 * Sub-order `subtotal`/`commission`/`vendorEarnings` are stored undiscounted
 * and pre-refund, so neither can be paid out at face value:
 *
 * - Refunds are order-level (`PaymentTransaction` rows, and nothing on the
 *   order splits them per vendor), so each sub-order gives back the same
 *   proportion of the order that was refunded.
 * - Order-level coupon discounts reduce what the platform actually collected.
 *   Paying undiscounted earnings would hand vendors more than came in — a
 *   100%-off coupon would still produce a full payout. Line discounts are
 *   already netted inside sub-order subtotals, so they come off the order
 *   discount before the ratio is taken, and free-shipping coupons discount
 *   shipping rather than items, so they do not reduce item earnings at all.
 */

/** The order fields `payableRatioFor` and the currency grouping read. */
export const PAYABLE_ORDER_PROJECTION =
  // `paymentMethod` is read only by the cash-on-delivery shipping rule, which
  // cannot tell a COD order from a card one without it.
  "total subtotal discount coupon currency paymentMethod items.lineDiscount subOrders";

interface PayableOrderLike {
  total?: number;
  subtotal?: number;
  discount?: number;
  coupon?: { type?: string } | null;
  /** Read only by the cash-on-delivery shipping rule. */
  paymentMethod?: string | null;
  /**
   * The currency the sale was in. Absent on orders written before the snapshot
   * existed, which are treated as the store's own — the same assumption the
   * ledger makes for them.
   */
  currency?: string;
  items?: Array<{ lineDiscount?: { amount?: number } | null }> | null;
}

interface PayableSubOrderLike {
  vendorId?: unknown;
  subtotal?: number;
  commission?: number;
  vendorEarnings?: number;
  shippingCost?: number;
  status?: string;
  payoutStatus?: string;
  payoutId?: unknown;
  /** When the payout that covers this consignment froze its amount. */
  payoutClaimedAt?: Date | null;
  payoutDate?: Date | null;
  /** When this consignment's commission invoice was paid. */
  commissionSettledAt?: Date | null;
  /** Who took the cash at the door — see lib/cod-collection.ts. */
  codCollectedBy?: string | null;
  fulfillment?: { method?: string } | null;
}

/**
 * Orders holding sub-orders that are ready to be paid out to `vendorId`.
 *
 * This is the eligibility rule payout creation claims against; the Payouts tab
 * uses it unchanged so "owed" never promises money a payout would refuse.
 *
 * `paymentStatus: paid` is not by itself a statement that the PLATFORM was paid
 * — a vendor marking a cash order collected sets exactly the same flag. Paying
 * those out sent merchants money that never arrived here, on top of never
 * collecting the commission they owed, so custody is checked separately. What
 * the platform is still owed on those orders is a debt this filter cannot
 * express; it only stops the wrong-direction payment.
 */
export function buildPayableOrderFilter(
  vendorId: Types.ObjectId | string,
  range?: { periodStart?: Date; periodEnd?: Date },
): Record<string, unknown> {
  const vendorObjectId = new Types.ObjectId(String(vendorId));
  // THIS consignment's money, not the order's. The order-level payment arm
  // admits `partially_paid` — a split order with one vendor collected — so
  // without this a vendor whose own cash had not arrived would ride in on a
  // sibling's collection.
  const claimable = {
    vendorId: vendorObjectId,
    status: "delivered",
    paymentStatus: SETTLED_SUB_ORDER_PAYMENT_MATCH,
    payoutStatus: { $nin: ["scheduled", "paid"] },
  };

  const filter: Record<string, unknown> = {
    status: "delivered",
    paymentStatus: { $in: SETTLED_ORDER_PAYMENT_STATUSES },
    // Two ways the platform can be holding this money, and they ask the
    // question at different levels — which is why this is an `$or` of whole
    // shapes rather than a custody arm spread alongside one `$elemMatch`.
    $or: [
      {
        // A gateway settled it onto the platform's own credentials. That is a
        // property of the ORDER, so the consignment carries no extra condition.
        ...platformSettledOrderFilter(),
        subOrders: { $elemMatch: claimable },
      },
      {
        // Cash the platform's own courier collected. Custody here is a
        // property of the CONSIGNMENT — one vendor on the order may ship with
        // the store's courier while another drives their own van — so the
        // condition has to sit inside the same `$elemMatch` that picks the
        // vendor, or it could be satisfied by somebody else's parcel.
        paymentMethod: "cod",
        subOrders: {
          $elemMatch: { ...claimable, ...platformCollectedCodMatch() },
        },
      },
    ],
  };

  if (range?.periodStart || range?.periodEnd) {
    const createdAt: Record<string, Date> = {};
    if (range.periodStart) createdAt.$gte = range.periodStart;
    if (range.periodEnd) createdAt.$lte = range.periodEnd;
    filter.createdAt = createdAt;
  }

  return filter;
}

/**
 * Orders where `vendorId` collected the money and still owes the platform its
 * commission.
 *
 * The exact complement of {@link buildPayableOrderFilter} on the custody arm,
 * and identical on every other condition, so a delivered and settled sale
 * appears in exactly one of the two. That is the property worth keeping: an
 * order in neither is revenue that has silently left both ledgers.
 *
 * "Not yet collected" is the absence of BOTH settlement stamps, so no existing
 * row needs backfilling and no order-creation path has to stamp anything.
 * `commissionSettlementId` is the claim an open invoice holds and
 * `commissionSettledAt` is the moment it was paid; excluding only the latter
 * would let a second invoice bill a sale the first one is still collecting,
 * exactly as `payoutStatus` excludes both `scheduled` and `paid`.
 */
export function buildCommissionOwedOrderFilter(
  vendorId: Types.ObjectId | string,
  range?: { periodStart?: Date; periodEnd?: Date },
): Record<string, unknown> {
  const vendorObjectId = new Types.ObjectId(String(vendorId));
  // Kept identical to its counterpart's `claimable` on every shared condition
  // so the two stay exact complements: a vendor is billed commission on cash
  // they took, and a sibling's collection is not evidence that they took any.
  const billable = {
    vendorId: vendorObjectId,
    status: "delivered",
    paymentStatus: SETTLED_SUB_ORDER_PAYMENT_MATCH,
    commissionSettledAt: { $exists: false },
    commissionSettlementId: { $exists: false },
  };

  const filter: Record<string, unknown> = {
    status: "delivered",
    paymentStatus: { $in: SETTLED_ORDER_PAYMENT_STATUSES },
    // The mirror image of the payable filter, arm for arm.
    $or: [
      {
        // Self-collected by any method OTHER than COD — cash at the counter,
        // a manual sale, the merchant's own card terminal. `$nor` of the
        // gateway arms is what "the platform did not receive it" means.
        paymentMethod: { $ne: "cod" },
        ...selfCollectedOrderFilter(),
        subOrders: { $elemMatch: billable },
      },
      {
        // COD the VENDOR collected. The `$ne: "cod"` above deliberately
        // excludes every COD order from the first arm, because whether the
        // platform received it is per consignment and cannot be answered up
        // here — an order-level `$nor` would bill a vendor for cash the
        // store's courier banked.
        paymentMethod: "cod",
        subOrders: {
          $elemMatch: { ...billable, ...vendorCollectedCodMatch() },
        },
      },
    ],
  };

  if (range?.periodStart || range?.periodEnd) {
    const createdAt: Record<string, Date> = {};
    if (range.periodStart) createdAt.$gte = range.periodStart;
    if (range.periodEnd) createdAt.$lte = range.periodEnd;
    filter.createdAt = createdAt;
  }

  return filter;
}

/**
 * Did this vendor take the cash for this consignment at the door?
 *
 * The exact complement of `isPlatformCollectedCod`, and only ever true on a COD
 * order — a card sale settled onto the platform's own gateway however the goods
 * were handed over.
 */
function isVendorCollectedCod(
  order: PayableOrderLike,
  sub: PayableSubOrderLike,
): boolean {
  if (String(order.paymentMethod || "").toLowerCase() !== "cod") return false;
  return !isPlatformCollectedCod(sub);
}

/**
 * This consignment's slice of a free-shipping coupon.
 *
 * The coupon discounts DELIVERY and nothing else, so it is apportioned by what
 * each consignment's delivery was rated at — the same split `decomposeOrder`
 * uses. Any other coupon reduced the goods, which the payable ratio already
 * accounts for.
 */
function shippingDiscountFor(
  order: PayableOrderLike,
  ratedForThisSub: number,
  ratedForOrder: number,
): number {
  if (order.coupon?.type !== "free_shipping") return 0;
  if (ratedForOrder <= 0 || ratedForThisSub <= 0) return 0;
  const discount = Math.min(
    ratedForOrder,
    Math.max(0, Number(order.discount || 0)),
  );
  return (discount * ratedForThisSub) / ratedForOrder;
}

/** Selects the sub-orders {@link buildCommissionOwedOrderFilter} matched. */
export function isCommissionOwedSubOrder(
  sub: PayableSubOrderLike & {
    commissionSettledAt?: unknown;
    commissionSettlementId?: unknown;
  },
): boolean {
  return (
    sub.status === "delivered" &&
    !sub.commissionSettledAt &&
    !sub.commissionSettlementId
  );
}

/**
 * Orders already paid out to `vendorId`.
 *
 * The set a clawback is computed over: a refund that lands after the payout has
 * cleared cannot reduce that payout, so what the vendor was paid and what they
 * turned out to be owed drift apart with nothing watching.
 */
function buildSettledOrderFilter(
  vendorId: Types.ObjectId | string,
): Record<string, unknown> {
  return {
    subOrders: {
      $elemMatch: {
        vendorId: new Types.ObjectId(String(vendorId)),
        payoutStatus: "paid",
      },
    },
  };
}

/** Selects the sub-orders {@link buildSettledOrderFilter} matched. */
function isSettledSubOrder(sub: PayableSubOrderLike): boolean {
  return sub.payoutStatus === "paid";
}

/**
 * Orders where `vendorId` has already PAID the commission.
 *
 * The mirror of {@link buildSettledOrderFilter} on the other side of the
 * ledger: there the platform sent money and a later refund makes it an
 * overpayment; here the vendor sent money and a later refund makes it a
 * credit. Both are settlements a refund can arrive after, and neither can be
 * undone by the settlement itself.
 */
function buildCommissionSettledOrderFilter(
  vendorId: Types.ObjectId | string,
): Record<string, unknown> {
  return {
    subOrders: {
      $elemMatch: {
        vendorId: new Types.ObjectId(String(vendorId)),
        commissionSettledAt: { $exists: true, $ne: null },
      },
    },
  };
}

/** Selects the sub-orders {@link buildCommissionSettledOrderFilter} matched. */
export function isCommissionSettledSubOrder(sub: PayableSubOrderLike): boolean {
  return Boolean(sub.commissionSettledAt);
}

/**
 * What a vendor is holding that they turned out not to be owed.
 *
 * `payableAtPayout` is what their settled sales were worth when the payout
 * cleared; `payableNow` is what the same sales are worth with every refund
 * since applied. The difference is an overpayment, and it exists because a
 * payout is final while a refund is not: a shopper returning goods a month
 * after the vendor was paid for them takes the money out of the platform's
 * pocket, not the vendor's.
 *
 * Never negative. An UNDERpayment is not the mirror case — it means sales were
 * left out of a payout, and those are still sitting in the payable balance
 * waiting to be claimed by the next one, so treating it as a credit would pay
 * them twice.
 */
export function overpaidToVendor(
  payableAtPayout: number,
  payableNow: number,
): number {
  return Math.max(0, roundMoney(payableAtPayout - payableNow));
}

/**
 * What one order's refunds did, in the two forms the payout maths can use.
 *
 * Split because refunds are no longer all alike. A refund raised against a
 * return records exactly whose goods came back — see
 * `PaymentTransaction.refundAllocation` and lib/refund-allocation.ts — and that
 * consignment, and only that one, should carry it. An order-level refund
 * records nothing, because there is no item context to record, so it is still
 * spread across the order the way every refund used to be.
 *
 * Keeping the two apart is what stops a return of ONE vendor's item from
 * reaching into another vendor's balance, while leaving every refund written
 * before allocations existed behaving exactly as it always did.
 */
export interface OrderRefundBreakdown {
  /** Refunds that said nothing about their composition. Prorated, as before. */
  unallocated: number;
  /** Goods handed back per vendor, from the refunds that did say. */
  merchandiseByVendor: Map<string, number>;
  /**
   * Delivery handed back per vendor. Read only by the cash-on-delivery
   * shipping rule: a vendor cannot owe the platform delivery money that has
   * already gone back to the shopper.
   */
  shippingByVendor: Map<string, number>;
  /**
   * Commission the platform kept back as a refund administration fee, per
   * vendor. Summed rather than averaged, which is why the allocation records
   * what was KEPT rather than what was returned.
   */
  commissionRetainedByVendor: Map<string, number>;
}

/** Nothing refunded — so a caller can read the shape without a null check. */
export function emptyRefundBreakdown(): OrderRefundBreakdown {
  return {
    unallocated: 0,
    merchandiseByVendor: new Map(),
    shippingByVendor: new Map(),
    commissionRetainedByVendor: new Map(),
  };
}

/** One refund row, reduced to what the payout arithmetic reads. */
export interface RefundRow {
  orderId: string;
  createdAt: Date;
  grossAmount: number;
  /** Null when this refund recorded no allocation. */
  allocation: Array<{
    vendorId?: unknown;
    merchandise?: number | null;
    shipping?: number | null;
    commissionRetained?: number | null;
  }> | null;
}

/**
 * Every succeeded refund against these orders.
 *
 * Sourced from `PaymentTransaction` rather than `Order.refundedTotal`: the
 * denormalized column is a reservation counter that a failed gateway call rolls
 * back, while these rows are the settled financial record.
 *
 * Loaded whole rather than aggregated, because the allocation has to be read
 * row by row. One order can carry a return refund that recorded its split and
 * an order-level refund that did not, and summing them in the database would
 * lose exactly the distinction this exists to keep.
 */
async function loadRefundRows(
  orderIds: ReadonlyArray<Types.ObjectId | string>,
): Promise<RefundRow[]> {
  if (orderIds.length === 0) return [];

  const rows = await PaymentTransaction.find({
    orderId: {
      $in: orderIds.map((id) => new Types.ObjectId(String(id))),
    },
    type: "refund",
    status: "succeeded",
  })
    .select("orderId grossAmount createdAt refundAllocation")
    .lean<
      Array<{
        orderId: unknown;
        grossAmount?: number;
        createdAt?: Date;
        refundAllocation?: Array<{
          vendorId?: unknown;
          merchandise?: number | null;
          shipping?: number | null;
          commissionRetained?: number | null;
        }> | null;
      }>
    >();

  return rows.map((row) => ({
    orderId: String(row.orderId),
    // Epoch for a row with no timestamp, so the clawback's cutoff reads it as
    // "before the payout" rather than throwing it out or counting it late.
    createdAt: row.createdAt ? new Date(row.createdAt) : new Date(0),
    grossAmount: Number(row.grossAmount || 0),
    allocation:
      Array.isArray(row.refundAllocation) && row.refundAllocation.length > 0
        ? row.refundAllocation
        : null,
  }));
}

/**
 * Fold refund rows into one breakdown per order.
 *
 * `include` narrows which rows count, which is how the clawback asks the same
 * question twice — once as the payout saw it, once as it stands now — without
 * subtracting one breakdown from another. A breakdown is not a number and does
 * not subtract meaningfully.
 */
export function summarizeRefundRows(
  rows: ReadonlyArray<RefundRow>,
  include?: (row: RefundRow) => boolean,
): Map<string, OrderRefundBreakdown> {
  const byOrder = new Map<string, OrderRefundBreakdown>();

  for (const row of rows) {
    if (include && !include(row)) continue;

    let entry = byOrder.get(row.orderId);
    if (!entry) {
      entry = emptyRefundBreakdown();
      byOrder.set(row.orderId, entry);
    }

    if (!row.allocation) {
      entry.unallocated += row.grossAmount;
      continue;
    }

    for (const share of row.allocation) {
      // Only merchandise, plus whatever commission the platform held back out
      // of it. Tax, delivery and duty were never the vendor's money, so handing
      // them back changes nothing about what the vendor is owed.
      const merchandise = Math.max(0, Number(share?.merchandise || 0));
      const shipping = Math.max(0, Number(share?.shipping || 0));
      const retained = Math.max(0, Number(share?.commissionRetained || 0));
      if (merchandise <= 0 && shipping <= 0 && retained <= 0) continue;
      const vendorId = share?.vendorId ? String(share.vendorId) : "";
      if (merchandise > 0) {
        entry.merchandiseByVendor.set(
          vendorId,
          (entry.merchandiseByVendor.get(vendorId) || 0) + merchandise,
        );
      }
      if (shipping > 0) {
        entry.shippingByVendor.set(
          vendorId,
          (entry.shippingByVendor.get(vendorId) || 0) + shipping,
        );
      }
      if (retained > 0) {
        entry.commissionRetainedByVendor.set(
          vendorId,
          (entry.commissionRetainedByVendor.get(vendorId) || 0) + retained,
        );
      }
    }
  }

  return byOrder;
}

/** Succeeded refunds per order, broken down for the payout arithmetic. */
export async function fetchRefundTotalsByOrder(
  orderIds: ReadonlyArray<Types.ObjectId | string>,
): Promise<Map<string, OrderRefundBreakdown>> {
  return summarizeRefundRows(await loadRefundRows(orderIds));
}

/**
 * Fraction of a sub-order's stored amounts that survives the order-level
 * coupon discount and any refund that did NOT record what it was made of.
 *
 * `totalRefunded` is deliberately only the unallocated part. A refund that
 * named the consignment whose goods came back is subtracted from that
 * consignment by `sumVendorPayable` instead, because spreading it over the
 * whole order is what took money out of vendors who were never involved.
 * Refunds with nothing recorded have no better answer available, so they keep
 * the old proportional treatment — and with no allocations anywhere this
 * function's result is unchanged, which is what keeps historical payouts from
 * shifting under a rebuild.
 */
export function payableRatioFor(
  order: PayableOrderLike,
  totalRefunded: number,
): number {
  const orderTotal = Number(order.total || 0);
  const refundRatio =
    orderTotal > 0
      ? Math.min(1, Math.max(0, totalRefunded / orderTotal))
      : 0;

  const orderSubtotal = Number(order.subtotal || 0);
  const orderDiscount = Number(order.discount || 0);
  const lineDiscountTotal = (order.items || []).reduce(
    (sum, item) => sum + Number(item?.lineDiscount?.amount || 0),
    0,
  );
  const isFreeShippingCoupon = order.coupon?.type === "free_shipping";
  const orderLevelDiscount = isFreeShippingCoupon
    ? 0
    : Math.max(0, orderDiscount - lineDiscountTotal);
  const discountRatio =
    orderSubtotal > 0
      ? Math.min(1, Math.max(0, orderLevelDiscount / orderSubtotal))
      : 0;

  return (1 - refundRatio) * (1 - discountRatio);
}

/**
 * What a vendor still owes back, in one currency.
 *
 * Loaded rather than computed inline because two callers need the identical
 * answer — payout creation, which deducts it, and the vendor finance screen,
 * which has to show it even when no payout is being made. A vendor deep enough
 * in the negative cannot have a payout created at all (the minimum-withdrawal
 * check rejects it), so a figure that only appeared during payout creation
 * would be invisible in exactly the case that matters.
 */
/**
 * How much a settlement turned out to be wrong by, once later refunds landed.
 *
 * One shape, two settlements. A payout is the platform sending a vendor their
 * share; a paid commission invoice is the vendor sending the platform its cut.
 * Both are final, both can be followed by a refund that un-makes the sale they
 * were calculated from, and in both cases the difference is owed back the
 * other way. Written once because a second copy of this arithmetic would drift
 * from the first the moment either was touched.
 *
 * Never negative. The mirror case is not the mirror answer: less settled than
 * expected means sales are still waiting to be claimed by the next payout or
 * the next invoice, not that anybody owes anything.
 */
async function settlementDrift(params: {
  vendorId: Types.ObjectId | string;
  currency: string;
  /** Orders carrying a settled consignment for this vendor. */
  orderFilter: Record<string, unknown>;
  /** Which of the vendor's consignments this settlement covered. */
  isSettled: (sub: PayableSubOrderLike) => boolean;
  /** When it settled — the cutoff a refund has to fall after to count. */
  settledAt: (sub: PayableSubOrderLike) => Date | null | undefined;
  /** Which figure the settlement moved. */
  read: (totals: VendorPayableTotals) => number;
}): Promise<number> {
  const vendorObjectId = new Types.ObjectId(String(params.vendorId));
  const currency = params.currency.toUpperCase();

  // The shared projection takes `subOrders` whole, so every stamp this reads
  // is already there. Naming a subpath as well collides with the parent and
  // Mongo rejects the query outright.
  const settled = await Order.find(params.orderFilter)
    .select(PAYABLE_ORDER_PROJECTION)
    .lean<
      Array<PayableOrderLike & { _id: unknown; subOrders?: PayableSubOrderLike[] | null }>
    >();
  if (settled.length === 0) return 0;

  const settledAtByOrderId = new Map<string, Date>();
  for (const order of settled) {
    const when = (order.subOrders || [])
      .filter(
        (sub) =>
          String(sub.vendorId) === String(vendorObjectId) &&
          params.isSettled(sub),
      )
      .map((sub) => params.settledAt(sub))
      .find(Boolean);
    if (when) settledAtByOrderId.set(String(order._id), new Date(when));
  }
  if (settledAtByOrderId.size === 0) return 0;

  const rows = await loadRefundRows([...settledAtByOrderId.keys()]);
  // A refund issued BEFORE the settlement was already deducted from it, so
  // counting that one again would reclaim money nobody was ever given.
  const isLate = (row: RefundRow) => {
    const when = settledAtByOrderId.get(row.orderId);
    return Boolean(when && row.createdAt > when);
  };

  const lateOrderIds = new Set(rows.filter(isLate).map((row) => row.orderId));
  if (lateOrderIds.size === 0) return 0;

  const relevant = rows.filter((row) => lateOrderIds.has(row.orderId));
  const affected = settled.filter((order) =>
    lateOrderIds.has(String(order._id)),
  );
  const valueIn = (refunds: ReadonlyMap<string, OrderRefundBreakdown>) =>
    params.read(
      payableInCurrency(
        sumVendorPayable(
          affected,
          vendorObjectId,
          refunds,
          params.isSettled,
          currency,
        ),
        currency,
      ),
    );

  // The same arithmetic run twice over the same sales — once as the settlement
  // saw them, once as they stand — so the difference cannot be anything but
  // the refunds that arrived too late to be counted. Two summaries of one set
  // of rows rather than one summary minus another: a breakdown carries
  // per-vendor maps, and subtracting those would be inventing arithmetic
  // nobody checked.
  return overpaidToVendor(
    valueIn(summarizeRefundRows(relevant, (row) => !isLate(row))),
    valueIn(summarizeRefundRows(relevant)),
  );
}

export async function fetchVendorOverpayment(params: {
  vendorId: Types.ObjectId | string;
  currency: string;
}): Promise<number> {
  return settlementDrift({
    ...params,
    orderFilter: buildSettledOrderFilter(params.vendorId),
    isSettled: isSettledSubOrder,
    // The moment the amount was fixed, not the moment it was sent. A refund
    // arriving while the payout sat scheduled changed neither figure: the
    // payout was already computed, and reading `payoutDate` made the clawback
    // treat it as having landed before the settlement. Older rows carry only
    // `payoutDate`, which for them is the closest thing to the truth there is.
    settledAt: (sub) => sub.payoutClaimedAt ?? sub.payoutDate,
    read: (totals) => totals.netAmount,
  });
}

/**
 * Commission a vendor has already PAID on sales that were refunded afterwards.
 *
 * The platform collects its cut, the shopper returns the goods, and the sale it
 * was charged on stops existing — but the invoice was settled and the sale
 * dropped out of the owed query the moment it was stamped, so nothing was ever
 * giving it back. The ledger knew: `commission_receivable` goes NEGATIVE for
 * exactly this amount, which is the platform recording that it owes the vendor.
 * This is the figure that turns that entry into something collectable.
 *
 * Netted against what the vendor owes rather than paid out on its own. A credit
 * that has to be sent as money needs a payment rail and a decision; one that
 * reduces the next invoice needs neither, and it is what a vendor would expect
 * to see.
 */
export async function fetchVendorCommissionCredit(params: {
  vendorId: Types.ObjectId | string;
  currency: string;
}): Promise<number> {
  return settlementDrift({
    ...params,
    orderFilter: buildCommissionSettledOrderFilter(params.vendorId),
    isSettled: isCommissionSettledSubOrder,
    settledAt: (sub) => sub.commissionSettledAt,
    read: (totals) => totals.commissionAmount,
  });
}

interface VendorPayableTotals {
  currency: string;
  grossSales: number;
  commissionAmount: number;
  netAmount: number;
  /** Ids of the orders that contributed at least one payable sub-order. */
  orderIds: string[];
}

/** An empty bucket, so a caller with nothing owed still has a shape to read. */
function emptyPayableTotals(currency: string): VendorPayableTotals {
  return {
    currency: currency.toUpperCase(),
    grossSales: 0,
    commissionAmount: 0,
    netAmount: 0,
    orderIds: [],
  };
}

/** The one currency a caller is reporting in, or an empty bucket for it. */
export function payableInCurrency(
  totals: ReadonlyArray<VendorPayableTotals>,
  currency: string,
): VendorPayableTotals {
  const wanted = currency.toUpperCase();
  return (
    totals.find((row) => row.currency === wanted) ?? emptyPayableTotals(wanted)
  );
}

/**
 * Sum a vendor's payable amounts across orders, GROUPED BY CURRENCY.
 *
 * `isPayable` selects which of the vendor's sub-orders count — payout creation
 * passes the ones it just claimed, the Payouts tab passes everything still
 * unpaid — so the two differ only in selection, never in arithmetic.
 *
 * Grouped rather than summed because a payout moves money in ONE currency, and
 * a figure that added a UGX sale to a USD one was denominated in nothing while
 * looking perfectly ordinary on screen. Callers pick the currency they are
 * reporting or paying in with `payableInCurrency`, and are expected to say
 * something about the buckets they did not pick rather than let them vanish.
 */
export function sumVendorPayable<
  TOrder extends PayableOrderLike & {
    _id?: unknown;
    subOrders?: PayableSubOrderLike[] | null;
  },
>(
  orders: ReadonlyArray<TOrder>,
  vendorId: Types.ObjectId | string,
  refundByOrderId: ReadonlyMap<string, OrderRefundBreakdown>,
  isPayable: (sub: PayableSubOrderLike) => boolean,
  /** What an order with no currency of its own is counted as. */
  fallbackCurrency = "USD",
  options: {
    /**
     * Add the delivery a vendor collected at the door to what they owe.
     *
     * Passed only by the commission-owed path, never by a payout: on a
     * platform-settled order the delivery money already arrived here, and
     * billing a vendor for it would charge them twice. Off unless the store
     * turns it on — see `billVendorCodShipping` in lib/return-policy.ts and
     * finding F5 in the audit.
     */
    billVendorCodShipping?: boolean;
  } = {},
): VendorPayableTotals[] {
  const vendorKey = String(vendorId);
  const byCurrency = new Map<string, VendorPayableTotals>();

  for (const order of orders) {
    const orderId = String(order._id);
    const refunds = refundByOrderId.get(orderId) ?? emptyRefundBreakdown();
    // Only the refunds that recorded nothing are prorated. The rest come off
    // the consignment they actually name, below.
    const payableRatio = payableRatioFor(order, refunds.unallocated);
    // Every consignment's rated delivery, so a free-shipping coupon can be
    // apportioned across them the way `decomposeOrder` apportions it.
    const ratedShipping = (order.subOrders || []).reduce(
      (sum, sub) => sum + Math.max(0, Number(sub?.shippingCost || 0)),
      0,
    );
    const currency = String(order.currency || fallbackCurrency)
      .trim()
      .toUpperCase();
    let contributed = false;

    for (const sub of order.subOrders || []) {
      if (String(sub.vendorId) !== vendorKey || !isPayable(sub)) continue;

      if (!byCurrency.has(currency)) {
        byCurrency.set(currency, emptyPayableTotals(currency));
      }
      const totals = byCurrency.get(currency)!;

      const subtotal = Number(sub.subtotal || 0);
      const commission = Number(sub.commission || 0);
      const earnings = Number(sub.vendorEarnings || 0);

      // This consignment's goods that came back, from the refunds that named
      // it. Already in charged money — the return estimate takes the order
      // discount off before recording it — so it is subtracted AFTER the ratio
      // has applied that discount, never before.
      const merchandiseBack = Math.max(
        0,
        refunds.merchandiseByVendor.get(vendorKey) || 0,
      );
      // The same split the sale posted and the ledger reverses
      // (`refundPostings`), so the three cannot drift apart — including the
      // slice the platform held back as a refund administration fee, which is
      // read off the allocation rather than recomputed here.
      const commissionRatio = subtotal > 0 ? commission / subtotal : 0;
      const retained = Math.min(
        Math.max(0, refunds.commissionRetainedByVendor.get(vendorKey) || 0),
        merchandiseBack * commissionRatio,
      );
      const commissionBack = roundMoney(
        merchandiseBack * commissionRatio - retained,
      );
      // The fee stays with the platform, so the vendor's side absorbs it.
      const earningsBack = roundMoney(merchandiseBack - commissionBack);

      // Delivery the vendor physically took at the door, which the platform
      // charged for and has never billed back. `sub.shippingCost` is what the
      // consignment was RATED at, while a free-shipping coupon means the
      // shopper handed over less — so the coupon comes off before it is
      // billed, and anything already refunded to the shopper comes off after.
      let shippingOwed = 0;
      if (options.billVendorCodShipping && isVendorCollectedCod(order, sub)) {
        const rated = Math.max(0, Number(sub.shippingCost || 0));
        const charged = Math.max(0, rated - shippingDiscountFor(order, rated, ratedShipping));
        const shippingBack = Math.max(
          0,
          refunds.shippingByVendor.get(vendorKey) || 0,
        );
        shippingOwed = Math.max(
          0,
          roundMoney(charged * payableRatio - shippingBack),
        );
      }

      // Accumulated RAW, negatives included, and floored once per bucket at
      // the end. A consignment can legitimately come out negative — a refund
      // administration fee makes the vendor's side absorb slightly more than
      // their share was worth — and flooring each one on its own would leave
      // the platform showing a vendor as owed money it had already recovered
      // in the ledger. Netting within the vendor's own balance is what keeps
      // the two engines saying the same thing.
      totals.grossSales += roundMoney(subtotal * payableRatio - merchandiseBack);
      totals.commissionAmount +=
        roundMoney(commission * payableRatio - commissionBack) + shippingOwed;
      totals.netAmount += roundMoney(earnings * payableRatio - earningsBack);
      contributed = true;
    }

    if (contributed) byCurrency.get(currency)!.orderIds.push(orderId);
  }

  // Floored here, not above. A vendor whose whole balance is negative is one
  // the platform has overpaid, and that is `fetchVendorOverpayment`'s question
  // — this one only ever answers "how much is owed", which cannot be less
  // than nothing.
  return [...byCurrency.values()]
    .map((totals) => ({
      ...totals,
      grossSales: Math.max(0, roundMoney(totals.grossSales)),
      commissionAmount: Math.max(0, roundMoney(totals.commissionAmount)),
      netAmount: Math.max(0, roundMoney(totals.netAmount)),
    }))
    .sort((a, b) => b.netAmount - a.netAmount);
}
