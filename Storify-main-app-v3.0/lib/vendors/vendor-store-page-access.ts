import "server-only";

import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { assertVendorPermission } from "@/lib/access/rbac";
import { NotFoundError } from "@/lib/api/errors";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";

type SessionUser = Parameters<typeof assertVendorPermission>[0] & {
  id: string;
};

/**
 * The gate every vendor Online Store route shares (/api/vendor/store-page,
 * /api/vendor/sliders), in the order the other vendor routes use:
 * permission, marketplace mode, then the signed-in user's own vendor. What
 * is read or changed is always that vendor's — no route takes a vendor id
 * from the request.
 *
 * Reading needs "view store settings"; changing the landing page or a
 * slider needs "edit store settings", the same permission the store profile
 * uses.
 */
export async function requireVendorStorePageAccess(
  user: SessionUser,
  mode: "view" | "edit",
) {
  await assertVendorPermission(
    user,
    mode === "edit"
      ? VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS
      : VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
    mode === "edit"
      ? "You do not have permission to change your online store"
      : "You do not have permission to view your online store",
  );

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  return requireApprovedVendorByUserId(user.id, {
    allowPaymentRequiredSetup: true,
  });
}
