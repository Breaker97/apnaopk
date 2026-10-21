import "server-only";

import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { vendorOwner, type TemplateOwner } from "./owner";

/**
 * The gate of the vendor's Invoice Settings pages (Phase 7): the vendor area's
 * own guard with the store-settings view grant, as the vendor's other Online
 * Store pages use it. An admin is sent to the admin dashboard and anyone
 * without a store of their own — vendor-created staff (role STAFF) included —
 * away from the vendor area, so only the store's owner reaches these pages;
 * the vendor layout already turns everyone away while marketplace mode is
 * off. `canEdit` is the edit grant: without it the pages look but don't save.
 *
 * The manage routes check all of it again on every call (owner.ts); the page
 * only reads, and only the store's own templates.
 */
export async function requireVendorTemplatePage(locale: string): Promise<{ owner: TemplateOwner; canEdit: boolean }> {
  const access = await requireVendorAreaAccess({
    locale,
    required: [VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS],
  });
  const canEdit =
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS) ||
    access.vendorPermissions.includes(VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS);
  return { owner: vendorOwner(String(access.vendor._id)), canEdit };
}
