/**
 * Team roles and permissions — what a member of the store's own team may do
 * in the admin dashboard.
 *
 * The admin dashboard used to be all-or-nothing: every administrator held
 * everything, and `AdminProfile.permissions` was decorative. A member of the
 * team now carries a ROLE (Administrator, Manager, Staff, or one the store made) and
 * may hold extra permissions or have some taken away; the Owner always holds
 * everything.
 *
 * The levels, highest first: the Owner; a full administrator (the
 * Administrator role); an administrator on a narrower role; staff. Only the
 * Owner gives full access or the OWNER_ONLY_PERMISSIONS below, and only the
 * Owner changes a full administrator, so nobody makes or edits an account at
 * or above their own level.
 *
 * The vocabulary is the staff permissions every guard already reads (orders,
 * products, inventory, customers, POS, inbox …) plus one view/manage pair per
 * admin-only area below. A route or page that a staff member could already
 * reach keeps accepting the same staff strings, so one grant means the same
 * thing in the staff area and in the admin dashboard.
 *
 * Where it is enforced: `lib/access/team-route-permissions.ts` maps every
 * admin API path and dashboard area to the permissions that open it, and
 * `withApi`, the area layouts and the sidebar read that map.
 */
import {
  ALL_STAFF_PERMISSIONS,
  DEFAULT_STAFF_PERMISSIONS,
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";

/** The admin-only areas: one pair each, View opens the screens and Manage changes them. */
export const ADMIN_AREA_PERMISSIONS = {
  VIEW_DASHBOARD: "view_dashboard",

  VIEW_USERS: "view_users",
  MANAGE_USERS: "manage_users",

  VIEW_VENDORS: "view_vendors",
  MANAGE_VENDORS: "manage_vendors",

  VIEW_FINANCE: "view_finance",
  MANAGE_FINANCE: "manage_finance",

  VIEW_PAYOUTS: "view_payouts",
  MANAGE_PAYOUTS: "manage_payouts",

  VIEW_PAYMENTS: "view_payments",
  MANAGE_PAYMENTS: "manage_payments",

  VIEW_QUOTES: "view_quotes",
  MANAGE_QUOTES: "manage_quotes",

  VIEW_RETURNS: "view_returns",
  MANAGE_RETURNS: "manage_returns",

  VIEW_MARKETING: "view_marketing",
  MANAGE_MARKETING: "manage_marketing",

  VIEW_BOOSTS: "view_boosts",
  MANAGE_BOOSTS: "manage_boosts",

  VIEW_ONLINE_STORE: "view_online_store",
  MANAGE_ONLINE_STORE: "manage_online_store",

  VIEW_CONTENT: "view_content",
  MANAGE_CONTENT: "manage_content",

  VIEW_AI_AGENT: "view_ai_agent",
  MANAGE_AI_AGENT: "manage_ai_agent",
  /** Generate copy and images with AI (spends the store's AI key). */
  USE_AI_STUDIO: "use_ai_studio",

  VIEW_SETTINGS: "view_settings",
  MANAGE_SETTINGS: "manage_settings",
  /**
   * The settings that hold secrets or decide who gets in: payment gateways,
   * file storage, email and SMS providers, social sign-in, security, carriers.
   */
  MANAGE_SENSITIVE_SETTINGS: "manage_sensitive_settings",

  VIEW_ACTIVITY_LOG: "view_activity_log",

  VIEW_TEAM: "view_team",
  /** Edit a member's details and status, send their invitation, remove them. */
  MANAGE_TEAM: "manage_team",
  /** Add a member, on a role their own role may assign. */
  CREATE_TEAM_MEMBERS: "create_team_members",
  /** Move a member onto another role (or between the admin dashboard and the staff area). */
  ASSIGN_TEAM_ROLES: "assign_team_roles",
  /** Give a member permissions on top of their role, or take some of the role's away. */
  EDIT_MEMBER_PERMISSIONS: "edit_member_permissions",
  /** Create, change and delete roles. */
  MANAGE_ROLES: "manage_roles",
} as const;

export type AdminAreaPermission =
  (typeof ADMIN_AREA_PERMISSIONS)[keyof typeof ADMIN_AREA_PERMISSIONS];

export type TeamPermission = StaffPermission | AdminAreaPermission;

export const ALL_ADMIN_AREA_PERMISSIONS = Object.values(
  ADMIN_AREA_PERMISSIONS,
) as AdminAreaPermission[];

/** Everything a member of the admin dashboard can be given. */
export const ALL_TEAM_PERMISSIONS: TeamPermission[] = [
  ...ALL_STAFF_PERMISSIONS,
  ...ALL_ADMIN_AREA_PERMISSIONS,
];

const TEAM_PERMISSION_SET = new Set<string>(ALL_TEAM_PERMISSIONS);
const STAFF_PERMISSION_SET = new Set<string>(ALL_STAFF_PERMISSIONS);

export function isTeamPermission(value: unknown): value is TeamPermission {
  return typeof value === "string" && TEAM_PERMISSION_SET.has(value);
}

export function isStaffTierPermission(value: unknown): value is StaffPermission {
  return typeof value === "string" && STAFF_PERMISSION_SET.has(value);
}

/**
 * Which dashboard a role's members work in. An admin-tier member signs in to
 * the admin dashboard (any team permission); a staff-tier member to the staff
 * area (staff permissions only).
 */
export const TEAM_ROLE_TIERS = ["admin", "staff"] as const;
export type TeamRoleTier = (typeof TEAM_ROLE_TIERS)[number];

/** The permissions a role of this tier may carry. */
export function permissionsForTier(tier: TeamRoleTier): TeamPermission[] {
  return tier === "admin" ? ALL_TEAM_PERMISSIONS : [...ALL_STAFF_PERMISSIONS];
}

/** The built-in roles, by key. Their keys never change; their names do. */
export const BUILT_IN_TEAM_ROLE_KEYS = {
  ADMINISTRATOR: "administrator",
  MANAGER: "manager",
  STAFF: "staff",
} as const;

export type BuiltInTeamRoleKey =
  (typeof BUILT_IN_TEAM_ROLE_KEYS)[keyof typeof BUILT_IN_TEAM_ROLE_KEYS];

/**
 * The permissions that decide who may do what: managing the team, its roles,
 * the store's accounts, and the settings that hold secrets or decide who gets
 * in. Only the Owner gives them — to a member or to a role. Nobody else can
 * hand out the power to hand out power, so whatever anyone else gives is
 * always less than they hold themselves (lib/access/team-permissions.ts
 * `canGrantTeamPermissions`). A member who already holds one keeps it when
 * someone else edits them; only the giving is the Owner's.
 */
export const OWNER_ONLY_PERMISSIONS: readonly TeamPermission[] = [
  ADMIN_AREA_PERMISSIONS.MANAGE_TEAM,
  ADMIN_AREA_PERMISSIONS.CREATE_TEAM_MEMBERS,
  ADMIN_AREA_PERMISSIONS.ASSIGN_TEAM_ROLES,
  ADMIN_AREA_PERMISSIONS.EDIT_MEMBER_PERMISSIONS,
  ADMIN_AREA_PERMISSIONS.MANAGE_ROLES,
  ADMIN_AREA_PERMISSIONS.MANAGE_USERS,
  ADMIN_AREA_PERMISSIONS.MANAGE_SENSITIVE_SETTINGS,
];

const OWNER_ONLY_SET = new Set<string>(OWNER_ONLY_PERMISSIONS);

/** Whether only the Owner may give this permission. */
export function isOwnerOnlyPermission(permission: string): boolean {
  return OWNER_ONLY_SET.has(permission);
}

/**
 * What a Manager may NOT do out of the box: the store's secrets and who may
 * sign in, money leaving the store, and the books. The Owner can change the
 * Manager role like any other.
 */
export const MANAGER_WITHHELD_PERMISSIONS: readonly TeamPermission[] = [
  ...OWNER_ONLY_PERMISSIONS,
  ADMIN_AREA_PERMISSIONS.MANAGE_PAYOUTS,
  ADMIN_AREA_PERMISSIONS.MANAGE_FINANCE,
];

export const MANAGER_DEFAULT_PERMISSIONS: TeamPermission[] =
  ALL_TEAM_PERMISSIONS.filter(
    (permission) => !MANAGER_WITHHELD_PERMISSIONS.includes(permission),
  );

export interface BuiltInTeamRole {
  key: BuiltInTeamRoleKey;
  name: string;
  description: string;
  tier: TeamRoleTier;
  /** Holds every permission, including ones a later release adds. */
  allPermissions: boolean;
  permissions: TeamPermission[];
}

export const BUILT_IN_TEAM_ROLES: readonly BuiltInTeamRole[] = [
  {
    key: BUILT_IN_TEAM_ROLE_KEYS.ADMINISTRATOR,
    name: "Administrator",
    description: "Everything in the admin dashboard.",
    tier: "admin",
    allPermissions: true,
    permissions: [],
  },
  {
    key: BUILT_IN_TEAM_ROLE_KEYS.MANAGER,
    name: "Manager",
    description:
      "Runs the store day to day: orders, catalogue, customers, vendors, marketing and the online store. Not the store's secrets, the team, payouts or the books.",
    tier: "admin",
    allPermissions: false,
    permissions: MANAGER_DEFAULT_PERMISSIONS,
  },
  {
    // Every staff member of the store's own team has a role; this is the one
    // they start on. Staff from before 3.1 are moved onto it with their own
    // list kept as changes (db:migrate team-staff-role).
    key: BUILT_IN_TEAM_ROLE_KEYS.STAFF,
    name: "Staff",
    description: "Sells and helps customers. Starts with the till, orders and the inbox.",
    tier: "staff",
    allPermissions: false,
    permissions: DEFAULT_STAFF_PERMISSIONS,
  },
];

/** Every string that opens a staff resource's screens: its view and every verb on it. */
export const STAFF_RESOURCE_ANY: Record<string, StaffPermission[]> = {
  pos: [STAFF_PERMISSIONS.ACCESS_POS, STAFF_PERMISSIONS.MANAGE_POS],
  orders: [STAFF_PERMISSIONS.VIEW_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS, STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.DELETE_ORDERS],
  products: [STAFF_PERMISSIONS.VIEW_PRODUCTS, STAFF_PERMISSIONS.MANAGE_PRODUCTS, STAFF_PERMISSIONS.CREATE_PRODUCTS, STAFF_PERMISSIONS.EDIT_PRODUCTS, STAFF_PERMISSIONS.DELETE_PRODUCTS],
  categories: [STAFF_PERMISSIONS.VIEW_CATEGORIES, STAFF_PERMISSIONS.MANAGE_CATEGORIES, STAFF_PERMISSIONS.CREATE_CATEGORIES, STAFF_PERMISSIONS.EDIT_CATEGORIES, STAFF_PERMISSIONS.DELETE_CATEGORIES],
  brands: [STAFF_PERMISSIONS.VIEW_BRANDS, STAFF_PERMISSIONS.MANAGE_BRANDS, STAFF_PERMISSIONS.CREATE_BRANDS, STAFF_PERMISSIONS.EDIT_BRANDS, STAFF_PERMISSIONS.DELETE_BRANDS],
  customers: [STAFF_PERMISSIONS.VIEW_CUSTOMERS, STAFF_PERMISSIONS.MANAGE_CUSTOMERS, STAFF_PERMISSIONS.CREATE_CUSTOMERS, STAFF_PERMISSIONS.EDIT_CUSTOMERS, STAFF_PERMISSIONS.DELETE_CUSTOMERS],
  inventory: [STAFF_PERMISSIONS.VIEW_INVENTORY, STAFF_PERMISSIONS.MANAGE_INVENTORY, STAFF_PERMISSIONS.CREATE_INVENTORY, STAFF_PERMISSIONS.EDIT_INVENTORY, STAFF_PERMISSIONS.DELETE_INVENTORY],
  reviews: [STAFF_PERMISSIONS.VIEW_REVIEWS, STAFF_PERMISSIONS.MANAGE_REVIEWS, STAFF_PERMISSIONS.EDIT_REVIEWS, STAFF_PERMISSIONS.DELETE_REVIEWS],
  inbox: [STAFF_PERMISSIONS.VIEW_INBOX, STAFF_PERMISSIONS.REPLY_INBOX, STAFF_PERMISSIONS.MANAGE_INBOX],
  analytics: [STAFF_PERMISSIONS.VIEW_ANALYTICS],
  abandoned: [STAFF_PERMISSIONS.VIEW_ABANDONED_CHECKOUTS, STAFF_PERMISSIONS.MANAGE_ABANDONED_CHECKOUTS],
  banners: [STAFF_PERMISSIONS.VIEW_CAMPAIGN_BANNERS, STAFF_PERMISSIONS.MANAGE_CAMPAIGN_BANNERS],
};

/** Every string that changes a staff resource: each verb and the legacy umbrella. */
export const STAFF_RESOURCE_WRITE: Record<string, StaffPermission[]> = {
  pos: [STAFF_PERMISSIONS.MANAGE_POS],
  orders: [STAFF_PERMISSIONS.MANAGE_ORDERS, STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.DELETE_ORDERS],
  products: [STAFF_PERMISSIONS.MANAGE_PRODUCTS, STAFF_PERMISSIONS.CREATE_PRODUCTS, STAFF_PERMISSIONS.EDIT_PRODUCTS, STAFF_PERMISSIONS.DELETE_PRODUCTS],
  categories: [STAFF_PERMISSIONS.MANAGE_CATEGORIES, STAFF_PERMISSIONS.CREATE_CATEGORIES, STAFF_PERMISSIONS.EDIT_CATEGORIES, STAFF_PERMISSIONS.DELETE_CATEGORIES],
  brands: [STAFF_PERMISSIONS.MANAGE_BRANDS, STAFF_PERMISSIONS.CREATE_BRANDS, STAFF_PERMISSIONS.EDIT_BRANDS, STAFF_PERMISSIONS.DELETE_BRANDS],
  customers: [STAFF_PERMISSIONS.MANAGE_CUSTOMERS, STAFF_PERMISSIONS.CREATE_CUSTOMERS, STAFF_PERMISSIONS.EDIT_CUSTOMERS, STAFF_PERMISSIONS.DELETE_CUSTOMERS],
  inventory: [STAFF_PERMISSIONS.MANAGE_INVENTORY, STAFF_PERMISSIONS.CREATE_INVENTORY, STAFF_PERMISSIONS.EDIT_INVENTORY, STAFF_PERMISSIONS.DELETE_INVENTORY],
  reviews: [STAFF_PERMISSIONS.MANAGE_REVIEWS, STAFF_PERMISSIONS.EDIT_REVIEWS, STAFF_PERMISSIONS.DELETE_REVIEWS],
  inbox: [STAFF_PERMISSIONS.REPLY_INBOX, STAFF_PERMISSIONS.MANAGE_INBOX],
  abandoned: [STAFF_PERMISSIONS.MANAGE_ABANDONED_CHECKOUTS],
  banners: [STAFF_PERMISSIONS.MANAGE_CAMPAIGN_BANNERS],
};
