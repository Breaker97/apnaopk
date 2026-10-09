import mongoose from "mongoose";

/**
 * Sub-order payment status backfill
 * =================================
 *
 * `SubOrder` gained its own `paymentStatus`. Until now payment lived only at
 * the order level, so on a split order one vendor marking their cash collected
 * declared the WHOLE order paid — the courier stopped collecting COD on the
 * other vendors' parcels, their digital files unlocked, and their sub-orders
 * became payable on money that had never arrived.
 *
 * This copies the order-level status down onto every sub-order that does not
 * have one yet. For every historical order that is the correct reconstruction,
 * because the order-level value was the ONLY answer that existed: whatever it
 * said applied to all of that order's vendors, and stamping it preserves
 * exactly the behaviour those orders have today.
 *
 * Running it is optional but recommended. Readers resolve a missing sub-order
 * value against the order-level one (`resolveSubOrderPaymentStatus`), and the
 * Mongo filters pair a sub-order arm with an order-level arm for the same
 * reason — so an install that never runs this stays correct, just slower to
 * query and harder to read in the shell.
 *
 * Deployment ordering: run AFTER deploying the code that added the field.
 *
 * Usage:
 *   tsx --env-file=.env scripts/backfill-suborder-payment-status.ts
 *   tsx --env-file=.env scripts/backfill-suborder-payment-status.ts --dry-run
 */

const DRY_RUN = process.argv.includes("--dry-run");

type OrderRow = {
  _id: mongoose.Types.ObjectId;
  orderNumber?: string;
  paymentStatus?: string;
  subOrders?: Array<{
    _id?: mongoose.Types.ObjectId;
    paymentStatus?: string;
  }>;
};

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;

  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
      maxPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✓ Connected to MongoDB");

    const db = mongoose.connection.db;
    if (!db) {
      console.error("❌ Database connection not available");
      process.exit(1);
    }

    // Money migration: say out loud which database is about to be written, so
    // a misconfigured .env is caught before the write rather than after it.
    console.log(`   host: ${mongoose.connection.host}`);
    console.log(`   db:   ${db.databaseName}`);

    console.log(
      `\n💳 Sub-order payment status backfill${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );

    const orders = db.collection<OrderRow>("orders");
    const selector = {
      paymentStatus: { $gt: "" },
      subOrders: {
        $elemMatch: {
          $or: [
            { paymentStatus: { $exists: false } },
            { paymentStatus: null },
            { paymentStatus: "" },
          ],
        },
      },
    };

    const cursor = orders.find(selector, {
      projection: {
        orderNumber: 1,
        paymentStatus: 1,
        "subOrders._id": 1,
        "subOrders.paymentStatus": 1,
      },
    });

    let scanned = 0;
    let updated = 0;
    let subOrdersStamped = 0;
    let splitOrders = 0;

    for await (const order of cursor) {
      scanned += 1;
      const subOrders = order.subOrders || [];
      const targets = subOrders.filter((sub) => !sub.paymentStatus);
      if (targets.length === 0) continue;

      if (subOrders.length > 1) splitOrders += 1;

      if (DRY_RUN) {
        console.log(
          `   [dry-run] ${order.orderNumber || order._id}: would stamp "${order.paymentStatus}" on ${targets.length} sub-order(s)`,
        );
        updated += 1;
        subOrdersStamped += targets.length;
        continue;
      }

      const result = await orders.updateOne(
        { _id: order._id },
        { $set: { "subOrders.$[so].paymentStatus": order.paymentStatus } },
        {
          arrayFilters: [
            {
              $or: [
                { "so.paymentStatus": { $exists: false } },
                { "so.paymentStatus": null },
                { "so.paymentStatus": "" },
              ],
            },
          ],
        },
      );
      if (result.modifiedCount > 0) {
        updated += 1;
        subOrdersStamped += targets.length;
      }
    }

    console.log(
      `\n   scanned ${scanned} order(s), ${DRY_RUN ? "would update" : "updated"} ${updated}, stamping ${subOrdersStamped} sub-order(s)`,
    );
    if (splitOrders > 0) {
      console.log(
        `   ℹ ${splitOrders} of those span multiple vendors. They inherit the order-level value, which is what those orders already behave as — the per-vendor distinction only starts applying to collections recorded from now on.`,
      );
    }

    // A count rather than a claim: proving the selector is empty afterwards is
    // the only statement worth making about whether this finished its job.
    if (!DRY_RUN) {
      const remaining = await orders.countDocuments(selector);
      console.log(
        remaining === 0
          ? "   ✓ no orders left with an unstamped sub-order"
          : `   ⚠ ${remaining} order(s) still match the selector — re-run to finish`,
      );
    }

    console.log(
      `\n✅ Backfill ${DRY_RUN ? "dry-run complete (no changes made)" : "completed"}.\n`,
    );
  } catch (error) {
    console.error("\n❌ Backfill failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(() => process.exit(1));
