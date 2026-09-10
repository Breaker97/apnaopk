/**
 * Realign every vendor owner's `user.role` with the vendor record they own.
 *
 * `Vendor.status` and `user.role` record the same fact in two places, and for a
 * long time only the admin approval endpoint wrote both. Every path that
 * brought a store back from the billing side — a Stripe webhook, a one-shot
 * gateway confirmation — restored the vendor document alone. An owner demoted
 * by the suspension before it therefore stayed a `customer`: their storefront
 * kept selling and taking orders, while every `/vendor/*` page bounced them to
 * `/become-vendor` and offered them a signup wizard for the store they were
 * still paying a subscription on.
 *
 * The activation paths now repair the role themselves and the vendor area
 * guard heals a drifted request in place, so this script is for the accounts
 * that drifted before those landed. It is idempotent — running it on a healthy
 * store writes nothing.
 *
 * WHAT IT WILL NOT DO IS DEMOTE. A user holding `vendor` whose store is
 * suspended, rejected or gone is reported and left alone: taking a role away
 * cuts off a live merchant, the data cannot say whether an admin meant it, and
 * the mistake is not one an admin would notice until the merchant complains.
 * Promotion restores access the vendor record already says they are owed;
 * demotion is a decision, and decisions belong to whoever made them.
 *
 * Admin and staff owners are skipped by `decideVendorOwnerRoleRepair` — their
 * roles answer to a different lifecycle and `setUserRole` would overwrite it.
 *
 *   tsx --env-file=.env scripts/reconcile-vendor-owner-roles.ts           # report
 *   tsx --env-file=.env scripts/reconcile-vendor-owner-roles.ts --apply   # write
 */

import { basename } from "node:path";

import { USER_ROLES, VENDOR_STATUS } from "@/config/app.config";
import { connectDB, disconnectDB, mongoose } from "@/lib/db";
import { decideVendorOwnerRoleRepair, setUserRole } from "@/lib/access/user-role";

const LOG = "[vendor-owner-roles]";
const apply = process.argv.includes("--apply");

type OwnerDoc = {
  _id: unknown;
  email?: string;
  role?: string;
  roles?: unknown;
  emailVerificationAudience?: string;
};

type VendorDoc = {
  _id: unknown;
  userId?: unknown;
  storeName?: string;
  status?: string;
  storeActive?: boolean;
  isDefault?: boolean;
};

function label(vendor: VendorDoc, owner: OwnerDoc | null) {
  const store = vendor.storeName || String(vendor._id);
  return `${store} <${owner?.email ?? "no owner"}>`;
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  console.log(
    `${LOG} ${apply ? "APPLY" : "REPORT ONLY (pass --apply to write)"} — connected to "${db.databaseName}".`,
  );

  const users = db.collection<OwnerDoc>("user");
  const vendors = db.collection<VendorDoc>("vendors");

  // Approved stores whose owner should hold the vendor role. The house vendor
  // is excluded: it is owned by an admin on purpose, and promoting that account
  // would strip the admin rights the whole store runs on.
  const live = await vendors
    .find(
      { status: VENDOR_STATUS.APPROVED, isDefault: { $ne: true } },
      {
        projection: {
          userId: 1,
          storeName: 1,
          status: 1,
          storeActive: 1,
          isDefault: 1,
        },
      },
    )
    .toArray();

  console.log(`${LOG} ${live.length} approved vendor(s) to check.\n`);

  let promoted = 0;
  let healthy = 0;
  let skipped = 0;
  let ownerless = 0;

  for (const vendor of live) {
    if (!vendor.userId) {
      ownerless += 1;
      console.log(`${LOG} ORPHAN   ${label(vendor, null)} — vendor has no userId`);
      continue;
    }

    const owner = await users.findOne(
      { _id: vendor.userId },
      { projection: { email: 1, role: 1, roles: 1, emailVerificationAudience: 1 } },
    );

    if (!owner) {
      ownerless += 1;
      console.log(
        `${LOG} ORPHAN   ${vendor.storeName} — owner ${String(vendor.userId)} does not exist`,
      );
      continue;
    }

    const decision = decideVendorOwnerRoleRepair(owner);

    if (decision === "already-vendor") {
      healthy += 1;
      continue;
    }

    if (decision === "protected") {
      skipped += 1;
      console.log(
        `${LOG} SKIP     ${label(vendor, owner)} — admin/staff account (role=${owner.role})`,
      );
      continue;
    }

    promoted += 1;
    console.log(
      `${LOG} ${apply ? "PROMOTE " : "WOULD FIX"} ${label(vendor, owner)} — role=${owner.role} roles=${JSON.stringify(owner.roles)} audience=${owner.emailVerificationAudience} → vendor`,
    );

    if (apply) {
      await setUserRole(String(owner._id), USER_ROLES.VENDOR);
    }
  }

  // The other direction, reported and never written. See the header.
  const vendorRoleUsers = await users
    .find({ role: USER_ROLES.VENDOR }, { projection: { email: 1, role: 1 } })
    .toArray();

  const stale: string[] = [];
  for (const owner of vendorRoleUsers) {
    const vendor = await vendors.findOne(
      { userId: owner._id },
      { projection: { storeName: 1, status: 1 } },
    );
    if (!vendor) {
      stale.push(`${owner.email} — holds vendor role with no vendor record`);
    } else if (vendor.status !== VENDOR_STATUS.APPROVED) {
      stale.push(
        `${owner.email} — holds vendor role, store "${vendor.storeName}" is ${vendor.status}`,
      );
    }
  }

  console.log(
    `\n${LOG} healthy=${healthy} ${apply ? "promoted" : "would promote"}=${promoted} skipped=${skipped} orphaned=${ownerless}`,
  );

  if (stale.length) {
    console.log(
      `\n${LOG} ${stale.length} account(s) hold the vendor role without an approved store.`,
    );
    console.log(`${LOG} Reported only — demotion is an admin decision:`);
    for (const line of stale) console.log(`${LOG}   ${line}`);
  }

  if (!apply && promoted > 0) {
    console.log(`\n${LOG} Re-run with --apply to write these ${promoted} change(s).`);
  }

  await disconnectDB();
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  main().catch((error) => {
    console.error(`${LOG} failed:`, error);
    process.exit(1);
  });
}
