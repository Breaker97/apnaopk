/**
 * Give every inventory location an owning vendor.
 *
 * Locations used to be platform-global. They are now per-merchant, so each
 * existing row has to be assigned to one. Every location in a pre-upgrade store
 * was created through the admin/staff dashboards, so they all belong to the
 * house vendor — the same vendor an admin acts as in single-vendor mode.
 *
 * The second half is the interesting one. `Product.locationInventory[].locationId`
 * is a bare string with no reference and no validation, so after the assignment
 * some products will hold stock rows pointing at a location that now belongs to
 * a different merchant. This script REPORTS those by default and changes
 * nothing, because moving them is not always safe to do blind:
 * `product.stock` is recomputed as the sum of the location rows on every
 * ordinary save (see models/product.model.ts `buildProductAggregateUpdate`), so
 * dropping a row silently destroys the units in it.
 *
 * `--move-orphan-stock` performs the only lossless fix: for each affected
 * vendor it moves the quantity onto that vendor's own default location,
 * creating one if they have none. The sum is preserved exactly, so no product's
 * visible stock changes.
 *
 * Usage:
 *   pnpm db:migrate location-vendor --dry-run          # report only, writes nothing
 *   pnpm db:migrate location-vendor              # assign owners
 *   pnpm db:migrate location-vendor -- --move-orphan-stock
 *   pnpm db:migrate location-vendor -- --owner-vendor-id=<id>
 *
 * Idempotent: assignment filters on locations that have no owner yet, and the
 * orphan pass is recomputed from current data on every run.
 */

import { connectDB, disconnectDB, mongoose } from "@/lib/db";

const LOG = "[location-vendor]";

const dryRun = process.argv.includes("--dry-run");
const moveOrphanStock = process.argv.includes("--move-orphan-stock");
const ownerArg = process.argv
  .find((arg) => arg.startsWith("--owner-vendor-id="))
  ?.split("=")[1]
  ?.trim();

type LocationRow = {
  _id?: unknown;
  name?: string;
  address?: string;
  vendorId?: unknown;
  isDefault?: boolean;
  isActive?: boolean;
  fulfillsOnlineOrders?: boolean;
  pickupEnabled?: boolean;
  pickupArea?: string;
  instructions?: string;
  weeklyHours?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
};

type InventoryRow = { locationId?: unknown; quantity?: number };

type ProductRow = {
  _id: unknown;
  name?: string;
  vendorId?: unknown;
  locationInventory?: InventoryRow[];
  variants?: Array<{ _id?: unknown; locationInventory?: InventoryRow[] }>;
};

async function run() {
  await connectDB();
  const database = mongoose.connection.db;
  if (!database) throw new Error("MongoDB database connection is unavailable");

  const locations = database.collection<LocationRow>("inventorylocations");
  const products = database.collection<ProductRow>("products");
  const vendors = database.collection("vendors");

  // ---------------------------------------------------------------- preflight
  // Resolved by query rather than through lib/multi-vendor.ts: the helpers there
  // are `unstable_cache`d (no Next runtime here) and the get-or-create variant
  // would WRITE to the vendor and to the owner's roles.
  const houseVendor = ownerArg
    ? await vendors.findOne({ _id: new mongoose.Types.ObjectId(ownerArg) })
    : await vendors.findOne(
        { $or: [{ isDefault: true }, { slug: "main-store" }] },
        { sort: { isDefault: -1 } },
      );

  if (!houseVendor) {
    throw new Error(
      `${LOG} No default vendor found. Save your store settings first, or pass --owner-vendor-id=<id>.`,
    );
  }

  const houseVendorId = String(houseVendor._id);
  console.log(
    `${LOG} House vendor: ${houseVendor.storeName || "(unnamed)"} ` +
      `[${houseVendorId}] slug=${houseVendor.slug ?? "-"} isDefault=${Boolean(
        houseVendor.isDefault,
      )}`,
  );
  if (!ownerArg && !houseVendor.isDefault) {
    console.warn(
      `${LOG} WARNING: matched by slug, not by the isDefault flag. ` +
        `Confirm this is your own store before running without --dry-run.`,
    );
  }

  // `isDefault` is not a unique index, and stores are found carrying it on more
  // than one vendor — usually a leftover from an early multi-vendor switch.
  // While it is ambiguous, `findOne({ isDefault: true })` answers whichever
  // document Mongo returns first, so "the house store" can change between
  // requests and location scoping drifts with it.
  const strayDefaults = await vendors
    .find({ isDefault: true, _id: { $ne: houseVendor._id } })
    .toArray();

  if (strayDefaults.length > 0) {
    console.warn(
      `${LOG} ${strayDefaults.length} other vendor(s) also carry isDefault:`,
    );
    for (const stray of strayDefaults) {
      console.warn(
        `${LOG}   - ${stray.storeName || "(unnamed)"} [${String(stray._id)}] slug=${stray.slug ?? "-"}`,
      );
    }
    if (dryRun) {
      console.log(
        `${LOG} Would clear isDefault on ${strayDefaults.length} vendor(s), keeping ${houseVendorId}.`,
      );
    } else {
      const cleared = await vendors.updateMany(
        { isDefault: true, _id: { $ne: houseVendor._id } },
        { $set: { isDefault: false } },
      );
      console.log(
        `${LOG} Cleared isDefault on ${cleared.modifiedCount} vendor(s). ` +
          `To undo: set isDefault back to true on the ids listed above.`,
      );
    }
  }

  // ------------------------------------- phase 0b: rescue the admin's address
  // A store could type a pickup address into admin Settings → Shipping, where it
  // fed a rate option every caller disabled — so the switch never did anything
  // at checkout. That setting is gone now, but the address is real data the
  // merchant entered, so it seeds their first real branch rather than being
  // dropped when the field is removed.
  const settingsDoc = await database.collection("settings").findOne({});
  const legacyPickup = settingsDoc?.shipping?.localPickup as
    | { enabled?: boolean; pickupAddress?: string; instructions?: string }
    | undefined;
  const houseHasBranches = Boolean(
    houseVendor.shipping?.localPickup?.locations?.length,
  );

  if (legacyPickup?.pickupAddress?.trim() && !houseHasBranches) {
    const address = legacyPickup.pickupAddress.trim();
    const existing = await locations.findOne({
      vendorId: houseVendor._id,
      address,
    });

    if (existing) {
      console.log(`${LOG} The admin's pickup address is already a location.`);
    } else if (dryRun) {
      console.log(
        `${LOG} Would create a collection point from the admin's pickup ` +
          `address ("${address}", enabled=${Boolean(legacyPickup.enabled)}).`,
      );
    } else {
      const now = new Date();
      await locations.insertOne({
        vendorId: houseVendor._id,
        name: "Main pickup location",
        address,
        isDefault: false,
        isActive: true,
        // A collection counter, not a dispatch point. This used to be
        // `stocksInventory: false`, a flag no form could ever set again;
        // `fulfillsOnlineOrders` says the same thing and the merchant can
        // switch it back on once they decide to post from here.
        fulfillsOnlineOrders: false,
        pickupEnabled: Boolean(legacyPickup.enabled),
        instructions: legacyPickup.instructions?.trim() || "",
        weeklyHours: [],
        createdAt: now,
        updatedAt: now,
      });
      console.log(
        `${LOG} Created a collection point from the admin's pickup address.`,
      );
    }
  }

  // ------------------------------ phase 0c: pickup branches become locations
  // Collection points used to be a separate list embedded on the vendor, so the
  // same physical address was described twice and neither copy knew about the
  // other. They are inventory locations now, distinguished by `pickupEnabled`.
  const vendorsWithBranches = await vendors
    .find({ "shipping.localPickup.locations.0": { $exists: true } })
    .toArray();

  let branchesMoved = 0;
  for (const vendor of vendorsWithBranches) {
    const branches = vendor.shipping?.localPickup?.locations ?? [];
    const pickupEnabled = Boolean(vendor.shipping?.localPickup?.enabled);

    for (const branch of branches) {
      const name = String(branch.name || "").trim();
      const address = String(branch.pickupAddress || "").trim();
      if (!name || !address) continue;

      // Idempotent: a branch already moved has a location with the same owner
      // and name, so a second run adds nothing.
      const already = await locations.findOne({ vendorId: vendor._id, name });
      if (already) continue;

      if (dryRun) {
        console.log(
          `${LOG} Would move pickup branch "${name}" to a location for ` +
            `${vendor.storeName || vendor._id}.`,
        );
        branchesMoved += 1;
        continue;
      }

      const now = new Date();
      await locations.insertOne({
        vendorId: vendor._id,
        name,
        address,
        isDefault: false,
        isActive: branch.enabled !== false,
        // A collection counter, not a dispatch point. This used to be
        // `stocksInventory: false`, a flag no form could ever set again;
        // `fulfillsOnlineOrders` says the same thing and the merchant can
        // switch it back on once they decide to post from here.
        fulfillsOnlineOrders: false,
        // Only publishable when the vendor had pickup switched on at all; a
        // branch left behind by a disabled profile must not go live silently.
        pickupEnabled: pickupEnabled && branch.enabled !== false,
        pickupArea: String(branch.pickupArea || "").trim(),
        instructions: String(branch.instructions || "").trim(),
        weeklyHours: Array.isArray(branch.weeklyHours) ? branch.weeklyHours : [],
        createdAt: now,
        updatedAt: now,
      });
      branchesMoved += 1;
    }
  }

  if (branchesMoved > 0) {
    console.log(
      `${LOG} ${dryRun ? "Would move" : "Moved"} ${branchesMoved} pickup branch(es) ` +
        `into locations.`,
    );
  } else {
    console.log(`${LOG} No embedded pickup branches to move.`);
  }

  // ------------------------------------------------------- phase 1: ownership
  const unownedFilter = { $or: [{ vendorId: { $exists: false } }, { vendorId: null }] };
  const unownedCount = await locations.countDocuments(unownedFilter);
  const totalLocations = await locations.countDocuments({});

  console.log(
    `${LOG} Locations: ${totalLocations} total, ${unownedCount} without an owner.`,
  );

  if (unownedCount > 0) {
    const sample = await locations
      .find(unownedFilter, { projection: { name: 1, isDefault: 1, isActive: 1 } })
      .limit(20)
      .toArray();
    for (const row of sample) {
      console.log(
        `${LOG}   - ${row.name ?? "(unnamed)"}${row.isDefault ? " [default]" : ""}` +
          `${row.isActive === false ? " [inactive]" : ""}`,
      );
    }
    if (unownedCount > sample.length) {
      console.log(`${LOG}   … and ${unownedCount - sample.length} more`);
    }

    if (dryRun) {
      console.log(
        `${LOG} Would assign ${unownedCount} location(s) to the house vendor.`,
      );
    } else {
      const result = await locations.updateMany(unownedFilter, {
        $set: { vendorId: houseVendor._id },
      });
      console.log(`${LOG} Assigned ${result.modifiedCount} location(s).`);
    }
  }

  // ---------------------------------------------------- phase 2: orphan stock
  // A product may only hold stock at its own vendor's locations. Anything else
  // is invisible to that merchant's UI and unusable by their register.
  const ownerByLocation = new Map<string, string>();
  const locationNames = new Map<string, string>();
  for (const row of await locations.find({}).toArray()) {
    const id = String(row._id);
    locationNames.set(id, row.name ?? "(unnamed)");
    // Reflect what phase 1 just did (or would do) so the report is consistent
    // between a dry run and a real run.
    ownerByLocation.set(
      id,
      row.vendorId ? String(row.vendorId) : houseVendorId,
    );
  }

  type Orphan = {
    productId: string;
    productName: string;
    vendorId: string;
    variantId?: string;
    locationId: string;
    quantity: number;
  };

  const orphans: Orphan[] = [];
  const cursor = products.find(
    {
      $or: [
        { "locationInventory.0": { $exists: true } },
        { "variants.locationInventory.0": { $exists: true } },
      ],
    },
    { projection: { name: 1, vendorId: 1, locationInventory: 1, "variants._id": 1, "variants.locationInventory": 1 } },
  );

  let scanned = 0;
  for await (const product of cursor) {
    scanned += 1;
    const productVendorId = product.vendorId ? String(product.vendorId) : "";
    if (!productVendorId) continue;

    const collect = (rows: InventoryRow[] | undefined, variantId?: string) => {
      for (const row of rows ?? []) {
        const locationId = row.locationId ? String(row.locationId) : "";
        if (!locationId) continue;

        const owner = ownerByLocation.get(locationId);
        // A row pointing at a location that no longer exists is a separate
        // pre-existing problem; it is reported but not moved.
        if (owner === undefined) {
          orphans.push({
            productId: String(product._id),
            productName: product.name ?? "(unnamed)",
            vendorId: productVendorId,
            variantId,
            locationId,
            quantity: Number(row.quantity) || 0,
          });
          continue;
        }
        if (owner === productVendorId) continue;

        orphans.push({
          productId: String(product._id),
          productName: product.name ?? "(unnamed)",
          vendorId: productVendorId,
          variantId,
          locationId,
          quantity: Number(row.quantity) || 0,
        });
      }
    };

    collect(product.locationInventory);
    for (const variant of product.variants ?? []) {
      collect(variant.locationInventory, variant._id ? String(variant._id) : undefined);
    }
  }

  const orphanUnits = orphans.reduce((sum, row) => sum + row.quantity, 0);
  const orphanProducts = new Set(orphans.map((row) => row.productId));
  const missingLocations = new Set(
    orphans
      .filter((row) => !ownerByLocation.has(row.locationId))
      .map((row) => row.locationId),
  );

  console.log(
    `${LOG} Scanned ${scanned} product(s) with location stock. ` +
      `${orphans.length} row(s) across ${orphanProducts.size} product(s) point at a ` +
      `location owned by another merchant, holding ${orphanUnits} unit(s).`,
  );
  if (missingLocations.size > 0) {
    console.warn(
      `${LOG} ${missingLocations.size} row(s) reference a location that no longer exists — ` +
        `these are left untouched.`,
    );
  }

  for (const row of orphans.slice(0, 20)) {
    console.log(
      `${LOG}   - ${row.productName}${row.variantId ? " (variant)" : ""}: ` +
        `${row.quantity} @ ${locationNames.get(row.locationId) ?? row.locationId}`,
    );
  }
  if (orphans.length > 20) {
    console.log(`${LOG}   … and ${orphans.length - 20} more`);
  }

  if (orphans.length === 0) {
    console.log(`${LOG} Nothing to reconcile.`);
  } else if (!moveOrphanStock) {
    console.log(
      `${LOG} Left as-is. Product stock totals are unchanged, but these units are ` +
        `not visible to their merchant. Re-run with --move-orphan-stock to move them ` +
        `onto each merchant's own default location (sum preserved).`,
    );
  } else {
    await moveOrphans(
      database,
      orphans.filter((row) => ownerByLocation.has(row.locationId)),
    );
  }

  console.log(
    dryRun
      ? `${LOG} Dry run complete — nothing was written.`
      : `${LOG} Migration complete.`,
  );
}

/**
 * Move each orphan quantity onto a location its own merchant owns.
 *
 * The sum across a product's rows is preserved, so `product.stock` — which is
 * recomputed from that sum on the next save — does not move.
 */
async function moveOrphans(
  database: NonNullable<typeof mongoose.connection.db>,
  orphans: Array<{
    productId: string;
    vendorId: string;
    variantId?: string;
    locationId: string;
    quantity: number;
  }>,
) {
  const locations = database.collection("inventorylocations");
  const products = database.collection("products");
  const vendors = database.collection("vendors");
  const targetByVendor = new Map<string, string>();

  for (const vendorId of new Set(orphans.map((row) => row.vendorId))) {
    const objectId = new mongoose.Types.ObjectId(vendorId);
    const existing = await locations.findOne(
      { vendorId: objectId, isActive: { $ne: false } },
      { sort: { isDefault: -1, createdAt: 1 } },
    );

    if (existing) {
      targetByVendor.set(vendorId, String(existing._id));
      continue;
    }

    const vendor = await vendors.findOne({ _id: objectId });
    const name = `${vendor?.storeName || "Store"} Warehouse`;

    if (dryRun) {
      console.log(`${LOG} Would create location "${name}" for vendor ${vendorId}.`);
      targetByVendor.set(vendorId, `pending:${vendorId}`);
      continue;
    }

    const now = new Date();
    const created = await locations.insertOne({
      vendorId: objectId,
      name,
      isDefault: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`${LOG} Created location "${name}" for vendor ${vendorId}.`);
    targetByVendor.set(vendorId, String(created.insertedId));
  }

  // Rewritten per product rather than per row.
  //
  // The first version issued $inc/$push/$pull against `variants.$[v]` with
  // arrayFilters — and matched a *string* variant id against the ObjectId Mongo
  // stores, so every variant row silently missed all three updates while the
  // script counted them as moved. Reading the arrays, rebuilding them here and
  // writing them back is both simpler to reason about and verifiable: the sum
  // is checked before and after, and a mismatch aborts rather than being
  // reported as success.
  const byProduct = new Map<string, typeof orphans>();
  for (const row of orphans) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(row);
    byProduct.set(row.productId, list);
  }

  let movedRows = 0;
  let movedUnits = 0;

  for (const [productId, rows] of byProduct) {
    const targetId = targetByVendor.get(rows[0].vendorId);
    if (!targetId) continue;

    if (dryRun) {
      movedRows += rows.length;
      movedUnits += rows.reduce((sum, row) => sum + row.quantity, 0);
      continue;
    }

    const product = await products.findOne({
      _id: new mongoose.Types.ObjectId(productId),
    });
    if (!product) continue;

    const foreign = new Set(rows.map((row) => row.locationId));

    /** Fold every foreign row's quantity into the merchant's own location. */
    const rebuild = (input: InventoryRow[] | undefined) => {
      const source = input ?? [];
      const before = source.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

      let moved = 0;
      const kept: InventoryRow[] = [];
      for (const r of source) {
        if (foreign.has(String(r.locationId))) moved += Number(r.quantity) || 0;
        else kept.push(r);
      }
      if (moved === 0 && kept.length === source.length) return null;

      const target = kept.find((r) => String(r.locationId) === targetId);
      if (target) target.quantity = (Number(target.quantity) || 0) + moved;
      else kept.push({ locationId: targetId, quantity: moved });

      const after = kept.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);
      if (after !== before) {
        throw new Error(
          `${LOG} Refusing to write: ${product.name} sum changed ${before} -> ${after}`,
        );
      }
      return kept;
    };

    const update: Record<string, unknown> = {};

    const productLevel = rebuild(product.locationInventory);
    if (productLevel) update.locationInventory = productLevel;

    const variants = (product.variants ?? []) as Array<
      { locationInventory?: InventoryRow[] } & Record<string, unknown>
    >;
    let variantsChanged = false;
    const nextVariants = variants.map((variant) => {
      const rebuilt = rebuild(variant.locationInventory);
      if (!rebuilt) return variant;
      variantsChanged = true;
      return { ...variant, locationInventory: rebuilt };
    });
    if (variantsChanged) update.variants = nextVariants;

    if (Object.keys(update).length === 0) continue;

    const result = await products.updateOne(
      { _id: new mongoose.Types.ObjectId(productId) },
      { $set: update },
    );
    if (result.modifiedCount !== 1) {
      throw new Error(
        `${LOG} Failed to write ${product.name} (${productId}); aborting so the run is not reported as complete.`,
      );
    }

    movedRows += rows.length;
    movedUnits += rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  console.log(
    `${LOG} ${dryRun ? "Would move" : "Moved"} ${movedRows} stock row(s) ` +
      `(${movedUnits} unit(s)) to their own merchant's location.`,
  );
}

run()
  .catch((error) => {
    console.error(`${LOG} Migration failed:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB();
  });
