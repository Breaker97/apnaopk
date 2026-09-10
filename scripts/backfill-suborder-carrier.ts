import mongoose from "mongoose";

/**
 * Sub-order carrier backfill
 * ==========================
 *
 * `SubOrder` gained its own `carrier`. Until now the carrier lived only at the
 * order level, which on a split order meant the second vendor to ship
 * overwrote the first vendor's carrier — the tracking number was per-vendor
 * but the courier name was not.
 *
 * This copies the order-level carrier down onto every sub-order that already
 * has a tracking number and no carrier of its own. That is the best available
 * reconstruction: a sub-order with a tracking number did ship, and on a
 * single-vendor order (the overwhelming majority) the order-level carrier is
 * exactly right. On a historical split order it is a guess, so those are
 * reported separately rather than silently claimed as accurate.
 *
 * Deployment ordering: run AFTER deploying the code that added the field.
 *
 * Usage:
 *   tsx --env-file=.env scripts/backfill-suborder-carrier.ts
 *   tsx --env-file=.env scripts/backfill-suborder-carrier.ts --dry-run
 */

const DRY_RUN = process.argv.includes("--dry-run");

type OrderRow = {
  _id: mongoose.Types.ObjectId;
  orderNumber?: string;
  carrier?: string;
  subOrders?: Array<{
    _id?: mongoose.Types.ObjectId;
    trackingNumber?: string;
    carrier?: string;
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

    console.log(
      `\n🚚 Sub-order carrier backfill${DRY_RUN ? " (DRY RUN)" : ""}...\n`,
    );

    const orders = db.collection<OrderRow>("orders");
    const cursor = orders.find(
      {
        carrier: { $gt: "" },
        subOrders: {
          $elemMatch: {
            trackingNumber: { $gt: "" },
            $or: [{ carrier: { $exists: false } }, { carrier: "" }],
          },
        },
      },
      { projection: { orderNumber: 1, carrier: 1, "subOrders._id": 1, "subOrders.trackingNumber": 1, "subOrders.carrier": 1 } },
    );

    let scanned = 0;
    let updated = 0;
    let subOrdersStamped = 0;
    let splitOrders = 0;

    for await (const order of cursor) {
      scanned += 1;
      const subOrders = order.subOrders || [];
      const targets = subOrders.filter(
        (sub) => Boolean(sub.trackingNumber) && !sub.carrier,
      );
      if (targets.length === 0) continue;

      const isSplit = subOrders.length > 1;
      if (isSplit) splitOrders += 1;

      if (DRY_RUN) {
        console.log(
          `   [dry-run] ${order.orderNumber || order._id}: would stamp "${order.carrier}" on ${targets.length} sub-order(s)${isSplit ? " (SPLIT — carrier is inferred)" : ""}`,
        );
        updated += 1;
        subOrdersStamped += targets.length;
        continue;
      }

      const result = await orders.updateOne(
        { _id: order._id },
        { $set: { "subOrders.$[so].carrier": order.carrier } },
        {
          arrayFilters: [
            {
              "so.trackingNumber": { $gt: "" },
              $or: [{ "so.carrier": { $exists: false } }, { "so.carrier": "" }],
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
        `   ⚠ ${splitOrders} of those are split orders where the order-level carrier may not be every vendor's — review if it matters.`,
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
