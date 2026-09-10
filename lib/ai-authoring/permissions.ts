import { AuthorizationError } from "@/lib/api/errors";
import { hasVendorPermission, isAdmin, type MinimalUser } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { checkPlanCapability } from "@/lib/vendors/vendor-limits";
import type { AIAuthoringRequest } from "./types";

/**
 * Gate a vendor/staff caller for AI authoring. Two independent checks (admins
 * bypass both):
 *   1. Permission — the caller holds ACCESS_AI_STUDIO.
 *   2. Plan capability — the vendor's plan grants aiAuthoring (deny by default;
 *      when the plans feature is off, plans gate nothing and this passes).
 * Both must hold: the plan decides who can buy the feature, the permission
 * decides which staff of that vendor may use it.
 */
export async function assertVendorAuthoringAccess(
  user: NonNullable<MinimalUser> & { _id?: unknown },
  // Kept so call sites read as "gate this request", but access depends only on
  // the caller — the deterministic social-export route has no authoring request
  // to hand over, hence optional.
  _request?: AIAuthoringRequest,
) {
  const userId = String(user.id || user._id);
  const vendor = await requireApprovedVendorByUserId(userId);

  if (isAdmin(user)) return;

  const hasStudioPermission = await hasVendorPermission(
    user,
    VENDOR_PERMISSIONS.ACCESS_AI_STUDIO,
  );
  if (!hasStudioPermission) {
    throw new AuthorizationError(
      "You do not have permission to use AI Studio",
    );
  }

  const planGrants = await checkPlanCapability(vendor._id, "aiAuthoring", {
    planId: vendor.planId,
  });
  if (!planGrants) {
    throw new AuthorizationError(
      "AI Studio is not included in your plan. Upgrade to a plan with AI Authoring.",
    );
  }
}
