import { ObjectId } from "mongodb";
import { isCustomerAccount } from "@/lib/access/customer-account";
import { getAuthContext } from "@/lib/auth/auth";
import { auditAccountSelfDeleted } from "@/lib/auth/auth-audit";
import type { AuditContext } from "@/lib/audit";
import { cleanupDeletedUserReferences } from "@/lib/customers/user-cleanup";
import { connectDB, mongoose } from "@/lib/db";
import { DEMO_MODE_MESSAGE, isDemoModeEnabled } from "@/lib/demo-mode";
import { Vendor } from "@/models";

/**
 * A shopper deleting their own account, as the App Store (5.1.1(v)) and
 * Google Play require of an app with sign-up.
 *
 * Two doors lead here: Better Auth's `/api/auth/delete-user`, which the
 * account page's Security tab calls (its `beforeDelete`/`afterDelete` hooks
 * in lib/auth/auth.ts run these), and the shopper app's `DELETE /me`. Both
 * want the password, or a sign-in from the last ten minutes, before they get
 * here.
 *
 * Only a plain shopper may delete themselves. A seller, a team member or an
 * admin is closed by the screen that owns the role, where the owner and
 * last-admin rules are kept (app/api/admin/users/[id]/route.ts). A demo site
 * refuses, so a visitor cannot delete the demo's shared account.
 *
 * What goes is what the admin's own delete removes
 * (`cleanupDeletedUserReferences`): sign-in records, profile, carts,
 * wishlists, notifications, push subscriptions, reviews, unfinished
 * checkouts, pre-order waiting lists, followed stores, AI assistant chats,
 * and the personal details on support conversations and blog comments.
 * Orders, store credit, returns and quotes stay: they are the store's
 * financial records.
 */

type AccountDeletionRefusal = {
  reason: "DEMO_MODE" | "NOT_A_CUSTOMER";
  message: string;
};

const NOT_A_CUSTOMER_MESSAGE =
  "This account also runs or helps run the store, so it cannot be deleted here. Contact the store to close it.";

/** Why this account may not delete itself, or null when it may. */
export async function findAccountDeletionRefusal(
  userId: string,
): Promise<AccountDeletionRefusal | null> {
  if (isDemoModeEnabled()) return { reason: "DEMO_MODE", message: DEMO_MODE_MESSAGE };

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  // From the database, not the session: a role granted since the sign-in
  // counts.
  const user = await db
    .collection("user")
    .findOne({ _id: new ObjectId(userId) }, { projection: { role: 1, roles: 1 } });
  if (
    !isCustomerAccount(user as { role?: string; roles?: string[] } | null) ||
    // A seller's own login, whatever its role says: deleting it would orphan
    // the shop behind a ghost user.
    (await Vendor.exists({ userId }))
  ) {
    return { reason: "NOT_A_CUSTOMER", message: NOT_A_CUSTOMER_MESSAGE };
  }
  return null;
}

/**
 * Everything the account leaves behind, once the user row is gone. Better
 * Auth's `afterDelete` hook, and the last step of `deleteOwnAccount`.
 */
export async function cleanUpDeletedAccount(userId: string): Promise<void> {
  await cleanupDeletedUserReferences(userId);
}

/**
 * Deletes the account whose refusal check came back null: the steps Better
 * Auth's /delete-user takes after its own checks, through its own adapter.
 * The caller has proven the password or a recent sign-in.
 */
export async function deleteOwnAccount(
  userId: string,
  /** Who is deleting it, for the Activity Log; the shopper app's origin. */
  auditContext?: AuditContext,
): Promise<void> {
  const ctx = await getAuthContext();
  const user = await ctx.internalAdapter.findUserById(userId);
  await ctx.internalAdapter.deleteUser(userId);
  await ctx.internalAdapter.deleteUserSessions(userId);
  await cleanUpDeletedAccount(userId);
  // The website's delete is logged by Better Auth's own `afterDelete` hook
  // (lib/auth/auth.ts); this path does not go through it.
  if (user) await auditAccountSelfDeleted(user, auditContext ?? {});
}
