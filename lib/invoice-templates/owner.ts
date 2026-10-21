import "server-only";

import { isAdmin } from "@/lib/access/rbac";
import { AuthorizationError } from "@/lib/api/errors";
import { mongoose } from "@/lib/db";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";

/**
 * Whose templates a call works on. Always from the session, never from the
 * request (§4.1 principle 5): the admin routes work on the platform's, and a
 * vendor route works on the signed-in owner's own store. Another owner's
 * template is a 404, because every query carries `ownerFilter`.
 */
export type TemplateOwner = { kind: "platform" } | { kind: "vendor"; vendorId: string };

export const PLATFORM_OWNER: TemplateOwner = Object.freeze({ kind: "platform" });

/** A vendor's own templates, for a caller that already resolved the vendor from the session. */
export function vendorOwner(vendorId: string): TemplateOwner {
  return { kind: "vendor", vendorId: String(vendorId) };
}

/** The filter every template query carries. */
export function ownerFilter(owner: TemplateOwner): { vendorId: mongoose.Types.ObjectId | null } {
  return {
    vendorId: owner.kind === "vendor" ? new mongoose.Types.ObjectId(owner.vendorId) : null,
  };
}

export function ownerKey(owner: TemplateOwner): string {
  return owner.kind === "vendor" ? `vendor:${owner.vendorId}` : "platform";
}

type SessionUser = Parameters<typeof requireVendorStorePageAccess>[0];

/**
 * The vendor owner who may manage templates (Phase 7, D-07): the store
 * settings permissions (view to read, edit to change), marketplace mode on
 * (else 404), and the signed-in user's own approved store — the gate the
 * vendor Online Store routes share. Vendor staff (role STAFF) fail it:
 * vendor permissions belong to the owner alone.
 *
 * An admin is refused too, although the shared gate lets admins past its
 * permission check: the platform's templates are the admin's, in Settings →
 * Invoice Settings, and an admin who happens to own a store must not manage
 * that store's templates from here.
 */
export async function resolveVendorTemplateOwner(
  user: SessionUser,
  mode: "view" | "edit",
): Promise<TemplateOwner> {
  if (isAdmin(user)) {
    throw new AuthorizationError("Admins manage the platform's templates in Settings → Invoice Settings");
  }
  const vendor = await requireVendorStorePageAccess(user, mode, {
    view: "You do not have permission to view invoice templates",
    edit: "You do not have permission to change invoice templates",
  });
  return vendorOwner(String(vendor._id));
}
