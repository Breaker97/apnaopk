/**
 * Vendor access resolution — the single authority for "may this vendor do X".
 *
 * Four layers, one job each, evaluated in a fixed order. The FIRST one that
 * says no is the one reported, because that is the one an admin must fix:
 *
 *   1. POLICY      is the capability available on this marketplace at all?
 *   2. ENTITLEMENT did the vendor's plan include it (or the commission-only
 *                  baseline, when no plan governs them)?
 *   3. GRANT       does a stored override add or remove it for this vendor?
 *   4. LIFECYCLE   is the account in a state that permits it?
 *
 * Effective access is DERIVED on every read, never projected onto the vendor.
 * A plan change therefore needs no reconciliation sweep — the drift class that
 * `Vendor.commission` needs `commissionSource` for cannot exist here.
 *
 * See docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.2–§2.3.
 */

import { cache } from "react";
import { VENDOR_STATUS } from "@/config/app.config";
import {
  ALL_VENDOR_PACKS,
  ALL_VENDOR_PERMISSIONS,
  COMMISSION_ONLY_PACKS,
  PACK_OF_PERMISSION,
  PAYMENT_REQUIRED_SETUP_PERMISSIONS,
  VENDOR_PACK_LABELS,
  VENDOR_PERMISSION_IMPLICATIONS,
  VENDOR_PERMISSION_PACKS,
  cascadeVendorRevokes,
  expandVendorPacks,
  LEGACY_POLICY_FLAG_OF_PACK,
  packsFromPlanCapabilities,
  resolveStoredVendorPermission,
  type VendorPackPolicy,
  type VendorPolicyFlags,
  type VendorPermission,
  type VendorPermissionPack,
  type VendorPlanCapabilityInput,
} from "@/config/permissions.config";
import type { ISettings } from "@/models/settings.model";

// ============================================
// Inputs
// ============================================

type VendorOverrideMode = "grant" | "revoke";

export interface VendorAccessOverride {
  permission: VendorPermission;
  mode: VendorOverrideMode;
  /** Why the admin deviated from the entitlement. Shown in the audit trail. */
  reason?: string;
  grantedBy?: string;
  grantedAt?: Date;
  /** Null/absent = until revoked. A past date is ignored on read. */
  expiresAt?: Date | null;
}

/** The vendor fields this module reads. Accepts lean docs. */
export interface VendorAccessSubject {
  _id?: unknown;
  userId?: unknown;
  status?: string;
  planId?: unknown;
  /**
   * The internal single-store vendor. It is not a marketplace tenant: it exists
   * so products and orders keep a stable vendorId, and it is administered from
   * General Settings rather than sold a plan. Every layer exempts it — see
   * the guideline §2.8. Select this field wherever access is resolved.
   */
  isDefault?: boolean;
  /**
   * Legacy per-vendor grant list. Read only when `permissionOverrides` is
   * absent, and then converted to equivalent overrides so an unmigrated row
   * keeps exactly the access it has today. See `overridesFromLegacyGrants`.
   */
  permissions?: VendorPermission[];
  permissionOverrides?: VendorAccessOverride[];
}

/** The vendor fields every access query has to select. One string, one truth. */
export const VENDOR_ACCESS_FIELDS =
  "_id userId status isDefault planId permissions permissionOverrides";

/** The plan fields this module reads. */
export interface VendorAccessPlan {
  capabilities?: VendorPlanCapabilityInput | null;
}

/**
 * Re-exported: the policy table moved to config/permissions.config.ts so the
 * Marketplace policy screen can read it too, but every existing caller imports
 * the type from here.
 */

/** Where the account sits in its lifecycle, from resolveVendorPaymentAccess. */
type VendorAccessMode = "approved" | "setup" | "blocked";

export type AccessLayer = "policy" | "plan" | "grant" | "lifecycle";

type PermissionVerdict =
  | "allowed"
  | "override"
  | "policy"
  | "plan"
  | "revoked"
  | "lifecycle";

interface PermissionState {
  permission: VendorPermission;
  verdict: PermissionVerdict;
  /** The override touching this permission, when one applies. */
  override?: VendorAccessOverride;
  allowed: boolean;
}

type PackVerdict = PermissionVerdict | "partial";

interface VendorPackState {
  pack: VendorPermissionPack;
  label: string;
  /** Whether the marketplace allows this pack at all. One switch, one pack. */
  policy: boolean;
  entitled: boolean;
  /**
   * Whether the account's lifecycle state permits this pack. False only while a
   * vendor sits in the unpaid setup window and the pack is outside
   * PAYMENT_REQUIRED_SETUP_PERMISSIONS. Surfaced so the Access tab can say
   * "blocked by account state" instead of showing a grant that does not apply.
   */
  lifecycle: boolean;
  permissions: PermissionState[];
  allowedCount: number;
  total: number;
  verdict: PackVerdict;
}

export interface AccessDenial {
  layer: AccessLayer;
  pack: VendorPermissionPack;
  permission: VendorPermission;
}

// ============================================
// Layer 1 — marketplace policy
// ============================================

/**
 * Read the policy flags off settings. Absent means allowed — a store that has
 * never opened the Marketplace policy tab must not have every vendor locked
 * out, which is why every default in the schema is `true`.
 */
function readVendorPolicyFlags(
  settings: Pick<ISettings, "multiVendorMode"> | null | undefined,
): VendorPackPolicy {
  const mv = settings?.multiVendorMode as
    | (Partial<VendorPolicyFlags> & { packPolicy?: Partial<VendorPackPolicy> })
    | undefined;

  const policy = {} as VendorPackPolicy;
  for (const pack of ALL_VENDOR_PACKS) {
    const stored = mv?.packPolicy?.[pack];
    if (typeof stored === "boolean") {
      policy[pack] = stored;
      continue;
    }
    // No per-pack value yet: read the legacy boolean(s) this pack used to sit
    // under, so the split changes nothing until an operator or the migration
    // says otherwise. A pack under two booleans stays on if EITHER was on —
    // see LEGACY_POLICY_FLAG_OF_PACK for why that direction.
    const legacy = LEGACY_POLICY_FLAG_OF_PACK[pack].map(
      (key) => mv?.[key] ?? true,
    );
    policy[pack] = legacy.some(Boolean);
  }
  return policy;
}

function policyAllows(
  permission: VendorPermission,
  policy: VendorPackPolicy,
): boolean {
  // One lookup, no mapping table: policy is per PACK now, and every permission
  // belongs to exactly one pack. A switch cannot reach past its own label.
  const pack = PACK_OF_PERMISSION[permission];
  return pack ? policy[pack] !== false : false;
}

// ============================================
// Layer 2 — plan entitlement
// ============================================

/** Plans only gate anything when the marketplace actually sells them. */
export function plansInForce(
  settings: Pick<ISettings, "multiVendorMode" | "vendorConfig"> | null | undefined,
): boolean {
  return Boolean(
    settings?.multiVendorMode?.enabled && settings?.vendorConfig?.plansEnabled,
  );
}

/**
 * The packs a vendor is entitled to, before any override.
 *
 * A vendor with NO plan is a commission-only vendor, not an unentitled one:
 * the marketplace earns a percentage of their sales instead of a monthly fee.
 * Returning an empty list here would lock them out of their own catalog — and
 * since `plansEnabled` defaults to false, that is most vendors.
 *
 * The internal default vendor is not a tenant at all and holds every pack; the
 * caller passes `isDefaultVendor` because that fact lives on the vendor row.
 *
 * When a plan DOES govern them, `packsFromPlanCapabilities` decides what it
 * sells — including the deliberate distinction between an absent pack list
 * (legacy row) and an empty one (a plan that sells nothing).
 */
export function entitledPacks(
  plan: VendorAccessPlan | null | undefined,
  settings: Pick<ISettings, "multiVendorMode" | "vendorConfig"> | null | undefined,
  opts?: { isDefaultVendor?: boolean },
): VendorPermissionPack[] {
  if (opts?.isDefaultVendor) return [...ALL_VENDOR_PACKS];
  if (!plansInForce(settings) || !plan) return [...COMMISSION_ONLY_PACKS];
  return packsFromPlanCapabilities(plan.capabilities);
}

// ============================================
// Layer 3 — per-vendor overrides
// ============================================

/**
 * Drop overrides whose window has closed — an expiry needs no cleanup job — and
 * resolve retired permission strings to whatever they still stand for.
 *
 * The second part is what lets a permission be retired without a flag day. A
 * row naming a retired verb is not ignored: `resolveStoredVendorPermission`
 * promotes it to the live permission it used to satisfy, or drops it when it
 * satisfied nothing that survives. Because every write path starts from this
 * function, the next save records the promotion permanently — and a value
 * outside the schema enum never reaches `vendor.save()` to fail validation.
 */
export function activeOverrides(
  overrides: VendorAccessOverride[] | null | undefined,
  now: Date = new Date(),
): VendorAccessOverride[] {
  if (!Array.isArray(overrides)) return [];

  const live = overrides.filter((override) => {
    if (!override?.permission || !override?.mode) return false;
    if (!override.expiresAt) return true;
    return new Date(override.expiresAt).getTime() > now.getTime();
  });

  const byPermission = new Map<VendorPermission, VendorAccessOverride>();
  const promotions: VendorAccessOverride[] = [];

  for (const override of live) {
    const permission = resolveStoredVendorPermission(
      override.permission,
      override.mode,
    );
    if (!permission) continue;
    if (permission === override.permission) byPermission.set(permission, override);
    else promotions.push({ ...override, permission });
  }

  // Promotions are applied last and never overwrite. An override that already
  // names the live permission is what an admin actually chose; the retired row
  // is only standing in for it, so it must not outrank it — and that has to hold
  // whatever order the two happen to sit in the stored array.
  for (const promoted of promotions) {
    if (!byPermission.has(promoted.permission)) {
      byPermission.set(promoted.permission, promoted);
    }
  }

  return Array.from(byPermission.values());
}

/**
 * Convert a legacy `Vendor.permissions` list into the overrides that reproduce
 * it exactly against the vendor's entitlement:
 *   - entitled but not held  → revoke (the admin had unchecked it)
 *   - held but not entitled  → grant  (the admin had added it)
 *
 * Used by the migration script and, as a fallback, at read time for any row it
 * has not reached yet — so deploying this model revokes nothing.
 *
 * A retired permission in the stored list is PROMOTED, not dropped. Holding
 * `create_pos` used to satisfy an `access_pos` guard, so treating the string as
 * absent would turn "this vendor has POS" into a revoke of it.
 */
export function overridesFromLegacyGrants(
  held: VendorPermission[] | null | undefined,
  entitled: Set<VendorPermission>,
): VendorAccessOverride[] {
  if (!Array.isArray(held)) return [];
  const heldSet = new Set(
    held
      .map((permission) => resolveStoredVendorPermission(permission))
      .filter((permission): permission is VendorPermission => Boolean(permission)),
  );
  const out: VendorAccessOverride[] = [];

  for (const permission of entitled) {
    if (!heldSet.has(permission)) {
      out.push({ permission, mode: "revoke", reason: "Migrated from the previous permission list" });
    }
  }
  for (const permission of heldSet) {
    if (!entitled.has(permission)) {
      out.push({ permission, mode: "grant", reason: "Migrated from the previous permission list" });
    }
  }
  return out;
}

// ============================================
// Layer 4 — lifecycle
// ============================================

function lifecycleAllows(
  permission: VendorPermission,
  mode: VendorAccessMode,
): boolean {
  if (mode === "blocked") return false;
  if (mode === "setup") {
    return PAYMENT_REQUIRED_SETUP_PERMISSIONS.includes(permission);
  }
  return true;
}

// ============================================
// Resolution
// ============================================

interface ResolveVendorAccessInput {
  vendor: VendorAccessSubject | null | undefined;
  plan?: VendorAccessPlan | null;
  settings?: Pick<ISettings, "multiVendorMode" | "vendorConfig"> | null;
  /** Defaults to "approved"; pass the value resolveVendorPaymentAccess gives. */
  accessMode?: VendorAccessMode;
  now?: Date;
}

export interface VendorAccessResolution {
  effective: Set<VendorPermission>;
  entitledPacks: VendorPermissionPack[];
  overrides: VendorAccessOverride[];
  packs: VendorPackState[];
  /** Whether a required permission is satisfied, implications included. */
  has: (permission: VendorPermission) => boolean;
  /** Which layer denied it, or null when it is allowed. */
  denialFor: (permission: VendorPermission) => AccessDenial | null;
}

export function resolveVendorAccess({
  vendor,
  plan,
  settings,
  accessMode = "approved",
  now = new Date(),
}: ResolveVendorAccessInput): VendorAccessResolution {
  // The internal single-store vendor is exempt from all four layers: it is the
  // store itself, administered from General Settings, never sold a plan and
  // never subject to a marketplace-wide toggle meant for third-party sellers.
  // Guideline §2.8.
  const isDefaultVendor = vendor?.isDefault === true;

  const flags = isDefaultVendor
    ? readVendorPolicyFlags(null)
    : readVendorPolicyFlags(settings);
  const packList = entitledPacks(plan, settings, { isDefaultVendor });
  const entitled = new Set(expandVendorPacks(packList));

  // An explicit (possibly empty) override array means this row is on the new
  // model. Only an ABSENT one falls back to the legacy grant list.
  const overrides = isDefaultVendor
    ? []
    : Array.isArray(vendor?.permissionOverrides)
      ? activeOverrides(vendor?.permissionOverrides, now)
      : overridesFromLegacyGrants(vendor?.permissions, entitled);

  const grants = new Set<VendorPermission>();
  const explicitRevokes = new Set<VendorPermission>();
  const overrideOf = new Map<VendorPermission, VendorAccessOverride>();
  for (const override of overrides) {
    overrideOf.set(override.permission, override);
    if (override.mode === "grant") grants.add(override.permission);
    else explicitRevokes.add(override.permission);
  }
  // A revoke has to take the umbrella that implies it, or it does nothing.
  const revokes = cascadeVendorRevokes(explicitRevokes);

  const states = new Map<VendorPermission, PermissionState>();
  const effective = new Set<VendorPermission>();

  for (const permission of ALL_VENDOR_PERMISSIONS) {
    const verdict = ((): PermissionVerdict => {
      if (!policyAllows(permission, flags)) return "policy";
      const isEntitled = entitled.has(permission);
      if (!isEntitled && !grants.has(permission)) return "plan";
      if (revokes.has(permission)) return "revoked";
      if (!lifecycleAllows(permission, accessMode)) return "lifecycle";
      return isEntitled ? "allowed" : "override";
    })();

    const allowed = verdict === "allowed" || verdict === "override";
    if (allowed) effective.add(permission);
    states.set(permission, {
      permission,
      verdict,
      allowed,
      override: overrideOf.get(permission),
    });
  }

  const packs: VendorPackState[] = ALL_VENDOR_PACKS.map((pack) => {
    const permissions = VENDOR_PERMISSION_PACKS[pack].map(
      (permission) => states.get(permission)!,
    );
    const total = permissions.length;
    const allowedCount = permissions.filter((state) => state.allowed).length;

    // One boolean, because policy is per pack. It used to be derived by asking
    // every permission which of eight booleans governed it and reporting
    // "partial" when they disagreed — a state that can no longer exist.
    const policy = flags[pack] !== false;

    let verdict: PackVerdict;
    if (allowedCount === total) {
      verdict = permissions.some((state) => state.verdict === "override")
        ? "override"
        : "allowed";
    } else if (allowedCount === 0) {
      // Report the outermost layer present in the pack.
      const order: PermissionVerdict[] = [
        "policy",
        "plan",
        "revoked",
        "lifecycle",
      ];
      verdict =
        order.find((candidate) =>
          permissions.some((state) => state.verdict === candidate),
        ) ?? "plan";
    } else {
      verdict = "partial";
    }

    return {
      pack,
      label: VENDOR_PACK_LABELS[pack],
      policy,
      entitled: VENDOR_PERMISSION_PACKS[pack].some((permission) =>
        entitled.has(permission),
      ),
      // Every pack is wholly inside or wholly outside the setup allowance —
      // pinned by a test, so `some` here is exact rather than optimistic.
      lifecycle: VENDOR_PERMISSION_PACKS[pack].some((permission) =>
        lifecycleAllows(permission, accessMode),
      ),
      permissions,
      allowedCount,
      total,
      verdict,
    };
  });

  const satisfiedBy = (permission: VendorPermission): VendorPermission[] =>
    VENDOR_PERMISSION_IMPLICATIONS[permission] ?? [permission];

  return {
    effective,
    entitledPacks: packList,
    overrides,
    packs,
    has: (permission) =>
      satisfiedBy(permission).some((candidate) => effective.has(candidate)),
    denialFor: (permission) => {
      const candidates = satisfiedBy(permission);
      if (candidates.some((candidate) => effective.has(candidate))) return null;
      // Report the least restrictive reason among the ways it could be held:
      // if any candidate is merely un-entitled, upgrading fixes it.
      const order: PermissionVerdict[] = [
        "lifecycle",
        "revoked",
        "plan",
        "policy",
      ];
      const layerOf: Record<string, AccessLayer> = {
        lifecycle: "lifecycle",
        revoked: "grant",
        plan: "plan",
        policy: "policy",
      };
      for (const verdict of order) {
        const hit = candidates.find(
          (candidate) => states.get(candidate)?.verdict === verdict,
        );
        if (hit) {
          return {
            layer: layerOf[verdict],
            pack: PACK_OF_PERMISSION[hit],
            permission: hit,
          };
        }
      }
      return {
        layer: "plan",
        pack: PACK_OF_PERMISSION[permission],
        permission,
      };
    },
  };
}

/**
 * Pick which denial to show when a page asked for several permissions.
 *
 * Ordered by what the vendor can actually DO about it, not by layer depth: an
 * upgrade is self-serve, a payment is one click, asking the owner needs another
 * person, and a marketplace policy is a dead end. Showing the most actionable
 * door beats showing the outermost one — the outermost-layer rule is about the
 * verdict for ONE permission, which `denialFor` already applies.
 */
export function primaryDenial(
  access: VendorAccessResolution,
  required: readonly VendorPermission[],
): AccessDenial | null {
  const denials = required
    .map((permission) => access.denialFor(permission))
    .filter((denial): denial is AccessDenial => Boolean(denial));
  if (denials.length === 0) return null;

  const order: AccessLayer[] = ["plan", "lifecycle", "grant", "policy"];
  for (const layer of order) {
    const hit = denials.find((denial) => denial.layer === layer);
    if (hit) return hit;
  }
  return denials[0];
}

/** The reason-carrying gate route that replaced `/forbidden` for permissions. */
export function vendorLockedPath(
  locale: string,
  denial: AccessDenial | null,
): string {
  if (!denial) return `/${locale}/vendor/dashboard`;
  const params = new URLSearchParams({
    layer: denial.layer,
    pack: denial.pack,
  });
  return `/${locale}/vendor/locked?${params.toString()}`;
}

/** Narrow untrusted query values back to the union types. */
export function parseAccessLayer(value: unknown): AccessLayer {
  return value === "policy" ||
    value === "plan" ||
    value === "grant" ||
    value === "lifecycle"
    ? value
    : "plan";
}

export function parseVendorPack(value: unknown): VendorPermissionPack | null {
  return ALL_VENDOR_PACKS.includes(value as VendorPermissionPack)
    ? (value as VendorPermissionPack)
    : null;
}

/**
 * Where a vendor sits in its lifecycle, resolved the SAME way the page guard
 * resolves it.
 *
 * This exists because getting it wrong is silent and total. An APPROVED-but-
 * unpaid vendor is in a seven-day setup window during which
 * PAYMENT_REQUIRED_SETUP_PERMISSIONS is meant to keep their catalog and store
 * page editable — and the API routes that back those screens
 * (`allowPaymentRequiredSetup: true`) go through `hasVendorPermission`, not
 * through the page guard. Collapsing "not approved" to "blocked" here would
 * therefore leave those vendors with a working UI and a 403 behind every
 * button, which is exactly what the setup window exists to prevent.
 *
 * The window's end date lives on the application, not the vendor, so this reads
 * it — but only for a PAYMENT_REQUIRED vendor, so the common approved path
 * still costs no extra query.
 */
export async function resolveVendorLifecycleMode(
  vendor: VendorAccessSubject,
): Promise<VendorAccessMode> {
  if (vendor.status === VENDOR_STATUS.APPROVED) return "approved";
  if (vendor.status !== VENDOR_STATUS.PAYMENT_REQUIRED) return "blocked";

  const { VendorApplication } = await import("@/models");
  const {
    VENDOR_APPLICATION_LATEST_SORT,
    vendorApplicationLookupQuery,
  } = await import("@/lib/vendors/vendor-application");
  const { resolveVendorPaymentAccess } = await import(
    "@/lib/vendors/vendor-payment-access"
  );

  const application = await VendorApplication.findOne(
    vendorApplicationLookupQuery({
      vendorId: vendor._id,
      userId: vendor.userId,
    }),
  )
    .sort(VENDOR_APPLICATION_LATEST_SORT)
    .select("status paymentDueAt")
    .lean<{ status?: string; paymentDueAt?: Date | null } | null>();

  return resolveVendorPaymentAccess({
    vendorStatus: vendor.status,
    applicationStatus: application?.status,
    paymentDueAt: application?.paymentDueAt,
  }) === "setup"
    ? "setup"
    : "blocked";
}

/**
 * Load everything the resolver needs for one vendor. Kept here so the guard,
 * the API routes and `hasVendorPermission` all read the same way — and so the
 * plan lookup happens once per request rather than once per check.
 */
export async function loadVendorAccess(
  userIdOrVendor: string | VendorAccessSubject,
  opts?: { accessMode?: VendorAccessMode },
): Promise<VendorAccessResolution | null> {
  // Memoised per request when we are resolving from a user id and letting the
  // lifecycle layer resolve itself — which is every `hasVendorPermission` call.
  // Routes routinely ask three or four times in one handler
  // (app/api/vendor/products/import-export/route.ts, the staff invite route),
  // and each ask otherwise costs a vendor read, a settings read and a plan
  // read. Passing the resolution through `opts` instead would mean touching
  // every call site; this gets the same saving with none of that risk.
  //
  // Per REQUEST, so a permission changed by another request is picked up on the
  // next one — the same guarantee `requireAdminPageAccess` relies on.
  if (typeof userIdOrVendor === "string" && !opts?.accessMode) {
    return loadVendorAccessForUser(userIdOrVendor);
  }
  return loadVendorAccessUncached(userIdOrVendor, opts);
}

const loadVendorAccessForUser = cache((userId: string) =>
  loadVendorAccessUncached(userId),
);

async function loadVendorAccessUncached(
  userIdOrVendor: string | VendorAccessSubject,
  opts?: { accessMode?: VendorAccessMode },
): Promise<VendorAccessResolution | null> {
  const { connectDB } = await import("@/lib/db");
  const { Vendor, VendorPlan } = await import("@/models");
  const { getSettings } = await import("@/models/settings.model");

  await connectDB();

  const vendor =
    typeof userIdOrVendor === "string"
      ? await Vendor.findOne({ userId: userIdOrVendor })
          .select(VENDOR_ACCESS_FIELDS)
          .lean<VendorAccessSubject | null>()
      : userIdOrVendor;

  if (!vendor) return null;

  const [settings, plan, accessMode] = await Promise.all([
    getSettings(),
    vendor.planId
      ? VendorPlan.findById(vendor.planId)
          .select("capabilities")
          .lean<VendorAccessPlan | null>()
      : Promise.resolve(null),
    opts?.accessMode
      ? Promise.resolve(opts.accessMode)
      : resolveVendorLifecycleMode(vendor),
  ]);

  return resolveVendorAccess({ vendor, plan, settings, accessMode });
}
