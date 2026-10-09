import mongoose from "mongoose";

/**
 * Pre-order reliability dry run
 * =============================
 *
 * A READ-ONLY report of the historical pre-order data the new workflow will
 * not act on by itself (ambiguous stock, paid requests never released,
 * half-cancelled orders, requests without an advance notice, stale release
 * dates, ...) — run it before rolling the workflow out, and again after.
 * What each finding means and what to do about it is in
 * docs/PREORDER_RELIABILITY_IMPLEMENTATION.md.
 *
 * It writes nothing: no document, no index (`autoIndex`/`autoCreate` are off).
 * A database that is not on this machine needs `--allow-remote`, so a shared
 * or production database is never read by accident.
 *
 * Usage:
 *   pnpm preorder:reliability-report [--json] [--samples 25] [--scan-limit N] [--allow-remote]
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

  const { buildPreorderReliabilityReport } = await import(
    "@/lib/orders/preorder-reliability-report"
  );
  const report = await buildPreorderReliabilityReport({
    sampleLimit: Number(value("--samples") ?? 25),
    scanLimit: value("--scan-limit") ? Number(value("--scan-limit")) : undefined,
  });

  if (flag("--json")) {
    console.log(JSON.stringify({ database: mongoose.connection.name, ...report }, null, 2));
  } else {
    console.log(`Pre-order reliability report — ${mongoose.connection.name} — ${report.generatedAt.toISOString()}`);
    console.log(`Scanned ${report.scanned.orders} pre-orders, ${report.scanned.products} products.\n`);
    for (const finding of report.findings) {
      console.log(`${finding.count > 0 ? "!" : "✓"} ${finding.title}: ${finding.count}`);
      if (finding.count > 0) {
        console.log(`  → ${finding.action}`);
        for (const sample of finding.samples) {
          console.log(`    ${sample.orderNumber || "?"} (${sample.orderId})${sample.detail ? ` — ${sample.detail}` : ""}`);
        }
        if (finding.count > finding.samples.length) {
          console.log(`    … and ${finding.count - finding.samples.length} more (--samples N, or --json)`);
        }
      }
    }
    console.log(`\nOperations: ${JSON.stringify(report.operations)}`);
  }
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
