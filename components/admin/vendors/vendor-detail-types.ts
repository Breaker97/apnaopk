import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import type {
  PackLayerSnapshot,
  VendorOverrideDraft,
} from "./vendor-access-view";

type VendorAccountStatus = "active" | "inactive" | "banned";

/**
 * The full editable form. All settings tabs (Profile, Access, Account) share
 * one instance of this via the shell; a single global Save persists it.
 */
export interface VendorFormValues {
  storeName: string;
  slug: string;
  description: string;
  logo: string;
  banner: string;
  commission: number;
  /** "inherit" defers to settings.shipping.codCollectedBy. */
  codCollectedBy: string;
  status: string;
  /** Storefront "Verified vendor" badge. Admin-awarded, never derived. */
  verified: boolean;
  userStatus: VendorAccountStatus;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  /**
   * Deviations from the plan's entitlement — the only part of access an admin
   * edits here. Policy and plan are read-only on the Access tab because neither
   * is a per-vendor value; see the guideline §2.6.
   */
  permissionOverrides: VendorOverrideDraft[];
  /**
   * Server-resolved policy + entitlement per pack. Read-only: the Access tab
   * re-applies only the override layer locally so an unsaved edit is visible
   * without re-deriving rules the server owns.
   */
  packLayers: PackLayerSnapshot[];
  /** One sentence naming the entitlement basis (plan, or commission-only). */
  entitlementNote: string;
  /**
   * The lifecycle state the server resolved. Decides whether a lifecycle
   * denial reads as "on hold until paid" or just "blocked by account state":
   * a pending vendor is waiting on approval, not on money.
   */
  accessMode: "approved" | "setup" | "blocked";
  /** True when the plan sells fewer packs than the commission-only baseline. */
  entitlementWarning: boolean;
  /** Which pack row is expanded. Empty string = none. UI state, never saved. */
  expandedPack: string;
  notes: string;
  /**
   * Why the application was turned down. Lives on the VendorApplication, not
   * the vendor; the applicant reads it on become-vendor and can apply again.
   */
  rejectionReason: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressPostalCode: string;
  addressCountry: string;
  addressPhone: string;
  // Business / payment details (Vendor.bankDetails)
  bankAccountName: string;
  bankAccountNumber: string;
  bankName: string;
  bankRoutingNumber: string;
  bankSwiftCode: string;
  // Verification documents (Vendor.documents) — private storage keys (or
  // legacy public URLs), except taxId (text)
  docBusinessLicense: string;
  docTaxId: string;
  docTaxCertificate: string;
  docGovernmentId: string;
}

export const defaultVendorFormValues: VendorFormValues = {
  storeName: "",
  slug: "",
  description: "",
  logo: "",
  banner: "",
  commission: DEFAULT_VENDOR_COMMISSION_RATE,
  codCollectedBy: "inherit",
  status: VENDOR_STATUS.PENDING,
  verified: false,
  userStatus: USER_ACCOUNT_STATUS.ACTIVE,
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  permissionOverrides: [],
  packLayers: [],
  entitlementNote: "",
  accessMode: "approved",
  entitlementWarning: false,
  expandedPack: "",
  notes: "",
  rejectionReason: "",
  addressStreet: "",
  addressCity: "",
  addressState: "",
  addressPostalCode: "",
  addressCountry: "",
  addressPhone: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankName: "",
  bankRoutingNumber: "",
  bankSwiftCode: "",
  docBusinessLicense: "",
  docTaxId: "",
  docTaxCertificate: "",
  docGovernmentId: "",
};

/**
 * On-demand commerce counts shown in the header KPI strip.
 *
 * Commission is deliberately absent: it lives on the vendor document, which
 * the vendor GET reconciles against an expired trial/period, so the header
 * reads it from the loaded form rather than from this parallel request.
 */
export interface VendorStats {
  productCount?: number;
  orderCount?: number;
  /** Orders in `orderCount` that are cancelled, and so excluded from sales. */
  cancelledOrderCount?: number;
  /** Gross sales across every currency, labelled with the store default. */
  totalSales?: number;
  currency?: string;
}

/**
 * Read-only identity shown in the persistent header.
 *
 * Commerce counts are NOT part of this object. They arrive from a separate,
 * concurrent request, and folding them in here meant whichever response lost
 * the race got dropped — which is exactly how the KPI strip ended up stuck at
 * zero on vendors that plainly had orders.
 */
export interface VendorHeaderData {
  storeName: string;
  slug: string;
  logo?: string;
  status: string;
  ownerEmail: string;
  createdAt?: string;
}

/** The vendor's current subscription snapshot (read from the vendor GET). */
export interface VendorSubscriptionSummary {
  planId?: string;
  status?: string | null;
  planName?: string;
  price?: number;
  billingInterval?: string;
  provider?: string | null;
  /** Stripe subscription id; absent on one-shot and never-started rows. */
  paymentProviderRef?: string | null;
  commissionRateSnapshot?: number;
  currentPeriodEnd?: string;
  currentPeriodStart?: string;
  trialEnd?: string;
  cancelAtPeriodEnd?: boolean;
  providerStatus?: string | null;
  stripePriceId?: string | null;
  stripeLatestInvoiceId?: string | null;
  gracePeriodEnd?: string | null;
  pendingChangeType?: string | null;
  pendingChangeStatus?: string | null;
  pendingChangeEffectiveAt?: string | null;
  pendingPlanName?: string | null;
  lastReconcileError?: string | null;
  lastReconciledAt?: string | null;
  lastPayment?: {
    providerInvoiceId?: string;
    status?: string;
    amountDue?: number;
    amountPaid?: number;
    currency?: string;
    paidAt?: string | null;
  } | null;
}

type SetVendorField = <K extends keyof VendorFormValues>(
  key: K,
  value: VendorFormValues[K],
) => void;

/** Shared props every editable settings tab panel receives from the shell. */
export interface VendorTabProps {
  form: VendorFormValues;
  setField: SetVendorField;
  readOnly?: boolean;
}
