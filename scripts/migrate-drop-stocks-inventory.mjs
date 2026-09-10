/**
 * Retire `InventoryLocation.stocksInventory`.
 *
 * The flag vetoed a branch's place in the dispatch order, but no API route and
 * no form could ever set it — `scripts/backfill-location-vendor.ts` was the
 * only writer, and it wrote `false` for every branch migrated off the old
 * vendor pickup profile. Those branches showed "No delivery" in the locations
 * list while their own edit dialog showed "Ship online orders from here"
 * switched ON, and flipping that toggle did nothing at all.
 *
 * `fulfillsOnlineOrders` already answers the same question and IS editable, so
 * the value is carried across rather than dropped: a branch that did not
 * dispatch yesterday must not start dispatching the moment this deploys and
 * quietly pull orders away from the warehouse. After this the merchant can
 * switch it back on themselves, and the toggle means what it says.
 *
 *   node --env-file=.env scripts/migrate-drop-stocks-inventory.mjs --dry-run
 *   node --env-file=.env scripts/migrate-drop-stocks-inventory.mjs
 */

import mongoose from "mongoose";

const LOG = "[drop-stocks-inventory]";
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

  const locations = db.collection("inventorylocations");

  // Only rows that actually said "no". A row where the flag is true or absent
  // already dispatches, so writing `fulfillsOnlineOrders: true` over it could
  // overrule a merchant who deliberately switched that off.
  const carryFilter = {
    stocksInventory: false,
    fulfillsOnlineOrders: { $ne: false },
  };
  const carryCount = await locations.countDocuments(carryFilter);
  const unsetCount = await locations.countDocuments({
    stocksInventory: { $exists: true },
  });

  console.log(
    `${LOG} ${carryCount} location(s) need stocksInventory:false carried to fulfillsOnlineOrders:false.`,
  );
  console.log(`${LOG} ${unsetCount} location(s) still carry the field at all.`);

  if (dryRun) {
    if (carryCount > 0) {
      const sample = await locations
        .find(carryFilter)
        .project({ name: 1, vendorId: 1 })
        .limit(10)
        .toArray();
      for (const row of sample) {
        console.log(`${LOG}   would stop dispatching: "${row.name}"`);
      }
    }
    console.log(`${LOG} Dry run — nothing written.`);
    await mongoose.disconnect();
    return;
  }

  // Carry first, drop second. The reverse order would lose the value if the
  // process died between the two.
  const carried = await locations.updateMany(carryFilter, {
    $set: { fulfillsOnlineOrders: false },
  });
  console.log(`${LOG} Carried ${carried.modifiedCount} location(s).`);

  const dropped = await locations.updateMany(
    { stocksInventory: { $exists: true } },
    { $unset: { stocksInventory: "" } },
  );
  console.log(`${LOG} Dropped the field from ${dropped.modifiedCount} location(s).`);

  const remaining = await locations.countDocuments({
    stocksInventory: { $exists: true },
  });
  if (remaining > 0) {
    console.error(`${LOG} ${remaining} location(s) still carry the field.`);
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
