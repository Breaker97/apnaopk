import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import type { StaffPermission } from "@/config/permissions.config";

export type StaffArea = "admin" | "vendor";

type StaffAccountStatus = "active" | "inactive" | "banned";

export interface StaffFormValues {
  name: string;
  email: string;
  phone: string;
  status: StaffAccountStatus;
  permissions: StaffPermission[];
  vendorIds: string[];
  locationIds: string[];
  /** Free text, one region per line — split on save. */
  fulfillmentRegions: string;
  department: string;
  jobTitle: string;
  /** `yyyy-mm-dd`, the shape a native date input reads and writes. */
  startDate: string;
  notes: string;
  isActive: boolean;
}

export const defaultStaffFormValues: StaffFormValues = {
  name: "",
  email: "",
  phone: "",
  status: "active",
  permissions: [
    STAFF_PERMISSIONS.ACCESS_POS,
    STAFF_PERMISSIONS.VIEW_ORDERS,
    STAFF_PERMISSIONS.VIEW_PRODUCTS,
    STAFF_PERMISSIONS.VIEW_CUSTOMERS,
  ],
  vendorIds: [],
  locationIds: [],
  fulfillmentRegions: "",
  department: "",
  jobTitle: "",
  startDate: "",
  notes: "",
  isActive: true,
};

/** Identity block above the tabs — everything it shows comes from the GET. */
export interface StaffHeaderData {
  name: string;
  email: string;
  phone?: string;
  image?: string;
  status: StaffAccountStatus;
  department?: string;
  jobTitle?: string;
  createdAt?: string;
  /** Whether the account has a password, so the invite card can say which. */
  hasPassword?: boolean;
  twoFactorEnabled?: boolean;
  assignedByEmail?: string;
}

/** Commerce counts, loaded separately from the identity block. */
export interface StaffStats {
  orderCount: number;
  posOrderCount: number;
  onlineOrderCount: number;
  totalSales: number;
  lastOrderAt?: string | null;
}

export interface StaffNoteEntry {
  _id: string;
  body: string;
  authorEmail?: string;
  createdAt: string;
}

export interface StaffScopeOption {
  _id: string;
  name: string;
}
