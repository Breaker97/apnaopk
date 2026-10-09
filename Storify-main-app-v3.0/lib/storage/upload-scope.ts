import "server-only";

import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { isAdmin, isSeller, isVendor } from "@/lib/access/rbac";
import { getActiveStaffAccess } from "@/lib/access/staff-authz";
import { hasStaffScope } from "@/lib/access/staff-scope";
import type { UserRole } from "@/config/app.config";
import {
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";
import { vendorMediaScope } from "@/lib/storage/key";

/**
 * Resolve the owner scope for an upload from the signed-in user.
 *
 * A marketplace that stores every vendor's media in one flat date tree cannot
 * answer the questions it eventually has to answer: how much space is this
 * vendor using, what do we bill them, and what do we delete when they leave.
 * Scoping the key at write time is the only cheap moment to fix that — once
 * the objects exist, attributing them means walking the whole catalogue.
 *
 * Derived here, on the server, from the session. The client's `customPath` is
 * validated for shape but not ownership, so it can never be the source of this
 * value: a vendor could otherwise file uploads under a rival's prefix.
 *
 * Returns undefined for admins and customers — their uploads (store branding,
 * review photos, avatars) belong to the store, not to a vendor, and keeping
 * them unscoped leaves the existing key layout untouched.
 *
 * The role check is what makes that true, and it is not just an optimization.
 * In single-vendor mode the admin owns the default vendor record, so looking
 * the caller up by userId alone filed the store's own logo and banners under
 * `vendor/<default vendor id>/` — the opposite of what this promises. It also
 * spends a query per upload on customers, who can never have one.
 */
export async function resolveUploadScope(user: {
  id: string;
  role?: string | null;
}): Promise<string | undefined> {
  // The session carries `role` as a plain string; narrowing it here is the
  // same boundary cast the vendor routes make before reaching for rbac.
  if (!user?.id || !isVendor({ id: user.id, role: user.role as UserRole }))
    return undefined;

  await connectDB();
  const vendor = await Vendor.findOne({ userId: user.id })
    .select("_id")
    .lean<{ _id: unknown } | null>();

  if (!vendor?._id) return undefined;
  return vendorMediaScope(String(vendor._id)) || undefined;
}

/** Staff grants that put someone to work on the catalogue's media. */
const STAFF_MEDIA_LIBRARY_PERMISSIONS: readonly StaffPermission[] = [
  STAFF_PERMISSIONS.MANAGE_PRODUCTS,
  STAFF_PERMISSIONS.CREATE_PRODUCTS,
  STAFF_PERMISSIONS.EDIT_PRODUCTS,
];

/**
 * Which stored files a caller may browse and pick from: `{}` for the whole
 * library, `{ ownerScope }` for one owner's folder, null for none.
 *
 * The rule is "you browse the folder your uploads land in" — with the one
 * case where that rule, read naively, hands out everything. An unscoped
 * upload means "the store's", and resolveUploadScope also returns undefined
 * for accounts whose uploads merely fall through to it; treating that as
 * "browse unscoped" would show them the store's whole library.
 *
 * - An admin browses everything, vendor folders included — the view
 *   Settings → Storage → Media Library gives.
 * - A vendor browses their own folder and nothing else. A vendor account with
 *   no vendor record yet has no folder, so no library — not the store's.
 * - Staff upload unscoped, into the store's library, so only staff who work
 *   on the whole catalogue may browse it: a product grant and no vendor,
 *   location or region scope. A scoped member's view could not be narrowed —
 *   nothing in a key says which vendor a staff upload was for — and every
 *   vendor-owned staff member is scoped to their vendor.
 * - Shoppers have no library.
 */
export async function resolveMediaLibraryScope(user: {
  id: string;
  role?: string | null;
}): Promise<{ ownerScope?: string } | null> {
  if (!user?.id) return null;
  const caller = { id: user.id, role: user.role ?? undefined };

  if (isAdmin(caller)) return {};

  if (isVendor(caller)) {
    const ownerScope = await resolveUploadScope(user);
    return ownerScope ? { ownerScope } : null;
  }

  if (isSeller(caller)) {
    const { permissions, scope } = await getActiveStaffAccess(user.id);
    if (hasStaffScope(scope)) return null;
    return permissions.some((permission) =>
      STAFF_MEDIA_LIBRARY_PERMISSIONS.includes(permission),
    )
      ? {}
      : null;
  }

  return null;
}
