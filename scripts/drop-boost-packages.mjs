/**
 * Remove what the flat-fee boost model left behind.
 *
 * Boosts are no longer bought as a package with a duration — a vendor books a
 * numbered ladder position for a range of UTC days — so every row written under
 * the old model describes a product that no longer exists. Those rows are not
 * merely stale, they are actively misleading: a campaign carrying a
 * `packageSnapshot` has no `positionSnapshot`, no `startDay`, no `billedDays`
 * and no BoostSlotDay rows, so the storefront cannot render it, the cron cannot
 * reconcile it, and every lifecycle path looks broken while it sits there.
 *
 * The feature never shipped, so there is deliberately no conversion: a flat-fee
 * campaign cannot be mapped onto a rung without inventing which rung it bought.
 *
 * `pnpm db:reset` does not list these collections either, so they survive a
 * full reset — on a self-hosted product every buyer would otherwise inherit
 * them forever.
 *
 * Also unsets `boosting.maxPerVendorPerPlacement`. It refereed an
 * undifferentiated random shuffle; under a ladder a vendor holding two rungs
 * paid for both, and capping post-hoc would mean charging for a position and
 * then not rendering it. The settings save silently drops unknown keys from the
 * payload and never `$unset`s the stored document, so removing it from the code
 * leaves the value behind.
 *
 * PlatformPayment rows are deliberately untouched: they are the money record,
 * and a paid attempt whose campaign is gone is exactly what an audit needs to
 * see. `refundedAmount` on them still reads correctly on its own.
 *
 * Usage:
 *   pnpm db:migrate drop-boost-packages --dry-run     # report only, writes nothing
 *   pnpm db:migrate drop-boost-packages
 */

import { connectDB, disconnectDB, mongoose } from "../lib/db.ts";

const LOG = "[drop-boost-packages]";
const dryRun = process.argv.includes("--dry-run");

async function run() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB database connection is unavailable");

  console.log(`${LOG} database: ${db.databaseName}`);

  const existing = new Set(
    (await db.listCollections().toArray()).map((c) => c.name),
  );

  // ------------------------------------------------------- the package catalog
  if (!existing.has("boostpackages")) {
    console.log(`${LOG} boostpackages: already absent.`);
  } else {
    const count = await db.collection("boostpackages").countDocuments({});
    if (dryRun) {
      console.log(`${LOG} Would drop boostpackages (${count} document(s)).`);
    } else {
      await db.collection("boostpackages").drop();
      console.log(`${LOG} Dropped boostpackages (${count} document(s)).`);
    }
  }

  // --------------------------------------------------- flat-fee campaign rows
  // Identified by what they CARRY, not by what they lack: `packageSnapshot` is
  // the old model's own field, so this can never match a ladder booking even if
  // one is somehow missing a snapshot.
  if (!existing.has("boostcampaigns")) {
    console.log(`${LOG} boostcampaigns: already absent.`);
  } else {
    const campaigns = db.collection("boostcampaigns");
    const legacy = { packageSnapshot: { $exists: true } };
    const legacyCount = await campaigns.countDocuments(legacy);
    const totalCount = await campaigns.countDocuments({});

    if (legacyCount === 0) {
      console.log(
        `${LOG} boostcampaigns: no flat-fee rows (${totalCount} total).`,
      );
    } else if (dryRun) {
      console.log(
        `${LOG} Would delete ${legacyCount} flat-fee campaign(s) of ${totalCount}.`,
      );
    } else {
      const ids = (
        await campaigns.find(legacy).project({ _id: 1 }).toArray()
      ).map((row) => row._id);
      const result = await campaigns.deleteMany(legacy);
      console.log(
        `${LOG} Deleted ${result.deletedCount} flat-fee campaign(s) of ${totalCount}.`,
      );

      // Their metric rows would otherwise be attributed to nothing — and the
      // ladder's delivery averages join through campaignId to read a position.
      if (existing.has("boostmetricdailies") && ids.length > 0) {
        const metrics = await db
          .collection("boostmetricdailies")
          .deleteMany({ campaignId: { $in: ids } });
        console.log(
          `${LOG} Deleted ${metrics.deletedCount} orphaned metric row(s).`,
        );
      }
    }
  }

  // ------------------------------------------- slot-days left by a failed run
  // Only rows whose campaign is gone: a live booking's days must never be
  // touched here. This is the same invariant sweepOrphanSlotDays enforces at
  // runtime, applied once for the rows the deletes above just orphaned.
  if (existing.has("boostslotdays") && existing.has("boostcampaigns")) {
    const slotDays = db.collection("boostslotdays");
    const orphans = await slotDays
      .aggregate([
        {
          $lookup: {
            from: "boostcampaigns",
            localField: "campaignId",
            foreignField: "_id",
            as: "campaign",
            pipeline: [{ $project: { _id: 1 } }],
          },
        },
        { $match: { campaign: { $size: 0 } } },
        { $project: { _id: 1 } },
      ])
      .toArray();

    if (orphans.length === 0) {
      console.log(`${LOG} boostslotdays: no orphaned rows.`);
    } else if (dryRun) {
      console.log(
        `${LOG} Would delete ${orphans.length} orphaned slot-day row(s).`,
      );
    } else {
      const result = await slotDays.deleteMany({
        _id: { $in: orphans.map((row) => row._id) },
      });
      console.log(
        `${LOG} Deleted ${result.deletedCount} orphaned slot-day row(s).`,
      );
    }
  }

  // ------------------------------------------- the dead stamp on products
  // `Product.sponsorship` denormalized "who holds a slot right now". The
  // storefront reads BoostCampaign instead, so the field is gone from the
  // schema — and a field absent from the schema is one Mongoose silently
  // ignores rather than cleans, so it would sit in a buyer's database
  // forever. The index migration drops its index; this drops the data.
  const products = db.collection("products");
  const stamped = await products.countDocuments({
    sponsorship: { $exists: true },
  });
  if (stamped === 0) {
    console.log(`${LOG} products: no sponsorship stamps left.`);
  } else if (dryRun) {
    console.log(
      `${LOG} Would unset sponsorship on ${stamped} product(s).`,
    );
  } else {
    const result = await products.updateMany(
      { sponsorship: { $exists: true } },
      { $unset: { sponsorship: "" } },
    );
    console.log(
      `${LOG} Unset sponsorship on ${result.modifiedCount} product(s).`,
    );
  }

  // ------------------------------------------------ the dead settings field
  const settings = db.collection("settings");
  const withCap = await settings.countDocuments({
    "boosting.maxPerVendorPerPlacement": { $exists: true },
  });
  if (withCap === 0) {
    console.log(`${LOG} settings: maxPerVendorPerPlacement already absent.`);
  } else if (dryRun) {
    console.log(`${LOG} Would unset boosting.maxPerVendorPerPlacement.`);
  } else {
    const result = await settings.updateMany(
      { "boosting.maxPerVendorPerPlacement": { $exists: true } },
      { $unset: { "boosting.maxPerVendorPerPlacement": "" } },
    );
    console.log(
      `${LOG} Unset maxPerVendorPerPlacement on ${result.modifiedCount} settings doc(s).`,
    );
  }

  console.log(
    dryRun ? `${LOG} Dry run complete — nothing was written.` : `${LOG} Complete.`,
  );
}

run()
  .catch((error) => {
    console.error(`${LOG} Failed:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
