import type { ISettings } from "@/models/settings.model";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import type { Address } from "@/types";
import {
  DEFAULT_VENDOR_STORE_VISIBILITY,
  formatVendorAddress,
  normalizeVendorAddressDisplay,
  type VendorStoreVisibility,
} from "@/lib/vendors/vendor-address";

interface POSSoundSettings {
  enabled: boolean;
  volume: number;
  addToCart: boolean;
  orderComplete: boolean;
  payment: boolean;
  error: boolean;
}

export interface POSSettings {
  taxRate: number;
  /**
   * Whether this seat may give discounts — see `canApplyPosDiscount`. The
   * server refuses them regardless; this only stops the till offering what it
   * would refuse. Absent means allowed, the behaviour before the check existed.
   */
  canApplyDiscounts?: boolean;
  currency: string;
  locale: string;
  storeName?: string;
  storePhone?: string;
  storeEmail?: string;
  storeAddress?: string;
  storeDomain?: string;
  paymentMethods: string[];
  stripe?: {
    enabled: boolean;
    configured: boolean;
    publishableKey?: string;
  };
  posLocationId?: string;
  /**
   * The counter's display name, for the surfaces that have to say WHERE rather
   * than scope by id — the empty grid, the receipt footer. Resolved alongside
   * `posLocationId` because only the caller knows which locations they own; an
   * unset id leaves this unset too, which reads as "shared stock".
   */
  posLocationName?: string;
  printedReceiptsEnabled?: boolean;
  receiptPrinter?: string;
  sound?: POSSoundSettings;
}

/**
 * The seller identity printed on the receipt header. The platform's
 * `settings.general` identity is only correct for the platform's own POS —
 * a vendor's terminal must print *that vendor's* store, so vendor/staff pages
 * pass an override built by `vendorReceiptIdentity()`.
 *
 * An override replaces the identity wholesale rather than field-by-field: a
 * vendor with no public phone prints no phone line — falling back to the
 * platform's phone would put another merchant's number on their receipt.
 */
export interface POSReceiptIdentity {
  storeName?: string;
  storePhone?: string;
  storeEmail?: string;
  storeAddress?: string;
}

/**
 * Build a vendor's receipt identity from their Vendor document.
 *
 * A receipt is handed to the customer, so it follows the same publication
 * gates as the public store page: the address at the precision the vendor
 * chose in `storeVisibility.addressDisplay` (their `address` is collected for
 * payouts/KYC and is often a home address), the phone only behind `showPhone`,
 * and no email — the storefront never publishes one either.
 */
export function vendorReceiptIdentity(vendor: {
  storeName?: string;
  address?: Address | null;
  storeVisibility?: VendorStoreVisibility | null;
}): POSReceiptIdentity {
  const visibility = vendor.storeVisibility ?? DEFAULT_VENDOR_STORE_VISIBILITY;
  const formatted = formatVendorAddress(
    vendor.address,
    normalizeVendorAddressDisplay(visibility.addressDisplay),
  );
  return {
    storeName: vendor.storeName ?? "Store",
    storePhone:
      visibility.showPhone && vendor.address?.phone
        ? vendor.address.phone
        : "",
    storeEmail: "",
    storeAddress: formatted ? formatted.lines.join(", ") : "",
  };
}

export function buildPOSSettings(
  settings: ISettings,
  identity?: POSReceiptIdentity,
): POSSettings {
  const customize = settings.pos?.customize;
  const stripeCredentials = resolveStripeCredentials(settings.payment?.stripe);
  const stripeEnabled = Boolean(settings.payment?.stripe?.enabled);
  return {
    taxRate: settings.orders?.taxRate ?? 0,
    currency: settings.general?.defaultCurrency ?? "USD",
    locale: settings.general?.defaultLanguage ?? "en",
    storeName: identity
      ? (identity.storeName ?? "Store")
      : (settings.general?.storeName ?? "Store"),
    storePhone: identity
      ? (identity.storePhone ?? "")
      : (settings.general?.storePhone ?? ""),
    storeEmail: identity
      ? (identity.storeEmail ?? "")
      : (settings.general?.storeEmail ?? ""),
    storeAddress: identity
      ? (identity.storeAddress ?? "")
      : (settings.general?.storeAddress ?? ""),
    storeDomain: settings.general?.storeDomain ?? "",
    paymentMethods: settings.pos?.checkout?.paymentMethods ?? ["cash", "card"],
    stripe: {
      enabled: stripeEnabled,
      configured: stripeEnabled && Boolean(stripeCredentials.secretKey),
      publishableKey: stripeCredentials.publishableKey,
    },
    posLocationId: settings.pos?.defaultPosLocationId,
    printedReceiptsEnabled: customize?.printedReceiptsEnabled ?? false,
    receiptPrinter: customize?.receiptPrinter ?? "",
    sound: {
      enabled: customize?.soundEnabled ?? true,
      volume: customize?.soundVolume ?? 50,
      addToCart: customize?.soundAddToCart ?? true,
      orderComplete: customize?.soundOrderComplete ?? true,
      payment: customize?.soundPayment ?? true,
      error: customize?.soundError ?? true,
    },
  };
}
