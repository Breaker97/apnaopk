import mongoose from "mongoose";
import { planHeaderThemeRefs } from "./lib/header-theme-refs.mjs";

/**
 * Header theme colours migration
 * ===============================
 *
 * In 3.1 a header colour can follow Theme settings → Colors. New headers use
 * the theme's primary for the "All Categories" button, the "Tinted sidebar"
 * category panel and the "Banner nav" strip, so they change with the brand.
 * A header saved before 3.1 holds those surfaces as fixed hex, so picking a
 * new brand colour left them blue.
 *
 * This converts only the untouched defaults: a surface still painted one of
 * the blues the header shipped with (#3b6ff5, #366FFF, #2065d1) becomes
 * `var(--theme-primary)`, and its default white text is dropped so the label
 * and icon take the primary's own readable colour. Any other colour a
 * merchant chose is left exactly as it is, and so is a non-white text colour.
 *
 * Each document is written with its old values in the filter, so an edit made
 * in Header Studio while this runs is never overwritten. Re-running finds
 * nothing to do.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-header-theme-colors.mjs            (apply)
 *   node --env-file=.env scripts/migrate-header-theme-colors.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

async function convert(db) {
  const settings = db.collection("settings");
  const docs = await settings
    .find({ "header.builder.rows.0": { $exists: true } }, { projection: { "header.builder": 1 } })
    .toArray();

  let surfaces = 0;
  let written = 0;
  for (const doc of docs) {
    const changes = planHeaderThemeRefs(doc.header?.builder);
    if (changes.length === 0) continue;

    console.log(`   • settings ${doc._id}:`);
    for (const change of changes) {
      const what = change.unset ? "inherit (readable on the primary)" : change.to;
      console.log(`       ${change.path}: ${change.from} → ${what}`);
    }
    surfaces += changes.filter((change) => change.to).length;
    if (DRY_RUN) continue;

    const filter = { _id: doc._id };
    const $set = {};
    const $unset = {};
    for (const change of changes) {
      filter[change.path] = change.from;
      if (change.unset) $unset[change.path] = "";
      else $set[change.path] = change.to;
    }
    const update = { $set, ...(Object.keys($unset).length ? { $unset } : {}) };
    const result = await settings.updateOne(filter, update);
    if (result.modifiedCount === 1) written++;
    else console.log("       ! changed while this ran — left as it is; run again to retry");
  }

  if (surfaces === 0) {
    console.log("   ✓ nothing to convert: no header surface still holds a shipped blue");
  } else if (DRY_RUN) {
    console.log(`   → dry run: ${surfaces} surface(s) would follow the theme; writing nothing`);
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

    console.log(`\n🎨 Header theme colours migration${DRY_RUN ? " (DRY RUN)" : ""}...\n`);
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
