import { withStrictLedger } from "./ledger";
import "server-only";

import { randomUUID } from "node:crypto";
import { FinanceRecoveryCheckpoint, FinanceRecoveryFailure } from "@/models/finance-recovery.model";
import type { Query } from "mongoose";
import { Types } from "mongoose";
import { Order } from "@/models/order.model";
import { Payout } from "@/models/payout.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { PlatformPayment } from "@/models/platformPayment.model";
import { Shipment } from "@/models/shipment.model";
import { Expense } from "@/models/expense.model";
import {
  healExpenseLedger,
  type ExpenseLedgerRow,
} from "@/lib/finance/expense-ledger";
import { ReturnRequest } from "@/models/return-request.model";
import { heldRestockReplays } from "@/lib/returns/held-units";
import { returnRestockEventKey } from "@/lib/returns/returns";
import { VendorSubscriptionPayment } from "@/models/vendorSubscriptionPayment.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import {
  postBalanceWriteOff,
  postOrderPaid,
  postPayoutPaid,
  postPayoutReversed,
  postPlatformPayment,
  postRefund,
  postRestockedCost,
  postRefundReversal,
  postExpense,
  postStoreCreditEvent,
  postShipmentLabel,
  postShipmentLabelVoid,
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
  const until = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS - slice * SWEEP_SLICE_DAYS * DAY_MS);
  return {
    since: new Date(until.getTime() - SWEEP_SLICE_DAYS * DAY_MS),
    until,
  };
}

interface LedgerReconcileResult {
  /** Entries written — zero means the ledger already had everything. */
  written: number;
  /** True when the time budget ran out before every scan had run. */
  stoppedEarly: boolean;
  continued: string[];
  failures: number;
  complete: boolean;
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
    labelVoids: number;
    expenses: number;
    returnRestocks: number;
    heldRestocks: number;
    cancelRestocks: number;
    storeCredit: number;
  };
}

export async function reconcileRecentLedger(params: {
  since: Date;
  group?: string;
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
  let since = params.since;
  let until = params.until ?? new Date();
  const group = params.group ?? (params.until ? "history" : "recent");
  const owner = randomUUID();
  const continued: string[] = [];
  let failures = 0;
  let currentSource = "";
  let currentCheckpoint: { _id: unknown; cursor?: unknown; key: string } | null = null;
  const recoveryQuery = <R, D>(query: Query<R, D>) => {
    if (currentCheckpoint?.cursor) query.find({ _id: { $gt: currentCheckpoint.cursor } });
    return query.sort({ _id: 1 });
  };
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
    labelVoids: 0,
    expenses: 0,
    returnRestocks: 0,
    heldRestocks: 0,
    cancelRestocks: 0,
    storeCredit: 0,
  };

  /**
   * Re-post each document a scan found, checking the budget before every one.
   * Checked only between scans, a slow database let one scan run the request
   * far past its budget — forty orders took over forty seconds — and every
   * scan after it, and the older-history sweep, never ran at all.
   */
  const each = async <T extends { _id?: unknown }>(rows: T[], post: (row: T) => Promise<number>) => {
    const retryRows = await FinanceRecoveryFailure.find({ source: currentSource, nextAttemptAt: { $lte: new Date() } }).sort({ nextAttemptAt: 1, _id: 1 }).limit(Math.min(limit, 20)).lean();
    const attempt = async (row: T, retry = false) => {
      const key = `${currentSource}:${String(row._id)}`;
      try {
        written += await withStrictLedger(() => post(row));
        await FinanceRecoveryFailure.deleteOne({ key });
      } catch (error) {
        failures++;
        await FinanceRecoveryFailure.updateOne({ key }, { $set: { source: currentSource, sourceId: String(row._id), payload: row, error: String(error).slice(0, 2000), nextAttemptAt: new Date(Date.now() + 60_000) }, $inc: { attempts: 1 } }, { upsert: true });
      }
      if (!retry) await FinanceRecoveryCheckpoint.updateOne({ _id: currentCheckpoint!._id, leaseOwner: owner }, { $set: { cursor: row._id }, $inc: { processed: 1 } });
    };
    for (const failed of retryRows) { if (outOfTime()) break; await attempt(failed.payload as T, true); }
    let processed = 0;
    for (const row of rows) {
      if (outOfTime()) { stoppedEarly = true; break; }
      await attempt(row); processed++;
    }
    const complete = processed === rows.length && rows.length < limit;
    if (!complete) continued.push(currentSource);
    await FinanceRecoveryCheckpoint.updateOne({ _id: currentCheckpoint!._id, leaseOwner: owner }, { $set: { complete, lastRunAt: new Date() }, $unset: { leaseOwner: "", leaseUntil: "" } });
  };

  const scans: Array<[keyof LedgerReconcileResult["scanned"], () => Promise<void>]> = [
    ["orders", async () => {
      const rows = await recoveryQuery(Order.find({
        paymentStatus: {
          $in: ["paid", "partially_paid", "partially_refunded", "refunded"],
        },
        ...within("updatedAt"),
      }))
        .select("_id")
        .limit(limit)
        .lean<Array<{ _id: unknown }>>();
      scanned.orders = rows.length;
      await each(rows, (order) => postOrderPaid(order._id));
    }],
    // A called-off deposit pre-order's unpaid balance — see
    // `balanceWriteOffPostings`.
    ["writeOffs", async () => {
      const rows = await recoveryQuery(Order.find({
        preorderOutstandingAmount: { $gt: 0 },
        ...within("updatedAt"),
        $or: [{ status: "cancelled" }, { "subOrders.status": "cancelled" }],
      }))
        .select("_id")
        .limit(limit)
        .lean<Array<{ _id: unknown }>>();
      scanned.writeOffs = rows.length;
      await each(rows, (order) => postBalanceWriteOff(order._id));
    }],
    ["refunds", async () => {
      const rows = await recoveryQuery(PaymentTransaction.find({
        type: "refund",
        status: "succeeded",
        ...within("createdAt"),
      })
        .sort({ _id: 1 }))
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
      const rows = await recoveryQuery(PaymentTransaction.find({
        type: "refund",
        status: "failed",
        ...within("updatedAt"),
      })
        .sort({ _id: 1 }))
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
      const rows = await recoveryQuery(Payout.find({ status: "paid", ...within("paidAt") }))
        .select(
          "_id payoutNumber vendorId netAmount commissionOffset commissionCredit paidFrom currency paidAt",
        )
        .limit(limit)
        .lean<Array<Parameters<typeof postPayoutPaid>[0]>>();
      scanned.payouts = rows.length;
      await each(rows, (payout) => postPayoutPaid(payout));
    }],
    ["platformPayments", async () => {
      const rows = await recoveryQuery(PlatformPayment.find({
        status: { $in: ["paid", "refunded"] },
        ...within("updatedAt"),
      }))
        // `provider` decides the cash account — without it every healed
        // payment would re-post into the gateway, including the ones an admin
        // collected by hand.
        .select("_id kind reference vendorId amount currency paidAt provider")
        .limit(limit)
        .lean<Array<Parameters<typeof postPlatformPayment>[0]>>();
      scanned.platformPayments = rows.length;
      await each(rows, (payment) => postPlatformPayment(payment));
    }],
    // A cancelled sale the store's own coupon paid for in full: no refund will
    // ever unwind it, because the shopper handed over nothing to give back.
    ["cancellations", async () => {
      const rows = await recoveryQuery(Order.find({
        "coupon.fundedBy": "platform",
        discount: { $gt: 0 },
        ...within("updatedAt"),
        $or: [{ status: "cancelled" }, { "subOrders.status": "cancelled" }],
      }))
        .select("_id")
        .limit(limit)
        .lean<Array<{ _id: unknown }>>();
      scanned.cancellations = rows.length;
      await each(rows, (order) => postStoreFundedCancellation(order._id));
    }],
    // A payout the bank sent back.
    ["reversedPayouts", async () => {
      const rows = await recoveryQuery(Payout.find({ status: "failed", ...within("reversedAt") }))
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
      const rows = await recoveryQuery(VendorSubscriptionPayment.find({
        status: { $in: ["paid", "refunded"] },
        amountPaid: { $gt: 0 },
        ...within("updatedAt"),
      }))
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
      const rows = await recoveryQuery(Shipment.find({
        "rate.amount": { $gt: 0 },
        "purchase.state": { $in: ["purchased", "voided"] },
        ...within("updatedAt"),
      }))
        .select(
          // `providerMode` is what tells a free test label from a real one;
          // without it every test label a merchant tried was booked as a cost.
          "_id vendorId orderId subOrderId rate bookingSequence providerMode purchase.purchasedAt purchase.billedTo purchase.shippingToStore createdAt",
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
            providerMode?: string | null;
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
          providerMode: shipment.providerMode,
        });
        // `shippingToStore` records only THAT the charge moved, never which
        // way — so the direction is re-derived from the order inside
        // `postShippingToStore`, where both live paths read it from too. A
        // scan that decided it here would be a third copy of the rule, and
        // the one it got wrong posted a second entry under a key the unique
        // index had never seen.
        // A test label never moves a delivery charge — the purchase path skips
        // it for the same reason it books no cost.
        if (
          shipment.purchase?.shippingToStore &&
          shipment.subOrderId &&
          shipment.providerMode !== "test"
        ) {
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
    /*
     * And the labels a carrier gave the money back for.
     *
     * The scan above re-posts what a label COST; nothing re-posted the
     * reversal, so a void whose live write failed left the store carrying a
     * cost it had been refunded, for good. It is a separate scan because it
     * is a separate document: `refunds[]` records each void's own booking,
     * rate and direction, which is exactly what the reversal needs and what
     * the shipment's current `purchase` no longer says once it has been
     * re-shipped.
     *
     * Only the settled ones. A refund the carrier is still considering, or
     * refused, is money that has not come back — `postShipmentLabelVoid`
     * refuses to reverse a cost that was never booked, and this refuses to
     * ask about one that was never refunded.
     */
    ["labelVoids", async () => {
      const rows = await recoveryQuery(Shipment.find({
        "refunds.state": "refunded",
        ...within("updatedAt"),
      }))
        .select("_id vendorId orderId subOrderId providerMode refunds")
        .limit(limit)
        .lean<
          Array<{
            _id: unknown;
            vendorId?: unknown;
            orderId?: unknown;
            subOrderId?: unknown;
            providerMode?: string | null;
            refunds?: Array<{
              state?: string;
              settledAt?: Date | null;
              bookingSequence?: number | null;
              rate?: { amount?: number; currency?: string } | null;
              billedTo?: string | null;
              shippingToStore?: boolean | null;
            }> | null;
          }>
        >();
      scanned.labelVoids = rows.length;
      await each(rows, async (shipment) => {
        let count = 0;
        for (const refund of shipment.refunds || []) {
          if (refund?.state !== "refunded") continue;
          count += await postShipmentLabelVoid({
            _id: shipment._id,
            vendorId: shipment.vendorId,
            orderId: shipment.orderId,
            rate: refund.rate as never,
            bookingSequence: refund.bookingSequence,
            billedTo: refund.billedTo,
            voidedAt: refund.settledAt,
            providerMode: shipment.providerMode,
          });
          // The delivery charge the label had moved to the store goes back to
          // the vendor with it. Which way that is, is the order's to say.
          if (refund.shippingToStore && shipment.subOrderId) {
            count += await postShippingToStore({
              orderId: shipment.orderId,
              subOrderId: shipment.subOrderId,
              shipmentId: shipment._id,
              bookingSequence: refund.bookingSequence,
              date: refund.settledAt ?? undefined,
              reversal: true,
            });
          }
        }
        return count;
      });
    }],
    /*
     * Hand-entered expenses.
     *
     * The thinnest of the scans, and worth having for the one case the others
     * cannot cover: the expense route awaits its posting, so a failure is
     * visible — but only to whoever was at the screen, and the row is saved
     * either way. Without this, an expense saved while the database hiccuped
     * stays out of the profit and loss until somebody notices the total is
     * wrong.
     *
     * Only the revision the row currently carries. Earlier revisions were
     * reversed at the moment they were corrected and their values are gone;
     * a deleted expense is gone too, along with any chance of replaying it.
     *
     * Only the platform's own costs. A vendor's expense — rent on THEIR shop —
     * is recorded for their reporting and never posted; replaying it here put
     * a seller's costs into the platform's profit and bank balance.
     */
    // Store credit given as goodwill, or expired unspent (R8) — see
    // `storeCreditPostings`. Refund credit and spends post with their refund
    // and their sale.
    ["storeCredit", async () => {
      const { StoreCreditTransaction } = await import("@/models/store-credit.model");
      const rows = await recoveryQuery(StoreCreditTransaction.find({
        $or: [{ type: "issue", source: "goodwill" }, { type: "expire" }],
        ...within("createdAt"),
      }))
        .select("_id type source amount currency createdAt")
        .limit(limit)
        .lean<Array<Parameters<typeof postStoreCreditEvent>[0]>>();
      scanned.storeCredit = rows.length;
      await each(rows, (row) => postStoreCreditEvent(row));
    }],
    ["expenses", async () => {
      const rows = await recoveryQuery(Expense.find({
        scope: { $ne: "vendor" },
        ...within("updatedAt"),
      }))
        .select(
          "_id date book category amount currency description paidFrom vendorId revision version debitAccount settlement",
        )
        .limit(limit)
        .lean<
          Array<Parameters<typeof postExpense>[0] & ExpenseLedgerRow & { version?: number }>
        >();
      scanned.expenses = rows.length;
      // Versioned sources belong to durable operations. Rebuilding them from
      // mutable rows can race a correction and bypass resolved posting dates.
      await each(rows, (expense) => expense.version === undefined ? postExpense(expense) : Promise.resolve(0));
      // And what the row cannot replay: a payment, and the reversal of a
      // revision that was corrected while the database was failing.
      if (!outOfTime()) written += await healExpenseLedger(rows.filter((expense) => expense.version === undefined));
    }],
    /*
     * Goods back on the shelf, taken back out of cost of goods — see
     * `restockCostPostings`. A return records exactly which units it put back,
     * step by step, so the replay reverses what the live path did, each step
     * under its own key (`returnRestockEventKey`).
     */
    ["returnRestocks", async () => {
      const rows = await recoveryQuery(ReturnRequest.find({
        "restockedLines.0": { $exists: true },
        ...within("updatedAt"),
      }))
        .select("_id orderId restockedLines")
        .limit(limit)
        .lean<
          Array<{
            _id: unknown;
            orderId?: unknown;
            restockedLines?: Array<{
              productId?: unknown;
              variantId?: unknown;
              quantity?: number;
              step?: string;
            }>;
          }>
        >();
      scanned.returnRestocks = rows.length;
      await each(rows, async (request) => {
        const steps = new Map<string, NonNullable<typeof request.restockedLines>>();
        for (const line of request.restockedLines || []) {
          const eventKey = returnRestockEventKey(request._id, line.step);
          if (!steps.has(eventKey)) steps.set(eventKey, []);
          steps.get(eventKey)!.push(line);
        }
        let posted = 0;
        for (const [eventKey, restocked] of steps) {
          posted += await postRestockedCost({
            orderId: request.orderId,
            restocked,
            eventKey,
          });
        }
        return posted;
      });
    }],
    /*
     * And the units a return's count found unsellable that the merchant later
     * put back on sale — one event each, under the key the live path used.
     */
    ["heldRestocks", async () => {
      const rows = await recoveryQuery(ReturnRequest.find({
        "unsellableDispositions.action": "restocked",
        ...within("updatedAt"),
      }))
        .select("_id orderId unsellableDispositions")
        .limit(limit)
        .lean<
          Array<Parameters<typeof heldRestockReplays>[0] & { orderId?: unknown }>
        >();
      scanned.heldRestocks = rows.length;
      await each(rows, async (request) => {
        let written = 0;
        for (const replay of heldRestockReplays(request)) {
          written += await postRestockedCost({ orderId: request.orderId, ...replay });
        }
        return written;
      });
    }],
    /*
     * And the consignments a cancellation put back. A cancelled consignment
     * that no longer holds its stock has had every one of its units restored —
     * the restore claims a consignment whole — so all of them are what came
     * back. The cap on what the books still carry keeps a return that already
     * reversed some of them from being counted twice.
     */
    ["cancelRestocks", async () => {
      const rows = await recoveryQuery(Order.find({
        subOrders: {
          $elemMatch: { status: "cancelled", inventoryReserved: false },
        },
        // Only orders that costed anything have a cost of goods to give back.
        "subOrders.items.cost": { $exists: true },
        ...within("updatedAt"),
      }))
        .select(
          "_id subOrders._id subOrders.status subOrders.inventoryReserved subOrders.items.productId subOrders.items.variantId subOrders.items.quantity",
        )
        .limit(limit)
        .lean<
          Array<{
            _id: unknown;
            subOrders?: Array<{
              _id?: unknown;
              status?: string;
              inventoryReserved?: boolean;
              items?: Array<{
                productId?: unknown;
                variantId?: unknown;
                quantity?: number;
              }>;
            }>;
          }>
        >();
      scanned.cancelRestocks = rows.length;
      await each(rows, (order) =>
        postRestockedCost({
          orderId: order._id,
          restocked: (order.subOrders || [])
            .filter(
              (sub) =>
                sub.status === "cancelled" && sub.inventoryReserved === false,
            )
            .flatMap((sub) =>
              (sub.items || []).map((item) => ({
                subOrderId: sub._id,
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
              })),
            ),
          eventKey: "restock",
        }),
      );
    }],
  ];

  // Least recently served sources go first; unfinished older windows retain their cursor.
  const progress = await FinanceRecoveryCheckpoint.find({ group }).select("source lastRunAt").lean();
  const lastRun = (source: string) => (progress.filter((p) => p.source === source).reduce((latest, p) => Math.max(latest, new Date(p.lastRunAt).getTime()), 0));
  const ordered = [...scans].sort(([a], [b]) => lastRun(a) - lastRun(b));
  for (const [source, scan] of ordered) {
    if (outOfTime()) { stoppedEarly = true; break; }
    const desiredSince = new Date(Math.floor(params.since.getTime() / DAY_MS) * DAY_MS);
    const desiredUntil = params.until ?? new Date(Math.ceil(Date.now() / DAY_MS) * DAY_MS);
    const key = `${group}:${source}:${desiredSince.toISOString()}:${desiredUntil.toISOString()}`;
    await FinanceRecoveryCheckpoint.updateOne({ key }, { $setOnInsert: { group, source, since: desiredSince, until: desiredUntil } }, { upsert: true });
    let candidate = await FinanceRecoveryCheckpoint.findOne({ group, source, complete: false }).sort({ since: 1 }).lean();
    if (!candidate) {
      await FinanceRecoveryCheckpoint.updateOne({ key, complete: true }, { $set: { complete: false, cursor: null, processed: 0 }, $inc: { generation: 1 } });
      candidate = await FinanceRecoveryCheckpoint.findOne({ key }).lean();
    }
    const leased = await FinanceRecoveryCheckpoint.findOneAndUpdate({ _id: candidate!._id, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }] }, { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + 90_000) } }, { returnDocument: "after" }).lean();
    if (!leased) { continued.push(source); continue; }
    currentSource = source; currentCheckpoint = leased; since = leased.since; until = leased.until;
    try { await scan(); } catch (error) {
      failures++; continued.push(source);
      await FinanceRecoveryCheckpoint.updateOne({ _id: leased._id, leaseOwner: owner }, { $set: { lastRunAt: new Date() }, $unset: { leaseOwner: "", leaseUntil: "" } });
      console.error(`Finance recovery scan ${source} failed`, error);
    }
  }

  if (written > 0) {
    console.warn(
      `Ledger reconcile wrote ${written} missing entr(ies) for events since ${since.toISOString()}`,
    );
  }

  return { written, stoppedEarly, scanned, continued, failures, complete: !stoppedEarly && !continued.length && !failures };
}
