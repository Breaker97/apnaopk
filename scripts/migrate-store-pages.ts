/**
 * StorePage maintenance migration. Idempotent; safe to re-run. Two jobs:
 *
 * 1. IDENTITY BACKFILL (pre-release schema generalization): documents
 *    written before the `key` era (kind "home"/"landing", unique `handle`)
 *    get their canonical key + denormalized fields, then indexes are synced
 *    (drops the old unique handle index, creates the unique key index).
 *    Ordering matters: backfill BEFORE syncIndexes, or the unique key index
 *    would collide on missing values.
 *
 * 2. LEGACY HOME CUTOVER: reads legacy `settings.homePage`, maps it through
 *    the SAME `homePageSettingsToSections()` the storefront's fallback path
 *    uses, and writes it as the published home StorePage. Re-running is a
 *    no-op: an already-published home page is never overwritten.
 *    `settings.homePage` is left untouched — it is the rollback path and is
 *    removed in a later release.
 *
 * Run with --dry-run first. It prints the target host/db and the exact
 * writes that would happen. The storefront cache picks changes up within
 * its 60s revalidate window (a script cannot call revalidateTag).
 */

import { connectDB, disconnectDB, mongoose } from "@/lib/db";
import { normalizeHomePageSettings } from "@/lib/site-config/home-page-config";
import {
  buildLandingKey,
  HOME_TEMPLATE_KEY,
  isValidPageHandle,
} from "@/lib/storefront/pages/handles";
import { homePageSettingsToSections } from "@/lib/storefront/pages/legacy-home";
import { sanitizeSectionInstances } from "@/lib/storefront/sections/instances";
import { getSettings } from "@/models/settings.model";
import { buildStorePageIdentity, StorePage } from "@/models/store-page.model";

const dryRun = process.argv.includes("--dry-run");

/** Old-shape documents, read straight off the collection. */
interface LegacyStorePageDoc {
  _id: unknown;
  kind?: string;
  key?: string;
  handle?: string;
}

async function backfillIdentity(): Promise<void> {
  const collection = StorePage.collection;
  const legacyDocs = (await collection
    .find({ key: { $exists: false } })
    .project({ kind: 1, handle: 1 })
    .toArray()) as unknown as LegacyStorePageDoc[];

  if (legacyDocs.length === 0) {
    console.log("Identity backfill: nothing to do — all documents carry a key.");
  }

  for (const doc of legacyDocs) {
    let key: string;
    if (doc.kind === "home" || doc.handle === "home") {
      key = HOME_TEMPLATE_KEY;
    } else if (doc.kind === "landing" && isValidPageHandle(doc.handle)) {
      key = buildLandingKey(doc.handle);
    } else {
      // Unknown shape: refuse to guess. Surface it and stop — a silent skip
      // here would strand the document behind the new unique key index.
      throw new Error(
        `Cannot derive a key for StorePage ${String(doc._id)} (kind=${doc.kind}, handle=${doc.handle}) — inspect it by hand`,
      );
    }

    const identity = buildStorePageIdentity(key);
    console.log(
      `Identity backfill: ${String(doc._id)} (${doc.kind}/${doc.handle}) -> ${key}`,
    );
    if (dryRun) continue;

    await collection.updateOne(
      { _id: doc._id as never },
      {
        $set: identity,
        // Templates carry no URL handle any more; the legacy home doc does.
        ...(identity.handle ? {} : { $unset: { handle: "" } }),
      },
    );
  }

  if (dryRun) {
    console.log("Dry run: index sync skipped.");
    return;
  }

  // Drops the retired unique handle index and creates the unique key index.
  await StorePage.syncIndexes();
  console.log("Indexes synced:", Object.keys(await collection.indexInformation()).join(", "));
}

async function migrateLegacyHome(): Promise<void> {
  const existing = await StorePage.findOne({ key: HOME_TEMPLATE_KEY })
    .select("published draft")
    .lean();
  if (existing?.published) {
    console.log(
      "Legacy cutover: home StorePage is already published — nothing to do.",
    );
    return;
  }
  if (existing) {
    console.log(
      "Legacy cutover: found a draft-only home StorePage. Leaving the " +
        "unpublished work alone — publish it from the builder to cut over.",
    );
    return;
  }

  const settings = await getSettings();
  const sections = homePageSettingsToSections(
    normalizeHomePageSettings(settings.homePage),
  );

  console.log(`Mapped ${sections.length} sections from settings.homePage:`);
  for (const section of sections) {
    const blocks = section.blocks?.length
      ? `, ${section.blocks.length} block(s)`
      : "";
    console.log(
      `  - ${section.type} (${section.id}) visible=${section.visible}${blocks}`,
    );
  }

  if (dryRun) {
    console.log("Dry run: no writes performed.");
    return;
  }

  const now = new Date();
  await StorePage.create({
    ...buildStorePageIdentity(HOME_TEMPLATE_KEY),
    title: "Home",
    draft: { sections, updatedAt: now, updatedBy: "migration" },
    published: { sections, publishedAt: now, publishedBy: "migration" },
    history: [],
  });

  // Never trust a reported success: re-read through the same boundary the
  // storefront uses and diff against what we meant to write.
  const written = await StorePage.findOne({ key: HOME_TEMPLATE_KEY })
    .select("published")
    .lean();
  const verified = sanitizeSectionInstances(written?.published?.sections);
  if (JSON.stringify(verified) !== JSON.stringify(sections)) {
    throw new Error(
      "Verification failed: published sections do not round-trip. " +
        "Inspect the store_pages collection before retrying.",
    );
  }

  console.log(
    `Verified: ${verified.length} sections published as the home StorePage.`,
  );
  console.log(
    "settings.homePage left untouched (rollback: delete the StorePage doc). " +
      "Storefront refreshes within 60s. The legacy Home builder no longer " +
      "affects the storefront from here on.",
  );
}

async function main() {
  await connectDB();
  const { host, name } = mongoose.connection;
  console.log(`Target: host=${host} db=${name}${dryRun ? " (dry run)" : ""}`);

  await backfillIdentity();
  await migrateLegacyHome();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
