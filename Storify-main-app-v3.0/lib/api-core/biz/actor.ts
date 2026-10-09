import { USER_ROLES, VENDOR_STATUS } from "@/config/app.config";
import type { StaffPermission } from "@/config/permissions.config";
import { getActiveStaffAccess } from "@/lib/access/staff-authz";
import { isStaffRole } from "@/lib/access/staff-role";
import type { StaffAccessScope } from "@/lib/access/staff-scope";
import type { MobileSession } from "@/lib/api-core/ports";
import { connectDB } from "@/lib/db";
import {
  VENDOR_ACCESS_FIELDS,
  resolveVendorAccess,
  resolveVendorLifecycleMode,
  type VendorAccessPlan,
  type VendorAccessResolution,
  type VendorAccessSubject,
} from "@/lib/vendors/vendor-permissions";
import { Vendor, VendorPlan } from "@/models";
import type { ISettings } from "@/models/settings.model";

/**
 * The operator behind a business-app session (PLAN §3.4, the TDD's `Actor`):
 * which workspaces they can work in, and what decides their access in each.
 *
 * Read from the database on every request, never cached, so a role taken
 * away, a staff member switched off or a seller suspended applies to the very
 * next call. The reads are the web's own: `getActiveStaffAccess` for staff (the
 * staff area and every `/api/admin` route use it), the vendor record, its plan
 * and lifecycle through `resolveVendorAccess` for sellers (the vendor area's
 * guard). At most two round trips: staff, two reads at once; a seller, the
 * vendor record and then its plan and payment state at once; a seller's staff,
 * their profile and then their seller.
 *
 * The decisions made with it (which workspace a request is for, whether it
 * may do this) are pure functions in ./access.ts.
 */

/** Settings the vendor access rules read, as the runtime read carries them. */
export type VendorAccessSettings = Pick<ISettings, "multiVendorMode" | "vendorConfig">;

/** What the store as a marketplace decides, from the cached runtime read. */
export interface MarketplaceFacts {
  /** Sellers run their own shops here; without it there is no vendor workspace. */
  multiVendor: boolean;
  vendorAccess: VendorAccessSettings;
}

/** The legacy policy booleans the access resolver still falls back to. */
const POLICY_FLAGS = [
  "canManageProducts",
  "canViewOrders",
  "canManageOrders",
  "canManageStoreSettings",
  "canViewAnalytics",
  "canManageDiscounts",
  "canManagePayouts",
  "canAccessPOS",
] as const;

/**
 * The marketplace facts from a lean settings document: only what the access
 * rules read, so the cached runtime read stays small and holds no secrets.
 */
export function marketplaceFacts(settings: {
  multiVendorMode?: unknown;
  vendorConfig?: unknown;
}): MarketplaceFacts {
  const mode = (settings.multiVendorMode ?? {}) as Record<string, unknown>;
  const config = (settings.vendorConfig ?? {}) as Record<string, unknown>;
  const multiVendorMode: Record<string, unknown> = { enabled: mode.enabled === true };
  if (mode.packPolicy && typeof mode.packPolicy === "object") {
    multiVendorMode.packPolicy = mode.packPolicy;
  }
  for (const flag of POLICY_FLAGS) {
    if (typeof mode[flag] === "boolean") multiVendorMode[flag] = mode[flag];
  }
  return {
    multiVendor: mode.enabled === true,
    vendorAccess: {
      multiVendorMode,
      vendorConfig: { plansEnabled: config.plansEnabled === true },
    } as unknown as VendorAccessSettings,
  };
}

/**
 * Where a seller's shop stands:
 * - `approved`: open.
 * - `setup`: approved but unpaid, inside the setup window: the catalogue and
 *   store settings only (`PAYMENT_REQUIRED_SETUP_PERMISSIONS`).
 * - `blocked`: anything else (pending, suspended, rejected, the window over).
 */
export type BizVendorMode = "approved" | "setup" | "blocked";

export interface BizVendor {
  id: string;
  name: string;
  /** As stored: a URL or a path on the store's own address. */
  logo?: string;
  /** The store's own word: `approved`, `payment_required`, `suspended`, … */
  status: string;
  mode: BizVendorMode;
}

/** The store itself, as an administrator: everything, no scope. */
export interface AdminGrant {
  workspace: "platform";
  kind: "admin";
}

/** The store's own staff: their permissions, within their scope. */
export interface PlatformStaffGrant {
  workspace: "platform";
  kind: "staff";
  permissions: StaffPermission[];
  staffScope: StaffAccessScope;
}

/**
 * A seller's staff: staff permissions (the platform-only ones already taken
 * out), scoped to their seller's whole orders (`wholeOrdersOnly`), as on the
 * website's staff area.
 */
export interface VendorStaffGrant {
  workspace: "vendor";
  kind: "staff";
  permissions: StaffPermission[];
  staffScope: StaffAccessScope;
  vendor: BizVendor;
}

/** The seller: their plan's permissions, as the vendor area resolves them. */
export interface VendorOwnerGrant {
  workspace: "vendor";
  kind: "vendor";
  vendor: BizVendor;
  access: VendorAccessResolution;
}

export type PlatformGrant = AdminGrant | PlatformStaffGrant;
export type VendorGrant = VendorStaffGrant | VendorOwnerGrant;
/** One workspace an operator can work in, with what decides their access there. */
export type BizWorkspaceGrant = PlatformGrant | VendorGrant;

export interface BizActor {
  userId: string;
  /**
   * The account's role, the store's own word (`admin`, `staff`, `vendor`;
   * the legacy `seller` reads as `staff`). Null for an account that runs
   * nothing: a shopper, or a seller demoted by a suspension.
   */
  role: "admin" | "staff" | "vendor" | null;
  /** Empty when they can work nowhere right now. */
  workspaces: BizWorkspaceGrant[];
}

function vendorMode(status: string | undefined, lifecycle?: "approved" | "setup" | "blocked"): BizVendorMode {
  if (status === VENDOR_STATUS.APPROVED) return "approved";
  return lifecycle === "setup" ? "setup" : "blocked";
}

type VendorRow = VendorAccessSubject & { storeName?: string; logo?: string | null };

function toBizVendor(row: VendorRow, mode: BizVendorMode): BizVendor {
  return {
    id: String(row._id),
    name: String(row.storeName ?? ""),
    ...(row.logo ? { logo: String(row.logo) } : {}),
    status: String(row.status ?? ""),
    mode,
  };
}

async function staffWorkspaces(userId: string, marketplace: MarketplaceFacts): Promise<BizWorkspaceGrant[]> {
  const access = await getActiveStaffAccess(userId);
  if (!access.active) return [];
  if (!access.vendorOwned) {
    return [
      { workspace: "platform", kind: "staff", permissions: access.permissions, staffScope: access.scope },
    ];
  }
  // A seller's staff work in their seller's workspace, which exists only on a
  // store with sellers. Their seller's own lifecycle closes it as a whole: the
  // staff of a suspended or unpaid shop do nothing from the app.
  const vendorId = access.scope.vendorIds[0];
  if (!marketplace.multiVendor || !vendorId) return [];
  const row = await Vendor.findById(vendorId)
    .select("_id status storeName logo")
    .lean<VendorRow | null>();
  if (!row) return [];
  return [
    {
      workspace: "vendor",
      kind: "staff",
      permissions: access.permissions,
      staffScope: access.scope,
      vendor: toBizVendor(row, vendorMode(row.status)),
    },
  ];
}

async function vendorWorkspaces(userId: string, marketplace: MarketplaceFacts): Promise<BizWorkspaceGrant[]> {
  if (!marketplace.multiVendor) return [];
  const row = await Vendor.findOne({ userId })
    .select(`${VENDOR_ACCESS_FIELDS} storeName logo`)
    .lean<VendorRow | null>();
  if (!row) return [];
  const [plan, lifecycle] = await Promise.all([
    row.planId
      ? VendorPlan.findById(row.planId).select("capabilities").lean<VendorAccessPlan | null>()
      : Promise.resolve(null),
    resolveVendorLifecycleMode(row),
  ]);
  const access = resolveVendorAccess({
    vendor: row,
    plan,
    settings: marketplace.vendorAccess,
    accessMode: lifecycle,
  });
  return [{ workspace: "vendor", kind: "vendor", vendor: toBizVendor(row, vendorMode(row.status, lifecycle)), access }];
}

/**
 * The operator a session belongs to. The session's role is the one the
 * session read just took from the database (an administrator in `roles` reads
 * as `admin`).
 */
export async function loadBizActor(
  session: MobileSession,
  marketplace: MarketplaceFacts,
): Promise<BizActor> {
  const userId = session.user.id;
  const role = session.user.role;
  if (role === USER_ROLES.ADMIN) {
    return { userId, role: "admin", workspaces: [{ workspace: "platform", kind: "admin" }] };
  }
  await connectDB();
  if (isStaffRole(role)) {
    return { userId, role: "staff", workspaces: await staffWorkspaces(userId, marketplace) };
  }
  if (role === USER_ROLES.VENDOR) {
    return { userId, role: "vendor", workspaces: await vendorWorkspaces(userId, marketplace) };
  }
  return { userId, role: null, workspaces: [] };
}
