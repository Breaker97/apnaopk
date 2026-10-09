import { Types } from "mongoose";
import { Order, PaymentTransaction } from "@/models";
import { Settings } from "@/models/settings.model";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { quantizeToCurrency } from "@/lib/intl/money";
import { getSubOrderPreorderCollectedAmount } from "@/lib/orders/preorder-cancel-refund";
import { loadUnreversedConsignmentTotals } from "@/lib/finance/post-events";

/**
 * Deposit pre-orders whose cancelled consignments were refunded less than
 * their share of the deposit.
 *
 * Until 3.0, on a store that had run `db:migrate suborder-payment`, a seller's
 * consignment of a split deposit pre-order cancelled after the deposit was
 * paid refunded nothing (`isConsignmentCollected` read the stamped
 * `partially_paid` as an unpaid parcel). The order went on, the rest shipped,
 * and the shopper never had that part of the deposit back. Nothing in the
 * data marks those cancellations — the refund claim stamp is written whether
 * or not money followed — so they are found by arithmetic: what the cancelled
 * consignments' shares come to under the rule as it now stands, against what
 * the order has refunded.
 *
 * READ ONLY: a report for the store to act on from the order page (refund the
 * shortfall there), never a refund made here. An order cancelled whole is not
 * listed: its cancellation refunded everything collected, earlier shares
 * included. A refund made for another reason — goodwill, a return — counts
 * towards what the shopper has had back, so the figure is the most that is
 * still owed, not a certainty; the rows list every refund so the admin can
 * judge.
 */

export type DepositRefundShortfall = {
  orderId: string;
  orderNumber?: string;
  currency: string;
  status?: string;
  paymentStatus?: string;
  /** Each cancelled consignment and the share of the deposit it was owed. */
  cancelled: Array<{
    subOrderId: string;
    vendorId?: string;
    paymentStatus: string | null;
    share: number;
  }>;
  /** The shares together, each held to what the books still carry for it. */
  owed: number;
  refundedTotal: number;
  refunds: Array<{ amount: number; createdAt?: Date; reason?: string }>;
  /** `owed` less `refundedTotal`, never below zero. */
  shortfall: number;
};

export type ShortfallOrder = Parameters<typeof getSubOrderPreorderCollectedAmount>[0] & {
  _id: unknown;
  orderNumber?: string;
  status?: string;
  refundedTotal?: number | null;
  preorderOutstandingAmount?: number;
  subOrders?: Array<
    Parameters<typeof getSubOrderPreorderCollectedAmount>[1] & {
      status?: string;
      vendorId?: unknown;
    }
  > | null;
};

/** Half a cent: float residue is not money owed. */
const EPSILON = 0.005;

/**
 * The shortfall on one order, from what it already records — null when
 * nothing is owed (or the order is not a live deposit pre-order with a
 * cancelled consignment).
 *
 * `unreversed`: what the books still hold per consignment
 * (`loadUnreversedConsignmentTotals`); a consignment absent from it has no
 * ceiling known, as the live refund treats it.
 */
export function depositRefundShortfall(
  order: ShortfallOrder,
  options: {
    defaultCurrency?: string;
    unreversed?: ReadonlyMap<string, number>;
    refunds?: DepositRefundShortfall["refunds"];
  } = {},
): DepositRefundShortfall | null {
  if (!(Number(order.preorderOutstandingAmount || 0) > 0)) return null;
  if (String(order.status || "") === ORDER_STATUS.CANCELLED) return null;
  if (String(order.paymentStatus || PAYMENT_STATUS.PENDING) === PAYMENT_STATUS.PENDING) return null;
  const subOrders = (order.subOrders || []).filter(Boolean);
  const cancelledSubs = subOrders.filter((sub) => sub.status === ORDER_STATUS.CANCELLED);
  if (cancelledSubs.length === 0 || cancelledSubs.length === subOrders.length) return null;

  const currency = String(order.currency || options.defaultCurrency || "USD").toUpperCase();
  const priced = { ...order, currency } as ShortfallOrder;
  const cancelled = cancelledSubs.map((sub) => {
    const share = getSubOrderPreorderCollectedAmount(priced, sub);
    const left = options.unreversed?.get(String(sub._id));
    return {
      subOrderId: String(sub._id),
      vendorId: sub.vendorId ? String(sub.vendorId) : undefined,
      paymentStatus: sub.paymentStatus ?? null,
      share: quantizeToCurrency(left === undefined ? share : Math.min(share, left), currency),
    };
  });
  const owed = quantizeToCurrency(
    cancelled.reduce((sum, sub) => sum + sub.share, 0),
    currency,
  );
  const refundedTotal = Math.max(0, Number(order.refundedTotal || 0));
  const shortfall = quantizeToCurrency(Math.max(0, owed - refundedTotal), currency);
  if (shortfall <= EPSILON) return null;

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    currency,
    status: order.status,
    paymentStatus: order.paymentStatus,
    cancelled,
    owed,
    refundedTotal,
    refunds: options.refunds ?? [],
    shortfall,
  };
}

export type DepositRefundShortfallReport = {
  generatedAt: Date;
  /** Live deposit pre-orders with a cancelled consignment, as scanned. */
  scanned: number;
  shortfalls: DepositRefundShortfall[];
};

/** Every live deposit pre-order with a cancelled consignment, newest first. */
export async function findDepositRefundShortfalls(
  options: { scanLimit?: number } = {},
): Promise<DepositRefundShortfallReport> {
  // A plain read: `getSettings()` mints the settings document on an empty
  // database and runs the settings migration, and this report writes nothing.
  const settings = await Settings.findOne({}, { "general.defaultCurrency": 1 }).lean<{
    general?: { defaultCurrency?: string };
  } | null>();
  const defaultCurrency = settings?.general?.defaultCurrency;
  const query = Order.find({
    preorderOutstandingAmount: { $gt: 0 },
    status: { $ne: ORDER_STATUS.CANCELLED },
    paymentStatus: { $ne: PAYMENT_STATUS.PENDING },
    "subOrders.status": ORDER_STATUS.CANCELLED,
  })
    .sort({ createdAt: -1 })
    .lean<ShortfallOrder[]>();
  if (options.scanLimit) query.limit(options.scanLimit);
  const orders = await query;

  const shortfalls: DepositRefundShortfall[] = [];
  for (const order of orders) {
    const orderId = new Types.ObjectId(String(order._id));
    const [unreversed, refundRows] = await Promise.all([
      loadUnreversedConsignmentTotals(orderId),
      PaymentTransaction.find({ orderId, type: "refund", status: "succeeded" })
        .sort({ createdAt: 1 })
        .select("grossAmount createdAt note")
        .lean<Array<{ grossAmount?: number; createdAt?: Date; note?: string }>>(),
    ]);
    const found = depositRefundShortfall(order, {
      defaultCurrency,
      unreversed,
      refunds: refundRows.map((row) => ({
        amount: Number(row.grossAmount || 0),
        createdAt: row.createdAt,
        reason: row.note,
      })),
    });
    if (found) shortfalls.push(found);
  }
  return { generatedAt: new Date(), scanned: orders.length, shortfalls };
}
