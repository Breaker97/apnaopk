import { connectDB, mongoose } from "@/lib/db";
import { Order, PaymentTransaction } from "@/models";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";

/**
 * Charge-row gateway fee backfill
 * ===============================
 *
 * Every gateway records its cut on the order (`paymentFee`,
 * `paymentFeeCurrency`, `paymentFeeRate`) and the ledger posts it from there,
 * but until 2026-09 no payment path handed those fields to the charge
 * transaction — so `PaymentTransaction.feeAmount` stayed 0 and `netAmount`
 * equalled `grossAmount` on the payments dashboard, however much the gateway
 * kept. The finalize pipeline now forwards the fee; this brings the rows that
 * were written before it did into line.
 *
 * Re-syncs each affected charge through `ensureChargeTransaction`, the same
 * choke point the gateways use, so the row gets exactly the fee, net and
 * metadata a fresh capture would. An already-succeeded charge posts nothing
 * new to the ledger and sends no notification — the re-sync only rewrites the
 * amounts, and keeps any refund already netted off the row.
 *
 * Usage:
 *   pnpm db:migrate charge-fees --dry-run   # prints host/db and what would change
 *   pnpm db:migrate charge-fees
 */

const DRY_RUN = process.argv.includes("--dry-run");
const PAGE_SIZE = 200;

type OrderRow = {
  _id: mongoose.Types.ObjectId;
  orderNumber: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  paypalCaptureId?: string;
  razorpayPaymentId?: string;
  paystackTransactionId?: string;
  pesapalConfirmationCode?: string;
  iotecTransactionId?: string;
  orangeMoneyTxnId?: string;
  mtnMomoTransactionId?: string;
  mtnMomoReferenceId?: string;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total?: number;
  preorderOutstandingAmount?: number;
  paymentFee?: number;
  paymentFeeCurrency?: string;
  paymentFeeRate?: number;
  currency?: string;
  channel?: string;
  posLocationId?: mongoose.Types.ObjectId;
  createdAt?: Date;
};

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database connection not available");

  // Money migration: say out loud which database is about to be written, so a
  // misconfigured .env is caught before the write rather than after it.
  console.log(`✓ Connected to MongoDB`);
  console.log(`   host: ${mongoose.connection.host}`);
  console.log(`   db:   ${db.databaseName}`);
  console.log(`\n💳 Charge-row gateway fee backfill${DRY_RUN ? " (DRY RUN)" : ""}...\n`);

  const selector = {
    paymentFee: { $gt: 0 },
    paymentStatus: { $in: ["paid", "partially_paid", "partially_refunded", "refunded"] },
  };

  let scanned = 0;
  let resynced = 0;
  let alreadyCorrect = 0;
  let noChargeRow = 0;
  let lastId: mongoose.Types.ObjectId | null = null;

  for (;;) {
    const page: OrderRow[] = await Order.find({
      ...selector,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    })
      .sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .lean<OrderRow[]>();
    if (page.length === 0) break;

    const charges = await PaymentTransaction.find({
      orderId: { $in: page.map((order) => order._id) },
      type: "charge",
    })
      .select("orderId feeAmount")
      .lean<Array<{ orderId: unknown; feeAmount?: number }>>();
    const feeByOrder = new Map(
      charges.map((charge) => [String(charge.orderId), Number(charge.feeAmount || 0)]),
    );

    for (const order of page) {
      scanned += 1;
      lastId = order._id;
      const key = String(order._id);
      if (!feeByOrder.has(key)) {
        // A paid order with no charge row is a different repair (db:migrate ledger).
        noChargeRow += 1;
        continue;
      }
      if (feeByOrder.get(key)! > 0) {
        alreadyCorrect += 1;
        continue;
      }

      resynced += 1;
      console.log(
        `${DRY_RUN ? "would re-sync" : "re-syncing"} ${order.orderNumber}: fee ${order.paymentFee} ${
          order.paymentFeeCurrency || order.currency || ""
        }`,
      );
      if (DRY_RUN) continue;

      await ensureChargeTransaction({
        _id: key,
        orderNumber: order.orderNumber,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paymentId: order.paymentId,
        stripePaymentIntentId: order.stripePaymentIntentId,
        paypalCaptureId: order.paypalCaptureId,
        razorpayPaymentId: order.razorpayPaymentId,
        paystackTransactionId: order.paystackTransactionId,
        pesapalConfirmationCode: order.pesapalConfirmationCode,
        iotecTransactionId: order.iotecTransactionId,
        orangeMoneyTxnId: order.orangeMoneyTxnId,
        mtnMomoTransactionId: order.mtnMomoTransactionId,
        mtnMomoReferenceId: order.mtnMomoReferenceId,
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        tax: order.tax,
        discount: order.discount,
        total: order.total,
        preorderOutstandingAmount: order.preorderOutstandingAmount,
        paymentFee: order.paymentFee,
        paymentFeeCurrency: order.paymentFeeCurrency,
        paymentFeeRate: order.paymentFeeRate,
        currency: order.currency,
        channel: order.channel || "online",
        posLocationId: order.posLocationId ? String(order.posLocationId) : undefined,
        createdAt: order.createdAt,
      });
    }
  }

  console.log(`\n✓ Done. Orders with a recorded fee: ${scanned}`);
  console.log(`   ${DRY_RUN ? "would re-sync" : "re-synced"}: ${resynced}`);
  console.log(`   already carried the fee: ${alreadyCorrect}`);
  if (noChargeRow > 0) {
    console.log(`   no charge row (run db:migrate ledger first): ${noChargeRow}`);
  }
}

run()
  .catch((error) => {
    console.error("❌ Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
