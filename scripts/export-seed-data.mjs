import path from "path";
import { mkdirSync, writeFileSync } from "fs";
import { MongoClient, BSON } from "mongodb";
import { auditSnapshot } from "./seed-audit.mjs";
import {
  parseTemplateArg,
  resolveSeedTemplate,
  SEED_DATA_ROOT,
} from "./seed-templates.mjs";

/**
 * Export one template's live demo store into `scripts/seed-data/<template>/`.
 *
 * Each template in the gallery has its own demo database — Electronics sells
 * phones out of five tech vendors, Classic sells a general marketplace — and
 * its own snapshot directory, because the storefront a theme ships is designed
 * around the catalog beneath it. `scripts/seed.mjs` seeds a fresh install from
 * one of these, and the install wizard's "sample data" tick imports the
 * chosen template's, so a buyer's first storefront looks like the demo they
 * picked instead of a generic placeholder catalog.
 *
 * The export is READ-ONLY on the source database and refuses to write a
 * snapshot it cannot vouch for: `scripts/seed-audit.mjs` repairs what a live
 * store accumulates (a deleted vendor's inventory locations, a second store
 * carrying `isDefault`, sliders no section binds, abandoned landing pages,
 * price ranges left stale by a `findOneAndUpdate` write) and reports every
 * change. Faults it will not paper over stop the export.
 *
 * What is deliberately NOT exported:
 * - Customers, users, sessions, orders, carts, payments, ledgers — real
 *   operational data and PII. The seed generates its own demo accounts
 *   and orders.
 * - Credentials of any kind: payment gateways, SMTP, storage, OAuth,
 *   analytics and AI keys, vendor bank details, Stripe references.
 * - Store-page version history (heavy, and meaningless on a fresh install).
 *
 * Media note: image URLs are exported as-is, so seeded installs render the
 * demo catalog from the same public bucket the live store uses.
 *
 * Usage: pnpm db:seed:export [--template=<id>]
 *        (reads MONGODB_URI / MONGODB_DB_NAME; the template defaults to the
 *        source store's own active theme)
 */

/** The house-store slug — mirrors `appConfig.defaultVendorSlug`. */
const DEFAULT_VENDOR_SLUG = "main-store";

/** Key names that must never appear in a snapshot (checked after sanitizing). */
const SENSITIVE_KEY_PATTERN =
  /secret|password|token|api[_-]?key|apikey|credential|privatekey/i;
/** Keys the pattern matches that are known-safe (not credentials). */
const SENSITIVE_KEY_ALLOWLIST = new Set([
  "serviceTokenAllowList", // Shippo service-level identifiers, not credentials
  "courierIdAllowList",
  "monthlyTokenBudget", // AI sales agent usage cap — a number, not a credential
]);

function stripKeys(doc, keys) {
  for (const key of keys) delete doc[key];
  return doc;
}

function hasContent(value) {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/** Collect object key paths that look like filled-in credentials so a future
 * schema change can't silently leak one into a committed snapshot. Emptied
 * fields (e.g. a blanked token) are fine — only non-empty values flag. */
function findSensitiveKeys(value, basePath, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, i) =>
      findSensitiveKeys(entry, `${basePath}[${i}]`, out),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const keyPath = basePath ? `${basePath}.${key}` : key;
    if (
      SENSITIVE_KEY_PATTERN.test(key) &&
      !SENSITIVE_KEY_ALLOWLIST.has(key) &&
      hasContent(child)
    ) {
      out.push(keyPath);
    }
    findSensitiveKeys(child, keyPath, out);
  }
}

async function exportSeedData() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "storify";

  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  console.log(`✓ Connected to ${db.databaseName} (read-only export)`);

  const settings = await db.collection("settings").findOne({});
  if (!settings) {
    console.error("❌ No settings document found — is this the right database?");
    process.exit(1);
  }

  // Which template this store dresses. Named explicitly, or taken from the
  // store's own active theme — the snapshot and the theme it was designed
  // against must not be able to drift apart by accident.
  const requested = parseTemplateArg();
  const activeTheme = settings.onlineStore?.activeTheme;
  if (!requested && !activeTheme) {
    console.error(
      "❌ This store has no active theme, so the target template is unknown.\n" +
        "   Pass one explicitly: pnpm db:seed:export --template=<id>",
    );
    process.exit(1);
  }
  const template = resolveSeedTemplate(requested || activeTheme, {
    // The exporter CREATES the directory, so a template's first export must
    // not be refused for not existing yet.
    mustExist: false,
  });
  if (requested && activeTheme && requested !== activeTheme) {
    console.warn(
      `⚠️  Exporting as "${requested}" from a store whose active theme is "${activeTheme}".`,
    );
  }
  console.log(`✓ Template: ${template.id} → ${path.relative(process.cwd(), template.dir)}`);

  // The live store's own absolute URLs become relative links on export so
  // snapshots never point a fresh install back at the demo domain.
  const storeDomain = (settings.general?.storeDomain || "").replace(/\/+$/, "");

  // ---- Read ------------------------------------------------------------
  // Vendors: approved only; demo user accounts are created at seed time.
  const vendors = await db
    .collection("vendors")
    .find({ status: "approved" })
    .sort({ createdAt: 1 })
    .toArray();
  for (const vendor of vendors) {
    stripKeys(vendor, ["userId", "bankDetails", "stripeCustomerId", "planId"]);
  }

  const locations = await db.collection("inventorylocations").find({}).toArray();
  const categories = await db
    .collection("categories")
    .find({})
    .sort({ order: 1, name: 1 })
    .toArray();
  const brands = await db.collection("brands").find({}).sort({ order: 1 }).toArray();
  const globalVariants = await db
    .collection("globalvariants")
    .find({})
    .sort({ position: 1 })
    .toArray();
  const products = await db
    .collection("products")
    .find({ status: "active" })
    .sort({ createdAt: 1 })
    .toArray();
  for (const product of products) {
    // Derived again on seed through the app's own builder; a snapshot must
    // never carry a search index computed by an older rule.
    stripKeys(product, ["search"]);
  }
  const collections = await db
    .collection("collections")
    .find({})
    .sort({ position: 1 })
    .toArray();
  const menus = await db.collection("menus").find({}).toArray();
  const sliders = await db.collection("sliders").find({}).toArray();
  const storePages = await db.collection("storepages").find({}).toArray();
  // Only the discounts the storefront advertises survive the audit below,
  // but they must be read here: a `coupon-banner` naming a code no coupon
  // defines offers the shopper something checkout will reject.
  const coupons = await db.collection("coupons").find({}).toArray();
  for (const coupon of coupons) {
    stripKeys(coupon, ["createdBy", "usedBy"]);
  }
  const blogCategories = await db.collection("blogcategories").find({}).toArray();
  const blogPosts = await db.collection("blogposts").find({}).toArray();
  for (const post of blogPosts) {
    // Authorship is stamped with the seeded admin at import time.
    stripKeys(post, ["password", "authorId", "authorName"]);
  }
  const vendorPlans = await db
    .collection("vendorplans")
    .find({})
    .sort({ sortOrder: 1 })
    .toArray();
  for (const plan of vendorPlans) {
    stripKeys(plan, [
      "createdBy",
      "stripePriceId",
      "stripeProductId",
      "stripePriceActive",
      "stripePriceCurrency",
      "stripeSyncedAt",
    ]);
  }
  const onboardingTemplate = await db
    .collection("onboardingtemplates")
    .findOne({ key: "default" });
  if (onboardingTemplate) stripKeys(onboardingTemplate, ["updatedBy"]);

  await client.close();

  // ---- Audit: repair what a live store accumulates ----------------------
  const { data, repairs, errors } = auditSnapshot(
    {
      vendors,
      locations,
      categories,
      brands,
      globalVariants,
      products,
      collections,
      menus,
      sliders,
      storePages,
      coupons,
      blogCategories,
      blogPosts,
      vendorPlans,
    },
    { defaultVendorSlug: DEFAULT_VENDOR_SLUG },
  );

  if (repairs.length > 0) {
    console.log(`\n🔧 Repaired ${repairs.length} issue(s) on the way out:`);
    for (const repair of repairs) console.log(`   • ${repair}`);
  }
  if (errors.length > 0) {
    console.error("\n❌ The source store has faults the export will not hide:");
    for (const error of errors) console.error(`   - ${error}`);
    console.error("\n   Nothing was written. Fix the store and re-run.");
    process.exit(1);
  }

  const files = new Map([
    ["vendors.json", data.vendors],
    ["inventory-locations.json", data.locations],
    ["categories.json", data.categories],
    ["brands.json", data.brands],
    ["global-variants.json", data.globalVariants],
    ["products.json", data.products],
    ["collections.json", data.collections],
    ["menus.json", data.menus],
    ["sliders.json", data.sliders],
    ["store-pages.json", data.storePages],
    ["coupons.json", data.coupons],
    ["blog-categories.json", data.blogCategories],
    ["blog-posts.json", data.blogPosts],
    ["vendor-plans.json", data.vendorPlans],
    ["onboarding-template.json", onboardingTemplate ? [onboardingTemplate] : []],
  ]);

  // ---- Settings: presentation/config sections only, never credentials. ----
  // Excluded on purpose: payment, email, storage, security, analytics — the
  // seed's own safe defaults apply and each install configures its own.
  const SETTINGS_SECTIONS = [
    "general",
    "appearance",
    "orders",
    "shipping",
    "social",
    "maintenance",
    "pos",
    "multiVendorMode",
    "aiSalesAgent",
    "aiAuthoring",
    "homePage",
    "contentPages",
    "header",
    "footer",
    "vendorConfig",
    "boosting",
    "onlineStore",
    "checkout",
    // The out-of-stock display rule is edited on the Product card studio and
    // stored here; without it a seeded store silently reverts to the schema
    // default and its grids order differently from the demo.
    "catalog",
    "productCard",
    "notifications",
  ];
  const settingsSnapshot = {};
  for (const section of SETTINGS_SECTIONS) {
    if (settings[section] !== undefined) {
      settingsSnapshot[section] = settings[section];
    }
  }
  // The snapshot dresses ONE template, so it states which — a store seeded
  // from it must not come up wearing whatever theme the source last previewed.
  settingsSnapshot.onlineStore = {
    ...(settingsSnapshot.onlineStore ?? {}),
    activeTheme: template.id,
  };
  // Feature config survives, but anything needing an API key ships disabled —
  // a fresh install turns them back on after adding its own keys.
  if (settingsSnapshot.aiSalesAgent) settingsSnapshot.aiSalesAgent.enabled = false;
  if (settingsSnapshot.aiAuthoring) {
    delete settingsSnapshot.aiAuthoring.apiKey;
    settingsSnapshot.aiAuthoring.enabled = false;
  }
  const shippo = settingsSnapshot.shipping?.carriers?.shippo;
  if (shippo) {
    shippo.testToken = "";
    shippo.enabled = false;
  }
  files.set("settings.json", settingsSnapshot);

  // ---- Sanitize sweep, domain rewrite, write ----
  mkdirSync(template.dir, { recursive: true });

  const sensitive = [];
  const counts = {};
  console.log("");
  for (const [filename, payload] of files) {
    findSensitiveKeys(payload, filename.replace(/\.json$/, ""), sensitive);

    let text = BSON.EJSON.stringify(payload, undefined, 2, { relaxed: true });
    if (storeDomain) {
      text = text.split(storeDomain).join("");
    }
    writeFileSync(path.join(template.dir, filename), text + "\n");
    counts[filename] = Array.isArray(payload) ? payload.length : 1;
    console.log(
      `   ✓ ${filename} (${counts[filename]} ${Array.isArray(payload) ? "docs" : "doc"})`,
    );
  }

  if (sensitive.length > 0) {
    console.error(
      "\n❌ Credential-looking keys made it into the snapshot — fix the export rules for:",
    );
    for (const keyPath of sensitive) console.error(`   - ${keyPath}`);
    process.exit(1);
  }

  writeFileSync(
    path.join(template.dir, "manifest.json"),
    JSON.stringify(
      {
        template: template.id,
        exportedAt: new Date().toISOString(),
        sourceDb: MONGODB_DB_NAME,
        counts,
        repairs,
      },
      undefined,
      2,
    ) + "\n",
  );

  console.log(`\n✅ Snapshot written to ${template.dir}`);
  console.log(
    `   Review the diff (git diff ${path.relative(process.cwd(), SEED_DATA_ROOT)}) before committing.`,
  );
}

exportSeedData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Export failed:", error);
    process.exit(1);
  });
