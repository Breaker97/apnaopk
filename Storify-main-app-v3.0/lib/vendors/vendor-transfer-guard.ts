import type { NextRequest } from "next/server";
import {
  VENDOR_PERMISSIONS,
  type VendorPermission,
} from "@/config/permissions.config";
import { hasVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import type { ApiSession } from "@/lib/api/handler";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";

/**
 * Gate for a vendor's own transfer endpoints. Transfers move a vendor's product
 * stock, so they ride on the product permissions, like the vendor's inventory
 * and locations screens: viewing needs view_products, changing one needs
 * manage_products or edit_products. Which transfers and locations the vendor
 * reaches is then decided by the shared transfer code from their own locations.
 */
export async function requireVendorTransferAccess(
  request: NextRequest,
  session: ApiSession,
  mode: "read" | "write",
  rateAction: string,
) {
  const required: VendorPermission[] =
    mode === "read"
      ? [VENDOR_PERMISSIONS.VIEW_PRODUCTS]
      : [VENDOR_PERMISSIONS.MANAGE_PRODUCTS, VENDOR_PERMISSIONS.EDIT_PRODUCTS];

  let allowed = false;
  for (const permission of required) {
    if (await hasVendorPermission(session.user, permission)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    throw new AuthorizationError(
      mode === "read"
        ? "You do not have permission to view transfers"
        : "You do not have permission to change transfers",
    );
  }

  await rateLimitByUser(
    request,
    session.user.id,
    rateAction,
    mode === "read" ? "lenient" : "moderate",
    session.user.role,
  );

  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  return requireApprovedVendorByUserId(session.user.id, {
    allowPaymentRequiredSetup: mode === "read",
  });
}
