import { CAPABILITIES, type Capability } from "@/contracts/mobile/biz/v1/me";
import { WORKSPACES, type Workspace } from "@/contracts/mobile/biz/v1/common";
import {
  STAFF_PERMISSIONS,
  VENDOR_PERMISSIONS,
  type StaffPermission,
  type VendorPermission,
} from "@/config/permissions.config";
import { MobileApiError } from "@/lib/api-core/errors";
import type { BizActor, BizWorkspaceGrant } from "./actor";

/**
 * Who may call a business-app endpoint: the rule every biz route declares
 * (`workspace` + `permission`, lib/api-core/registry.ts), and the decisions
 * the pipeline makes with it, as pure functions of the actor (./actor.ts).
 *
 * The rules are named here once, one per capability of the contract
 * (contracts/mobile/biz/v1/me.ts), and GET /me works the capabilities out
 * from the same table: the app hides exactly what the API would refuse. A
 * route's rule must be one of these (the registry policy test checks it).
 */

/**
 * Which workspace a route works in:
 * - `account`: none; it is about the person's own account (GET /me, their
 *   notifications and devices). Any operator, whatever their workspaces.
 * - `any`: either workspace, the one the request is for.
 * - `platform`, `vendor`: only that one (a seller's payouts, sellers'
 *   applications).
 */
export type BizWorkspaceMode = "account" | "any" | Workspace;

/**
 * The permissions a route asks for, by who is asking:
 * - `staff`: a staff member (the store's own or a seller's), any one of these
 *   staff permissions; `[]` every staff member, `null` none.
 * - `vendor`: a seller, any one of these, as their plan resolves them
 *   (`manage_x` covers `edit_x`); `[]` every seller, `null` none.
 * An administrator is always let through.
 */
export interface BizPermission {
  staff: readonly StaffPermission[] | null;
  vendor: readonly VendorPermission[] | null;
}

export interface BizAccessRule {
  workspace: BizWorkspaceMode;
  permission: BizPermission;
}

export const ANY_OPERATOR: BizPermission = { staff: [], vendor: [] };

/** The rule of each capability: what the app shows is what the route lets through. */
export const CAPABILITY_ACCESS = {
  VIEW_ORDERS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.VIEW_ORDERS], vendor: [VENDOR_PERMISSIONS.VIEW_ORDERS] },
  },
  EDIT_ORDERS: {
    workspace: "any",
    permission: {
      staff: [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
      vendor: [VENDOR_PERMISSIONS.EDIT_ORDERS],
    },
  },
  CANCEL_ORDERS: {
    workspace: "any",
    permission: {
      staff: [STAFF_PERMISSIONS.DELETE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
      vendor: [VENDOR_PERMISSIONS.DELETE_ORDERS],
    },
  },
  VIEW_PRODUCTS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.VIEW_PRODUCTS], vendor: [VENDOR_PERMISSIONS.VIEW_PRODUCTS] },
  },
  CREATE_ORDERS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS], vendor: [VENDOR_PERMISSIONS.CREATE_ORDERS] },
  },
  RECORD_ORDER_PAYMENTS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS], vendor: [VENDOR_PERMISSIONS.CREATE_ORDERS] },
  },
  VIEW_ORDER_CUSTOMERS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.VIEW_CUSTOMERS], vendor: [VENDOR_PERMISSIONS.CREATE_ORDERS] },
  },
  CREATE_ORDER_CONTACTS: {
    workspace: "platform",
    permission: { staff: [STAFF_PERMISSIONS.CREATE_CUSTOMERS, STAFF_PERMISSIONS.MANAGE_CUSTOMERS], vendor: null },
  },
  CREATE_PRODUCTS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.CREATE_PRODUCTS, STAFF_PERMISSIONS.MANAGE_PRODUCTS], vendor: [VENDOR_PERMISSIONS.CREATE_PRODUCTS] },
  },
  DELETE_PRODUCTS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.DELETE_PRODUCTS, STAFF_PERMISSIONS.MANAGE_PRODUCTS], vendor: [VENDOR_PERMISSIONS.DELETE_PRODUCTS] },
  },
  EDIT_PRODUCTS: {
    workspace: "any",
    permission: {
      staff: [STAFF_PERMISSIONS.EDIT_PRODUCTS, STAFF_PERMISSIONS.MANAGE_PRODUCTS],
      vendor: [VENDOR_PERMISSIONS.EDIT_PRODUCTS],
    },
  },
  // A seller's stock is part of their catalogue on the website (the vendor
  // inventory routes ask for the product permissions); the store's staff have
  // inventory permissions of their own.
  VIEW_STOCK: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.VIEW_INVENTORY], vendor: [VENDOR_PERMISSIONS.VIEW_PRODUCTS] },
  },
  ADJUST_STOCK: {
    workspace: "any",
    permission: {
      staff: [STAFF_PERMISSIONS.EDIT_INVENTORY, STAFF_PERMISSIONS.MANAGE_INVENTORY],
      vendor: [VENDOR_PERMISSIONS.EDIT_PRODUCTS],
    },
  },
  VIEW_INBOX: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.VIEW_INBOX], vendor: [VENDOR_PERMISSIONS.VIEW_INBOX] },
  },
  REPLY_INBOX: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.REPLY_INBOX], vendor: [VENDOR_PERMISSIONS.REPLY_INBOX] },
  },
  // Giving a conversation to someone else, resolving and reopening it: what
  // the website's inbox asks the manage permission for (lib/conversations).
  MANAGE_INBOX: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.MANAGE_INBOX], vendor: [VENDOR_PERMISSIONS.MANAGE_INBOX] },
  },
  VIEW_PAYOUTS: {
    workspace: "vendor",
    permission: { staff: null, vendor: [VENDOR_PERMISSIONS.VIEW_PAYOUTS] },
  },
  // No staff permission approves a seller: administrators only, as on the website.
  REVIEW_VENDOR_APPLICATIONS: {
    workspace: "platform",
    permission: { staff: null, vendor: null },
  },
  VIEW_RETURNS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.VIEW_ORDERS], vendor: [VENDOR_PERMISSIONS.VIEW_ORDERS] },
  },
  HANDLE_RETURNS: {
    workspace: "any",
    permission: { staff: [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS], vendor: [VENDOR_PERMISSIONS.EDIT_ORDERS] },
  },
  OVERRIDE_RETURN_ELIGIBILITY: {
    workspace: "platform",
    permission: { staff: [STAFF_PERMISSIONS.CREATE_INELIGIBLE_RETURNS], vendor: null },
  },
  ISSUE_REFUNDS: {
    workspace: "platform",
    permission: { staff: null, vendor: null },
  },
  // The leaf also verifies refundPayer/custody and the current settlement state.
  RECORD_REFUND_SETTLEMENT: {
    workspace: "any",
    permission: { staff: null, vendor: [VENDOR_PERMISSIONS.EDIT_ORDERS] },
  },
  // A business's own notes about a customer (lib/customers/business-customers.ts):
  // the store's team share the store's, a seller's team the seller's. Seeing a
  // customer is not enough: a staff member needs a grant that writes customer
  // records. A seller's staff can never hold edit or manage (those change the
  // account every seller shares: VENDOR_STAFF_PLATFORM_ONLY_PERMISSIONS); a
  // note changes nothing of it, so the one a seller can give, create, opens
  // their notes. A seller needs what seeing their customers needs.
  MANAGE_CUSTOMER_NOTES: {
    workspace: "any",
    permission: {
      staff: [STAFF_PERMISSIONS.EDIT_CUSTOMERS, STAFF_PERMISSIONS.MANAGE_CUSTOMERS, STAFF_PERMISSIONS.CREATE_CUSTOMERS],
      vendor: [VENDOR_PERMISSIONS.CREATE_ORDERS],
    },
  },
} as const satisfies Readonly<Record<Capability, BizAccessRule>>;

/**
 * Every rule a biz route may declare: the capabilities', and two for routes
 * any operator may call:
 * - `account`: about the person's own account (GET /me, notifications,
 *   devices), whether or not they have a workspace;
 * - `workspace`: in the workspace the request is for (GET /home, whose tiles
 *   each follow a capability).
 *
 * Spread one into the entry: `defineBizRoute({ …, ...BIZ_ACCESS.VIEW_ORDERS })`.
 */
export const BIZ_ACCESS = {
  account: { workspace: "account", permission: ANY_OPERATOR },
  workspace: { workspace: "any", permission: ANY_OPERATOR },
  ...CAPABILITY_ACCESS,
} as const satisfies Readonly<Record<string, BizAccessRule>>;

/** A capability's rule, as the checks below read it. */
const ruleOf = (capability: Capability): BizAccessRule => CAPABILITY_ACCESS[capability];

const isWorkspace = (value: string): value is Workspace =>
  (WORKSPACES as readonly string[]).includes(value);

function workspacesOf(actor: BizActor): Workspace[] {
  return actor.workspaces.map((grant) => grant.workspace);
}

export function workspaceNotAvailable(actor: BizActor): MobileApiError {
  return new MobileApiError(
    403,
    "WORKSPACE_NOT_AVAILABLE",
    actor.workspaces.length === 0
      ? "This account cannot work in the business app right now."
      : "This account does not work in that part of the store.",
    { details: { workspaces: workspacesOf(actor) } },
  );
}

/**
 * The workspace a request is for: the one `X-Workspace` names, else the only
 * one the person has, else the only one the route works in. Null for a
 * route about the account when none can be told (no workspace, or two and no
 * header). Refuses a header that is not a workspace (400), a workspace the
 * person does not have or the route does not work in (403), and a route
 * that needs one when none can be told.
 */
export function chooseWorkspace(
  actor: BizActor,
  mode: BizWorkspaceMode,
  header: string | null,
): BizWorkspaceGrant | null {
  const value = header?.trim().toLowerCase() || null;
  if (value !== null && !isWorkspace(value)) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "X-Workspace is platform or vendor.", {
      errors: { "X-Workspace": ["Send platform or vendor."] },
    });
  }

  let grant: BizWorkspaceGrant | undefined;
  if (value) {
    grant = actor.workspaces.find((candidate) => candidate.workspace === value);
    if (!grant) {
      if (mode === "account") return null;
      throw workspaceNotAvailable(actor);
    }
  } else if (actor.workspaces.length === 1) {
    grant = actor.workspaces[0];
  } else if (mode === "platform" || mode === "vendor") {
    grant = actor.workspaces.find((candidate) => candidate.workspace === mode);
  }

  if (mode === "account") return grant ?? null;
  if (!grant) {
    if (actor.workspaces.length > 1) {
      throw new MobileApiError(400, "VALIDATION_ERROR", "Say which workspace this is for in X-Workspace.", {
        errors: { "X-Workspace": ["Send platform or vendor."] },
      });
    }
    throw workspaceNotAvailable(actor);
  }
  if (mode !== "any" && grant.workspace !== mode) throw workspaceNotAvailable(actor);
  return grant;
}

/** Whether a grant's permissions satisfy a rule's (an administrator always does). */
export function grantHasPermission(grant: BizWorkspaceGrant, permission: BizPermission): boolean {
  if (grant.kind === "admin") return true;
  if (grant.kind === "staff") {
    const wanted = permission.staff;
    return wanted !== null && (wanted.length === 0 || wanted.some((p) => grant.permissions.includes(p)));
  }
  const wanted = permission.vendor;
  return wanted !== null && (wanted.length === 0 || wanted.some((p) => grant.access.has(p)));
}

function vendorNotActive(status: string): MobileApiError {
  return new MobileApiError(403, "VENDOR_NOT_ACTIVE", "The shop is not open for this.", {
    details: { status },
  });
}

/**
 * Refuses a request the grant does not allow: a closed shop is
 * VENDOR_NOT_ACTIVE (a seller in the unpaid setup window only for what the
 * window does not cover: their catalogue still works), anything else missing
 * AUTHORIZATION_ERROR.
 */
export function assertGrantAllows(grant: BizWorkspaceGrant, permission: BizPermission): void {
  if (grant.workspace === "vendor" && grant.vendor.mode === "blocked") {
    throw vendorNotActive(grant.vendor.status);
  }
  if (grantHasPermission(grant, permission)) return;
  if (grant.workspace === "vendor" && grant.vendor.mode !== "approved") {
    throw vendorNotActive(grant.vendor.status);
  }
  throw new MobileApiError(403, "AUTHORIZATION_ERROR", "You do not have permission to do this.");
}

/** Whether a capability's rule lets this grant through, without refusing. */
export function grantCan(grant: BizWorkspaceGrant, capability: Capability): boolean {
  if (grant.workspace === "vendor" && grant.kind === "staff" && ["CREATE_ORDERS", "RECORD_ORDER_PAYMENTS"].includes(capability)) return false;
  const rule = ruleOf(capability);
  if (rule.workspace !== "any" && rule.workspace !== grant.workspace) return false;
  if (grant.workspace === "vendor" && grant.vendor.mode === "blocked") return false;
  return grantHasPermission(grant, rule.permission);
}

/** What GET /me says a grant may do: every capability `grantCan`. */
export function capabilitiesOf(grant: BizWorkspaceGrant): Capability[] {
  return CAPABILITIES.filter((capability) => grantCan(grant, capability));
}

/**
 * Refuses unless the grant has a capability, for a handler that checks a
 * second one inside a route (cancelling within the order actions).
 */
export function assertCapability(grant: BizWorkspaceGrant, capability: Capability): void {
  const rule = ruleOf(capability);
  if (rule.workspace !== "any" && rule.workspace !== grant.workspace) {
    throw new MobileApiError(403, "AUTHORIZATION_ERROR", "You do not have permission to do this.");
  }
  assertGrantAllows(grant, rule.permission);
}
