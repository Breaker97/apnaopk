import { USER_ACCOUNT_STATUS } from "@/config/app.config";

export type CustomerStatus = "active" | "inactive" | "banned";
export type LoyaltyTier = "bronze" | "silver" | "gold" | "platinum";

export interface CustomerEmailNotifications {
  orderUpdates: boolean;
  promotions: boolean;
  newsletter: boolean;
  priceDrops: boolean;
  backInStock: boolean;
}

/**
 * Cached commerce stats surfaced in the header KPI strip. Mirrors the
 * CustomerProfile.stats sub-document (all optional / may be absent).
 */
export interface CustomerStats {
  totalOrders?: number;
  totalSpent?: number;
  averageOrderValue?: number;
  lastOrderDate?: string;
  totalReviews?: number;
  averageRating?: number;
  totalWishlistItems?: number;
}

/**
 * Read-only identity + commerce context shown in the persistent header.
 * Not part of the editable form; refreshed on load only.
 */
export interface CustomerHeaderData {
  name: string;
  email: string;
  image?: string;
  status: CustomerStatus;
  loyaltyTier: LoyaltyTier;
  loyaltyPoints: number;
  lifetimePoints: number;
  stats: CustomerStats;
  lastActiveAt?: string;
  createdAt?: string;
}

/**
 * The full editable form. All tabs share one instance of this via the shell;
 * a single global Save persists the whole thing.
 */
export interface CustomerFormValues {
  name: string;
  email: string;
  phone: string;
  image: string;
  status: CustomerStatus;
  loyaltyPoints: number;
  loyaltyTier: LoyaltyTier;
  acquisitionSource: string;
  tagsInput: string;
  notes: string;
  marketingOptIn: boolean;
  emailNotifications: CustomerEmailNotifications;
  shippingFirstName: string;
  shippingLastName: string;
  shippingStreet: string;
  shippingApartment: string;
  shippingCity: string;
  shippingState: string;
  shippingPostalCode: string;
  shippingCountry: string;
  shippingPhone: string;
}

export const defaultEmailNotifications: CustomerEmailNotifications = {
  orderUpdates: true,
  promotions: false,
  newsletter: false,
  priceDrops: false,
  backInStock: false,
};

export const defaultCustomerFormValues: CustomerFormValues = {
  name: "",
  email: "",
  phone: "",
  image: "",
  status: USER_ACCOUNT_STATUS.ACTIVE,
  loyaltyPoints: 0,
  loyaltyTier: "bronze",
  acquisitionSource: "",
  tagsInput: "",
  notes: "",
  marketingOptIn: false,
  emailNotifications: { ...defaultEmailNotifications },
  shippingFirstName: "",
  shippingLastName: "",
  shippingStreet: "",
  shippingApartment: "",
  shippingCity: "",
  shippingState: "",
  shippingPostalCode: "",
  shippingCountry: "",
  shippingPhone: "",
};

type SetCustomerField = <K extends keyof CustomerFormValues>(
  key: K,
  value: CustomerFormValues[K],
) => void;

/** Shared props every editable tab panel receives from the shell. */
export interface CustomerTabProps {
  form: CustomerFormValues;
  setField: SetCustomerField;
  readOnly?: boolean;
}
