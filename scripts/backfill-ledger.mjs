/**
 * Replay history into the ledger.
 *
 * The ledger starts empty on an existing store, so every report would begin at
 * the moment the feature shipped. This walks the documents that already record
 * money — paid orders, refunds, cleared payouts, platform payments, purchased
 * labels — and posts each through the SAME rules the live paths use.
 *
 * Safe to run repeatedly. Entry keys are derived from the source document, so a
 * second run collides with the unique index and writes nothing; there is no
 * "already done" flag to get wrong, and a run interrupted halfway is simply
 * resumed by running it again.
 *
 * It writes only to the ledger. No order, payout or payment is touched, so the
 * worst case of a mistaken run is entries that can be dropped and rebuilt.
 *
 * **`--rebuild` is for when a posting RULE changed.** Idempotency is the whole
 * design here, and it cuts both ways: an entry written under an old rule keeps
 * its key, so a plain re-run collides with it and the stale entry survives
 * forever. Rebuilding deletes the order and refund entries in scope and posts
 * them again. It is the only way to correct the books after a rule
 * fix, and it is deliberately a separate flag, because on any other day it
 * deletes good data to write the same thing back.
 *
 * Usage:
 *   pnpm db:migrate ledger --dry-run     # counts what it would post, writes nothing
 *   pnpm db:migrate ledger
 *   pnpm db:migrate ledger -- --from=2026-01-01
 *   pnpm db:migrate ledger -- --rebuild --method=cod    # after a rule change
 */

import mongoose from "mongoose";

const DRY_RUN = process.argv.includes("--dry-run");
const REBUILD = process.argv.includes("--rebuild");
const methodArg = process.argv.find((arg) => arg.startsWith("--method="));
/** Replay only orders paid this way — the scope a rule fix usually has. */
const METHOD = methodArg ? methodArg.split("=")[1] : null;
const fromArg = process.argv.find((arg) => arg.startsWith("--from="));
const FROM = fromArg ? new Date(fromArg.split("=")[1]) : null;
const PAGE = 200;

function log(message) {
  console.log(`[ledger] ${message}`);
}

async function run() {
  const { MONGODB_URI, MONGODB_DB_NAME } = process.env;
  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    // Mirrors lib/db.ts: without this a URI with no path segment silently
    // targets `test` and the backfill reports a cheerful zero.
    ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
    serverSelectionTimeoutMS: 10000,
  });
  log(`connected to ${mongoose.connection.db?.databaseName}`);
  if (FROM && Number.isNaN(FROM.getTime())) {
    console.error("❌ --from is not a date");
    process.exit(1);
  }

  // Imported after the connection so the models register against it, and one
  // file at a time rather than through `models/index.ts` — the barrel loads
  // every model in the app, and a cycle in that graph leaves config constants
  // undefined when this runs outside Next.
  // Sequentially, NOT Promise.all. Parallel dynamic imports interleave under
  // tsx's CommonJS transform, and a module that several of these share
  // (config/app.config) can be handed over half-initialized — which surfaces
  // as a constant being "not defined" inside a schema that plainly imports it.
  const { Order } = await import("../models/order.model.ts");
  const { Payout } = await import("../models/payout.model.ts");
  const { PlatformPayment } = await import("../models/platformPayment.model.ts");
  const { Shipment } = await import("../models/shipment.model.ts");
  const { VendorSubscriptionPayment } = await import(
    "../models/vendorSubscriptionPayment.model.ts"
  );
  const { PaymentTransaction } = await import(
    "../models/payment-transaction.model.ts"
  );
  const postEvents = await import("../lib/finance/post-events.ts");
  const ledger = await import("../lib/finance/ledger.ts");

  const dateFilter = FROM ? { $gte: FROM } : undefined;
  const totals = {
    orders: 0,
    refunds: 0,
    payouts: 0,
    platform: 0,
    subscriptions: 0,
    labels: 0,
  };

  // --- unpaid expenses, re-filed ------------------------------------------
  // An expense recorded as not-yet-paid used to credit `vendor_payable`, which
  // is one specific debt — a seller's share of their own sales — so the store's
  // own unpaid rent raised what the marketplace appeared to owe its vendors,
  // and an expense tagged to a vendor appeared on that vendor's statement as a
  // line they had earned. These entries cannot be re-posted the way an order
  // can (the key is the same and the reversal chain has to stay intact), so the
  // account is corrected in place. Scoped to expense entries, and idempotent —
  // a second run matches nothing.
  {
    const { LedgerEntry } = await import("../models/ledger-entry.model.ts");
    const scope = { "source.kind": "expense" };
    const misfiled = await LedgerEntry.countDocuments({
      ...scope,
      $or: [{ credit: "vendor_payable" }, { debit: "vendor_payable" }],
    });
    if (misfiled > 0) {
      if (DRY_RUN) {
        log(`would re-file ${misfiled} unpaid-expense entr(ies) to accounts_payable`);
      } else {
        // Both sides: the expense credits the payable, and its reversal debits
        // the same account back.
        const [credits, debits] = await Promise.all([
          LedgerEntry.updateMany(
            { ...scope, credit: "vendor_payable" },
            { $set: { credit: "accounts_payable" } },
          ),
          LedgerEntry.updateMany(
            { ...scope, debit: "vendor_payable" },
            { $set: { debit: "accounts_payable" } },
          ),
        ]);
        log(
          `re-filed ${(credits.modifiedCount ?? 0) + (debits.modifiedCount ?? 0)} unpaid-expense entr(ies) to accounts_payable`,
        );
      }
    }
  }

  // --- paid orders ---------------------------------------------------------
  const orderFilter = {
    paymentStatus: { $in: ["paid", "partially_paid", "partially_refunded", "refunded"] },
    ...(dateFilter ? { createdAt: dateFilter } : {}),
    ...(METHOD ? { paymentMethod: METHOD } : {}),
  };
  const orderCount = await Order.countDocuments(orderFilter);
  log(`${orderCount} paid order(s) to replay${METHOD ? ` (${METHOD} only)` : ""}`);

  if (REBUILD) {
    // Drop first, then replay: the entries about to be written carry the same
    // keys as the ones already there, so without this the old rule's answer is
    // what survives. Scoped to the orders in the filter — every other entry on
    // the books is left exactly where it is.
    const ids = (await Order.find(orderFilter).select("_id").lean()).map(
      (order) => order._id,
    );
    // A rule that changes how a sale posts changes how its refund posts too,
    // and a refund entry is filed under the refund's own id — so it has to be
    // found through the transaction, or the correction covers only half the
    // story and the two halves stop agreeing.
    const refundIds = (
      await PaymentTransaction.find({ type: "refund", orderId: { $in: ids } })
        .select("_id")
        .lean()
    ).map((transaction) => transaction._id);
    const { LedgerEntry } = await import("../models/ledger-entry.model.ts");
    const doomed = {
      $or: [
        { "source.kind": "order", "source.id": { $in: ids } },
        { "source.kind": "refund", "source.id": { $in: refundIds } },
      ],
    };
    const count = await LedgerEntry.countDocuments(doomed);
    if (DRY_RUN) {
      log(`rebuild: would delete ${count} existing entr(ies) before replaying`);
    } else {
      const { deletedCount } = await LedgerEntry.deleteMany(doomed);
      log(`rebuild: deleted ${deletedCount} existing entr(ies)`);
    }
  }
  for (let skip = 0; skip < orderCount; skip += PAGE) {
    const page = await Order.find(orderFilter)
      .sort({ _id: 1 })
      .skip(skip)
      .limit(PAGE)
      .select("_id")
      .lean();
    for (const order of page) {
      if (DRY_RUN) {
        totals.orders += 1;
        continue;
      }
      totals.orders += await postEvents.postOrderPaid(order._id);
    }
  }

  // --- refunds -------------------------------------------------------------
  // Read from PaymentTransaction rather than the order: an order carries only a
  // running total, and posting that as one entry would merge several refunds
  // into a figure with no date of its own.
  const refundFilter = {
    type: "refund",
    status: "succeeded",
    ...(dateFilter ? { createdAt: dateFilter } : {}),
  };
  const refundCount = await PaymentTransaction.countDocuments(refundFilter);
  log(`${refundCount} refund(s) to replay`);
  for (let skip = 0; skip < refundCount; skip += PAGE) {
    const page = await PaymentTransaction.find(refundFilter)
      .sort({ _id: 1 })
      .skip(skip)
      .limit(PAGE)
      .select("_id orderId grossAmount createdAt")
      .lean();
    for (const refund of page) {
      if (DRY_RUN) {
        totals.refunds += 1;
        continue;
      }
      totals.refunds += await postEvents.postRefund({
        orderId: refund.orderId,
        amount: refund.grossAmount,
        refundId: refund._id,
        date: refund.createdAt,
      });
    }
  }

  // --- cleared payouts -----------------------------------------------------
  const payoutFilter = {
    status: "paid",
    ...(dateFilter ? { paidAt: dateFilter } : {}),
  };
  const payouts = await Payout.find(payoutFilter)
    .select("_id payoutNumber vendorId netAmount currency paidAt")
    .lean();
  log(`${payouts.length} paid payout(s) to replay`);
  for (const payout of payouts) {
    if (DRY_RUN) {
      totals.payouts += 1;
      continue;
    }
    totals.payouts += await postEvents.postPayoutPaid(payout);
  }

  // --- platform payments (boosts, subscriptions) ---------------------------
  const platformFilter = {
    status: "paid",
    ...(dateFilter ? { paidAt: dateFilter } : {}),
  };
  const platformPayments = await PlatformPayment.find(platformFilter)
    .select("_id kind reference vendorId amount currency paidAt")
    .lean();
  log(`${platformPayments.length} platform payment(s) to replay`);
  for (const payment of platformPayments) {
    if (DRY_RUN) {
      totals.platform += 1;
      continue;
    }
    totals.platform += await postEvents.postPlatformPayment(payment);
  }

  // --- subscription invoices ----------------------------------------------
  // The other half of plan revenue. A subscription billed by the provider's own
  // engine never becomes a PlatformPayment — the renewal arrives as an invoice
  // and lands here — so a store on Stripe Billing has all of its plan income in
  // this collection and none in the one above.
  const subscriptionFilter = {
    status: { $in: ["paid", "refunded"] },
    amountPaid: { $gt: 0 },
    ...(dateFilter ? { paidAt: dateFilter } : {}),
  };
  const subscriptionInvoices = await VendorSubscriptionPayment.find(
    subscriptionFilter,
  )
    .select(
      "_id vendorId providerInvoiceId status amountPaid amountRefunded currency paidAt providerCreatedAt",
    )
    .lean();
  log(`${subscriptionInvoices.length} subscription invoice(s) to replay`);
  for (const invoice of subscriptionInvoices) {
    if (DRY_RUN) {
      totals.subscriptions += 1;
      continue;
    }
    totals.subscriptions += await postEvents.postSubscriptionInvoice(invoice);
  }

  // --- purchased labels ----------------------------------------------------
  if (Shipment) {
    const labelFilter = {
      "rate.amount": { $gt: 0 },
      ...(dateFilter ? { createdAt: dateFilter } : {}),
    };
    const shipments = await Shipment.find(labelFilter)
      .select(
        "_id vendorId orderId rate bookingSequence purchase.purchasedAt purchase.billedTo createdAt",
      )
      .lean();
    log(`${shipments.length} purchased label(s) to replay`);
    for (const shipment of shipments) {
      if (DRY_RUN) {
        totals.labels += 1;
        continue;
      }
      totals.labels += await postEvents.postShipmentLabel({
        _id: shipment._id,
        vendorId: shipment.vendorId,
        orderId: shipment.orderId,
        rate: shipment.rate,
        purchasedAt: shipment.purchase?.purchasedAt || shipment.createdAt,
        // Only the live label survives on a re-shipped parcel, so a replay can
        // only ever restate that one — with the key of the booking it belongs
        // to, so it does not land on top of the entry the first booking wrote.
        bookingSequence: shipment.bookingSequence,
        billedTo: shipment.purchase?.billedTo,
      });
    }
  }

  if (DRY_RUN) {
    log(
      `dry run — would replay ${totals.orders} order(s), ${totals.refunds} refund(s), ` +
        `${totals.payouts} payout(s), ${totals.platform} platform payment(s), ` +
        `${totals.subscriptions} subscription invoice(s), ${totals.labels} label(s). Nothing written.`,
    );
  } else {
    const written = Object.values(totals).reduce((sum, count) => sum + count, 0);
    log(
      `posted ${written} entr(ies) ` +
        `(orders ${totals.orders}, refunds ${totals.refunds}, payouts ${totals.payouts}, ` +
        `platform ${totals.platform}, subscriptions ${totals.subscriptions}, labels ${totals.labels})`,
    );

    // The check that catches a rule which credits one account and debits
    // another for a different amount — invisible in any single rule's own test.
    const balance = await ledger.getTrialBalance();
    if (balance.balanced) {
      log("trial balance: 0.00 ✓");
    } else {
      log(`⚠️  TRIAL BALANCE IS OFF BY ${balance.total} — a posting rule is wrong`);
      process.exitCode = 1;
    }
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("[ledger] failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
