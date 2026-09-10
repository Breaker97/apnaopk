import mongoose from "mongoose";

/**
 * Seeded-brand cleanup
 * ====================
 *
 * The demo seeder used to write this app's own name into fields that outrank
 * `general.storeName`, so a store renamed in Settings → General kept showing the
 * demo brand:
 *
 *   - `settings.seo.metaTitle` — the browser tab title, the `og:title` and the
 *     search-result headline for every page that does not set its own.
 *   - `settings.email.fromName` — the sender name on every outbound email.
 *   - `seo.pageTitle` on categories, collections, brands and blog posts — the
 *     tab title of each of those pages, seeded as "<name> - <brand>".
 *   - the seeded "Welcome to <brand>!" customer notification.
 *
 * The seeder no longer writes any of them, and the settings pair also repairs
 * itself on the next boot (`migrateSettings()`), so this script exists for the
 * content rows, which nothing else reaches. Running it is safe either way — it
 * only rewrites values that still match what the seeder shipped.
 *
 * Only the *app's* brand is touched. A title an admin wrote, and any title
 * carrying the store's own name, is left exactly as it is.
 *
 * Idempotent, and a no-op on a store that was never seeded.
 *
 * Usage:
 *   node --env-file=.env scripts/debrand-seeded-content.mjs            (apply)
 *   node --env-file=.env scripts/debrand-seeded-content.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

/** Must match DEFAULT_STORE_NAME in config/branding.config.ts. */
const APP_BRAND = "Storify";

/** Exactly what the seeder wrote into `settings.seo.metaTitle`. */
const SEEDED_META_TITLE = `${APP_BRAND} - Multi-vendor E-commerce`;

/** The suffix the seeder appended to every content page title. */
const SEEDED_TITLE_SUFFIX = ` - ${APP_BRAND}`;

const SEEDED_NOTIFICATION_TITLE = `Welcome to ${APP_BRAND}!`;

/** Collections whose documents carry an SEO page title. */
const CONTENT_COLLECTIONS = [
  "categories",
  "collections",
  "brands",
  "blogposts",
];

function log(message) {
  console.log(`${DRY_RUN ? "[dry-run] " : ""}${message}`);
}

async function debrandSettings(db, storeName) {
  const settings = db.collection("settings");
  const doc = await settings.findOne({});
  if (!doc) return;

  const updates = {};
  const metaTitle = (doc.seo?.metaTitle || "").trim();
  const fromName = (doc.email?.fromName || "").trim();

  // Cleared rather than rewritten to the store name: an empty field falls back
  // to `general.storeName` at render time, so it keeps tracking future renames.
  if (metaTitle === SEEDED_META_TITLE) updates["seo.metaTitle"] = "";
  if (fromName === APP_BRAND) updates["email.fromName"] = "";

  if (Object.keys(updates).length === 0) {
    log(`settings: nothing seeded left (store name "${storeName}")`);
    return;
  }

  if (!DRY_RUN) {
    await settings.updateOne({ _id: doc._id }, { $set: updates });
  }
  for (const field of Object.keys(updates)) {
    log(`settings: cleared ${field} — now derives from "${storeName}"`);
  }
}

async function debrandContentTitles(db) {
  for (const name of CONTENT_COLLECTIONS) {
    const collection = db.collection(name);
    const cursor = collection.find(
      { "seo.pageTitle": { $regex: `${SEEDED_TITLE_SUFFIX}$` } },
      { projection: { "seo.pageTitle": 1 } },
    );

    let updated = 0;
    for await (const doc of cursor) {
      const title = String(doc.seo.pageTitle);
      // The bare name. The layout's metadata template appends the live store
      // name, so nothing needs to be substituted in its place.
      const next = title.slice(0, -SEEDED_TITLE_SUFFIX.length).trim();
      if (!next) continue;
      if (!DRY_RUN) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { "seo.pageTitle": next } },
        );
      }
      updated += 1;
    }
    log(`${name}: ${updated} page title${updated === 1 ? "" : "s"} debranded`);
  }
}

async function debrandNotifications(db, storeName) {
  const notifications = db.collection("notifications");
  const filter = { title: SEEDED_NOTIFICATION_TITLE };
  const count = await notifications.countDocuments(filter);
  if (count && !DRY_RUN) {
    await notifications.updateMany(filter, {
      $set: { title: `Welcome to ${storeName}!` },
    });
  }
  log(`notifications: ${count} seeded welcome message${count === 1 ? "" : "s"} retitled`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  log(`connected to ${db.databaseName}`);

  const settings = await db.collection("settings").findOne({});
  const storeName = (settings?.general?.storeName || "").trim() || APP_BRAND;

  await debrandSettings(db, storeName);
  await debrandContentTitles(db);
  await debrandNotifications(db, storeName);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Seeded-brand cleanup failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
