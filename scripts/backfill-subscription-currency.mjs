import mongoose from "mongoose";

/**
 * Vendor subscription currency backfill
 * =====================================
 *
 * Repairs plan snapshots stamped with the placeholder currency "USD".
 *
 * `VendorPlan` has no `currency` field of its own — only `stripePriceCurrency`,
 * which exists once a Stripe price has been synced. `buildSubscriptionForPlan`
 * used to read a non-existent `plan.currency` and fall back to "USD", so every
 * subscription snapshot on a non-Stripe install was stamped "USD" regardless of
 * the store's actual currency.
 *
 * That was harmless while non-Stripe subscriptions were free/manual only. The
 * one-shot renewal rail changed that: `/api/vendor/subscription/renew` reads
 * `planSnapshot.currency` FIRST and hands it straight to the gateway, so an
 * NGN store would ask Paystack to collect USD, and a UGX store would fail every
 * renewal on ioTec's UGX-only guard.
 *
 * What is rewritten:
 *   vendorsubscriptions.planSnapshot.currency
 *       for every row Stripe is not actually billing — the snapshot drives
 *       FUTURE renewals. New value: the plan's synced Stripe price currency
 *       when it has one, otherwise the store's default currency.
 *   vendorapplications.planSnapshot.currency
 *       only for applications still awaiting payment. A paid application's
 *       currency records what was actually collected and is never rewritten.
 *
 * "Stripe is actually billing it" means provider "stripe" AND a
 * paymentProviderRef. Provider alone is not enough: buildSubscriptionForPlan
 * stamps "stripe" on every paid INCOMPLETE row as a placeholder, long before
 * the real rail is known, so filtering on provider would skip exactly the
 * Paystack/Pesapal vendors this backfill exists for.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-subscription-currency.mjs            (apply)
 *   node --env-file=.env scripts/backfill-subscription-currency.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

/** A row Stripe genuinely bills — its currency belongs to the Stripe price. */
const LIVE_STRIPE = { provider: "stripe", paymentProviderRef: { $type: "string" } };

/** A snapshot must already be an object; `$set` on a dotted path under null throws. */
const HAS_SNAPSHOT = { planSnapshot: { $type: "object" } };

async function resolveStoreCurrency(db) {
  const settings = await db
    .collection("settings")
    .findOne({}, { projection: { "general.defaultCurrency": 1 } });
  if (!settings) {
    throw new Error(
      "No settings document found — check MONGODB_URI / MONGODB_DB_NAME point at the store database",
    );
  }
  return String(settings?.general?.defaultCurrency || "USD").toUpperCase();
}

/** planId -> synced Stripe price currency, for plans that have one. */
async function loadPlanCurrencies(db) {
  const plans = await db
    .collection("vendorplans")
    .find({}, { projection: { stripePriceCurrency: 1 } })
    .toArray();
  const map = new Map();
  for (const plan of plans) {
    if (plan.stripePriceCurrency) {
      map.set(String(plan._id), String(plan.stripePriceCurrency).toUpperCase());
    }
  }
  return map;
}

async function backfill(db, { collectionName, filter, planCurrencies, storeCurrency }) {
  const collection = db.collection(collectionName);
  const rows = await collection
    .find(
      { ...filter, ...HAS_SNAPSHOT },
      { projection: { planId: 1, "planSnapshot.currency": 1 } },
    )
    .toArray();

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const target = planCurrencies.get(String(row.planId)) || storeCurrency;
    const current = String(row.planSnapshot?.currency || "").toUpperCase();
    if (!target || target === current) {
      skipped += 1;
      continue;
    }
    if (DRY_RUN) {
      console.log(
        `   [dry-run] ${collectionName} ${row._id}: ${current || "(unset)"} -> ${target}`,
      );
      updated += 1;
      continue;
    }
    await collection.updateOne(
      { _id: row._id },
      { $set: { "planSnapshot.currency": target } },
    );
    updated += 1;
  }

  console.log(
    `   ${collectionName}: ${rows.length} candidate(s), ${updated} ${
      DRY_RUN ? "would be " : ""
    }rewritten, ${skipped} already correct`,
  );
  return updated;
}

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      // Mirrors lib/db.ts: a URI without a path segment relies on this, and
      // without it the script would silently operate on the `test` database.
      ...(process.env.MONGODB_DB_NAME
        ? { dbName: process.env.MONGODB_DB_NAME }
        : {}),
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log("✓ Connected to MongoDB");

    const db = mongoose.connection.db;
    if (!db) {
      console.error("❌ Database connection not available");
      process.exit(1);
    }

    const storeCurrency = await resolveStoreCurrency(db);
    const planCurrencies = await loadPlanCurrencies(db);

    console.log(
      `\n💱 Subscription currency backfill${DRY_RUN ? " (DRY RUN)" : ""}...`,
    );
    console.log(`   database: ${db.databaseName}`);
    console.log(`   store default currency: ${storeCurrency}`);
    console.log(
      `   plans with a synced Stripe price currency: ${planCurrencies.size}\n`,
    );

    // Everything except a live Stripe subscription: the snapshot drives every
    // future renewal on the one-shot rail.
    const subscriptions = await backfill(db, {
      collectionName: "vendorsubscriptions",
      filter: { $nor: [LIVE_STRIPE] },
      planCurrencies,
      storeCurrency,
    });

    // Applications still awaiting payment. A paid one records what was
    // actually collected and must keep it.
    const applications = await backfill(db, {
      collectionName: "vendorapplications",
      filter: { paymentStatus: { $nin: ["paid", "refunded"] } },
      planCurrencies,
      storeCurrency,
    });

    console.log(
      `\n✅ Backfill ${
        DRY_RUN
          ? `dry-run complete — ${subscriptions + applications} row(s) would change (no writes made)`
          : `completed — ${subscriptions + applications} row(s) rewritten`
      }.\n`,
    );
  } catch (error) {
    console.error("\n❌ Currency backfill failed:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("✓ Disconnected from MongoDB");
  }
}

run()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
