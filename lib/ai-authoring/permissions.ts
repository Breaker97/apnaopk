import type { Types } from "mongoose";
import { AuthorizationError } from "@/lib/api/errors";
import { hasVendorPermission, isAdmin, type MinimalUser } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { checkPlanCapability } from "@/lib/vendors/vendor-limits";
import type { ISettings } from "@/models/settings.model";
import type { AIAuthoringRequest } from "./types";

/** Which of the two vendor gates refuses, or null when both pass. */
type VendorAuthoringDenial = "permission" | "plan" | null;

/**
 * The vendor half of AI authoring access, as a verdict rather than a throw.
 *
 * Both callers need the same answer but not the same shape: the routes turn it
 * into the 403 they have always returned, while the vendor layout turns it into
 * the flag that keeps AI buttons off a form the routes would refuse anyway.
 * The caller supplies the permission set because it usually already has one —
 * the layout from `requireVendorAreaAccess`, a route from `hasVendorPermission`
 * — and a re-read here would cost every vendor page an extra lookup.
 */
export async function vendorAuthoringDenial(input: {
  hasStudioPermission: boolean;
  vendorId: Types.ObjectId | string;
  /**
   * Pre-loaded `Vendor.planId`, to skip the vendor lookup. `null` states there
   * is no plan; leaving it out asks `checkPlanCapability` to look one up.
   */
  planId?: Types.ObjectId | string | null;
  /** Pre-loaded settings, to skip the `plansEnabled` re-read. */
  settings?: ISettings;
}): Promise<VendorAuthoringDenial> {
  if (!input.hasStudioPermission) return "permission";

  const planGrants = await checkPlanCapability(input.vendorId, "aiAuthoring", {
    planId: input.planId,
    settings: input.settings,
  });

  return planGrants ? null : "plan";
}

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

  const denial = await vendorAuthoringDenial({
    hasStudioPermission: await hasVendorPermission(
      user,
      VENDOR_PERMISSIONS.ACCESS_AI_STUDIO,
    ),
    vendorId: vendor._id,
    planId: vendor.planId,
  });

  if (denial === "permission") {
    throw new AuthorizationError("You do not have permission to use AI Studio");
  }
  if (denial === "plan") {
    throw new AuthorizationError(
      "AI Studio is not included in your plan. Upgrade to a plan with AI Authoring.",
    );
  }
}
