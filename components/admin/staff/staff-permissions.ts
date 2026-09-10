import {
  ALL_STAFF_PERMISSIONS,
  STAFF_PERMISSIONS,
} from "@/config/permissions.config";
import type { StaffPermission } from "@/config/permissions.config";

/**
 * The permission vocabulary shared by the staff create form and the staff
 * detail shell. Both screens render the same matrix, so the resource table and
 * its legacy-`manage_*` handling live here rather than in either component.
 */

export const PERMISSION_LABELS: Record<string, string> = {
  access_pos: "POS",
  manage_pos: "Manage POS",
  create_pos: "Create POS",
  edit_pos: "Edit POS",
  delete_pos: "Delete POS",
  view_orders: "View Orders",
  manage_orders: "Manage Orders",
  create_orders: "Create Orders",
  edit_orders: "Edit Orders",
  delete_orders: "Delete Orders",
  view_products: "View Products",
  manage_products: "Manage Products",
  create_products: "Create Products",
  edit_products: "Edit Products",
  delete_products: "Delete Products",
  view_customers: "View Customers",
  manage_customers: "Manage Customers",
  create_customers: "Create Customers",
  edit_customers: "Edit Customers",
  delete_customers: "Delete Customers",
  view_inventory: "View Inventory",
  manage_inventory: "Manage Inventory",
  create_inventory: "Create Inventory",
  edit_inventory: "Edit Inventory",
  delete_inventory: "Delete Inventory",
  view_reviews: "View Reviews",
  manage_reviews: "Manage Reviews",
  edit_reviews: "Edit Reviews",
  delete_reviews: "Delete Reviews",
  view_analytics: "Analytics",
  view_inbox: "View Inbox",
  reply_inbox: "Reply in Inbox",
  manage_inbox: "Manage Inbox",
};

type PermissionAction = "create" | "edit" | "delete";

export type PermissionResource = {
  key: string;
  label: string;
  /** Second line under the label — what the row's columns actually mean. */
  hint?: string;
  view?: StaffPermission;
  legacyManage?: StaffPermission;
  create?: StaffPermission;
  edit?: StaffPermission;
  delete?: StaffPermission;
};

export const PERMISSION_RESOURCES: PermissionResource[] = [
  {
    key: "pos",
    label: "Point of Sale",
    hint: "Register access and till actions",
    view: STAFF_PERMISSIONS.ACCESS_POS,
    legacyManage: STAFF_PERMISSIONS.MANAGE_POS,
    create: STAFF_PERMISSIONS.CREATE_POS,
    edit: STAFF_PERMISSIONS.EDIT_POS,
    delete: STAFF_PERMISSIONS.DELETE_POS,
  },
  {
    key: "orders",
    label: "Orders",
    view: STAFF_PERMISSIONS.VIEW_ORDERS,
    legacyManage: STAFF_PERMISSIONS.MANAGE_ORDERS,
    create: STAFF_PERMISSIONS.CREATE_ORDERS,
    edit: STAFF_PERMISSIONS.EDIT_ORDERS,
    delete: STAFF_PERMISSIONS.DELETE_ORDERS,
  },
  {
    key: "products",
    label: "Products",
    view: STAFF_PERMISSIONS.VIEW_PRODUCTS,
    legacyManage: STAFF_PERMISSIONS.MANAGE_PRODUCTS,
    create: STAFF_PERMISSIONS.CREATE_PRODUCTS,
    edit: STAFF_PERMISSIONS.EDIT_PRODUCTS,
    delete: STAFF_PERMISSIONS.DELETE_PRODUCTS,
  },
  {
    key: "customers",
    label: "Customers",
    view: STAFF_PERMISSIONS.VIEW_CUSTOMERS,
    legacyManage: STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
    create: STAFF_PERMISSIONS.CREATE_CUSTOMERS,
    edit: STAFF_PERMISSIONS.EDIT_CUSTOMERS,
    delete: STAFF_PERMISSIONS.DELETE_CUSTOMERS,
  },
  {
    key: "inventory",
    label: "Inventory",
    view: STAFF_PERMISSIONS.VIEW_INVENTORY,
    legacyManage: STAFF_PERMISSIONS.MANAGE_INVENTORY,
    create: STAFF_PERMISSIONS.CREATE_INVENTORY,
    edit: STAFF_PERMISSIONS.EDIT_INVENTORY,
    delete: STAFF_PERMISSIONS.DELETE_INVENTORY,
  },
  {
    // Reviews permissions have always existed in the config; without a row
    // here they could only be granted by "Select all", and the summary showed
    // them as raw `view_reviews` keys.
    key: "reviews",
    label: "Reviews",
    hint: "Create = moderate",
    view: STAFF_PERMISSIONS.VIEW_REVIEWS,
    create: STAFF_PERMISSIONS.MANAGE_REVIEWS,
    edit: STAFF_PERMISSIONS.EDIT_REVIEWS,
    delete: STAFF_PERMISSIONS.DELETE_REVIEWS,
  },
  {
    key: "analytics",
    label: "Analytics",
    hint: "View only",
    view: STAFF_PERMISSIONS.VIEW_ANALYTICS,
  },
  {
    key: "inbox",
    label: "Inbox",
    hint: "Create = reply · Edit = manage",
    view: STAFF_PERMISSIONS.VIEW_INBOX,
    create: STAFF_PERMISSIONS.REPLY_INBOX,
    edit: STAFF_PERMISSIONS.MANAGE_INBOX,
  },
];

export const PERMISSION_ACTIONS: {
  key: PermissionAction;
  label: string;
}[] = [
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
];

/**
 * Expand the legacy `manage_*` grants into the explicit create/edit/delete
 * ones the matrix renders, so a profile saved before the split still shows
 * every box it actually implies.
 */
export function normalizeStaffPermissions(
  input: StaffPermission[],
): StaffPermission[] {
  const next = new Set<StaffPermission>(input);

  for (const resource of PERMISSION_RESOURCES) {
    if (resource.legacyManage && next.has(resource.legacyManage)) {
      if (resource.create) next.add(resource.create);
      if (resource.edit) next.add(resource.edit);
      if (resource.delete) next.add(resource.delete);
    }
  }

  return Array.from(next);
}

export function hasResourceView(
  permissions: StaffPermission[],
  resource: PermissionResource,
): boolean {
  return resource.view ? permissions.includes(resource.view) : false;
}

export function hasResourceAction(
  permissions: StaffPermission[],
  resource: PermissionResource,
  action: PermissionAction,
): boolean {
  const actionPermission = resource[action];
  if (actionPermission && permissions.includes(actionPermission)) return true;
  return resource.legacyManage
    ? permissions.includes(resource.legacyManage)
    : false;
}

/** Turning a resource off clears every action it implies, legacy grant included. */
export function toggleResourceView(
  permissions: StaffPermission[],
  resource: PermissionResource,
  checked: boolean,
): StaffPermission[] {
  let next = [...permissions];

  if (resource.view) {
    if (checked && !next.includes(resource.view)) next.push(resource.view);
    if (!checked) next = next.filter((p) => p !== resource.view);
  }

  if (!checked) {
    const implied = [
      resource.legacyManage,
      resource.create,
      resource.edit,
      resource.delete,
    ].filter(Boolean) as StaffPermission[];
    next = next.filter((p) => !implied.includes(p));
  }

  return next;
}

/** Granting an action implies View, and drops the coarse legacy grant. */
export function toggleResourceAction(
  permissions: StaffPermission[],
  resource: PermissionResource,
  action: PermissionAction,
  checked: boolean,
): StaffPermission[] {
  const actionPermission = resource[action];
  if (!actionPermission) return permissions;

  let next = [...permissions];

  if (resource.legacyManage) {
    next = next.filter((p) => p !== resource.legacyManage);
  }

  if (checked) {
    if (!next.includes(actionPermission)) next.push(actionPermission);
    if (resource.view && !next.includes(resource.view)) next.push(resource.view);
  } else {
    next = next.filter((p) => p !== actionPermission);
  }

  return next;
}

interface StaffRolePreset {
  key: string;
  label: string;
  description: string;
  permissions: StaffPermission[];
}

/**
 * Starting points for the matrix. They are not stored anywhere — applying one
 * only sets the checkboxes, and any edit afterwards reads back as "Custom".
 */
export const STAFF_ROLE_PRESETS: StaffRolePreset[] = [
  {
    key: "cashier",
    label: "Cashier",
    description: "Ring up sales at the register",
    permissions: [
      STAFF_PERMISSIONS.ACCESS_POS,
      STAFF_PERMISSIONS.CREATE_POS,
      STAFF_PERMISSIONS.VIEW_ORDERS,
      STAFF_PERMISSIONS.CREATE_ORDERS,
      STAFF_PERMISSIONS.VIEW_PRODUCTS,
      STAFF_PERMISSIONS.VIEW_CUSTOMERS,
      STAFF_PERMISSIONS.CREATE_CUSTOMERS,
    ],
  },
  {
    key: "sales_associate",
    label: "Sales associate",
    description: "Register, orders, customers and inbox",
    permissions: [
      STAFF_PERMISSIONS.ACCESS_POS,
      STAFF_PERMISSIONS.CREATE_POS,
      STAFF_PERMISSIONS.EDIT_POS,
      STAFF_PERMISSIONS.VIEW_ORDERS,
      STAFF_PERMISSIONS.CREATE_ORDERS,
      STAFF_PERMISSIONS.EDIT_ORDERS,
      STAFF_PERMISSIONS.VIEW_PRODUCTS,
      STAFF_PERMISSIONS.VIEW_INVENTORY,
      STAFF_PERMISSIONS.VIEW_CUSTOMERS,
      STAFF_PERMISSIONS.CREATE_CUSTOMERS,
      STAFF_PERMISSIONS.EDIT_CUSTOMERS,
      STAFF_PERMISSIONS.VIEW_INBOX,
      STAFF_PERMISSIONS.REPLY_INBOX,
    ],
  },
  {
    key: "store_manager",
    label: "Store manager",
    description: "Everything except deleting records",
    permissions: (ALL_STAFF_PERMISSIONS as StaffPermission[]).filter(
      (permission) =>
        !permission.startsWith("delete_") &&
        // The coarse legacy grants imply delete, so a "no delete" preset can
        // not carry them.
        !PERMISSION_RESOURCES.some((r) => r.legacyManage === permission),
    ),
  },
  {
    key: "full_access",
    label: "Full access",
    description: "Every permission, including delete",
    permissions: (ALL_STAFF_PERMISSIONS as StaffPermission[]).filter(
      (permission) =>
        !PERMISSION_RESOURCES.some((r) => r.legacyManage === permission),
    ),
  },
];

/**
 * Which preset (if any) the current selection matches.
 *
 * Compared over the grantable set only: a profile saved before the manage/
 * create/edit/delete split still carries the coarse `manage_*` keys, and those
 * are already expanded into the columns the matrix shows — counting them would
 * make an all-boxes-ticked profile match nothing.
 */
export function matchStaffRolePreset(
  permissions: StaffPermission[],
): StaffRolePreset | null {
  const current = toGrantableSet(permissions);
  return (
    STAFF_ROLE_PRESETS.find((preset) => {
      const target = toGrantableSet(preset.permissions);
      if (target.size !== current.size) return false;
      for (const permission of target) {
        if (!current.has(permission)) return false;
      }
      return true;
    }) ?? null
  );
}

function toGrantableSet(permissions: StaffPermission[]) {
  return new Set(
    normalizeStaffPermissions(permissions).filter((permission) =>
      GRANTABLE_STAFF_PERMISSIONS.includes(permission),
    ),
  );
}

/**
 * Permissions the matrix can actually reach — the denominator behind
 * "12 of 33". The legacy `manage_*` grants are deliberately excluded: they are
 * migration leftovers, not separate powers.
 */
export const GRANTABLE_STAFF_PERMISSIONS = (
  ALL_STAFF_PERMISSIONS as StaffPermission[]
).filter(
  (permission) => !PERMISSION_RESOURCES.some((r) => r.legacyManage === permission),
);
