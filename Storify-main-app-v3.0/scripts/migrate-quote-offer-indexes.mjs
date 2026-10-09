import mongoose from "mongoose";

/**
 * Quote offer index migration (September 2026)
 * ============================================
 *
 * Adds the two indexes the quote-offer feature relies on. Purely additive —
 * nothing is dropped or replaced:
 *
 *   quoterequests { userId: 1, createdAt: -1 }
 *     The shopper's own list at /account/quotes, and the lookup that decides
 *     whether a signed-in visitor has a live price for the product they are
 *     looking at. Without it, every product page view by a signed-in shopper
 *     with a quote scans the collection.
 *
 *   quoterequests { email: 1, userId: 1 }
 *     Claiming requests sent while signed out, on the session that follows
 *     (lib/customers/customer.ts, claimGuestCustomerData). That runs on EVERY
 *     sign-in, so it is the one that must not be a scan.
 *
 * Stores that leave Mongoose `autoIndex` on get both on the next boot; this
 * script exists for deployments that run with MONGODB_AUTO_INDEX=false.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-quote-offer-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-quote-offer-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

const ENSURE = {
  quoterequests: [
    { name: "userId_1_createdAt_-1", key: { userId: 1, createdAt: -1 } },
    { name: "email_1_userId_1", key: { email: 1, userId: 1 } },
  ],
};

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection.db;
  console.log(
    `${DRY_RUN ? "🔍 Dry run" : "🚀 Applying"} on database "${db.databaseName}"`,
  );

  let created = 0;
  for (const [collectionName, wanted] of Object.entries(ENSURE)) {
    const collection = db.collection(collectionName);
    const existing = await collection.indexes().catch(() => []);
    const byName = new Map(existing.map((index) => [index.name, index]));
    for (const { name, key } of wanted) {
      if (byName.has(name)) {
        console.log(`  = ${collectionName}.${name} already present`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  + would create ${collectionName}.${name} ${JSON.stringify(key)}`);
      } else {
        await collection.createIndex(key, { name, background: true });
        console.log(`  + created ${collectionName}.${name} ${JSON.stringify(key)}`);
      }
      created += 1;
    }
  }

  console.log(
    DRY_RUN
      ? `✅ Dry run complete — ${created} index(es) would be created.`
      : `✅ Done — ${created} index(es) created.`,
  );
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
