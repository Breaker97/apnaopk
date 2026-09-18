import "server-only";

import { Types } from "mongoose";
import { Order } from "@/models/order.model";
import { Payout } from "@/models/payout.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { PlatformPayment } from "@/models/platformPayment.model";
import { Shipment } from "@/models/shipment.model";
import { VendorSubscriptionPayment } from "@/models/vendorSubscriptionPayment.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import {
  postBalanceWriteOff,
  postOrderPaid,
  postPayoutPaid,
  postPayoutReversed,
  postPlatformPayment,
  postRefund,
  postRefundReversal,
  postShipmentLabel,
  postShippingToStore,
  postStoreFundedCancellation,
  postSubscriptionInvoice,
} from "@/lib/finance/post-events";

/**
 * Re-post every recent money event, so a ledger write that failed heals itself.
 *
 * Every live path posts to the ledger fire-and-forget — a checkout, a webhook
 * or a cron tick must not fail because the ledger could not be written — and
 * the price of that is a gap nobody sees: a paid order whose sale never
 * posted, a refund with no reversal, a payout with no cash leaving. The only
 * repair was running the backfill script by hand.
 *
 * Every posting carries a unique key, so posting an event twice writes nothing
 * the second time. That is what makes this safe to run daily over everything
 * recent: on a healthy install it writes zero entries, and whatever it does
 * write is exactly what was missing. The window overlaps the previous run's so
 * a write that failed just before the last one is still inside it.
 *
 * Recent is not enough on its own. A gap older than the window stayed a gap
 * for good — the only repair was an admin knowing to run the backfill script —
 * so each run also sweeps ONE older slice of history, a different one each
 * day, and over a month of runs the whole of the last few years has been
 * checked without any single run doing more than a day's worth of work.
 */

const PAGE_LIMIT = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back one deep-sweep slice reaches, and how many make up the cycle. */
const SWEEP_SLICE_DAYS = 30;
const SWEEP_SLICES = 30;

/**
 * The older slice of history this run checks.
 *
 * Derived from the date rather than from a stored cursor: a cursor is a second
 * piece of state to lose, and a cron that missed a day would skip that slice
 * forever. The cycle repeats every 30 runs, so a slice missed today is checked
 * next month.
 */
export function deepSweepWindow(now: Date = new Date()): {
  since: Date;
  until: Date;
} {
  const slice = Math.floor(now.getTime() / DAY_MS) % SWEEP_SLICES;
  const until = new Date(now.getTime() - slice * SWEEP_SLICE_DAYS * DAY_MS);
  return {
    since: new Date(until.getTime() - SWEEP_SLICE_DAYS * DAY_MS),
    until,
  };
}

export interface LedgerReconcileResult {
  /** Entries written — zero means the ledger already had everything. */
  written: number;
  /** True when the time budget ran out before every scan had run. */
  stoppedEarly: boolean;
  scanned: {
    orders: number;
    writeOffs: number;
    cancellations: number;
    refunds: number;
    reversedRefunds: number;
    payouts: number;
    reversedPayouts: number;
    platformPayments: number;
    subscriptions: number;
    labels: number;
  };
}

export async function reconcileRecentLedger(params: {
  since: Date;
  /** The far end of the window; now, unless an older slice is being swept. */
  until?: Date;
  limit?: number;
  /**
   * Stop starting new scans after this long. The pass runs inside a request,
   * and a scan that never returns heals nothing at all — where it stops, the
   * next run picks up, because it decides what to post by reading the ledger
   * rather than by remembering where it got to.
   */
  budgetMs?: number;
}): Promise<LedgerReconcileResult> {
  const limit = params.limit ?? PAGE_LIMIT;
  const since = params.since;
  const until = params.until ?? null;
  const startedAt = Date.now();
  const outOfTime = () =>
    params.budgetMs !== undefined && Date.now() - startedAt >= params.budgetMs;
  let stoppedEarly = false;
  /** The window this pass covers, on whichever date field a collection uses. */
  const within = (field: string) => ({
    [field]: until ? { $gte: since, $lt: until } : { $gte: since },
  });
  let written = 0;
  const scanned: LedgerReconcileResult["scanned"] = {
    orders: 0,
    writeOffs: 0,
    cancellations: 0,
    refunds: 0,
    reversedRefunds: 0,
    payouts: 0,
    reversedPayouts: 0,
    platformPayments: 0,
    subscriptions: 0,
    labels: 0,
  };

  /**
   * Re-post each document a scan found, checking the budget before every one.
   * Checked only between scans, a slow database let one scan run the request
   * far past its budget — forty orders took over forty seconds — and every
   * scan after it, and the older-history sweep, never ran at all.
   */
  const each = async <T,>(rows: T[], post: (row: T) => Promise<number>) => {
    for (const row of rows) {
      if (outOfTime()) {
        stoppedEarly = true;
        return;
      }
      written += await post(row).catch(logAndCountNothing);
    }
  };

  const scans: Array<[keyof LedgerReconcileResult["scanned"], () => Promise<void>]> = [
    ["orders", async () => {
      const rows = await Order.find({
        paymentStatus: {
          $in: ["paid", "partially_paid", "partially_refunded", "refunded"],
        },
        ...within("updatedAt"),
      })
        .select("_id")
        .limit(limit)
        .lean<Array<{ _id: unknown }>>();
      scanned.orders = rows.length;
      await each(rows, (order) => postOrderPaid(order._id));
    }],
    // A called-off deposit pre-order's unpaid balance — see
    // `balanceWriteOffPostings`.
    ["writeOffs", async () => {
      const rows = await Order.find({
        preorderOutstandingAmount: { $gt: 0 },
        ...within("updatedAt"),
        $or: [{ status: "cancelled" }, { "subOrders.status": "cancelled" }],
      })
        .select("_id")
        .limit(limit)
        .lean<Array<{ _id: unknown }>>();
      scanned.writeOffs = rows.length;
      await each(rows, (order) => postBalanceWriteOff(order._id));
    }],
    ["refunds", async () => {
      const rows = await PaymentTransaction.find({
        type: "refund",
        status: "succeeded",
        ...within("createdAt"),
      })
        .sort({ _id: 1 })
        .select("_id orderId grossAmount createdAt")
        .limit(limit)
        .lean<Array<{ _id: unknown; orderId: unknown; grossAmount?: number; createdAt?: Date }>>();
      scanned.refunds = rows.length;
      await each(rows, (refund) =>
        postRefund({
          orderId: refund.orderId,
          amount: Number(refund.grossAmount || 0),
          refundId: refund._id,
          date: refund.createdAt,
        }),
      );
    }],
    // A refund the gateway later failed is reversed with entries of its own.
    ["reversedRefunds", async () => {
      const rows = await PaymentTransaction.find({
        type: "refund",
        status: "failed",
        ...within("updatedAt"),
      })
        .sort({ _id: 1 })
        .select("_id orderId grossAmount")
        .limit(limit)
        .lean<Array<{ _id: unknown; orderId: unknown; grossAmount?: number }>>();
      scanned.reversedRefunds = rows.length;
      await each(rows, async (refund) => {
        // Only a refund the books actually carry has anything to reverse; a
        // row that never posted would otherwise be "reversed" out of nothing.
        const posted = await LedgerEntry.exists({
          "source.kind": "refund",
          "source.id": new Types.ObjectId(String(refund._id)),
        });
        if (!posted) return 0;
        return postRefundReversal({
          orderId: refund.orderId,
          amount: Number(refund.grossAmount || 0),
          refundId: refund._id,
        });
      });
    }],
    ["payouts", async () => {
      const rows = await Payout.find({ status: "paid", ...within("paidAt") })
        .select(
          "_id payoutNumber vendorId netAmount commissionOffset commissionCredit paidFrom currency paidAt",
        )
        .limit(limit)
        .lean<Array<Parameters<typeof postPayoutPaid>[0]>>();
      scanned.payouts = rows.length;
      await each(rows, (payout) => postPayoutPaid(payout));
    }],
    ["platformPayments", async () => {
      const rows = await PlatformPayment.find({
        status: "paid",
        ...within("paidAt"),
      })
        .select("_id kind reference vendorId amount currency paidAt")
        .limit(limit)
        .lean<Array<Parameters<typeof postPlatformPayment>[0]>>();
      scanned.platformPayments = rows.length;
      await each(rows, (payment) => postPlatformPayment(payment));
    }],
    // A cancelled sale the store's own coupon paid for in full: no refund will
    // ever unwind it, because the shopper handed over nothing to give back.
    ["cancellations", async () => {
      const rows = await Order.find({
        "coupon.fundedBy": "platform",
        discount: { $gt: 0 },
        ...within("updatedAt"),
        $or: [{ status: "cancelled" }, { "subOrders.status": "cancelled" }],
      })
        .select("_id")
        .limit(limit)
        .lean<Array<{ _id: unknown }>>();
      scanned.cancellations = rows.length;
      await each(rows, (order) => postStoreFundedCancellation(order._id));
    }],
    // A payout the bank sent back.
    ["reversedPayouts", async () => {
      const rows = await Payout.find({ status: "failed", ...within("reversedAt") })
        .select(
          "_id payoutNumber vendorId netAmount commissionOffset commissionCredit paidFrom currency reversedAt",
        )
        .limit(limit)
        .lean<Array<Parameters<typeof postPayoutReversed>[0]>>();
      scanned.reversedPayouts = rows.length;
      await each(rows, (payout) => postPayoutReversed(payout));
    }],
    // Plan income billed by the provider's own engine never becomes a platform
    // payment, so a store on provider billing had none of it healed here.
    ["subscriptions", async () => {
      const rows = await VendorSubscriptionPayment.find({
        status: { $in: ["paid", "refunded"] },
        amountPaid: { $gt: 0 },
        ...within("paidAt"),
      })
        .select(
          "_id vendorId providerInvoiceId status amountPaid amountRefunded currency paidAt providerCreatedAt",
        )
        .limit(limit)
        .lean<Array<Parameters<typeof postSubscriptionInvoice>[0]>>();
      scanned.subscriptions = rows.length;
      await each(rows, (invoice) => postSubscriptionInvoice(invoice));
    }],
    // What a carrier label cost, and the delivery charge a store label moved.
    ["labels", async () => {
      const rows = await Shipment.find({
        "rate.amount": { $gt: 0 },
        "purchase.state": { $in: ["purchased", "voided"] },
        ...within("updatedAt"),
      })
        .select(
          "_id vendorId orderId subOrderId rate bookingSequence purchase.purchasedAt purchase.billedTo purchase.shippingToStore createdAt",
        )
        .limit(limit)
        .lean<
          Array<{
            _id: unknown;
            vendorId?: unknown;
            orderId?: unknown;
            subOrderId?: unknown;
            rate?: { amount?: number; currency?: string } | null;
            bookingSequence?: number | null;
            createdAt?: Date;
            purchase?: {
              purchasedAt?: Date | null;
              billedTo?: string | null;
              shippingToStore?: boolean | null;
            } | null;
          }>
        >();
      scanned.labels = rows.length;
      await each(rows, async (shipment) => {
        let count = await postShipmentLabel({
          _id: shipment._id,
          vendorId: shipment.vendorId,
          orderId: shipment.orderId,
          rate: shipment.rate as never,
          purchasedAt: shipment.purchase?.purchasedAt || shipment.createdAt,
          bookingSequence: shipment.bookingSequence,
          billedTo: shipment.purchase?.billedTo,
        });
        if (shipment.purchase?.shippingToStore && shipment.subOrderId) {
          count += await postShippingToStore({
            orderId: shipment.orderId,
            subOrderId: shipment.subOrderId,
            shipmentId: shipment._id,
            bookingSequence: shipment.bookingSequence,
            date: shipment.purchase?.purchasedAt || shipment.createdAt,
          });
        }
        return count;
      });
    }],
  ];

  // Under a budget, a different scan goes first each day, so a busy store
  // whose first few scans eat the budget still gets every kind of event healed
  // within a cycle rather than the last few never. Unbudgeted, they run in the
  // order written.
  const rotation =
    params.budgetMs === undefined
      ? 0
      : Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % scans.length;
  const ordered = [...scans.slice(rotation), ...scans.slice(0, rotation)];
  for (const [, scan] of ordered) {
    if (outOfTime()) {
      stoppedEarly = true;
      break;
    }
    await scan();
  }

  if (written > 0) {
    console.warn(
      `Ledger reconcile wrote ${written} missing entr(ies) for events since ${since.toISOString()}`,
    );
  }

  return { written, stoppedEarly, scanned };
}

function logAndCountNothing(error: unknown): number {
  console.error("Ledger reconcile: an event could not be re-posted", error);
  return 0;
}
