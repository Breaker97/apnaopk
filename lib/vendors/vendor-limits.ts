/**
 * Vendor plan limits — the single authority for plan resource caps
 * (products, staff). Mirrors resolveVendorCommission in spirit: it reads the
 * vendor's plan.limits and compares against a live usage count.
 *
 * Semantics:
 *   - No plan, or a null/absent limit for the resource → UNLIMITED (allowed).
 *   - A numeric limit → allowed while current usage is strictly below it.
 *
 * This is a SOFT gate: the count-then-create sequence is not atomic, so under
 * heavy concurrent creates a vendor could momentarily exceed the cap by a
 * small margin. That is acceptable given low per-vendor create concurrency; a
 * hard guarantee would require a maintained usage counter with a conditional
 * $inc. Kept intentionally out of the money path — limits gate capacity, never
 * commission.
 */

import { Vendor, VendorPlan, Product, StaffProfile } from "@/models";
import { VENDOR_OWNED_STAFF_FILTER } from "@/lib/access/staff-ownership";
import { getSettings, type ISettings } from "@/models/settings.model";
import { PRODUCT_STATUS } from "@/config/app.config";
import {
  planSellsPack,
  type VendorPermissionPack,
  type VendorPlanCapabilityInput,
} from "@/config/permissions.config";
import type { Types } from "mongoose";

type LimitedResource = "products" | "staff";

interface LimitCheck {
  /** True when another unit of the resource may be created. */
  allowed: boolean;
  /** The plan's cap, or null when the resource is unlimited. */
  limit: number | null;
  /** Live usage count (0 when unlimited — not computed in that case). */
  current: number;
  resource: LimitedResource;
}

/**
 * Pure limit decision — separated from DB reads so it is unit-testable, the same
 * way resolveVendorCommission is a pure function its callers feed loaded docs.
 * A null/undefined/negative limit means unlimited. Creation is allowed while
 * `current` is strictly below `limit`.
 */
export function evaluateLimit(
  limit: number | null | undefined,
  current: number,
): boolean {
  if (limit == null || !Number.isFinite(limit) || limit < 0) return true;
  return current < limit;
}

/** Live usage for a resource. Staff counts only ACTIVE profiles — a limit
 * gates seats in use, and a deactivated staff member does not occupy one. */
async function currentUsage(
  vendorId: Types.ObjectId | string,
  resource: LimitedResource,
): Promise<number> {
  if (resource === "products") {
    return Product.countDocuments({ vendorId });
  }
  // Ownership, not just membership: platform staff an admin scoped to this
  // vendor's data must not occupy one of the vendor's paid seats.
  return StaffProfile.countDocuments({
    vendorIds: vendorId,
    isActive: { $ne: false },
    ...VENDOR_OWNED_STAFF_FILTER,
  });
}

/** Unlimited result — no cap applies. */
function unlimited(resource: LimitedResource): LimitCheck {
  return { allowed: true, limit: null, current: 0, resource };
}

/**
 * Check whether a vendor may create another unit of `resource` under their plan.
 *
 * Limits only apply while the plans feature is enabled. When it is off, this
 * returns unlimited even for a vendor carrying a stale planId — a vendor must
 * always be able to add products/staff when plans are not in force. A vendor
 * with no plan is likewise unlimited (they bill at the configured default
 * commission but face no cap).
 *
 * @param vendorId  the Vendor _id
 * @param resource  "products" | "staff"
 * @param opts.planId  pre-loaded Vendor.planId to skip the vendor lookup when
 *   the caller already holds the vendor doc. Pass `null` to assert "no plan"
 *   without a query; omit (undefined) to have this function load it.
 * @param opts.settings  pre-loaded settings to skip the plansEnabled re-read.
 */
export async function checkPlanLimit(
  vendorId: Types.ObjectId | string,
  resource: LimitedResource,
  opts?: {
    planId?: Types.ObjectId | string | null;
    settings?: ISettings;
  },
): Promise<LimitCheck> {
  const settings = opts?.settings ?? (await getSettings());
  // Plans off → no caps in force, regardless of any stale planId on the vendor.
  if (
    !settings.multiVendorMode?.enabled ||
    !settings.vendorConfig?.plansEnabled
  ) {
    return unlimited(resource);
  }

  let planId = opts?.planId;
  if (planId === undefined) {
    const vendor = await Vendor.findById(vendorId)
      .select("planId")
      .lean<{ planId?: Types.ObjectId | null } | null>();
    planId = vendor?.planId ?? null;
  }

  const plan = planId
    ? await VendorPlan.findById(planId)
        .select("limits")
        .lean<{ limits?: { products?: number | null; staff?: number | null } } | null>()
    : null;

  const limit = plan?.limits?.[resource] ?? null;
  if (limit == null) {
    return unlimited(resource);
  }

  const current = await currentUsage(vendorId, resource);
  return { allowed: evaluateLimit(limit, current), limit, current, resource };
}

type PlanCapability = "aiAuthoring";

/** Which capability pack sells each legacy capability flag. */
const PACK_FOR_CAPABILITY: Record<PlanCapability, VendorPermissionPack> = {
  aiAuthoring: "aiStudio",
};

/**
 * Whether a vendor's plan grants a capability (feature flag).
 *
 * Unlike limits, capabilities are DENY-by-default: a vendor gets the feature
 * only when their active plan explicitly sells it. Exception: when the plans
 * feature is off, plans restrict nothing — the capability is treated as granted
 * and the global feature's own settings (e.g. AI authoring's
 * access.vendorsEnabled) stay the effective gate.
 *
 * Reads the plan's capability PACKS, falling back to the legacy boolean for a
 * row written before packs existed — `packsFromPlanCapabilities` owns that
 * rule. Reading the raw `capabilities.aiAuthoring` here instead is what made
 * the `aiStudio` pack unsellable: an admin could tick it, the permission layer
 * would grant `access_ai_studio`, and this check would still refuse.
 *
 * @param opts.planId    pre-loaded Vendor.planId to skip the vendor lookup.
 * @param opts.settings  pre-loaded settings to skip the plansEnabled re-read.
 */
export async function checkPlanCapability(
  vendorId: Types.ObjectId | string,
  capability: PlanCapability,
  opts?: {
    planId?: Types.ObjectId | string | null;
    settings?: ISettings;
  },
): Promise<boolean> {
  const settings = opts?.settings ?? (await getSettings());
  // Plans off → plans don't gate anything; defer to the feature's own settings.
  if (
    !settings.multiVendorMode?.enabled ||
    !settings.vendorConfig?.plansEnabled
  ) {
    return true;
  }

  let planId = opts?.planId;
  if (planId === undefined) {
    const vendor = await Vendor.findById(vendorId)
      .select("planId")
      .lean<{ planId?: Types.ObjectId | null } | null>();
    planId = vendor?.planId ?? null;
  }

  // No plan → no plan-granted capability (deny by default).
  if (!planId) return false;

  const plan = await VendorPlan.findById(planId)
    .select("capabilities")
    .lean<{ capabilities?: VendorPlanCapabilityInput } | null>();

  return planSellsPack(plan?.capabilities, PACK_FOR_CAPABILITY[capability]);
}

interface DraftExcessResult {
  /** The product cap applied (null when unlimited — nothing drafted). */
  limit: number | null;
  /** Active products before reconciliation. */
  activeBefore: number;
  /** How many were pushed to draft to fit the new cap. */
  drafted: number;
}

/**
 * Reconcile a vendor's ACTIVE products against a product cap by drafting the
 * overflow — the non-destructive downgrade behavior standard across Dokan/WCFM
 * (products are never deleted, only unpublished). Newest products are drafted
 * first so a vendor keeps their oldest/established listings live; they can
 * re-publish others later up to the new cap.
 *
 * A null limit (unlimited plan / no plan) drafts nothing. Idempotent: drafting
 * only ever affects currently-active products, so re-running is a no-op once
 * the vendor is within the cap.
 *
 * @param limit  the NEW plan's product cap (null = unlimited).
 */
export async function draftExcessProducts(
  vendorId: Types.ObjectId | string,
  limit: number | null,
): Promise<DraftExcessResult> {
  if (limit == null || !Number.isFinite(limit) || limit < 0) {
    return { limit: null, activeBefore: 0, drafted: 0 };
  }

  const activeBefore = await Product.countDocuments({
    vendorId,
    status: PRODUCT_STATUS.ACTIVE,
  });
  if (activeBefore <= limit) {
    return { limit, activeBefore, drafted: 0 };
  }

  // Keep the oldest `limit` active products; draft the newest overflow.
  const overflow = await Product.find({
    vendorId,
    status: PRODUCT_STATUS.ACTIVE,
  })
    .sort({ createdAt: -1 })
    .limit(activeBefore - limit)
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();

  if (overflow.length === 0) {
    return { limit, activeBefore, drafted: 0 };
  }

  await Product.updateMany(
    { _id: { $in: overflow.map((p) => p._id) } },
    { $set: { status: PRODUCT_STATUS.DRAFT } },
  );

  return { limit, activeBefore, drafted: overflow.length };
}
