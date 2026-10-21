/**
 * `pnpm db:migrate demo-sync --template=<id>`: bring a DEMO store up to date
 * with its template's committed snapshot (`scripts/seed-data/<id>/`) and keep
 * its accounts, orders and credentials.
 *
 *   pnpm db:migrate demo-sync --template=electronics --dry-run   report only
 *   pnpm db:migrate demo-sync --template=electronics             apply
 *   pnpm db:migrate demo-sync --template=electronics --prune     …and retire
 *                                         what the snapshot no longer has
 *
 * Why it exists: `pnpm db:seed` never updates. Each step skips a collection
 * that already has data, so a demo seeded from last month's snapshot keeps
 * last month's catalog until it is wiped, and `db:full-reset` wipes the
 * demo's accounts and orders along with it.
 *
 * What it writes, matched by `_id` (store pages by key, vendor pages by
 * vendor, coupons by code, the onboarding template by key):
 * - catalog: vendors (only ones the store already has — a new vendor needs a
 *   login), inventory locations, categories, brands, global variants,
 *   products, collections, menus, sliders, blog, vendor plans, the
 *   onboarding template;
 * - storefront: store pages and vendor pages, and the coupons they
 *   advertise. A replaced live version goes into the page's history, so the
 *   builder can roll it back;
 * - settings: the sections the export ships, merged over the store's own.
 *
 * What it never touches: users, accounts and sessions; orders, payments and
 * the ledger; reviews and wishlists; credentials of any kind; and the
 * per-store fields of the documents it does write — a vendor's login and bank
 * details, a product's rating from the store's own reviews, a coupon's usage,
 * a plan's Stripe price, a switch that only works with the store's own keys.
 *
 * It refuses, before writing anything:
 * - a store not seeded from this template (its house store is not the
 *   snapshot's);
 * - a store wearing another theme (unless --force);
 * - a store with an inventory ledger (`pnpm inventory:cutover` has run).
 *   Stock there moves only with movement evidence, and a script cannot
 *   invent evidence for a catalog it overwrites;
 * - a plan that would replace documents the store changed AFTER the snapshot
 *   was exported (unless --overwrite-newer). Synced back onto its own source
 *   store, a snapshot would otherwise quietly revert every edit made since.
 *
 * Run it with --dry-run first, and take a backup before applying.
 */

import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { rebaseCountdownSections } from "@/lib/install/countdown-window";
import { buildBarcodeRegistryEntries } from "@/lib/products/barcode-registry";
import { backfillProductSearchIndex } from "@/lib/products/search-index";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import { isVendorPageSectionType } from "@/lib/vendors/vendor-store-page";
import {
  STORE_PAGE_HISTORY_LIMIT,
  buildStorePageIdentity,
} from "@/models/store-page.model";
import { VENDOR_STORE_PAGE_HISTORY_LIMIT } from "@/models/vendor-store-page.model";
import {
  changedAfterExport,
  couponWindow,
  keepRunningCountdowns,
  mergeSettingsSection,
  planDocument,
  pushHistory,
  stableStringify,
} from "./lib/demo-sync.mjs";
import {
  parseTemplateArg,
  readSnapshotFile,
  resolveSeedTemplate,
} from "./seed-templates.mjs";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const PRUNE = argv.includes("--prune");
const FORCE = argv.includes("--force");
const OVERWRITE_NEWER = argv.includes("--overwrite-newer");

/**
 * Settings the store keeps even though the snapshot has them: per-deployment
 * values, and switches the export turns off because the keys they need are
 * not exported. Credential-shaped keys are kept by pattern on top of these.
 */
const KEEP_STORE_SETTINGS = [
  "general.storeDomain",
  "maintenance.enabled",
  "aiSalesAgent.enabled",
  "aiAuthoring.enabled",
  /^shipping\.carriers\.[^.]+\.enabled$/,
];
/** The export's own credential pattern (scripts/export-seed-data.mjs). */
const SENSITIVE_KEY_PATTERN =
  /secret|password|token|api[_-]?key|apikey|credential|privatekey/i;

const now = new Date();
let sections = [];
let failures = 0;
/**
 * The sync runs twice: a planning pass that writes nothing, then the writing
 * pass. The first finds documents the store changed after the export, so the
 * sync can stop before it has written anything.
 */
let writing = false;
/** Documents the store changed after the snapshot was exported. */
const newer = [];
let snapshotExportedAt = null;

function noteNewer(title, label, store) {
  if (!writing && changedAfterExport(store, snapshotExportedAt)) {
    newer.push(`${title}: ${label}`);
  }
}

function section(title) {
  const entry = { title, counts: {}, lines: [], extras: [] };
  sections.push(entry);
  return entry;
}

function count(entry, key) {
  entry.counts[key] = (entry.counts[key] ?? 0) + 1;
}

async function write(entry, label, run) {
  if (!writing) return true;
  try {
    await run();
    return true;
  } catch (error) {
    failures += 1;
    count(entry, "failed");
    entry.lines.push(`! ${label}: ${error.message}`);
    return false;
  }
}

/**
 * Sync one snapshot collection whose documents are written whole.
 * `transform` adjusts a snapshot document against the store's copy before
 * planning; `skip` names a reason to leave one out.
 */
async function syncCollection(db, {
  title,
  collection,
  docs,
  preserve = [],
  derived = [],
  match = (doc) => ({ _id: doc._id }),
  label = (doc) => doc.name ?? doc.title ?? doc.slug ?? String(doc._id),
  transform,
  skip,
  onInsert,
  afterPlan,
  onWritten,
}) {
  const entry = section(title);
  const coll = db.collection(collection);
  const seen = [];
  const pending = [];

  for (const raw of docs) {
    const store = await coll.findOne(match(raw));
    if (store) seen.push(store._id);
    const reason = skip?.(raw, store);
    if (reason) {
      count(entry, "skipped");
      entry.lines.push(`- ${label(raw)}: ${reason}`);
      continue;
    }
    const doc = transform ? transform(raw, store) : raw;
    let plan = planDocument(doc, store, { preserve, derived, now });
    if (plan.action === "insert" && onInsert) plan = { ...plan, doc: onInsert(plan.doc) };
    if (afterPlan) plan = afterPlan(plan, store);
    if (plan.action === "same") {
      count(entry, "unchanged");
      continue;
    }
    if (plan.action === "update") noteNewer(title, label(raw), store);
    pending.push({ raw, store, plan });
  }

  const done = ({ raw, plan }) => {
    count(entry, plan.action === "insert" ? "new" : "updated");
    entry.lines.push(
      plan.action === "insert"
        ? `+ ${label(raw)}`
        : `~ ${label(raw)} (${plan.changed.join(", ")})`,
    );
    onWritten?.(plan.doc);
  };

  if (!writing) {
    pending.forEach(done);
  } else {
    // Renames can swap a unique value between two documents: "Mobile
    // Phones" becomes "Phones" (slug phones) while the old "Phones" becomes
    // "iPhones". Whichever is written first collides with the other's old
    // slug, so a duplicate-key write is retried once the rest have landed,
    // for as long as each pass makes progress.
    let queue = pending;
    const lastError = new Map();
    while (queue.length > 0) {
      const retry = [];
      for (const item of queue) {
        try {
          await (item.plan.action === "insert"
            ? coll.insertOne(item.plan.doc)
            : coll.replaceOne({ _id: item.store._id }, item.plan.doc));
          done(item);
        } catch (error) {
          if (error?.code !== 11000) throw error;
          lastError.set(item, error);
          retry.push(item);
        }
      }
      if (retry.length === queue.length) {
        for (const item of retry) {
          failures += 1;
          count(entry, "failed");
          entry.lines.push(`! ${label(item.raw)}: ${lastError.get(item).message}`);
        }
        break;
      }
      queue = retry;
    }
  }

  const extras = await coll
    .find({ _id: { $nin: [...seen, ...docs.map((doc) => doc._id)] } })
    .toArray();
  entry.extras = extras;
  return { entry, extras };
}

/** A storefront page's sections as they would be imported now. */
function importedSections(raw, storeSections, exportedAt, { vendorPage = false } = {}) {
  const sectionsNow = sanitizeSectionInstances(
    keepRunningCountdowns(
      rebaseCountdownSections(Array.isArray(raw) ? raw : [], exportedAt, now),
      storeSections,
      now,
    ),
  );
  return vendorPage
    ? sectionsNow.filter((s) => isVendorPageSectionType(s.type))
    : sectionsNow;
}

const sameSections = (a, b) =>
  stableStringify(a == null ? null : sanitizeSectionInstances(a)) ===
  stableStringify(b == null ? null : sanitizeSectionInstances(b));

async function syncStorePages(db, pages, exportedAt) {
  const entry = section("store pages");
  const coll = db.collection("storepages");
  for (const page of pages) {
    const store = await coll.findOne({ key: page.key });
    const draft = importedSections(page.draft?.sections, store?.draft?.sections, exportedAt);
    const published = page.published
      ? importedSections(page.published.sections, store?.published?.sections, exportedAt)
      : null;

    if (!store) {
      const ok = await write(entry, page.key, () =>
        coll.insertOne({
          ...buildStorePageIdentity(page.key),
          title: page.title,
          draft: { sections: draft, updatedAt: now, updatedBy: null },
          published: published
            ? { sections: published, publishedAt: now, publishedBy: null }
            : null,
          history: [],
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (ok) {
        count(entry, "new");
        entry.lines.push(`+ ${page.key}`);
      }
      continue;
    }

    const draftSame = sameSections(store.draft?.sections ?? [], draft);
    const publishedSame = sameSections(store.published?.sections ?? null, published);
    if (draftSame && publishedSame && store.title === page.title) {
      count(entry, "unchanged");
      continue;
    }
    noteNewer("store pages", page.key, store);
    const ok = await write(entry, page.key, () =>
      coll.updateOne(
        { _id: store._id },
        {
          $set: {
            ...buildStorePageIdentity(page.key),
            title: page.title,
            draft: {
              sections: draft,
              updatedAt: now,
              updatedBy: store.draft?.updatedBy ?? null,
            },
            published: published
              ? {
                  sections: published,
                  publishedAt: now,
                  publishedBy: store.published?.publishedBy ?? null,
                }
              : null,
            history: pushHistory(
              store.history,
              publishedSame ? null : store.published,
              STORE_PAGE_HISTORY_LIMIT,
            ),
            updatedAt: now,
          },
        },
      ),
    );
    if (ok) {
      count(entry, "updated");
      const parts = [
        draftSame ? null : "draft",
        publishedSame ? null : "published (previous kept in history)",
        store.title === page.title ? null : "title",
      ].filter(Boolean);
      entry.lines.push(`~ ${page.key} (${parts.join(", ")})`);
    }
  }
  entry.extras = await coll
    .find({ key: { $nin: pages.map((page) => page.key) } })
    .toArray();
  return entry;
}

async function syncVendorPages(db, pages, exportedAt, storeVendorIds) {
  const entry = section("vendor pages");
  const coll = db.collection("vendorstorepages");
  for (const page of pages) {
    const label = `vendor ${page.vendorId}`;
    if (!storeVendorIds.has(String(page.vendorId))) {
      count(entry, "skipped");
      entry.lines.push(`- ${label}: that vendor is not in this store`);
      continue;
    }
    const store = await coll.findOne({ vendorId: page.vendorId });
    const owner = (await db.collection("vendors").findOne({ _id: page.vendorId }))?.userId;
    const draft = importedSections(page.draft?.sections, store?.draft?.sections, exportedAt, { vendorPage: true });
    const published = page.published
      ? importedSections(page.published.sections, store?.published?.sections, exportedAt, { vendorPage: true })
      : null;
    const by = owner ? String(owner) : null;

    if (!store) {
      const ok = await write(entry, label, () =>
        coll.insertOne({
          vendorId: page.vendorId,
          draft: { sections: draft, updatedAt: now, updatedBy: by },
          published: published ? { sections: published, publishedAt: now, publishedBy: by } : null,
          history: [],
          settings: page.settings ?? {},
          takedown: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (ok) {
        count(entry, "new");
        entry.lines.push(`+ ${label}`);
      }
      continue;
    }

    const draftSame = sameSections(store.draft?.sections ?? [], draft);
    const publishedSame = sameSections(store.published?.sections ?? null, published);
    const settingsSame =
      stableStringify(store.settings ?? {}) === stableStringify(page.settings ?? {});
    if (draftSame && publishedSame && settingsSame) {
      count(entry, "unchanged");
      continue;
    }
    noteNewer("vendor pages", label, store);
    const ok = await write(entry, label, () =>
      coll.updateOne(
        { _id: store._id },
        {
          $set: {
            draft: { sections: draft, updatedAt: now, updatedBy: store.draft?.updatedBy ?? by },
            published: published
              ? { sections: published, publishedAt: now, publishedBy: store.published?.publishedBy ?? by }
              : null,
            settings: page.settings ?? {},
            history: pushHistory(
              store.history,
              publishedSame ? null : store.published,
              VENDOR_STORE_PAGE_HISTORY_LIMIT,
            ),
            updatedAt: now,
          },
        },
      ),
    );
    if (ok) {
      count(entry, "updated");
      entry.lines.push(`~ ${label}`);
    }
  }
  return entry;
}

async function syncSettings(db, snapshotSettings) {
  const entry = section("settings");
  const store = await db.collection("settings").findOne({});
  const set = {};
  const kept = [];
  for (const [name, value] of Object.entries(snapshotSettings)) {
    const merged = mergeSettingsSection(store[name], value, {
      keep: KEEP_STORE_SETTINGS,
      sensitive: SENSITIVE_KEY_PATTERN,
      path: name,
    });
    kept.push(...merged.kept);
    if (stableStringify(merged.section) === stableStringify(store[name] ?? null)) {
      count(entry, "unchanged");
      continue;
    }
    set[name] = merged.section;
    count(entry, "updated");
    entry.lines.push(`~ ${name}`);
  }
  if (kept.length > 0) {
    entry.lines.push(`= kept the store's own: ${kept.join(", ")}`);
  }
  if (Object.keys(set).length > 0) {
    noteNewer("settings", Object.keys(set).join(", "), store);
    await write(entry, "settings", () =>
      db.collection("settings").updateOne({ _id: store._id }, { $set: { ...set, updatedAt: now } }),
    );
  }
  return entry;
}

/** Re-register the barcodes of every product the sync wrote. */
async function rebuildBarcodes(db, products) {
  if (products.length === 0) return { registered: 0, conflicts: [] };
  const registry = db.collection("barcoderegistries");
  await registry.deleteMany({ productId: { $in: products.map((p) => p._id) } });
  const rows = products.flatMap((product) =>
    buildBarcodeRegistryEntries(product).map((row) => ({
      ...row,
      productId: product._id,
      active: true,
      createdAt: now,
      updatedAt: now,
    })),
  );
  if (rows.length === 0) return { registered: 0, conflicts: [] };
  try {
    const result = await registry.insertMany(rows, { ordered: false });
    return { registered: result.insertedCount, conflicts: [] };
  } catch (error) {
    // A code another product of this store already holds: reported, the
    // product keeps working, and the admin form will name the clash on save.
    const conflicts = (error.writeErrors ?? []).map(
      (w) => rows[w.index]?.valueNormalized ?? "?",
    );
    if (conflicts.length === 0) throw error;
    return { registered: rows.length - conflicts.length, conflicts };
  }
}

function printReport() {
  const width = Math.max(...sections.map((s) => s.title.length));
  console.log("");
  for (const entry of sections) {
    const counts = Object.entries(entry.counts)
      .map(([key, value]) => `${value} ${key}`)
      .join(" · ");
    console.log(`${entry.title.padEnd(width)}  ${counts || "nothing to do"}`);
    for (const line of entry.lines.slice(0, 25)) console.log(`${" ".repeat(width)}    ${line}`);
    if (entry.lines.length > 25) {
      console.log(`${" ".repeat(width)}    … and ${entry.lines.length - 25} more`);
    }
    if (entry.extras.length > 0 && entry.extrasNote) {
      console.log(`${" ".repeat(width)}    ${entry.extrasNote}`);
    }
  }
}

function printNewer(exportedAt) {
  if (newer.length === 0) return;
  console.warn(
    `\n⚠️  Changed in this store after the snapshot was exported (${exportedAt}). The sync would replace these edits:`,
  );
  for (const line of newer.slice(0, 40)) console.warn(`   • ${line}`);
  if (newer.length > 40) console.warn(`   … and ${newer.length - 40} more`);
  console.warn(
    "   Re-export the snapshot first if they should stay, or apply with --overwrite-newer.",
  );
}

async function main() {
  const templateId = parseTemplateArg(argv);
  if (!templateId) {
    console.error(
      "❌ Name the template this demo store dresses: --template=<id>\n" +
        "   e.g. pnpm db:migrate demo-sync --template=electronics --dry-run",
    );
    return 1;
  }
  const template = resolveSeedTemplate(templateId);
  const read = (name, optional = false) =>
    readSnapshotFile(template.dir, name, { optional }) ?? [];
  const snapshot = {
    vendors: read("vendors"),
    locations: read("inventory-locations"),
    categories: read("categories"),
    brands: read("brands"),
    globalVariants: read("global-variants"),
    products: read("products"),
    collections: read("collections"),
    menus: read("menus"),
    sliders: read("sliders"),
    storePages: read("store-pages"),
    vendorStorePages: read("vendor-store-pages", true),
    coupons: read("coupons", true),
    blogCategories: read("blog-categories"),
    blogPosts: read("blog-posts"),
    vendorPlans: read("vendor-plans", true),
    onboarding: read("onboarding-template", true),
    settings: readSnapshotFile(template.dir, "settings"),
  };
  const exportedAt = readSnapshotFile(template.dir, "manifest", { optional: true })?.exportedAt;

  await connectDB();
  const db = mongoose.connection.db;
  console.log(
    `✓ Connected to ${db.databaseName}${DRY_RUN ? " (dry run — nothing is written)" : ""}`,
  );
  console.log(`✓ Template: ${template.id}, snapshot exported ${exportedAt ?? "(unknown)"}`);

  // ---- Guards ----------------------------------------------------------
  const house = snapshot.vendors.find((vendor) => vendor.isDefault === true);
  const storeHouse = house
    ? await db.collection("vendors").findOne({ _id: house._id }, { projection: { _id: 1 } })
    : null;
  if (!storeHouse) {
    console.error(
      `\n❌ This store was not seeded from the "${template.id}" snapshot: its house store ` +
        `(${house?.slug ?? "?"}, ${house?._id ?? "?"}) is not here. A sync would pour a demo ` +
        "catalog into an unrelated store, so nothing was written.\n" +
        `   For a new demo store, seed an empty database: pnpm db:seed --template=${template.id}`,
    );
    return 1;
  }
  const settings = await db.collection("settings").findOne({});
  if (!settings) {
    console.error("\n❌ This store has no settings document. Nothing was written.");
    return 1;
  }
  const activeTheme = settings.onlineStore?.activeTheme;
  if (activeTheme && activeTheme !== template.id && !FORCE) {
    console.error(
      `\n❌ This store wears the "${activeTheme}" theme, not "${template.id}". ` +
        "Nothing was written. Pass --force if you mean to re-dress it.",
    );
    return 1;
  }
  const ledgerRows =
    (await db.collection("inventorypositions").estimatedDocumentCount()) +
    (await db.collection("inventorymovements").estimatedDocumentCount());
  if (ledgerRows > 0) {
    console.error(
      "\n❌ This store keeps an inventory ledger (pnpm inventory:cutover has run). Product stock " +
        "there moves only with movement evidence, which a sync cannot create for a catalog it " +
        "overwrites. Nothing was written. Rebuild the demo instead: pnpm db:full-reset " +
        `--template=${template.id}`,
    );
    return 1;
  }

  const admin = await db
    .collection("user")
    .find({ $or: [{ role: "admin" }, { roles: "admin" }] })
    .sort({ createdAt: 1 })
    .limit(1)
    .next();

  snapshotExportedAt = exportedAt ?? null;
  if (!snapshotExportedAt) {
    console.warn(
      "⚠️  The snapshot's manifest has no export date, so edits made in this store after the export cannot be told apart.",
    );
  }

  // Plan first, write second: nothing is written if the plan would replace
  // edits the store made after the export, unless that is asked for.
  await runSync(db, snapshot, exportedAt, admin);
  if (DRY_RUN || (newer.length > 0 && !OVERWRITE_NEWER)) {
    printReport();
    printNewer(exportedAt);
    if (DRY_RUN) {
      console.log("\nDry run — nothing was written. Re-run without --dry-run to apply.");
      return failures > 0 ? 1 : 0;
    }
    console.error(
      "\n❌ Nothing was written. Re-export the snapshot first so it carries those edits " +
        `(pnpm db:seed:export --template=${template.id}), or pass --overwrite-newer to replace them.`,
    );
    return 1;
  }

  sections = [];
  writing = true;
  await runSync(db, snapshot, exportedAt, admin);
  printReport();
  if (newer.length > 0) {
    console.log(
      `\n--overwrite-newer: replaced ${newer.length} document(s) this store had changed after the export.`,
    );
  }
  console.log(
    "\n✅ Synced. The storefront picks it up as its caches expire (a few minutes), or restart the app.",
  );
  return failures > 0 ? 1 : 0;
}

/**
 * Everything the sync reads and writes, in dependency order. Run once to
 * plan (`writing` false) and once to write.
 */
async function runSync(db, snapshot, exportedAt, admin) {
  // ---- Catalog ---------------------------------------------------------
  const vendors = await syncCollection(db, {
    title: "vendors",
    collection: "vendors",
    docs: snapshot.vendors,
    preserve: ["userId", "bankDetails", "stripeCustomerId", "planId"],
    label: (doc) => doc.storeName,
    skip: (doc, store) =>
      store
        ? null
        : "new in the snapshot; a vendor needs a login, so create it in the admin (or seed a fresh store) and re-run",
  });
  vendors.entry.extrasNote = `not in the snapshot, left alone: ${vendors.extras.map((v) => v.storeName).join(", ")}`;
  const storeVendorIds = new Set(
    (await db.collection("vendors").find({}, { projection: { _id: 1 } }).toArray()).map((v) =>
      String(v._id),
    ),
  );
  const vendorMissing = (doc) =>
    doc.vendorId && !storeVendorIds.has(String(doc.vendorId))
      ? "its vendor is not in this store"
      : null;

  const locations = await syncCollection(db, {
    title: "inventory locations",
    collection: "inventorylocations",
    docs: snapshot.locations,
    skip: vendorMissing,
  });
  locations.entry.extrasNote = `not in the snapshot, left alone: ${locations.extras.length}`;

  for (const [title, collection, docs] of [
    ["categories", "categories", snapshot.categories],
    ["brands", "brands", snapshot.brands],
    ["global variants", "globalvariants", snapshot.globalVariants],
  ]) {
    const synced = await syncCollection(db, { title, collection, docs });
    synced.entry.extrasNote = `not in the snapshot, left alone: ${synced.extras.map((d) => d.name).join(", ")}`;
  }

  const writtenProducts = [];
  const products = await syncCollection(db, {
    title: "products",
    collection: "products",
    docs: snapshot.products,
    // The store's own reviews decide these; the snapshot's are another
    // store's.
    preserve: ["rating", "reviewCount"],
    // Rebuilt below by the app's own builder for every product written.
    derived: ["search"],
    skip: vendorMissing,
    onInsert: (doc) => ({ ...doc, rating: 0, reviewCount: 0 }),
    onWritten: (doc) => writtenProducts.push(doc),
  });
  products.entry.extrasNote = PRUNE
    ? `not in the snapshot: ${products.extras.length} (active ones become drafts)`
    : `not in the snapshot, left alone: ${products.extras.length} (--prune hides them)`;

  for (const [title, collection, docs] of [
    ["collections", "collections", snapshot.collections],
    ["menus", "menus", snapshot.menus],
  ]) {
    const synced = await syncCollection(db, { title, collection, docs });
    synced.entry.extrasNote = `not in the snapshot, left alone: ${synced.extras.length}`;
  }

  const sliders = await syncCollection(db, {
    title: "sliders",
    collection: "sliders",
    docs: snapshot.sliders,
    preserve: ["history"],
    // A replaced live slider goes into its own history, so the slider editor
    // can restore it.
    afterPlan: (plan, store) => {
      if (plan.action !== "update") return plan;
      const live = ["slides", "controls", "transition", "autoplaySeconds"];
      if (!plan.changed.some((key) => live.includes(key))) return plan;
      const previous = Object.fromEntries(
        [...live, "publishedAt"].filter((key) => key in store).map((key) => [key, store[key]]),
      );
      return { ...plan, doc: { ...plan.doc, history: pushHistory(store.history, previous, 10) } };
    },
  });

  // ---- Storefront ------------------------------------------------------
  const pages = await syncStorePages(db, snapshot.storePages, exportedAt);
  await syncVendorPages(db, snapshot.vendorStorePages, exportedAt, storeVendorIds);

  const coupons = await syncCollection(db, {
    title: "coupons",
    collection: "coupons",
    docs: snapshot.coupons,
    match: (doc) => ({ code: String(doc.code).toUpperCase() }),
    label: (doc) => doc.code,
    preserve: ["usedCount", "usedBy", "createdBy"],
    transform: (doc, store) => ({ ...doc, ...couponWindow(store, now) }),
    skip: vendorMissing,
    onInsert: (doc) => ({ ...doc, usedCount: 0, createdBy: admin ? String(admin._id) : null }),
  });
  coupons.entry.extrasNote = `not in the snapshot, left alone: ${coupons.extras.length}`;

  // ---- Blog, plans, onboarding -----------------------------------------
  await syncCollection(db, {
    title: "blog categories",
    collection: "blogcategories",
    docs: snapshot.blogCategories,
  });
  await syncCollection(db, {
    title: "blog posts",
    collection: "blogposts",
    docs: snapshot.blogPosts,
    // `password` guards a protected post; the export never ships it.
    preserve: ["authorId", "authorName", "viewCount", "likeCount", "commentCount", "password"],
    onInsert: (doc) => ({
      ...doc,
      authorId: admin ? String(admin._id) : undefined,
      authorName: admin?.name ?? "Admin",
    }),
  });
  const plans = await syncCollection(db, {
    title: "vendor plans",
    collection: "vendorplans",
    docs: snapshot.vendorPlans,
    preserve: [
      "stripePriceId",
      "stripeProductId",
      "stripePriceActive",
      "stripePriceCurrency",
      "stripeSyncedAt",
      "createdBy",
    ],
    onInsert: (doc) => ({ ...doc, createdBy: admin ? String(admin._id) : null }),
  });
  plans.entry.extrasNote = `not in the snapshot, left alone (vendors may be subscribed): ${plans.extras.map((p) => p.name).join(", ")}`;
  await syncCollection(db, {
    title: "onboarding template",
    collection: "onboardingtemplates",
    docs: snapshot.onboarding,
    match: (doc) => ({ key: doc.key }),
    label: (doc) => doc.key,
    preserve: ["updatedBy"],
  });

  // ---- Settings --------------------------------------------------------
  await syncSettings(db, snapshot.settings);

  // ---- Derived data ----------------------------------------------------
  const derived = section("derived");
  if (writing) {
    const barcodes = await rebuildBarcodes(db, writtenProducts);
    derived.lines.push(`barcodes registered for written products: ${barcodes.registered}`);
    if (barcodes.conflicts.length > 0) {
      derived.lines.push(
        `! barcodes another product of this store already holds: ${barcodes.conflicts.join(", ")}`,
      );
    }
    const search = await backfillProductSearchIndex();
    derived.lines.push(`products re-indexed for search: ${search.updated}`);
  } else {
    derived.lines.push(
      `would re-register barcodes and re-index search for ${writtenProducts.length} product(s)`,
    );
  }

  // ---- Prune -----------------------------------------------------------
  if (PRUNE) {
    const prune = section("prune");
    const strays = products.extras.filter((p) => p.status === "active");
    if (strays.length > 0) {
      prune.lines.push(
        `products → draft (orders may still name them, so nothing is deleted): ${strays.map((p) => p.name).join(", ")}`,
      );
      await write(prune, "products", () =>
        db.collection("products").updateMany(
          { _id: { $in: strays.map((p) => p._id) } },
          { $set: { status: "draft", updatedAt: now } },
        ),
      );
    }
    const bound = new Set();
    for (const page of await db.collection("storepages").find({}).toArray()) {
      for (const state of [page.draft, page.published]) {
        for (const s of state?.sections ?? []) {
          for (const block of s?.blocks ?? []) {
            if (typeof block?.settings?.slider === "string") bound.add(block.settings.slider);
          }
        }
      }
    }
    const unbound = sliders.extras.filter((slider) => !bound.has(slider.handle));
    if (unbound.length > 0) {
      prune.lines.push(`sliders no page binds → deleted: ${unbound.map((s) => s.name).join(", ")}`);
      await write(prune, "sliders", () =>
        db.collection("sliders").deleteMany({ _id: { $in: unbound.map((s) => s._id) } }),
      );
    }
    const emptyLanding = pages.extras.filter(
      (page) =>
        page.kind === "landing" &&
        !(page.draft?.sections?.length > 0) &&
        !(page.published?.sections?.length > 0),
    );
    if (emptyLanding.length > 0) {
      prune.lines.push(`empty landing pages → deleted: ${emptyLanding.map((p) => p.key).join(", ")}`);
      await write(prune, "landing pages", () =>
        db.collection("storepages").deleteMany({ _id: { $in: emptyLanding.map((p) => p._id) } }),
      );
    }
    if (prune.lines.length === 0) prune.lines.push("nothing to retire");
  }
}

main()
  .then(async (code) => {
    await mongoose.disconnect().catch(() => {});
    process.exit(code);
  })
  .catch(async (error) => {
    console.error("\n❌ demo-sync failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
