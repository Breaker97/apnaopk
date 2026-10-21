/**
 * Every permission a member of the team can be given, as the screens list it:
 * groups of areas, each area with its own actions, named for what they do.
 *
 * One list for the Add team member form, the member page, the role editor and
 * the vendor's own staff screens, so a box means the same thing everywhere.
 * The permission strings are the ones the guards read
 * (config/permissions.config.ts, config/team-permissions.config.ts); only the
 * words and the grouping live here. `tests/team-permission-groups.test.ts`
 * keeps every grantable string on the list exactly once.
 *
 * Labels and hints are English phrases, translated through `admin.phrases`.
 */
import {
  LEGACY_STAFF_UMBRELLAS,
  STAFF_PERMISSIONS as S,
  type StaffPermission,
} from "@/config/permissions.config";
import {
  ADMIN_AREA_PERMISSIONS as A,
  type TeamPermission,
} from "@/config/team-permissions.config";

/** Permissions worth a second look before ticking. */
export const PERMISSION_RISKS = {
  moves_money: "Moves money",
  the_books: "The books",
  secrets: "Secrets",
  gives_access: "Gives access",
} as const;

export type PermissionRisk = keyof typeof PERMISSION_RISKS;

export interface PermissionAction {
  permission: TeamPermission;
  label: string;
  /** The row's View: every other action on the row needs it. */
  view?: boolean;
  /** Stands alone: neither needs the row's View nor goes when View goes. */
  standalone?: boolean;
  risk?: PermissionRisk;
}

export interface PermissionRow {
  key: string;
  label: string;
  hint?: string;
  /** Said instead on a vendor's staff screens, where the row offers less. */
  vendorHint?: string;
  /** The hint is about this action: left out where the action is not offered. */
  hintAbout?: TeamPermission;
  /**
   * A coarse grant from before create, edit and delete were split. A profile
   * still holding it holds every action on the row but View.
   */
  legacy?: StaffPermission;
  actions: PermissionAction[];
}

export interface PermissionGroup {
  key: string;
  label: string;
  rows: PermissionRow[];
}

const view = (permission: TeamPermission): PermissionAction => ({ permission, label: "View", view: true });
const action = (
  permission: TeamPermission,
  label: string,
  extra: Partial<PermissionAction> = {},
): PermissionAction => ({ permission, label, ...extra });

/** View, Create, Edit and Delete on a store record, with its pre-split umbrella. */
function record(
  key: string,
  label: string,
  permissions: { view: StaffPermission; create: StaffPermission; edit: StaffPermission; delete: StaffPermission },
): PermissionRow {
  return {
    key,
    label,
    legacy: LEGACY_STAFF_UMBRELLAS[key],
    actions: [
      view(permissions.view),
      action(permissions.create, "Create"),
      action(permissions.edit, "Edit"),
      action(permissions.delete, "Delete"),
    ],
  };
}

/** An admin-dashboard area: View opens its screens, Manage changes things there. */
function area(
  key: string,
  label: string,
  hint: string,
  permissions: { view: TeamPermission; manage: TeamPermission },
  risk?: PermissionRisk,
): PermissionRow {
  return {
    key,
    label,
    hint,
    actions: [view(permissions.view), action(permissions.manage, "Manage", risk ? { risk } : {})],
  };
}

export const TEAM_PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    key: "selling",
    label: "Selling",
    rows: [
      {
        key: "pos",
        label: "Point of Sale",
        hint: "Manage the till covers discounts, till reports and counters",
        actions: [
          action(S.ACCESS_POS, "Use the register", { view: true }),
          action(S.MANAGE_POS, "Manage the till"),
        ],
      },
      {
        ...record("orders", "Orders", {
          view: S.VIEW_ORDERS,
          create: S.CREATE_ORDERS,
          edit: S.EDIT_ORDERS,
          delete: S.DELETE_ORDERS,
        }),
        vendorHint: "Creating and cancelling orders stays with the store",
      },
      {
        key: "returns",
        label: "Returns & refunds",
        hint: "Refund sends money back to the customer",
        hintAbout: A.MANAGE_RETURNS,
        actions: [
          view(A.VIEW_RETURNS),
          action(A.MANAGE_RETURNS, "Refund", { risk: "moves_money" }),
          action(S.CREATE_INELIGIBLE_RETURNS, "Open past the return window", { standalone: true }),
        ],
      },
      area("quotes", "Quotes", "Price requests and offers", {
        view: A.VIEW_QUOTES,
        manage: A.MANAGE_QUOTES,
      }),
      {
        key: "abandoned_checkouts",
        label: "Abandoned checkouts",
        actions: [
          view(S.VIEW_ABANDONED_CHECKOUTS),
          action(S.MANAGE_ABANDONED_CHECKOUTS, "Send recovery emails"),
        ],
      },
    ],
  },
  {
    key: "catalog",
    label: "Catalog",
    rows: [
      record("products", "Products", {
        view: S.VIEW_PRODUCTS,
        create: S.CREATE_PRODUCTS,
        edit: S.EDIT_PRODUCTS,
        delete: S.DELETE_PRODUCTS,
      }),
      record("categories", "Categories", {
        view: S.VIEW_CATEGORIES,
        create: S.CREATE_CATEGORIES,
        edit: S.EDIT_CATEGORIES,
        delete: S.DELETE_CATEGORIES,
      }),
      record("brands", "Brands", {
        view: S.VIEW_BRANDS,
        create: S.CREATE_BRANDS,
        edit: S.EDIT_BRANDS,
        delete: S.DELETE_BRANDS,
      }),
      record("inventory", "Inventory", {
        view: S.VIEW_INVENTORY,
        create: S.CREATE_INVENTORY,
        edit: S.EDIT_INVENTORY,
        delete: S.DELETE_INVENTORY,
      }),
      {
        key: "reviews",
        label: "Reviews",
        actions: [
          view(S.VIEW_REVIEWS),
          action(S.MANAGE_REVIEWS, "Moderate"),
          action(S.EDIT_REVIEWS, "Edit"),
          action(S.DELETE_REVIEWS, "Delete"),
        ],
      },
    ],
  },
  {
    key: "customers",
    label: "Customers",
    rows: [
      {
        ...record("customers", "Customers", {
          view: S.VIEW_CUSTOMERS,
          create: S.CREATE_CUSTOMERS,
          edit: S.EDIT_CUSTOMERS,
          delete: S.DELETE_CUSTOMERS,
        }),
        vendorHint: "Customer accounts are changed by the store",
      },
      {
        key: "inbox",
        label: "Inbox",
        actions: [view(S.VIEW_INBOX), action(S.REPLY_INBOX, "Reply"), action(S.MANAGE_INBOX, "Manage")],
      },
    ],
  },
  {
    key: "marketing",
    label: "Marketing",
    rows: [
      {
        key: "campaign_banners",
        label: "Campaign banners",
        hint: "Popups and bars on the Home page",
        actions: [view(S.VIEW_CAMPAIGN_BANNERS), action(S.MANAGE_CAMPAIGN_BANNERS, "Manage")],
      },
      area("marketing", "Discounts & gift cards", "Also catalogues for ads", {
        view: A.VIEW_MARKETING,
        manage: A.MANAGE_MARKETING,
      }),
      area("boosts", "Boosts", "Sponsored products", { view: A.VIEW_BOOSTS, manage: A.MANAGE_BOOSTS }),
      area("ai_agent", "AI sales agent", "Its settings and conversations", {
        view: A.VIEW_AI_AGENT,
        manage: A.MANAGE_AI_AGENT,
      }),
      {
        key: "ai_studio",
        label: "AI Studio",
        hint: "Writes copy and images with the store's AI key",
        actions: [action(A.USE_AI_STUDIO, "Use")],
      },
    ],
  },
  {
    key: "online_store",
    label: "Online store & reports",
    rows: [
      area("online_store", "Online store", "Theme, pages, menus, sliders, checkout", {
        view: A.VIEW_ONLINE_STORE,
        manage: A.MANAGE_ONLINE_STORE,
      }),
      area("content", "Blog", "Posts, categories, comments", { view: A.VIEW_CONTENT, manage: A.MANAGE_CONTENT }),
      {
        key: "dashboard",
        label: "Dashboard",
        hint: "The home screen's figures",
        actions: [view(A.VIEW_DASHBOARD)],
      },
      { key: "analytics", label: "Analytics", actions: [view(S.VIEW_ANALYTICS)] },
    ],
  },
  {
    key: "money",
    label: "Money",
    rows: [
      area("payments", "Payments", "Transactions and chargebacks", {
        view: A.VIEW_PAYMENTS,
        manage: A.MANAGE_PAYMENTS,
      }),
      area("finance", "Finance", "Ledger, expenses, periods and reports", {
        view: A.VIEW_FINANCE,
        manage: A.MANAGE_FINANCE,
      }, "the_books"),
      area("payouts", "Payouts", "Manage sends vendors their money", {
        view: A.VIEW_PAYOUTS,
        manage: A.MANAGE_PAYOUTS,
      }, "moves_money"),
    ],
  },
  {
    key: "store_admin",
    label: "Store admin",
    rows: [
      area("vendors", "Vendors", "Applications, stores, plans and commissions", {
        view: A.VIEW_VENDORS,
        manage: A.MANAGE_VENDORS,
      }),
      area("users", "All accounts", "Every sign-in on the store", {
        view: A.VIEW_USERS,
        manage: A.MANAGE_USERS,
      }, "gives_access"),
      area("settings", "Settings", "Store settings", { view: A.VIEW_SETTINGS, manage: A.MANAGE_SETTINGS }),
      {
        key: "sensitive_settings",
        label: "Sensitive settings",
        hint: "Payment gateways, storage, email/SMS providers, sign-in, security, carriers",
        actions: [action(A.MANAGE_SENSITIVE_SETTINGS, "Manage", { risk: "secrets" })],
      },
      {
        key: "activity_log",
        label: "Activity log",
        hint: "Who did what",
        actions: [view(A.VIEW_ACTIVITY_LOG)],
      },
      // Adding members, giving them roles and changing their own permissions
      // are separate grants, and only the store owner gives any of them
      // (config/team-permissions.config.ts OWNER_ONLY_PERMISSIONS).
      {
        key: "team",
        label: "Team",
        hint: "Only the store owner gives these. Manage edits details and status, sends invitations and removes members",
        actions: [
          view(A.VIEW_TEAM),
          action(A.CREATE_TEAM_MEMBERS, "Add members", { risk: "gives_access" }),
          action(A.ASSIGN_TEAM_ROLES, "Change roles", { risk: "gives_access" }),
          action(A.EDIT_MEMBER_PERMISSIONS, "Change permissions", { risk: "gives_access" }),
          action(A.MANAGE_TEAM, "Manage", { risk: "gives_access" }),
        ],
      },
      {
        key: "roles",
        label: "Roles",
        hint: "Create and change roles. Only the store owner gives this",
        actions: [action(A.MANAGE_ROLES, "Manage", { risk: "gives_access" })],
      },
    ],
  },
];
