import mongoose from "mongoose";

/**
 * Abandoned-checkout sellers migration
 * ====================================
 *
 * A vendor now sees Orders → Abandoned checkouts: the checkouts that held its
 * products, with only its own lines. Which lines are whose is written onto the
 * record when the checkout is saved (`items[].vendorId`, and the set of them as
 * `vendorIds`), so a product deleted or moved to another seller later does not
 * take the line with it.
 *
 * Records saved before this release carry neither, so no vendor sees them. This
 * stamps them from each line's product as it is today — the best evidence left
 * for a basket that is at most ninety days old. A line whose product has since
 * been deleted is left without a seller, and no vendor sees it; the store's own
 * list is unchanged either way.
 *
 * It also creates the `{ vendorIds: 1, abandonedAt: -1 }` index the vendor list
 * reads, for stores that run with `MONGODB_AUTO_INDEX=false`.
 *
 * Idempotent: only records without `vendorIds` are read, and each write is a
 * compare-and-swap on the record as read, so a checkout the storefront updates
 * mid-run is left for its own save to stamp. `updatedAt` is not touched.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-abandoned-checkout-vendors.mjs            (apply)
 *   node --env-file=.env scripts/migrate-abandoned-checkout-vendors.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 200;
const INDEX_KEYS = { vendorIds: 1, abandonedAt: -1 };

function productIdOf(item) {
  const value = item?.productId;
  if (!value) return null;
  const id = typeof value === "object" && value._id ? value._id : value;
  const text = String(id);
  return mongoose.Types.ObjectId.isValid(text) ? text : null;
}

async function stampBatch(checkouts, products, stats) {
  const productIds = Array.from(
    new Set(
      checkouts.flatMap((checkout) =>
        (checkout.items ?? []).map(productIdOf).filter(Boolean),
      ),
    ),
  ).map((id) => new mongoose.Types.ObjectId(id));

  const owners = new Map();
  if (productIds.length > 0) {
    const found = await products
      .find({ _id: { $in: productIds } }, { projection: { vendorId: 1 } })
      .toArray();
    for (const product of found) {
      if (product.vendorId) owners.set(String(product._id), product.vendorId);
    }
  }

  const writes = [];
  for (const checkout of checkouts) {
    const vendorIds = new Map();
    const items = (checkout.items ?? []).map((item) => {
      const productId = productIdOf(item);
      const vendorId = productId ? owners.get(productId) : undefined;
      if (!vendorId) {
        stats.unownedLines += 1;
        return item;
      }
      vendorIds.set(String(vendorId), vendorId);
      return { ...item, vendorId };
    });

    stats.checkouts += 1;
    if ((checkout.items ?? []).length === 0) stats.empty += 1;
    else if (vendorIds.size === 0) stats.withoutSeller += 1;
    if (vendorIds.size > 1) stats.multiSeller += 1;

    writes.push({
      updateOne: {
        // Compare-and-swap on the record as read: a checkout saved since is
        // stamped by that save instead.
        filter: {
          _id: checkout._id,
          vendorIds: { $exists: false },
          updatedAt: checkout.updatedAt ?? { $exists: false },
        },
        update: { $set: { items, vendorIds: Array.from(vendorIds.values()) } },
      },
    });
  }
  return writes;
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Pass --env-file=.env");
    throw new Error("Missing MONGODB_URI");
  }

  console.log(
    `\nAbandoned-checkout sellers migration${DRY_RUN ? " (dry run — no changes)" : ""}\n`,
  );

  await mongoose.connect(uri);
  console.log(
    `✓ Connected to ${mongoose.connection.host}/${mongoose.connection.name}`,
  );

  try {
    const db = mongoose.connection.db;
    const checkouts = db.collection("abandonedcheckouts");
    const products = db.collection("products");

    const indexes = await checkouts.indexes().catch(() => []);
    const hasIndex = indexes.some(
      (index) => JSON.stringify(index.key) === JSON.stringify(INDEX_KEYS),
    );
    if (hasIndex) {
      console.log("Index { vendorIds: 1, abandonedAt: -1 } already exists.");
    } else if (DRY_RUN) {
      console.log("Would create index { vendorIds: 1, abandonedAt: -1 }.");
    } else {
      await checkouts.createIndex(INDEX_KEYS);
      console.log("✓ Created index { vendorIds: 1, abandonedAt: -1 }.");
    }

    const filter = { vendorIds: { $exists: false } };
    const pending = await checkouts.countDocuments(filter);
    if (pending === 0) {
      console.log("Nothing to do — every abandoned checkout names its sellers.");
      return;
    }
    console.log(`${pending} abandoned checkout(s) to stamp.`);

    const stats = {
      checkouts: 0,
      empty: 0,
      withoutSeller: 0,
      multiSeller: 0,
      unownedLines: 0,
      written: 0,
      skipped: 0,
    };

    const cursor = checkouts
      .find(filter, { projection: { items: 1, updatedAt: 1 } })
      .batchSize(BATCH_SIZE);

    let batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const writes = await stampBatch(batch, products, stats);
      batch = [];
      if (DRY_RUN || writes.length === 0) return;
      const result = await checkouts.bulkWrite(writes, { ordered: false });
      stats.written += result.modifiedCount;
      stats.skipped += writes.length - result.matchedCount;
    };

    for await (const checkout of cursor) {
      batch.push(checkout);
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();

    console.log(`\n${stats.checkouts} checkout(s) read.`);
    console.log(
      `  ${stats.multiSeller} held more than one seller's goods — each seller will see its own lines only.`,
    );
    console.log(
      `  ${stats.withoutSeller} name no seller (every product in them has since been deleted) — only the store sees them.`,
    );
    if (stats.empty > 0) {
      console.log(
        `  ${stats.empty} hold no lines at all (a checkout started and emptied) — no list shows them.`,
      );
    }
    if (stats.unownedLines > 0) {
      console.log(
        `  ${stats.unownedLines} line(s) in all whose product no longer exists — left without a seller.`,
      );
    }

    if (DRY_RUN) {
      console.log("\nDry run complete. Re-run without --dry-run to apply.");
      return;
    }

    console.log(`\n✅ Stamped ${stats.written} checkout(s).`);
    if (stats.skipped > 0) {
      console.log(
        `  ${stats.skipped} changed while this ran and were left for their next save to stamp.`,
      );
    }
  } catch (error) {
    console.error("\n❌ Abandoned-checkout sellers migration failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
