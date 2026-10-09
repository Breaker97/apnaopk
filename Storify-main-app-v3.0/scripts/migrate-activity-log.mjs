import mongoose from "mongoose";

/**
 * Activity Log migration for 3.0 (October 2026)
 * =============================================
 *
 * Two steps, both safe to re-run:
 *
 * 1. Indexes on `audit_logs`. Purely additive.
 *
 *      { actorVendorId: 1, createdAt: -1, _id: -1 }   a vendor's own log
 *      { createdAt: -1, _id: -1 }                     the admin log, unfiltered
 *
 *    Both end in `_id` because the log is listed `createdAt` then `_id`, and a
 *    tiebreaker the index does not carry turns every page into an in-memory
 *    sort of the whole window. Stores that leave Mongoose `autoIndex` on get
 *    them on the next boot; this is for MONGODB_AUTO_INDEX=false, where an index
 *    that no migration creates is one the store never gets.
 *
 * 2. Backfill `actorVendorId` on the rows already written, so a vendor's
 *    Activity Log is not empty for everything that happened before the upgrade.
 *    New rows are stamped as they are written.
 *
 *      - A vendor owner's rows (userRole "vendor") get that owner's store.
 *      - A vendor-owned staff member's rows (userRole "staff" or "seller") get
 *        the one vendor that created them.
 *
 *    Only what is unambiguous is stamped. A row stays unstamped — visible to
 *    admins only, the safe side — when its author is gone (a deleted account has
 *    no profile to read), or is a legacy staff profile scoped to several
 *    vendors. The mapping uses today's assignments, which is right because
 *    ownership is fixed when a vendor creates a staff member.
 *
 *    Rows an admin wrote about a vendor's store are never stamped: a vendor does
 *    not see what an admin did to its store. Only rows with no `actorVendorId`
 *    at all are touched, which is what makes a second run a no-op.
 *
 *    This writes through the native collection. The model's write-once guard
 *    covers Mongoose calls and would refuse these updates.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-activity-log.mjs            (apply)
 *   node --env-file=.env scripts/migrate-activity-log.mjs --dry-run  (report only)
 *   node --env-file=.env scripts/migrate-activity-log.mjs --indexes-only
 */
const DRY_RUN = process.argv.includes("--dry-run");
const INDEXES_ONLY = process.argv.includes("--indexes-only");

// Names and keys match what Mongoose derives from the schema, so a later
// autoIndex boot sees them as already present rather than as conflicts.
const INDEXES = [
  {
    name: "actorVendorId_1_createdAt_-1__id_-1",
    key: { actorVendorId: 1, createdAt: -1, _id: -1 },
  },
  { name: "createdAt_-1__id_-1", key: { createdAt: -1, _id: -1 } },
];

const BATCH = 200;
const UNSTAMPED = { actorVendorId: { $exists: false } };

async function ensureIndexes(audit) {
  const existing = await audit.indexes().catch(() => []);
  const present = new Set(existing.map((index) => index.name));
  let created = 0;
  let failed = 0;
  for (const { name, key } of INDEXES) {
    if (present.has(name)) {
      console.log(`  = audit_logs.${name} already present`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  + would create audit_logs.${name} ${JSON.stringify(key)}`);
      created += 1;
      continue;
    }
    try {
      await audit.createIndex(key, { name, background: true });
      console.log(`  + created audit_logs.${name} ${JSON.stringify(key)}`);
      created += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `  ✗ audit_logs.${name} not created: ${error?.message || error}`,
      );
    }
  }
  return { created, failed };
}

/** One `updateMany` per author, flushed in batches. Returns rows stamped (or that would be). */
async function stamp(audit, pairs) {
  let rows = 0;
  let ops = [];
  const flush = async () => {
    if (ops.length === 0) return;
    const result = await audit.bulkWrite(ops, { ordered: false });
    rows += result.modifiedCount ?? 0;
    ops = [];
  };

  for (const { userId, roles, vendorId } of pairs) {
    const filter = { userId, userRole: { $in: roles }, ...UNSTAMPED };
    if (DRY_RUN) {
      rows += await audit.countDocuments(filter);
      continue;
    }
    ops.push({ updateMany: { filter, update: { $set: { actorVendorId: vendorId } } } });
    if (ops.length >= BATCH) await flush();
  }
  await flush();
  return rows;
}

async function backfill(db, audit) {
  const owners = [];
  for await (const vendor of db
    .collection("vendors")
    .find({}, { projection: { userId: 1 } })) {
    if (vendor.userId) {
      owners.push({ userId: vendor.userId, roles: ["vendor"], vendorId: vendor._id });
    }
  }
  const ownerRows = await stamp(audit, owners);
  console.log(
    `  ${DRY_RUN ? "would stamp" : "stamped"} ${ownerRows} row(s) for ${owners.length} vendor owner(s)`,
  );

  const staff = [];
  let several = 0;
  for await (const profile of db.collection("staffprofiles").find(
    {
      $or: [
        { managedBy: "vendor" },
        { managedBy: { $exists: false }, "vendorIds.0": { $exists: true } },
      ],
    },
    { projection: { userId: 1, vendorIds: 1 } },
  )) {
    const vendorIds = profile.vendorIds ?? [];
    if (vendorIds.length === 1 && profile.userId) {
      staff.push({
        userId: profile.userId,
        roles: ["staff", "seller"],
        vendorId: vendorIds[0],
      });
    } else if (vendorIds.length > 1) {
      several += 1;
    }
  }
  const staffRows = await stamp(audit, staff);
  console.log(
    `  ${DRY_RUN ? "would stamp" : "stamped"} ${staffRows} row(s) for ${staff.length} vendor staff member(s)`,
  );
  if (several > 0) {
    console.log(
      `  ! ${several} vendor staff profile(s) are scoped to several vendors; their rows stay unstamped (admin-only)`,
    );
  }
}

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection.db;
  console.log(
    `${DRY_RUN ? "🔍 Dry run" : "🚀 Applying"} on database "${db.databaseName}"`,
  );

  const audit = db.collection("audit_logs");

  console.log("-- indexes --");
  const { created, failed } = await ensureIndexes(audit);

  if (!INDEXES_ONLY) {
    console.log("-- backfill actorVendorId --");
    await backfill(db, audit);
  }

  console.log(
    DRY_RUN
      ? `✅ Dry run complete — ${created} index(es) would be created.`
      : `✅ Done — ${created} index(es) created${failed ? `, ${failed} failed` : ""}.`,
  );
  await mongoose.disconnect();
  if (failed) process.exit(1);
}

run().catch(async (error) => {
  console.error("❌ Migration failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
