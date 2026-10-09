import mongoose from "mongoose";
import { pathToFileURL } from "node:url";

/**
 * House profile migration for 3.0 (October 2026)
 * ==============================================
 *
 * The house profile is the store's own vendor record: slug `main-store`,
 * `isDefault: true`. The app finds it by one rule — the slug, then the oldest
 * flagged vendor — and makes it on first need when it is missing. This script
 * repairs what that rule cannot decide alone. It REPORTS by default and writes
 * only with `--apply`.
 *
 * What it reports
 * ---------------
 *  - which vendor is the house, by that rule
 *  - every other vendor carrying `isDefault: true`, with its products, the
 *    orders holding one of its sub-orders, and its ledger entries in the store's
 *    own book (`book: "own"`)
 *  - admin-owned vendors without the flag that hold admin-made products: the
 *    probable house of a store older than the flag
 *  - when there is no house: whether an admin without a store exists to own one
 *  - whether `vendors` has its unique `slug` and `userId` indexes
 *
 * What `--apply` writes — only the unambiguous cases
 * -------------------------------------------------
 *  1. The slug holder is flagged and others are too: clear the others' flag,
 *     but only for a vendor with no orders, no products and no own-book
 *     entries. The finance cron re-posts old orders with the live set of house
 *     vendors (`getDefaultVendorIds`), under different keys for the store's own
 *     sales and a seller's — so a vendor with history that left the set would
 *     have that history posted a second time. Those are reported and kept.
 *  2. The slug holder has no flag and nobody else has one: flag it.
 *  3. No slug holder and exactly one flagged vendor: give it the slug.
 *  4. `--adopt=<vendorId>` while there is no house at all: flag that vendor and
 *     give it the slug. Nothing else about it changes. For the "probable house"
 *     cases above, after a person has looked.
 *  5. A missing unique index on `slug` or `userId`, when no duplicates block
 *     it: create it. Concurrent first requests rely on it to make one house.
 *
 * Everything else — several slug holders, an unflagged slug holder beside a
 * flagged vendor, several flagged vendors and no slug holder — is written down
 * as ACTION NEEDED and left alone. A second run writes nothing.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-house-profile.mjs                    (report)
 *   node --env-file=.env scripts/migrate-house-profile.mjs --apply
 *   node --env-file=.env scripts/migrate-house-profile.mjs --apply --adopt=<vendorId>
 *   pnpm db:migrate house-profile --dry-run   /   pnpm db:migrate house-profile
 */

export const HOUSE_SLUG = "main-store";
const ADMIN_FILTER = { $or: [{ role: "admin" }, { roles: "admin" }] };
const ADMIN_SOURCED = {
  $or: [
    { productSource: "admin" },
    { productSource: { $exists: false } },
    { productSource: null },
  ],
};

const idOf = (value) => String(value?._id ?? value);
const label = (vendor) =>
  `${vendor.storeName || "(unnamed)"} [${idOf(vendor)}] slug=${vendor.slug ?? "-"} isDefault=${Boolean(vendor.isDefault)}`;

async function vendorHistory(db, vendorId) {
  const [products, orders, ownEntries] = await Promise.all([
    db.collection("products").countDocuments({ vendorId }),
    db.collection("orders").countDocuments({ "subOrders.vendorId": vendorId }),
    db.collection("ledgerentries").countDocuments({ vendorId, book: "own" }),
  ]);
  return { products, orders, ownEntries };
}

async function uniqueIndexState(vendors, field) {
  const indexes = await vendors.indexes().catch(() => []);
  const present = indexes.some(
    (index) =>
      index.unique === true &&
      Object.keys(index.key).length === 1 &&
      index.key[field] === 1,
  );
  if (present) return { field, present: true, duplicates: 0 };
  const duplicates = await vendors
    .aggregate([
      { $match: { [field]: { $ne: null } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
      { $count: "groups" },
    ])
    .toArray();
  return { field, present: false, duplicates: duplicates[0]?.groups ?? 0 };
}

/**
 * Read the store and decide what --apply would do. Writes nothing.
 * `adopt` is the vendor id a person picked with --adopt, if any.
 *
 * @param {import("mongodb").Db} db
 * @param {{ adopt?: string | null }} [options]
 */
export async function planHouseProfile(db, { adopt = null } = {}) {
  const vendors = db.collection("vendors");
  const projection = { storeName: 1, slug: 1, isDefault: 1, userId: 1 };

  const slugHolders = await vendors
    .find({ slug: HOUSE_SLUG }, { projection })
    .sort({ _id: 1 })
    .toArray();
  const flagged = await vendors
    .find({ isDefault: true }, { projection })
    .sort({ _id: 1 })
    .toArray();
  const house = slugHolders[0] ?? flagged[0] ?? null;

  const strays = [];
  for (const vendor of flagged) {
    if (house && idOf(vendor) === idOf(house)) continue;
    strays.push({ vendor, history: await vendorHistory(db, vendor._id) });
  }

  const admins = await db
    .collection("user")
    .find(ADMIN_FILTER, { projection: { _id: 1 } })
    .toArray();
  const adminIds = admins.map((admin) => admin._id);
  const adminVendors = adminIds.length
    ? await vendors
        .find(
          {
            userId: { $in: adminIds },
            isDefault: { $ne: true },
            slug: { $ne: HOUSE_SLUG },
          },
          { projection },
        )
        .toArray()
    : [];
  const legacyCandidates = [];
  for (const vendor of adminVendors) {
    const adminProducts = await db
      .collection("products")
      .countDocuments({ vendorId: vendor._id, ...ADMIN_SOURCED });
    if (adminProducts > 0) legacyCandidates.push({ vendor, adminProducts });
  }
  const owningAdmins = new Set(
    (
      await vendors
        .find({ userId: { $in: adminIds } }, { projection: { userId: 1 } })
        .toArray()
    ).map((vendor) => idOf(vendor.userId)),
  );
  const freeAdmins = adminIds.filter((id) => !owningAdmins.has(idOf(id))).length;

  const indexes = [
    await uniqueIndexState(vendors, "slug"),
    await uniqueIndexState(vendors, "userId"),
  ];

  const writes = [];
  const actionNeeded = [];
  const kept = [];

  if (slugHolders.length > 1) {
    actionNeeded.push(
      `${slugHolders.length} vendors hold the slug "${HOUSE_SLUG}"; only one may. Decide which is the store's own and rename the others.`,
    );
  } else if (adopt) {
    if (house) {
      if (idOf(house) !== String(adopt)) {
        actionNeeded.push(
          `--adopt ignored: the store already has a house profile, ${label(house)}.`,
        );
      }
    } else {
      const picked = await vendors.findOne(
        { _id: new mongoose.Types.ObjectId(String(adopt)) },
        { projection },
      );
      if (!picked) {
        actionNeeded.push(`--adopt: no vendor has the id ${adopt}.`);
      } else {
        writes.push({
          kind: "adopt",
          vendor: picked,
          set: { isDefault: true, slug: HOUSE_SLUG },
        });
      }
    }
  } else if (house && slugHolders.length === 1) {
    const otherFlagged = flagged.filter((vendor) => idOf(vendor) !== idOf(house));
    if (house.isDefault !== true) {
      if (otherFlagged.length === 0) {
        writes.push({ kind: "flag-slug-holder", vendor: house, set: { isDefault: true } });
      } else {
        actionNeeded.push(
          `The slug holder ${label(house)} has no flag while ${otherFlagged.length} other vendor(s) do. Decide which is the store's own.`,
        );
      }
    } else {
      for (const { vendor, history } of strays) {
        const quiet =
          history.products === 0 && history.orders === 0 && history.ownEntries === 0;
        if (quiet) {
          writes.push({ kind: "clear-stray-flag", vendor, set: { isDefault: false } });
        } else {
          kept.push({ vendor, history });
        }
      }
    }
  } else if (house) {
    // Found by the flag alone: no slug holder.
    if (flagged.length === 1) {
      writes.push({ kind: "give-slug", vendor: house, set: { slug: HOUSE_SLUG } });
    } else {
      actionNeeded.push(
        `${flagged.length} vendors carry isDefault and none holds the slug "${HOUSE_SLUG}". Decide which is the store's own, give it that slug by hand, then run this again to clear the others' flags.`,
      );
    }
  } else if (legacyCandidates.length > 0) {
    actionNeeded.push(
      `No house profile, but ${legacyCandidates.length} admin-owned store(s) hold admin-made products. If one of them is the store's own, run with --apply --adopt=<its id>.`,
    );
  }

  for (const index of indexes) {
    if (index.present) continue;
    if (index.duplicates === 0) {
      writes.push({ kind: "create-index", field: index.field });
    } else {
      actionNeeded.push(
        `vendors.${index.field} has no unique index and ${index.duplicates} duplicate value(s) block one.`,
      );
    }
  }

  return {
    house,
    slugHolders: slugHolders.length,
    strays,
    kept,
    legacyCandidates,
    freeAdmins,
    indexes,
    writes,
    actionNeeded,
  };
}

/** Carry out a plan's writes. Each write is guarded, so a re-run is a no-op. */
export async function applyHouseProfile(db, plan) {
  const vendors = db.collection("vendors");
  let written = 0;
  for (const write of plan.writes) {
    if (write.kind === "create-index") {
      await vendors.createIndex(
        { [write.field]: 1 },
        { name: `${write.field}_1`, unique: true, background: true },
      );
      written += 1;
      continue;
    }
    const guard =
      write.kind === "clear-stray-flag"
        ? { isDefault: true }
        : write.kind === "flag-slug-holder"
          ? { isDefault: { $ne: true } }
          : write.kind === "give-slug"
            ? { slug: { $ne: HOUSE_SLUG } }
            : {};
    const result = await vendors.updateOne(
      { _id: write.vendor._id, ...guard },
      { $set: { ...write.set, updatedAt: new Date() } },
    );
    written += result.modifiedCount;
  }
  return written;
}

function describe(plan, apply) {
  const lines = [];
  lines.push(
    plan.house
      ? `House profile: ${label(plan.house)}`
      : `House profile: none. ${
          plan.legacyCandidates.length > 0
            ? "It is not made on its own while a probable older one exists (below)."
            : plan.freeAdmins > 0
              ? "It is made on first need (the product form, inventory, POS, or saving Settings → General)."
              : "No admin without a store exists to own one: add an admin account that owns no store."
        }`,
  );
  for (const { vendor, history } of plan.strays) {
    lines.push(
      `Also flagged: ${label(vendor)} — products ${history.products}, orders ${history.orders}, own-book ledger entries ${history.ownEntries}`,
    );
  }
  for (const { vendor, history } of plan.kept) {
    lines.push(
      `  kept: ${vendor.storeName || idOf(vendor)} has history (orders ${history.orders}, own-book entries ${history.ownEntries}); its flag stays so the finance cron posts nothing twice. Its old entries are a separate finance repair.`,
    );
  }
  for (const { vendor, adminProducts } of plan.legacyCandidates) {
    lines.push(
      `Probable older house: ${label(vendor)} — ${adminProducts} admin-made product(s)`,
    );
  }
  for (const index of plan.indexes) {
    lines.push(
      `Index vendors.${index.field} (unique): ${index.present ? "present" : "missing"}`,
    );
  }
  for (const write of plan.writes) {
    const what =
      write.kind === "create-index"
        ? `create the unique index vendors.${write.field}_1`
        : `${write.kind}: ${label(write.vendor)} → ${JSON.stringify(write.set)}`;
    lines.push(`${apply ? "  + " : "  would "}${what}`);
  }
  for (const note of plan.actionNeeded) lines.push(`ACTION NEEDED: ${note}`);
  if (
    plan.writes.length === 0 &&
    plan.actionNeeded.length === 0 &&
    plan.kept.length === 0
  ) {
    lines.push("Nothing to do.");
  }
  return lines;
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
}

async function run() {
  const APPLY = process.argv.includes("--apply");
  const ADOPT = argValue("--adopt");
  const MONGODB_URI = process.env.MONGODB_URI;
  const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME;
  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }
  if (ADOPT && !mongoose.isValidObjectId(ADOPT)) {
    console.error(`❌ --adopt needs a vendor id, got "${ADOPT}".`);
    process.exit(1);
  }

  await mongoose.connect(MONGODB_URI, {
    ...(MONGODB_DB_NAME ? { dbName: MONGODB_DB_NAME } : {}),
  });
  const db = mongoose.connection.db;
  console.log(
    `${APPLY ? "🚀 Applying" : "🔍 Report only (pass --apply to write)"} on database "${db.databaseName}"`,
  );

  const plan = await planHouseProfile(db, { adopt: ADOPT });
  const written = APPLY ? await applyHouseProfile(db, plan) : 0;
  for (const line of describe(plan, APPLY)) console.log(line);
  console.log(
    APPLY
      ? `✅ Done — ${written} write(s).`
      : `✅ Report complete — ${plan.writes.length} write(s) would be made.`,
  );
  await mongoose.disconnect();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch(async (error) => {
    console.error("❌ House profile migration failed:", error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
