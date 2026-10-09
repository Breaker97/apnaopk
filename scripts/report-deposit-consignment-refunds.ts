import mongoose from "mongoose";

/**
 * Deposit shares still owed on cancelled consignments
 * ===================================================
 *
 * A READ-ONLY report of the split deposit pre-orders whose cancelled
 * consignments were refunded less than their share of the deposit. Until 3.0,
 * on a store that had run `db:migrate suborder-payment`, a seller's (or the
 * store's) cancellation of one consignment of a deposit pre-order refunded
 * nothing; the rest of the order went on and the shopper never had that part
 * of the deposit back. See `lib/orders/deposit-refund-shortfall.ts` for how
 * an order is judged.
 *
 * It writes nothing: no document, no index. Refund what it lists from the
 * order's page (Refund → the shortfall), which records the refund and posts
 * it to the ledger as any refund is. A database that is not on this machine
 * needs `--allow-remote`, so a shared or production database is never read by
 * accident.
 *
 * Usage:
 *   pnpm orders:deposit-refund-report [--json] [--scan-limit N] [--allow-remote]
 */

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

function hostsOf(uri: string): string[] {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/);
  return (match?.[1] || "").split(",").map((host) => host.split(":")[0]).filter(Boolean);
}

async function run() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  if (!uri) {
    console.error("Missing MONGODB_URI in the environment.");
    process.exit(1);
  }
  const hosts = hostsOf(uri);
  const local = hosts.length > 0 && hosts.every((host) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host));
  if (!local && !flag("--allow-remote")) {
    console.error(
      `MONGODB_URI points at ${hosts.join(", ") || "an unknown host"}. This report only reads, but pass --allow-remote to read a database that is not on this machine.`,
    );
    process.exit(2);
  }

  await mongoose.connect(uri, {
    ...(dbName ? { dbName } : {}),
    autoIndex: false,
    autoCreate: false,
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
  });
  // The models are compiled after this line (the import below): none of them
  // may build an index on the database being reported on.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  // `connectDB()` hands back this connection rather than opening its own.
  (globalThis as { mongooseCache?: unknown }).mongooseCache = {
    conn: mongoose,
    promise: Promise.resolve(mongoose),
  };

  const { findDepositRefundShortfalls } = await import("@/lib/orders/deposit-refund-shortfall");
  const report = await findDepositRefundShortfalls({
    scanLimit: value("--scan-limit") ? Number(value("--scan-limit")) : undefined,
  });

  if (flag("--json")) {
    console.log(JSON.stringify({ database: mongoose.connection.name, ...report }, null, 2));
  } else {
    console.log(
      `Deposit shares still owed on cancelled consignments — ${mongoose.connection.name} — ${report.generatedAt.toISOString()}`,
    );
    console.log(`Scanned ${report.scanned} live deposit pre-order(s) with a cancelled consignment.\n`);
    if (report.shortfalls.length === 0) {
      console.log("✓ Nothing owed: every cancelled consignment's share has been refunded.");
    }
    for (const row of report.shortfalls) {
      console.log(`! ${row.orderNumber || "?"} (${row.orderId}) — ${row.shortfall.toFixed(2)} ${row.currency} still owed`);
      console.log(`  order ${row.status || "?"} / ${row.paymentStatus || "?"}; owed for cancelled consignments ${row.owed.toFixed(2)}, refunded so far ${row.refundedTotal.toFixed(2)}`);
      for (const sub of row.cancelled) {
        console.log(`    consignment ${sub.subOrderId}${sub.vendorId ? ` (seller ${sub.vendorId})` : ""}: share ${sub.share.toFixed(2)}${sub.paymentStatus ? `, reads ${sub.paymentStatus}` : ""}`);
      }
      for (const refund of row.refunds) {
        console.log(`    refunded ${refund.amount.toFixed(2)}${refund.createdAt ? ` on ${refund.createdAt.toISOString().slice(0, 10)}` : ""}${refund.reason ? ` — ${refund.reason}` : ""}`);
      }
      console.log(`  → open /admin/orders/${row.orderId} and refund ${row.shortfall.toFixed(2)} ${row.currency}`);
    }
  }
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
