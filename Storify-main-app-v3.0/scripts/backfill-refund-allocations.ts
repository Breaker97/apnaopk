import { connectDB } from "@/lib/db";
import { Order } from "@/models/order.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import {
  accumulateRefundBacks,
  decomposeOrder,
  refundBacks,
  type PostingOrder,
  type RefundAllocationInput,
} from "@/lib/finance/postings";

/**
 * Refund allocation backfill
 * ==========================
 *
 * Every refund now records what it reversed, per consignment. Rows written
 * before that recorded nothing, and both money engines read their silence the
 * same way: prorate this one over the whole order.
 *
 * For an order where EVERY refund prorates that is still exactly right, and
 * those rows are left alone — prorating over the remainder and prorating over
 * the whole agree when nothing exact came first. The rows this repairs are the
 * mixed ones: an exact refund raised from a return, followed by an order-level
 * refund that recorded nothing. There the second refund was divided by the
 * ORIGINAL total and reversed a slice of goods the first had already handed
 * back — on the reported order, 23.73 taken from a vendor whose share was
 * already fully clawed, and 2.64 of tax reversed against a liability that was
 * already clear.
 *
 * The split is reconstructed by replaying each order's refunds in `_id` order
 * through the same rule the live path uses, so a repaired row carries exactly
 * what it would carry had it been written today.
 *
 * This writes ONLY `refundAllocation`, and only where it is missing. It does
 * not move money, touch the ledger, or change an amount. Run the ledger
 * rebuild afterwards to re-post the entries these rows produced:
 *
 *   tsx --env-file=.env scripts/backfill-ledger.mjs
 *
 * Deployment ordering: run AFTER deploying the code that resolves allocations
 * at write time, so no new mixed rows are being created behind it.
 *
 * Usage:
 *   tsx --env-file=.env scripts/backfill-refund-allocations.ts --dry-run
 *   tsx --env-file=.env scripts/backfill-refund-allocations.ts
 */

const DRY_RUN = process.argv.includes("--dry-run");

const ORDER_PROJECTION =
  "orderNumber currency total tax shippingCost discount coupon.type customs.dutyAmount paidAt createdAt paymentMethod paymentStatus preorderOutstandingAmount channel stripePaymentIntentId subOrders.vendorId subOrders.subtotal subOrders.commission subOrders.vendorEarnings subOrders.shippingCost subOrders.codCollectedBy subOrders.paymentStatus subOrders.fulfillment.method";

type RefundRow = {
  _id: unknown;
  orderId: unknown;
  grossAmount?: number;
  refundAllocation?: RefundAllocationInput[] | null;
};

const hasAllocation = (row: RefundRow) =>
  Array.isArray(row.refundAllocation) && row.refundAllocation.length > 0;

async function run() {
  await connectDB();

  const orderIds = await PaymentTransaction.distinct("orderId", {
    type: "refund",
    status: "succeeded",
  });
  console.log(`${orderIds.length} order(s) carry a succeeded refund`);

  let inspected = 0;
  let repaired = 0;
  let skippedProrated = 0;
  let skippedUndecomposable = 0;

  for (const orderId of orderIds) {
    const refunds = await PaymentTransaction.find({
      orderId,
      type: "refund",
      status: "succeeded",
    })
      .sort({ _id: 1 })
      .select("orderId grossAmount refundAllocation")
      .lean<RefundRow[]>();
    if (refunds.length === 0) continue;
    inspected += 1;

    // An order where nothing recorded an exact split is already consistent:
    // every refund on it prorated, and they add up. Repairing those would
    // rewrite history that was never wrong.
    if (!refunds.some(hasAllocation)) {
      skippedProrated += 1;
      continue;
    }
    // Nothing missing, nothing to do.
    if (refunds.every(hasAllocation)) continue;

    const order = await Order.findById(orderId)
      .select(ORDER_PROJECTION)
      .lean<PostingOrder | null>();
    const decomposition = order ? decomposeOrder(order) : null;
    const subOrders = (order?.subOrders || []).filter(Boolean);
    if (!order || !decomposition || subOrders.length === 0) {
      skippedUndecomposable += 1;
      continue;
    }

    // Replay in the order they were written, exactly as the live path folds
    // them, so each gap is filled with what it would have recorded at the time.
    let alreadyReversed = accumulateRefundBacks({
      decomposition,
      subOrders,
      refunds: [],
    });

    for (const refund of refunds) {
      const amount = Number(refund.grossAmount || 0);
      const allocation = hasAllocation(refund)
        ? (refund.refundAllocation as RefundAllocationInput[])
        : null;
      const backs = refundBacks({
        decomposition,
        subOrders,
        amount,
        allocation,
        alreadyReversed,
      });

      if (!allocation) {
        const shares = subOrders
          .map((sub, index) => ({
            vendorId: sub.vendorId ?? null,
            merchandise: backs[index * 4] ?? 0,
            shipping: backs[index * 4 + 1] ?? 0,
            tax: backs[index * 4 + 2] ?? 0,
            duty: backs[index * 4 + 3] ?? 0,
          }))
          .filter(
            (share) =>
              share.merchandise > 0 ||
              share.shipping > 0 ||
              share.tax > 0 ||
              share.duty > 0,
          );

        if (shares.length > 0) {
          console.log(
            `  ${order.orderNumber} refund ${amount} -> ${JSON.stringify(
              shares.map((s) => ({
                m: s.merchandise,
                s: s.shipping,
                t: s.tax,
              })),
            )}`,
          );
          if (!DRY_RUN) {
            await PaymentTransaction.updateOne(
              { _id: refund._id },
              { $set: { refundAllocation: shares } },
            );
          }
          repaired += 1;
        }
      }

      alreadyReversed = alreadyReversed.map(
        (value, index) => value + (backs[index] ?? 0),
      );
    }
  }

  console.log("");
  console.log(`orders inspected            : ${inspected}`);
  console.log(`refund rows repaired        : ${repaired}`);
  console.log(`orders left alone (prorated): ${skippedProrated}`);
  console.log(`orders skipped (no decomp)  : ${skippedUndecomposable}`);
  if (DRY_RUN) {
    console.log("");
    console.log("DRY RUN — nothing was written. Re-run without --dry-run to apply,");
    console.log("then rebuild the ledger so the entries follow the repaired rows.");
  }
  process.exit(0);
}

run().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
