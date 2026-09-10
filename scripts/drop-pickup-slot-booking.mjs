/**
 * Remove what the pickup slot-booking system left behind.
 *
 * Pickup no longer takes appointments — a shopper collects during the branch's
 * opening hours — so two collections and six per-branch settings now describe a
 * feature that does not exist. On a self-hosted product every buyer would
 * otherwise inherit them forever: `pnpm db:reset` does not list the collections
 * either, so they survive even a full reset.
 *
 * The `$unset` is not optional. `defaultPickupLocation()` wrote slot length,
 * capacity, lead time, booking horizon and blackout dates into EVERY branch a
 * merchant ever created, including ones that never took a booking — so these
 * keys are present in essentially every database, not just deliberately
 * configured ones.
 *
 * Orders are deliberately untouched. `Order.subOrders[].fulfillment.pickup`
 * keeps its historical `reservationId`, `startAt`, `endAt` and `timeZone` so
 * every order booked while the system existed still shows the window it booked.
 *
 * Usage:
 *   pnpm db:migrate drop-pickup-slots --dry-run     # report only, writes nothing
 *   pnpm db:migrate drop-pickup-slots
 */

import { connectDB, disconnectDB, mongoose } from "../lib/db.ts";

const LOG = "[drop-pickup-slots]";
const dryRun = process.argv.includes("--dry-run");

/** Per-branch settings that only ever meant something to slot booking. */
const SLOT_KEYS = [
  "scheduling",
  "minLeadMinutes",
  "maxAdvanceDays",
  "slotDurationMinutes",
  "capacityPerSlot",
  "blackoutDates",
];

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB database connection is unavailable");

  console.log(`${LOG} database: ${db.databaseName}`);

  // ------------------------------------------------- the booking collections
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

  for (const name of ["pickupslots", "pickupreservations"]) {
    if (!existing.has(name)) {
      console.log(`${LOG} ${name}: already absent.`);
      continue;
    }
    const count = await db.collection(name).countDocuments({});
    if (dryRun) {
      console.log(`${LOG} Would drop ${name} (${count} document(s)).`);
    } else {
      await db.collection(name).drop();
      console.log(`${LOG} Dropped ${name} (${count} document(s)).`);
    }
  }

  // ------------------------------------------------ the per-branch leftovers
  const vendors = db.collection("vendors");
  const branchUnset = Object.fromEntries(
    SLOT_KEYS.map((key) => [`shipping.localPickup.locations.$[].${key}`, ""]),
  );
  // The pre-`locations[]` single-address profile carried the same settings.
  const legacyUnset = Object.fromEntries(
    SLOT_KEYS.map((key) => [`shipping.localPickup.${key}`, ""]),
  );

  const withBranches = await vendors.countDocuments({
    "shipping.localPickup.locations.0": { $exists: true },
  });
  const withLegacy = await vendors.countDocuments({
    $or: SLOT_KEYS.map((key) => ({
      [`shipping.localPickup.${key}`]: { $exists: true },
    })),
  });

  console.log(
    `${LOG} Vendors: ${withBranches} with branches, ${withLegacy} carrying legacy slot settings.`,
  );

  if (dryRun) {
    console.log(
      `${LOG} Would unset ${SLOT_KEYS.join(", ")} on every branch and on the legacy profile.`,
    );
    console.log(`${LOG} Dry run complete — nothing was written.`);
    return;
  }

  if (withBranches > 0) {
    const result = await vendors.updateMany(
      { "shipping.localPickup.locations.0": { $exists: true } },
      { $unset: branchUnset },
    );
    console.log(`${LOG} Cleaned branches on ${result.modifiedCount} vendor(s).`);
  }
  if (withLegacy > 0) {
    const result = await vendors.updateMany(
      {
        $or: SLOT_KEYS.map((key) => ({
          [`shipping.localPickup.${key}`]: { $exists: true },
        })),
      },
      { $unset: legacyUnset },
    );
    console.log(
      `${LOG} Cleaned legacy pickup settings on ${result.modifiedCount} vendor(s).`,
    );
  }

  console.log(`${LOG} Complete.`);
}

run()
  .catch((error) => {
    console.error(`${LOG} Failed:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
