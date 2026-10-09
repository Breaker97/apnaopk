/**
 * Stamp `Vendor.commissionSource` on rows that predate the field.
 *
 * `commission` is a bare number, so nothing could tell a rate that is merely
 * the store default from one an admin negotiated for a single merchant — which
 * is why a changed platform rate was never swept onto existing vendors at all.
 * `commissionSource` makes that legible; this fills it in for everyone already
 * on file.
 *
 * The classification is derived, not guessed:
 *   - on a plan            → "plan"   (the subscription states the rate)
 *   - matches the default  → "default"(indistinguishable from a projection)
 *   - anything else        → "manual" (a number nothing but a human produced)
 *
 * That last rule is deliberately generous. Reading an unusual rate as a default
 * would let the next Settings save overwrite a negotiated deal with no record
 * of what it was; reading a genuine default as manual merely leaves one vendor
 * behind on a rate change, which is visible and fixable. Wrong in the direction
 * that can be undone.
 *
 * `reprojectDefaultCommission` matches `commissionSource: { $ne: "manual" }`,
 * so an unrun migration is safe too — untouched rows sweep as defaults.
 *
 *   node --env-file=.env scripts/backfill-commission-source.mjs --dry-run
 *   node --env-file=.env scripts/backfill-commission-source.mjs
 */

import mongoose from "mongoose";

const LOG = "[commission-source]";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(`${LOG} MONGODB_URI is not set.`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(
    `${LOG} ${dryRun ? "DRY RUN — " : ""}connected to "${db.databaseName}".`,
  );

  const settings = await db.collection("settings").findOne({});
  const defaultRate = settings?.orders?.commission?.vendorRate;
  if (typeof defaultRate !== "number") {
    console.log(
      `${LOG} No configured commission rate; every non-plan vendor will be read as manual.`,
    );
  } else {
    console.log(`${LOG} Store default rate: ${defaultRate}%`);
  }

  const vendors = db.collection("vendors");
  const rows = await vendors
    .find(
      { commissionSource: { $exists: false } },
      { projection: { storeName: 1, commission: 1, planId: 1, isDefault: 1 } },
    )
    .toArray();

  console.log(`${LOG} ${rows.length} vendor(s) without a source.`);

  const buckets = { plan: [], default: [], manual: [] };
  for (const row of rows) {
    // The house store is never billed, so its 0 is not a negotiated rate —
    // leaving it as "default" keeps it out of every sweep via `isDefault`.
    const source = row.planId
      ? "plan"
      : row.isDefault || row.commission === defaultRate
        ? "default"
        : "manual";
    buckets[source].push(row);
  }

  for (const [source, list] of Object.entries(buckets)) {
    console.log(`${LOG}   ${source}: ${list.length}`);
    if (source === "manual") {
      for (const row of list.slice(0, 15)) {
        console.log(
          `${LOG}     "${row.storeName ?? row._id}" at ${row.commission}% — kept, not swept`,
        );
      }
    }
  }

  if (dryRun) {
    console.log(`${LOG} Dry run — nothing written.`);
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const [source, list] of Object.entries(buckets)) {
    if (list.length === 0) continue;
    const result = await vendors.updateMany(
      { _id: { $in: list.map((row) => row._id) } },
      { $set: { commissionSource: source } },
    );
    written += result.modifiedCount;
  }
  console.log(`${LOG} Stamped ${written} vendor(s).`);

  const remaining = await vendors.countDocuments({
    commissionSource: { $exists: false },
  });
  if (remaining > 0) {
    console.error(`${LOG} ${remaining} vendor(s) still have no source.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`${LOG} Done.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(`${LOG} Failed:`, error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
