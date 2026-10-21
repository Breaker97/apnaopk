import mongoose from "mongoose";

/**
 * Index migration for team roles (3.1)
 * ====================================
 *
 * Creates the indexes team roles need. Purely additive: nothing is dropped and
 * nothing is rebuilt, so it is safe to re-run and safe to run on a store that
 * is already up to date. The built-in roles (Administrator, Manager) are made
 * by the app itself the first time the Team screen or a role check needs them.
 *
 * Stores that leave Mongoose `autoIndex` on get all of them on the next boot.
 * This script exists for deployments running with MONGODB_AUTO_INDEX=false,
 * which is the recommended production setting.
 *
 *   teamroles      — one role per key (UNIQUE: two first visits making the
 *                    built-in roles at once must make each once).
 *   adminprofiles  — an admin role's members, re-written when the role changes.
 *   staffprofiles  — a staff role's members, the same.
 *
 * Usage:
 *   pnpm db:migrate team-role-indexes             # create what is missing
 *   pnpm db:migrate team-role-indexes --dry-run   # report only
 */

const DRY_RUN = process.argv.includes("--dry-run");
// Names and options match what Mongoose derives from the schema, so a later
// autoIndex boot sees them as already present rather than as conflicts.
const ENSURE = [
  ["teamroles", [{ name: "key_1", key: { key: 1 }, options: { unique: true } }]],
  ["adminprofiles", [{ name: "teamRoleId_1", key: { teamRoleId: 1 }, options: { sparse: true } }]],
  ["staffprofiles", [{ name: "teamRoleId_1", key: { teamRoleId: 1 }, options: { sparse: true } }]],
];

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

  let created = 0;
  let failed = 0;
  for (const [collectionName, wanted] of ENSURE) {
    const collection = db.collection(collectionName);
    const existing = await collection.indexes().catch(() => []);
    const byName = new Set(existing.map((index) => index.name));
    for (const { name, key, options = {} } of wanted) {
      if (byName.has(name)) {
        console.log(`  = ${collectionName}.${name} already present`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  + would create ${collectionName}.${name} ${JSON.stringify(key)}`);
        created += 1;
        continue;
      }
      try {
        await collection.createIndex(key, { name, background: true, ...options });
        console.log(`  + created ${collectionName}.${name} ${JSON.stringify(key)}`);
        created += 1;
      } catch (error) {
        // One duplicate should not cost the store every other index.
        failed += 1;
        console.error(
          `  ✗ ${collectionName}.${name} not created: ${error?.message || error}`,
        );
      }
    }
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
