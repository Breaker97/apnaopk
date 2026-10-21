import mongoose from "mongoose";
import { planAiWidgetThemeRefs } from "./lib/ai-widget-theme-refs.mjs";

/**
 * AI widget theme colours migration
 * ==================================
 *
 * In 3.1 the AI sales widget follows Theme settings → Colors: a new store's
 * chat button and header take the theme's primary. A widget saved before 3.1
 * holds the purple it shipped with (#7c3aed → #a855f7), so it stayed purple
 * whatever the store's colours were.
 *
 * This converts only an untouched widget — both colours still that purple —
 * to `var(--theme-primary)`. A widget whose colours a merchant changed is
 * left exactly as it is. Each write filters on the old values, so an edit
 * made in the admin while this runs is never overwritten; re-running finds
 * nothing to do.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-ai-widget-theme-colors.mjs            (apply)
 *   node --env-file=.env scripts/migrate-ai-widget-theme-colors.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function convert(db) {
  const settings = db.collection("settings");
  const docs = await settings
    .find({ "aiSalesAgent.widget": { $exists: true } }, { projection: { "aiSalesAgent.widget": 1 } })
    .toArray();

  let widgets = 0;
  let written = 0;
  for (const doc of docs) {
    const changes = planAiWidgetThemeRefs(doc.aiSalesAgent?.widget);
    if (changes.length === 0) continue;
    widgets++;
    console.log(`   • settings ${doc._id}:`);
    for (const change of changes) console.log(`       ${change.path}: ${change.from} → ${change.to}`);
    if (DRY_RUN) continue;

    const filter = { _id: doc._id };
    const $set = {};
    for (const change of changes) {
      filter[change.path] = change.from;
      $set[change.path] = change.to;
    }
    const result = await settings.updateOne(filter, { $set });
    if (result.modifiedCount === 1) written++;
    else console.log("       ! changed while this ran — left as it is; run again to retry");
  }

  if (widgets === 0) {
    console.log("   ✓ nothing to convert: no widget still wears the shipped purple");
  } else if (DRY_RUN) {
    console.log(`   → dry run: ${widgets} widget(s) would follow the theme; writing nothing`);
  } else {
    console.log(`   ✓ ${written} settings document(s) updated`);
  }
}

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

    console.log(`\n💬 AI widget theme colours migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`);
    await convert(db);
    console.log("\n✅ Done");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
