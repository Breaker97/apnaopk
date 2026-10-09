import mongoose from "mongoose";

/**
 * Index migration for 2.2 and 2.3 (September 2026)
 * =================================================
 *
 * Creates every index the schemas gained in 2.2 and 2.3. Purely additive:
 * nothing is dropped and nothing is rebuilt, so it is safe to re-run and safe
 * to run on a store that is already up to date.
 *
 * Stores that leave Mongoose `autoIndex` on get all of them on the next boot.
 * This script exists for deployments running with MONGODB_AUTO_INDEX=false,
 * which is the recommended production setting — there, an index that no
 * migration creates is an index the store never gets.
 *
 * 2.3
 *   orders { addressHold.state, addressHold.lastRequestAt } partial
 *     The sweep in /api/cron/carrier-shipments, which reads open address
 *     holds oldest-request-first to send reminders and meet deadlines.
 *     Partial on an open hold: all but a handful of orders never carry one.
 *
 *   shipments { refunds.state } partial
 *     Settling the refunds a carrier left pending after a label was voided.
 *
 *   orders { checkoutAttemptId } unique partial, { payLinkPaypalOrderId } partial
 *     One order per checkout attempt, held by the database rather than by the
 *     claim above it; and the lookup a "pay now" PayPal approval makes.
 *
 *   checkoutattempts — every index of the collection 2.3 introduces: one
 *     unique partial per gateway reference (the idempotency of every webhook
 *     rests on them), the retry, expiry, stock-hold and reconcile sweeps, the
 *     support lookup, and the TTL that deletes a closed attempt after 90 days.
 *
 *   abandonedcheckouts { status, recoveryEmails.dueAt, recoveryEmails.claimedAt },
 *   { purgeAt } TTL
 *     The recovery-ladder sweep, and the TTL that deletes a closed record
 *     after 90 days — without it, nothing ever does.
 *
 *   paymenttransactions { failureCode }, { checkoutAttemptId },
 *   { checkoutToken, createdAt }, { clientIp, createdAt },
 *   { customerEmail, createdAt }, { metadata.dedupeKey } sparse
 *     The card-testing counters, the attempts shown on an order, and the
 *     lookup that stops a replayed webhook recording a refusal twice.
 *
 *   expenses { recurring.templateId, date } unique partial
 *     One copy of a recurring expense per due date, even when two sweeps
 *     overlap. UNIQUE — see the note below.
 *
 *   (The customer-profile indexes 2.3 adds are created by
 *   `db:migrate marketing-consent`, which also rebuilds the guest `email_1`.)
 *
 * 2.2
 *   orders { checkoutCartId, status } partial
 *     Finds the pending order a redirect-gateway retry should reuse instead
 *     of creating a second one.
 *
 *   orders { preorderBalancePaypalOrderId } partial
 *     The lookup the PayPal capture route makes on every balance payment.
 *
 *   collections { kind }
 *     Splits manual collections from automated ones in the admin list.
 *
 *   preorderwaitlists { productId, variantId, email } unique
 *     Joining a waitlist twice is the same wait. UNIQUE — see the note below.
 *
 *   preorderwaitlists { productId, variantId, notifiedAt, createdAt }
 *     Who on this list is still waiting, oldest first.
 *
 *   slidermetricdailies { handle, slideId, date } unique, { handle, date }
 *     One counter row per slide per day, and the slider report's read.
 *     UNIQUE — see the note below.
 *
 * About the unique indexes: each is on a collection, or a field, that 2.2 or
 * 2.3 introduced, so on an upgraded store it is either empty or holds only
 * rows written since the upgrade, and the code that writes them either upserts
 * on exactly these keys or checks before it inserts. If a build fails on a duplicate anyway, the script reports it and
 * carries on with the rest rather than leaving the remaining indexes
 * uncreated; fix the duplicate and run it again.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-order-address-indexes.mjs            (apply)
 *   node --env-file=.env scripts/migrate-order-address-indexes.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

// Names and options match what Mongoose derives from the schema, so a later
// autoIndex boot sees them as already present rather than as conflicts.
const ENSURE = [
  [
    "orders",
    [
      {
        name: "addressHold.state_1_addressHold.lastRequestAt_1",
        key: { "addressHold.state": 1, "addressHold.lastRequestAt": 1 },
        options: { partialFilterExpression: { "addressHold.state": "open" } },
      },
      {
        name: "checkoutCartId_1_status_1",
        key: { checkoutCartId: 1, status: 1 },
        options: { partialFilterExpression: { checkoutCartId: { $exists: true } } },
      },
      {
        name: "preorderBalancePaypalOrderId_1",
        key: { preorderBalancePaypalOrderId: 1 },
        options: {
          partialFilterExpression: { preorderBalancePaypalOrderId: { $gt: "" } },
        },
      },
      {
        name: "payLinkPaypalOrderId_1",
        key: { payLinkPaypalOrderId: 1 },
        options: {
          partialFilterExpression: { payLinkPaypalOrderId: { $gt: "" } },
        },
      },
      {
        name: "checkoutAttemptId_1",
        key: { checkoutAttemptId: 1 },
        options: {
          unique: true,
          partialFilterExpression: { checkoutAttemptId: { $type: "objectId" } },
        },
      },
    ],
  ],
  [
    "checkoutattempts",
    [
      ...[
        "razorpayOrderId",
        "paypalOrderId",
        "paystackReference",
        "pesapalOrderTrackingId",
        "pesapalMerchantReference",
        "stripePaymentIntentId",
        "stripeSessionId",
      ].map((field) => ({
        name: `gateway.${field}_1`,
        key: { [`gateway.${field}`]: 1 },
        options: {
          unique: true,
          partialFilterExpression: { [`gateway.${field}`]: { $gt: "" } },
        },
      })),
      {
        name: "cartId_1_status_1_paymentMethod_1",
        key: { cartId: 1, status: 1, paymentMethod: 1 },
      },
      { name: "status_1_expiresAt_1", key: { status: 1, expiresAt: 1 } },
      {
        name: "status_1_stockHold.expiresAt_1",
        key: { status: 1, "stockHold.expiresAt": 1 },
      },
      {
        name: "status_1_reconcile.checkedAt_1_createdAt_1",
        key: { status: 1, "reconcile.checkedAt": 1, createdAt: 1 },
      },
      {
        name: "checkoutToken_1_createdAt_-1",
        key: { checkoutToken: 1, createdAt: -1 },
      },
      {
        name: "purgeAt_1",
        key: { purgeAt: 1 },
        options: { expireAfterSeconds: 0 },
      },
    ],
  ],
  [
    "abandonedcheckouts",
    [
      {
        name: "status_1_recoveryEmails.dueAt_1_recoveryEmails.claimedAt_1",
        key: {
          status: 1,
          "recoveryEmails.dueAt": 1,
          "recoveryEmails.claimedAt": 1,
        },
      },
      {
        name: "purgeAt_1",
        key: { purgeAt: 1 },
        options: { expireAfterSeconds: 0 },
      },
    ],
  ],
  [
    "paymenttransactions",
    [
      { name: "failureCode_1", key: { failureCode: 1 } },
      { name: "checkoutAttemptId_1", key: { checkoutAttemptId: 1 } },
      {
        name: "checkoutToken_1_createdAt_-1",
        key: { checkoutToken: 1, createdAt: -1 },
      },
      { name: "clientIp_1_createdAt_-1", key: { clientIp: 1, createdAt: -1 } },
      {
        name: "customerEmail_1_createdAt_-1",
        key: { customerEmail: 1, createdAt: -1 },
      },
      {
        name: "metadata.dedupeKey_1",
        key: { "metadata.dedupeKey": 1 },
        options: { sparse: true },
      },
    ],
  ],
  [
    "expenses",
    [
      {
        name: "recurring.templateId_1_date_1",
        key: { "recurring.templateId": 1, date: 1 },
        options: {
          unique: true,
          partialFilterExpression: {
            "recurring.templateId": { $type: "objectId" },
          },
        },
      },
    ],
  ],
  [
    "shipments",
    [
      {
        name: "refunds.state_1",
        key: { "refunds.state": 1 },
        options: { partialFilterExpression: { "refunds.state": "pending" } },
      },
    ],
  ],
  ["collections", [{ name: "kind_1", key: { kind: 1 } }]],
  [
    "preorderwaitlists",
    [
      {
        name: "productId_1_variantId_1_email_1",
        key: { productId: 1, variantId: 1, email: 1 },
        options: { unique: true },
      },
      {
        name: "productId_1_variantId_1_notifiedAt_1_createdAt_1",
        key: { productId: 1, variantId: 1, notifiedAt: 1, createdAt: 1 },
      },
    ],
  ],
  [
    "slidermetricdailies",
    [
      {
        name: "handle_1_slideId_1_date_1",
        key: { handle: 1, slideId: 1, date: 1 },
        options: { unique: true },
      },
      { name: "handle_1_date_1", key: { handle: 1, date: 1 } },
    ],
  ],
];

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
  let failed = 0;
  for (const [collectionName, wanted] of ENSURE) {
    const collection = db.collection(collectionName);
    const existing = await collection.indexes().catch(() => []);
    const byName = new Set(existing.map((index) => index.name));
    for (const { name, key, options = {} } of wanted) {
      if (byName.has(name)) {
        console.log(`  = ${collectionName}.${name} already present`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  + would create ${collectionName}.${name} ${JSON.stringify(key)}`);
        created += 1;
        continue;
      }
      try {
        await collection.createIndex(key, { name, background: true, ...options });
        console.log(`  + created ${collectionName}.${name} ${JSON.stringify(key)}`);
        created += 1;
      } catch (error) {
        // One duplicate should not cost the store every other index.
        failed += 1;
        console.error(
          `  ✗ ${collectionName}.${name} not created: ${error?.message || error}`,
        );
      }
    }
  }

  console.log(
    DRY_RUN
      ? `✅ Dry run complete — ${created} index(es) would be created.`
      : `✅ Done — ${created} index(es) created${failed ? `, ${failed} failed` : ""}.`,
  );
  await mongoose.disconnect();
  if (failed) process.exit(1);
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
