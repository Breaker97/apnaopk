import mongoose from "mongoose";

/**
 * Vendor access model migration: grant list → plan entitlement + overrides
 * =======================================================================
 *
 * Moves every vendor from the legacy `Vendor.permissions` array onto the derived
 * model in lib/vendor-permissions.ts, and gives every plan an explicit `packs`
 * list. See docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.2–§2.3.
 *
 * WHY A MIGRATION AT ALL, given the runtime already falls back:
 * `resolveVendorAccess` converts a legacy list to overrides on the fly, so the
 * app is correct with or without this script. What it cannot do is tell an
 * ABSENT override array ("not migrated") from an EMPTY one ("no deviations") —
 * so until a row is migrated, an admin clearing every override on the Access tab
 * and saving is the only thing that pins it. Running this makes the state
 * explicit for every vendor at once.
 *
 * WHAT IT WRITES, per vendor:
 *   entitled = expand(plan.packs, or the commission-only baseline)
 *   revoke   for each entitled permission the vendor does NOT hold
 *   grant    for each held permission that is NOT entitled
 * That reproduces today's effective access exactly — nobody gains or loses
 * anything on deploy. Narrowed vendors keep their narrowing as revokes; vendors
 * on the full default list end up with grants only where their plan sells less.
 *
 * AND, per plan: `capabilities.packs` from the old `aiAuthoring` flag —
 * baseline + aiStudio when it was on, baseline alone when it was off. A legacy
 * plan gated nothing but AI, so that is what it is read as; anything else would
 * silently change what existing subscribers hold.
 *
 * Note the ONE deliberate asymmetry: `aiStudio` is not in the baseline, because
 * AI authoring spends the operator's own OpenAI key with no path to bill it back
 * (see COMMISSION_ONLY_PACKS). A plan-less vendor is denied it today by
 * checkPlanCapability, and stays denied after this runs.
 *
 * WHAT IT SKIPS: a vendor with no legacy `permissions` array at all (nothing to
 * convert — an empty `held` set would revoke everything), and the internal
 * default vendor, which is exempt from all four layers.
 *
 * Idempotent: a vendor that already has `permissionOverrides` is skipped, as is
 * a plan that already has `capabilities.packs` — INCLUDING an empty one, which
 * is a deliberate "sells nothing". A second run reports 0 changes.
 *
 * Usage:
 *   node --env-file=.env scripts/migrate-vendor-permission-overrides.mjs            (apply)
 *   node --env-file=.env scripts/migrate-vendor-permission-overrides.mjs --dry-run  (report only)
 */

const DRY_RUN = process.argv.includes("--dry-run");

// Mirrors config/permissions.config.ts. Duplicated because migration scripts run
// as plain ESM without the "@/" path alias; the test in
// tests/vendor-permission-packs.test.ts asserts the two stay in step.
const VENDOR_PERMISSION_PACKS = {
  catalog: [
    "view_products",
    "manage_products",
    "create_products",
    "edit_products",
    "delete_products",
    "view_brands",
    "create_brands",
    "edit_brands",
  ],
  orders: [
    "view_orders",
    "manage_orders",
    "create_orders",
    "edit_orders",
    "delete_orders",
  ],
  storefront: [
    "view_store_settings",
    "manage_store_settings",
    "edit_store_settings",
  ],
  analytics: ["view_analytics"],
  inbox: ["view_inbox", "reply_inbox", "manage_inbox", "manage_channels"],
  staff: [
    "view_staff",
    "manage_staff",
    "create_staff",
    "edit_staff",
    "delete_staff",
  ],
  discounts: [
    "view_discounts",
    "manage_discounts",
    "create_discounts",
    "edit_discounts",
    "delete_discounts",
  ],
  pos: ["access_pos"],
  payouts: [
    "view_payouts",
    "manage_payouts",
  ],
  boosts: ["view_boosts", "manage_boosts"],
  aiStudio: ["access_ai_studio"],
};

const COMMISSION_ONLY_PACKS = [
  "catalog",
  "orders",
  "storefront",
  "analytics",
  "inbox",
  "staff",
  "discounts",
  "pos",
  "payouts",
  "boosts",
];

/**
 * Permissions retired in the same change that removed them from the enum, and
 * the surviving permission each one used to satisfy. Kept in step with
 * scripts/migrate-retire-decorative-vendor-permissions.mjs, which is where the
 * reasoning lives.
 */
const RETIRED_PROMOTIONS = {
  create_analytics: "view_analytics",
  edit_analytics: "view_analytics",
  delete_analytics: "view_analytics",
  create_store_settings: "view_store_settings",
  delete_store_settings: "view_store_settings",
  create_payouts: "view_payouts",
  edit_payouts: "view_payouts",
  delete_payouts: "view_payouts",
  create_pos: "access_pos",
  edit_pos: "access_pos",
  delete_pos: "access_pos",
};

function expandPacks(packs) {
  const out = new Set();
  for (const pack of packs) {
    for (const permission of VENDOR_PERMISSION_PACKS[pack] ?? []) {
      out.add(permission);
    }
  }
  return out;
}

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (!MONGODB_URI) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      // Mirrors lib/db.ts: without this a URI with no path segment silently
      // targets the `test` database and the migration reports "nothing to do".
      ...(process.env.MONGODB_DB_NAME
        ? { dbName: process.env.MONGODB_DB_NAME }
        : {}),
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log("✓ Connected to MongoDB");

    const db = mongoose.connection.db;
    if (!db) {
      console.error("❌ Database connection not available");
      process.exit(1);
    }

    const settings = await db.collection("settings").findOne({});
    const plansEnabled = Boolean(
      settings?.multiVendorMode?.enabled && settings?.vendorConfig?.plansEnabled,
    );
    console.log(
      plansEnabled
        ? "· Plans are in force — vendors on a plan take that plan's packs"
        : "· Plans are NOT in force — every vendor takes the commission-only baseline",
    );

    // ---------------------------------------------------------------- plans
    const plans = await db
      .collection("vendorplans")
      .find({}, { projection: { _id: 1, name: 1, capabilities: 1 } })
      .toArray();

    let plansUpdated = 0;
    const planPacks = new Map();

    for (const plan of plans) {
      const existing = plan.capabilities?.packs;
      // ANY array is already authored — including an empty one, which is a
      // deliberate "this plan sells nothing". Overwriting that with the
      // baseline would silently hand its subscribers ten packs.
      if (Array.isArray(existing)) {
        planPacks.set(String(plan._id), existing);
        continue;
      }

      const packs = plan.capabilities?.aiAuthoring
        ? [...COMMISSION_ONLY_PACKS, "aiStudio"]
        : [...COMMISSION_ONLY_PACKS];
      planPacks.set(String(plan._id), packs);

      console.log(
        `  plan "${plan.name}" → ${packs.length} packs${
          plan.capabilities?.aiAuthoring ? " (incl. aiStudio)" : ""
        }`,
      );

      if (!DRY_RUN) {
        await db
          .collection("vendorplans")
          .updateOne(
            { _id: plan._id },
            { $set: { "capabilities.packs": packs } },
          );
      }
      plansUpdated += 1;
    }

    // -------------------------------------------------------------- vendors
    const vendors = await db
      .collection("vendors")
      .find(
        { permissionOverrides: { $exists: false } },
        {
          projection: {
            _id: 1,
            storeName: 1,
            planId: 1,
            permissions: 1,
            isDefault: 1,
          },
        },
      )
      .toArray();

    let vendorsUpdated = 0;
    let vendorsSkipped = 0;
    let totalGrants = 0;
    let totalRevokes = 0;

    for (const vendor of vendors) {
      // A row with NO legacy list has never been narrowed — it predates the
      // field, or was written outside the app. Treating a missing array as
      // "holds nothing" would emit a revoke for every entitled permission and
      // lock the vendor out of their own store. The runtime fallback
      // (`overridesFromLegacyGrants`) reads it as "no deviations", so leaving
      // the row alone is both correct and consistent with what it does today.
      if (!Array.isArray(vendor.permissions)) {
        console.log(
          `  ${vendor.storeName ?? vendor._id}: skipped — no legacy permission list to convert`,
        );
        vendorsSkipped += 1;
        continue;
      }

      // The internal default vendor is exempt from every layer (guideline
      // §2.8): it is the store itself, not a tenant, so it has no entitlement
      // to deviate from and needs no overrides.
      if (vendor.isDefault === true) {
        console.log(
          `  ${vendor.storeName ?? vendor._id}: skipped — internal default vendor, exempt from all layers`,
        );
        vendorsSkipped += 1;
        continue;
      }

      const packs =
        plansEnabled && vendor.planId
          ? (planPacks.get(String(vendor.planId)) ?? COMMISSION_ONLY_PACKS)
          : COMMISSION_ONLY_PACKS;
      const entitled = expandPacks(packs);

      // Retired verbs used to SATISFY a real permission, so a legacy list that
      // still carries one has to be promoted before it is dropped — otherwise a
      // vendor holding `create_pos` but not `access_pos` silently loses POS.
      // Repeated here (rather than assumed done) so this script is correct
      // whichever order the two migrations are run in.
      const held = new Set();
      for (const permission of vendor.permissions) {
        const promoted = RETIRED_PROMOTIONS[permission];
        if (promoted) held.add(promoted);
        else held.add(permission);
      }

      const overrides = [];
      for (const permission of entitled) {
        if (!held.has(permission)) {
          overrides.push({
            permission,
            mode: "revoke",
            reason: "Migrated from the previous permission list",
            grantedAt: new Date(),
            expiresAt: null,
          });
        }
      }
      for (const permission of held) {
        if (!entitled.has(permission)) {
          overrides.push({
            permission,
            mode: "grant",
            reason: "Migrated from the previous permission list",
            grantedAt: new Date(),
            expiresAt: null,
          });
        }
      }

      const grants = overrides.filter((o) => o.mode === "grant").length;
      const revokes = overrides.length - grants;
      totalGrants += grants;
      totalRevokes += revokes;

      if (overrides.length > 0) {
        console.log(
          `  ${vendor.storeName ?? vendor._id}: ${grants} grant, ${revokes} revoke`,
        );
      }

      if (!DRY_RUN) {
        await db
          .collection("vendors")
          .updateOne(
            { _id: vendor._id },
            { $set: { permissionOverrides: overrides } },
          );
      }
      vendorsUpdated += 1;
    }

    console.log("");
    console.log(DRY_RUN ? "DRY RUN — nothing written" : "Applied");
    console.log(`  plans given packs:      ${plansUpdated}`);
    console.log(`  vendors migrated:       ${vendorsUpdated}`);
    console.log(`  vendors skipped:        ${vendorsSkipped}`);
    console.log(`  grant overrides written:  ${totalGrants}`);
    console.log(`  revoke overrides written: ${totalRevokes}`);
    if (vendorsUpdated === 0 && plansUpdated === 0) {
      console.log("  (nothing to do — already migrated)");
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

run();
