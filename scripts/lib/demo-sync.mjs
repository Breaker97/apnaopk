import { BSON } from "mongodb";

/**
 * The pure half of `pnpm db:migrate demo-sync`: how one snapshot document is
 * laid over the document a demo store already has. No database in here —
 * `tests/demo-sync.test.ts` pins every rule — so the script itself only reads,
 * asks these functions, and writes.
 *
 * The sync exists because the seeder cannot update: every `pnpm db:seed` step
 * skips a collection that already has data, so a demo store seeded from last
 * month's snapshot keeps last month's catalog until it is wiped. A wipe takes
 * the store's accounts, orders and settings credentials with it; this keeps
 * them and replaces only what the snapshot owns.
 */

/** Canonical JSON: ObjectIds and dates as EJSON, object keys sorted. */
export function stableStringify(value) {
  const plain = BSON.EJSON.serialize(value ?? null, { relaxed: false });
  const sort = (node) => {
    if (Array.isArray(node)) return node.map(sort);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.keys(node)
          .sort()
          .map((key) => [key, sort(node[key])]),
      );
    }
    return node;
  };
  return JSON.stringify(sort(plain));
}

const omit = (doc, keys) =>
  Object.fromEntries(Object.entries(doc ?? {}).filter(([key]) => !keys.has(key)));

/** Fields no sync ever compares or carries over: bookkeeping, not content. */
const BOOKKEEPING = ["updatedAt", "__v"];

/**
 * What to do with one snapshot document, given the store's copy (or null).
 *
 * `preserve` names fields the STORE owns even though the snapshot has them:
 * a vendor's login (`userId`), a coupon's usage, a product's rating from the
 * store's own reviews. They are taken from the store's copy, or left out when
 * the store has none. Everything else comes from the snapshot, and fields the
 * snapshot no longer has are dropped — the snapshot is the whole document.
 *
 * `derived` names fields the store computes from the document (a product's
 * `search` block). The snapshot never carries them, so they are left out of
 * the comparison, and an updated document is written without them, so the
 * store rebuilds them from the new content.
 *
 * Returns the document to write and the top-level keys that changed; an
 * `update` whose content equals the store's is reported as `same` and not
 * written, so a second run is a no-op.
 *
 * @param {Record<string, any>} snapshotDoc
 * @param {Record<string, any> | null | undefined} storeDoc
 * @param {{ preserve?: string[], derived?: string[], now?: Date }} [options]
 */
export function planDocument(
  snapshotDoc,
  storeDoc,
  { preserve = [], derived = [], now = new Date() } = {},
) {
  const kept = new Set(preserve);
  const ignore = new Set([...BOOKKEEPING, ...kept, ...derived]);
  const base = omit(snapshotDoc, ignore);

  if (!storeDoc) {
    return {
      action: "insert",
      doc: { ...base, createdAt: snapshotDoc.createdAt ?? now, updatedAt: now },
      changed: [],
    };
  }

  const doc = { ...base, _id: storeDoc._id };
  for (const key of kept) {
    if (key in storeDoc) doc[key] = storeDoc[key];
  }
  if ("createdAt" in storeDoc) doc.createdAt = storeDoc.createdAt;

  const before = omit(storeDoc, ignore);
  const after = omit(doc, ignore);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => stableStringify(before[key]) !== stableStringify(after[key]))
    .sort();
  if (changed.length === 0) return { action: "same", doc: storeDoc, changed };
  return { action: "update", doc: { ...doc, updatedAt: now }, changed };
}

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !value._bsontype;

/**
 * Lay a snapshot settings section over the store's own.
 *
 * Objects merge key by key and arrays are replaced whole (a header's rows, a
 * zone list). Two kinds of value always stay the store's:
 * - credentials — any key the export would refuse to ship, matched by the
 *   same pattern (`sensitive`);
 * - the `keep` paths: switches the export turns off because their keys are
 *   not exported (the AI agent, a carrier), and per-deployment values such
 *   as the store's own domain.
 *
 * Returns the merged section and the paths that were kept.
 *
 * @param {any} storeSection
 * @param {any} snapshotSection
 * @param {{ keep?: Array<string | RegExp>, sensitive?: RegExp, path?: string }} [options]
 */
export function mergeSettingsSection(storeSection, snapshotSection, { keep = [], sensitive, path = "" } = {}) {
  const keptPaths = [];
  // Exact dot paths, or patterns for families (every carrier's `enabled`).
  const isKept = (here) =>
    keep.some((rule) => (rule instanceof RegExp ? rule.test(here) : rule === here));

  const merge = (store, snap, at) => {
    if (!isPlainObject(snap)) return snap;
    const out = isPlainObject(store) ? { ...store } : {};
    for (const [key, value] of Object.entries(snap)) {
      const here = at ? `${at}.${key}` : key;
      const storeHas = isPlainObject(store) && key in store;
      if (storeHas && (isKept(here) || (sensitive?.test(key) && !isPlainObject(value)))) {
        if (stableStringify(store[key]) !== stableStringify(value)) keptPaths.push(here);
        out[key] = store[key];
        continue;
      }
      out[key] = merge(isPlainObject(store) ? store[key] : undefined, value, here);
    }
    return out;
  };

  return { section: merge(storeSection, snapshotSection, path), kept: keptPaths };
}

/**
 * Restore point for a replaced storefront surface: the store's live version
 * goes to the front of its history, the way a publish from the builder does,
 * so the admin can roll back what the sync changed from the editor.
 */
export function pushHistory(history, entry, limit) {
  if (!entry) return Array.isArray(history) ? history : [];
  return [entry, ...(Array.isArray(history) ? history : [])].slice(0, limit);
}

/**
 * Keep a store's RUNNING countdowns where they are.
 *
 * The importers re-base every countdown from the moment of import
 * (`rebaseCountdownSections`), so a sync run twice would move the same offer
 * twice and rewrite the page each time. A countdown the store is still
 * running keeps its end; one that has ended, or is new, takes the re-based
 * end.
 */
export function keepRunningCountdowns(nextSections, storeSections, now = new Date()) {
  const running = new Map();
  for (const section of storeSections ?? []) {
    if (section?.type !== "countdown-offer" || !section.id) continue;
    const end = new Date(section.settings?.endsAt ?? NaN).getTime();
    if (Number.isFinite(end) && end > now.getTime()) {
      running.set(section.id, section.settings.endsAt);
    }
  }
  return (nextSections ?? []).map((section) =>
    section?.type === "countdown-offer" && running.has(section.id)
      ? { ...section, settings: { ...section.settings, endsAt: running.get(section.id) } }
      : section,
  );
}

/**
 * Did the store change this document after the snapshot was exported?
 *
 * The snapshot is a copy of the source store at one moment. Synced back onto
 * that same store later, it would quietly revert every edit made since: a
 * collection created at 12:37 against a snapshot from 12:18. Such documents
 * are named before anything is written. False when either date is unknown.
 */
export function changedAfterExport(storeDoc, exportedAt) {
  const exported = new Date(exportedAt ?? NaN).getTime();
  const updated = new Date(storeDoc?.updatedAt ?? NaN).getTime();
  return Number.isFinite(exported) && Number.isFinite(updated) && updated > exported;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A synced coupon's validity window. A store's running coupon keeps its own
 * window; a new or expired one runs from today for 90 days — the same rule
 * the seeder applies, because an exported window has usually closed.
 */
export function couponWindow(storeCoupon, now = new Date()) {
  const end = storeCoupon?.endDate ? new Date(storeCoupon.endDate) : null;
  if (end && end.getTime() > now.getTime()) {
    return { startDate: storeCoupon.startDate, endDate: storeCoupon.endDate };
  }
  return { startDate: now, endDate: new Date(now.getTime() + 90 * DAY_MS) };
}
