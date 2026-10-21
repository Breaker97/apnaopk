import { STAFF_PERMISSIONS, type StaffPermission } from "@/config/permissions.config";

export interface StaffResourceActions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const resources = {
  orders: [STAFF_PERMISSIONS.VIEW_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS, STAFF_PERMISSIONS.CREATE_ORDERS, STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.DELETE_ORDERS],
  products: [STAFF_PERMISSIONS.VIEW_PRODUCTS, STAFF_PERMISSIONS.MANAGE_PRODUCTS, STAFF_PERMISSIONS.CREATE_PRODUCTS, STAFF_PERMISSIONS.EDIT_PRODUCTS, STAFF_PERMISSIONS.DELETE_PRODUCTS],
  categories: [STAFF_PERMISSIONS.VIEW_CATEGORIES, STAFF_PERMISSIONS.MANAGE_CATEGORIES, STAFF_PERMISSIONS.CREATE_CATEGORIES, STAFF_PERMISSIONS.EDIT_CATEGORIES, STAFF_PERMISSIONS.DELETE_CATEGORIES],
  brands: [STAFF_PERMISSIONS.VIEW_BRANDS, STAFF_PERMISSIONS.MANAGE_BRANDS, STAFF_PERMISSIONS.CREATE_BRANDS, STAFF_PERMISSIONS.EDIT_BRANDS, STAFF_PERMISSIONS.DELETE_BRANDS],
} as const;

export type StaffResource = keyof typeof resources;

/** Viewing a resource includes reaching the records needed by its granted actions. */
export function staffResourcePermissions(resource: StaffResource): StaffPermission[] {
  return [...resources[resource]];
}

export function staffResourceActions(
  permissions: readonly StaffPermission[],
  resource: StaffResource,
): StaffResourceActions {
  const [, manage, create, edit, remove] = resources[resource];
  const manages = permissions.includes(manage);
  return {
    canCreate: manages || permissions.includes(create),
    canEdit: manages || permissions.includes(edit),
    canDelete: manages || permissions.includes(remove),
  };
}
