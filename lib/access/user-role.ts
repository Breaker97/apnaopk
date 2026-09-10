import { ObjectId } from "mongodb";
import { USER_ROLES, type UserRole } from "@/config/app.config";
import { connectDB, mongoose } from "@/lib/db";
import { isStaffRole } from "@/lib/access/staff-role";

/**
 * Sets a user's primary role.
 *
 * Callers here are vendor *grants* — admin approval, billing reactivation, the
 * reconcile script — none of which mean to revoke administrator rights.
 * Rewriting `roles` to `[role]` outright did exactly that: rejecting the vendor
 * application of someone who was also an admin silently demoted them to
 * customer with no way back, because `getPrimaryRole` reads admin out of
 * `roles`. Admin membership therefore survives; every other membership is
 * replaced by the new role.
 *
 * That replacement is also why this is the wrong tool for taking a role AWAY:
 * it still wipes a staff or seller grant. Demotions go through
 * `revokeVendorRole`, which removes only the vendor membership.
 */
export async function setUserRole(userId: string, role: UserRole) {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  const _id = new ObjectId(userId);
  const existing = await db
    .collection("user")
    .findOne({ _id }, { projection: { roles: 1 } });

  if (!existing) throw new Error("User not found");

  const previousRoles = Array.isArray(existing.roles) ? existing.roles : [];
  const keepsAdmin =
    role !== USER_ROLES.ADMIN && previousRoles.includes(USER_ROLES.ADMIN);
  const roles = keepsAdmin ? [role, USER_ROLES.ADMIN] : [role];

  const result = await db.collection("user").updateOne(
    { _id },
    {
      $set: {
        role,
        roles,
        emailVerificationAudience: role === "vendor" ? "vendor" : "customer",
        updatedAt: new Date(),
      },
    },
  );

  if (result.matchedCount === 0) {
    throw new Error("User not found");
  }
}

/**
 * What a repair should do with the account that owns a live vendor record.
 *
 * Kept pure and separate from the write so the rule can be pinned by tests and
 * reused by the reconcile script without a database. The decision *is* the
 * safety argument: this runs on webhook traffic across every merchant on the
 * platform, so "when may a role be rewritten" has to be readable in one place.
 */
type VendorOwnerRoleDecision =
  | "promote"
  | "already-vendor"
  | "protected";

export function decideVendorOwnerRoleRepair(owner: {
  role?: string | null;
  roles?: unknown;
}): VendorOwnerRoleDecision {
  // A row with no array at all predates the field; `normalizeUserRoles` derives
  // one at read time, so it is absent rather than empty and must not be read as
  // a contradiction. `null` keeps those two cases apart below.
  const roles = Array.isArray(owner.roles)
    ? owner.roles.filter((role): role is string => typeof role === "string")
    : null;

  // Admins and staff hold a store through a different lifecycle — an admin who
  // also owns the house vendor, a seller attached to one — and a billing event
  // must never rewrite what they are. `setUserRole` replaces the roles array
  // wholesale, so promoting here would strip a staff grant on webhook traffic.
  if (
    owner.role === USER_ROLES.ADMIN ||
    isStaffRole(owner.role) ||
    roles?.includes(USER_ROLES.ADMIN) ||
    roles?.some(isStaffRole)
  ) {
    return "protected";
  }

  // `getPrimaryRole` hands every guard `user.role` — unless `roles` carries
  // admin, which the branch above already took — so that one field is what
  // `/vendor/*` access actually turns on. `roles` still has to agree with it,
  // because `hasRole` reads either one and an array contradicting `role` is a
  // row nobody wrote on purpose.
  //
  // `emailVerificationAudience` is deliberately NOT part of this test, even
  // though `setUserRole` writes it: `resolveEmailVerificationStatus` returns on
  // `role === vendor` before it ever reads the audience, so the field is inert
  // for an approved vendor. Requiring it would mean rewriting — on every single
  // activation — the legacy accounts that predate the field, which is the
  // opposite of the idempotence every caller here is relying on.
  const synced =
    owner.role === USER_ROLES.VENDOR &&
    (roles === null || roles.includes(USER_ROLES.VENDOR));

  return synced ? "already-vendor" : "promote";
}

/**
 * Make the owner of a live vendor record hold the vendor role.
 *
 * `Vendor.status` and `user.role` are two records of one fact, and until now
 * only the admin approval endpoint wrote both. Everything that brings a store
 * back from the billing side — a Stripe webhook, a one-shot gateway
 * confirmation — restored the vendor document alone, so an owner demoted by an
 * earlier suspension stayed a customer: the storefront kept selling their
 * products and taking orders while every `/vendor/*` page bounced them to
 * `/become-vendor`, and no admin save could repair it because the vendor read
 * `approved` on both sides of every later edit.
 *
 * Idempotent by design, so every activation path can call it unconditionally:
 * it writes only when the account does not already read as a vendor, and it
 * leaves admin and staff accounts alone. Returns true when it promoted one.
 */
export async function ensureVendorOwnerRole(userId: unknown): Promise<boolean> {
  const id = toUserObjectId(userId);
  if (!id) return false;

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  const owner = await db
    .collection("user")
    .findOne<{ role?: string; roles?: unknown }>(
      { _id: id },
      { projection: { role: 1, roles: 1 } },
    );
  if (!owner) return false;
  if (decideVendorOwnerRoleRepair(owner) !== "promote") return false;

  await setUserRole(id.toString(), USER_ROLES.VENDOR);
  return true;
}

/**
 * What taking the vendor role away should leave behind on an account.
 *
 * The mirror image of `decideVendorOwnerRoleRepair`, and pure for the same
 * reason. `setUserRole(CUSTOMER)` used to be the answer, and it rewrote the
 * whole membership set: a seller or staff member whose vendor application was
 * rejected came out the other side a plain customer — while the promotion
 * path, via the repair decision above, had always refused to touch them.
 * Only the vendor membership goes; whatever else the account holds is what it
 * keeps.
 *
 * Returns the fields to write, or null when there is no vendor membership to
 * revoke and the primary role would not move.
 */
export function decideVendorOwnerRoleRevoke(owner: {
  role?: string | null;
  roles?: unknown;
}): { role: UserRole; roles: UserRole[] } | null {
  const isKnown = (value: unknown): value is UserRole =>
    typeof value === "string" &&
    (Object.values(USER_ROLES) as string[]).includes(value);

  // A row with no array predates the field; `normalizeUserRoles` derives
  // `[role]` for it at read time, so that is the membership set to start from.
  const held: UserRole[] = Array.isArray(owner.roles)
    ? owner.roles.filter(isKnown)
    : isKnown(owner.role)
      ? [owner.role]
      : [];
  const kept = Array.from(
    new Set(held.filter((role) => role !== USER_ROLES.VENDOR)),
  );

  // A non-vendor primary role stays what it is. A vendor primary falls back
  // the way `getPrimaryRole` reads the rest of the array: admin first, then a
  // staff grant, then customer.
  const role: UserRole =
    isKnown(owner.role) && owner.role !== USER_ROLES.VENDOR
      ? owner.role
      : kept.includes(USER_ROLES.ADMIN)
        ? USER_ROLES.ADMIN
        : (kept.find((entry) => isStaffRole(entry)) ?? USER_ROLES.CUSTOMER);

  // Nothing to revoke. An array that disagrees with a non-vendor `role` is
  // untidy, but not this function's to repair — see the repair decision.
  if (!held.includes(USER_ROLES.VENDOR) && role === owner.role) return null;

  return { role, roles: kept.includes(role) ? kept : [role, ...kept] };
}

/**
 * Take the vendor role away from the owner of a store that is no longer live —
 * rejected, suspended, deleted.
 *
 * Not for vendor staff removal: those accounts hold `staff` and never
 * `vendor`, so there is no membership here to revoke — see the DELETE in
 * app/api/vendor/staff/[id].
 *
 * Admin and staff owners keep what they have. The verification audience is
 * reset whether or not a role moved: applying flipped it to `vendor`, and a
 * customer still carrying that marker is held to the stricter of the two
 * verification policies (`resolveEmailVerificationStatus`). Returns true when
 * a role was actually written.
 */
export async function revokeVendorRole(userId: unknown): Promise<boolean> {
  const id = toUserObjectId(userId);
  if (!id) return false;

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  const owner = await db
    .collection("user")
    .findOne<{ role?: string; roles?: unknown }>(
      { _id: id },
      { projection: { role: 1, roles: 1 } },
    );
  if (!owner) return false;

  const next = decideVendorOwnerRoleRevoke(owner);
  await db.collection("user").updateOne(
    { _id: id },
    {
      $set: {
        ...(next ? { role: next.role, roles: next.roles } : {}),
        emailVerificationAudience: USER_ROLES.CUSTOMER,
        updatedAt: new Date(),
      },
    },
  );
  return Boolean(next);
}

/**
 * Vendor documents carry `userId` as an ObjectId, a string, or — when the
 * caller populated it — an object. Anything that is not an id is not an error
 * worth throwing on an activation path; it is a vendor with no owner to repair.
 */
function toUserObjectId(value: unknown): ObjectId | null {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  const raw = typeof value === "string" ? value : String(value);
  return ObjectId.isValid(raw) ? new ObjectId(raw) : null;
}

