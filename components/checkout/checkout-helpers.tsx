"use client";

import type { StripeElementStyle } from "@stripe/stripe-js";
import type { CartItem } from "@/types";
import type { Address } from "@/types";
import type { ShippingRateOption } from "@/lib/shipping/shipping";
import { isSafeAddressText } from "@/lib/customers/address-text";
import { cn } from "@/lib/utils";
import { FLOATING_INPUT_CLASS, FLOATING_LABEL_CLASS } from "@/lib/constants";

export type CheckoutFormData = {
  firstName: string;
  lastName: string;
  email: string;
  /** Contact phone (checkout settings `contact.mode`); `phone` is the delivery address's. */
  contactPhone: string;
  /** Guest ticked "create an account" (or the store requires one). */
  createAccount: boolean;
  accountPassword: string;
  customerNote: string;
  /** The store's own checkout fields, keyed by field id; absent until answered. */
  customFields: Record<string, string | boolean | undefined>;
  phone: string;
  address: string;
  apartment?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  paymentMethod:
    | "card"
    | "paypal"
    | "razorpay"
    | "paystack"
    | "pesapal"
    | "iotec"
    | "orange_money"
    | "mtn_momo"
    | "cod";
  /** ioTec Pay collection channel; defaults to mobile money. */
  iotecChannel?: "mobile_money" | "card";
  /** ioTec Pay mobile-money number (MTN/Airtel), collected inline. */
  iotecPhone?: string;
  /** MTN MoMo mobile-money number, collected inline. */
  mtnMomoPhone?: string;
  billingSameAsShipping: "same" | "different";
  billingFirstName: string;
  billingLastName: string;
  billingAddress: string;
  billingApartment?: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  billingCountry: string;
  billingPhone: string;
};

type CheckoutAddressPayload = {
  fullName: string;
  firstName?: string;
  lastName?: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
};

/** A saved account address as consumed by checkout, without account metadata. */
export type SavedCheckoutAddress = Pick<
  Address,
  | "firstName"
  | "lastName"
  | "street"
  | "apartment"
  | "city"
  | "state"
  | "postalCode"
  | "country"
  | "phone"
  | "label"
  | "isDefault"
>;

/**
 * Legacy addresses predate the server-side text validation. Keep malformed
 * records out of checkout so they cannot be selected as a delivery address.
 */
export function filterUsableSavedCheckoutAddresses(
  addresses: SavedCheckoutAddress[],
): SavedCheckoutAddress[] {
  return addresses.filter((address) => {
    const requiredValues = [
      address.street,
      address.city,
      address.postalCode,
      address.country,
    ];
    const optionalValues = [
      address.firstName,
      address.lastName,
      address.apartment,
      address.state,
      address.phone,
    ];

    return (
      requiredValues.every(
        (value) => isSafeAddressText(value) && value.trim().length > 0,
      ) &&
      optionalValues.every(
        (value) => value == null || isSafeAddressText(value),
      )
    );
  });
}

/**
 * The comparable identity of a delivery address.
 *
 * Case- and whitespace-insensitive because "12 Lake Road" and "12 lake road "
 * are the same doorstep, and offering to save the second one would grow a list
 * of near-duplicates the shopper then has to tell apart at checkout.
 */
function savedAddressIdentity(address: SavedCheckoutAddress): string {
  return [
    address.firstName,
    address.lastName,
    address.street,
    address.apartment,
    address.city,
    address.state,
    address.postalCode,
    address.country,
    address.phone,
  ]
    .map((value) => value?.trim().toLowerCase() || "")
    .join("");
}

/**
 * Whether a just-used delivery address is worth offering to save.
 *
 * Guests have no account to save into, and an address the shopper already has
 * would only be duplicated — in both cases the checkbox is noise, so it is not
 * rendered at all rather than shown and quietly ignored.
 */
export function canOfferToSaveAddress(input: {
  isAuthenticated: boolean;
  address: SavedCheckoutAddress | null;
  savedAddresses: SavedCheckoutAddress[];
}): boolean {
  if (!input.isAuthenticated || !input.address) return false;

  const required = [
    input.address.street,
    input.address.city,
    input.address.postalCode,
    input.address.country,
  ];
  if (!required.every((value) => (value ?? "").trim().length > 0)) return false;

  const identity = savedAddressIdentity(input.address);
  return !input.savedAddresses.some(
    (saved) => savedAddressIdentity(saved) === identity,
  );
}

/** Only an explicit account default may be auto-applied at checkout. */
export function defaultSavedAddressIndex(
  addresses: SavedCheckoutAddress[],
): number | null {
  const index = addresses.findIndex((address) => address.isDefault === true);
  return index === -1 ? null : index;
}

/**
 * The saved address that matches the place the shopper set in the header.
 *
 * Amazon's "Deliver to" is the selected address; here the location is a filter
 * the shopper picked by city, and this is the bridge between the two: when the
 * account has no explicit default, an address in the chosen city is a far
 * better starting point than an empty form — and a far safer one than the
 * first historic address, which is exactly the guess `defaultSavedAddressIndex`
 * refuses to make.
 *
 * Only an unambiguous match applies. Two addresses in the same city (home and
 * office, say) leave the choice to the shopper, and "Near me" carries no city
 * to match against at all.
 */
export function savedAddressIndexForLocation(
  addresses: SavedCheckoutAddress[],
  locationCity: string | null | undefined,
): number | null {
  const wanted = locationCity?.trim().toLowerCase();
  if (!wanted) return null;

  const matches = addresses
    .map((address, index) => ({ address, index }))
    .filter(({ address }) => address.city.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0].index : null;
}

/**
 * The recipient name an account name implies: the last word is the surname,
 * the rest the given name, so a one-word name lands in the required surname.
 */
export function accountRecipientName(name: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] || "",
  };
}

/**
 * Map a saved account address into delivery fields without touching payment.
 *
 * Names are optional on a saved address, but checkout requires a surname — in
 * a field the collapsed saved-address view does not render. An address saved
 * without any name is therefore addressed to the account holder
 * (`accountName`), rather than blanking the surname and leaving "Complete
 * order" to fail on an error the shopper cannot see.
 */
export function savedAddressFormValues(
  address: SavedCheckoutAddress,
  accountName?: string | null,
) {
  const recipient =
    address.firstName?.trim() || address.lastName?.trim()
      ? { firstName: address.firstName || "", lastName: address.lastName || "" }
      : accountRecipientName(accountName);
  return {
    ...recipient,
    address: address.street,
    apartment: address.apartment || "",
    city: address.city,
    state: address.state || "",
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone || "",
  };
}

type DeliveryAddressQuoteFields = Pick<
  CheckoutFormData,
  | "firstName"
  | "lastName"
  | "address"
  | "apartment"
  | "city"
  | "state"
  | "postalCode"
  | "country"
  | "phone"
>;

/**
 * Creates a stable value for the entire fulfilment address. A quote must be
 * refreshed even if a shopper changes only the apartment, recipient, or
 * phone number, because those fields travel with the delivery instruction.
 */
export function deliveryAddressQuoteKey(
  address: DeliveryAddressQuoteFields,
): string {
  return [
    address.firstName,
    address.lastName,
    address.address,
    address.apartment,
    address.city,
    address.state,
    address.postalCode,
    address.country,
    address.phone,
  ]
    .map((value) => value?.trim() || "")
    .join("\u001f");
}

/** Concise destination copy that differentiates saved-address choices. */
export function savedAddressSummary(address: SavedCheckoutAddress): string {
  const name = [address.firstName, address.lastName].filter(Boolean).join(" ");
  const cityLine = [address.city, address.postalCode].filter(Boolean).join(" ");
  const destination = [address.street, cityLine, address.country]
    .filter(Boolean)
    .join(", ");

  return [name, destination].filter(Boolean).join(" · ");
}

/** A delivery address cannot reuse the previous destination's rate. */
export function requiresFreshShippingQuote(input: {
  hasDestination: boolean;
  loading: boolean;
  resolution: { available: boolean } | null;
}): boolean {
  return input.hasDestination && (input.loading || input.resolution === null);
}

/**
 * The fields that say where a delivery is going. The checkout form requires
 * them of every delivery address, and shipping is not quoted until they are
 * filled — one list for both, so any address the form accepts has been quoted.
 */
export const DELIVERY_DESTINATION_FIELDS = ["address", "city", "country"] as const;

/**
 * Whether the shopper has said where the order is going. The country alone
 * never counts: checkout pre-fills it with the store default, and quoting that
 * answered for a place nobody chose — where the store does not ship there,
 * with a "not available" before a single field was typed.
 */
export function hasDeliveryDestination(
  address: Pick<CheckoutFormData, (typeof DELIVERY_DESTINATION_FIELDS)[number]>,
): boolean {
  return DELIVERY_DESTINATION_FIELDS.every((field) =>
    Boolean(address[field]?.trim()),
  );
}

/** Show fulfillment only when pickup is selectable or its unavailability needs explanation. */
export function shouldShowFulfillmentSelector(input: {
  pickupAvailable: boolean;
  multiVendor: boolean;
}): boolean {
  return input.pickupAvailable || input.multiVendor;
}

/**
 * Every delivery field the manual address form has to render.
 *
 * This exists because `state` was missing from the form for long enough to be
 * easy to miss: `calculateShipping` matches a zone's `regions` against the
 * destination state, so an address entered without one can never reach a
 * region-scoped rate and silently falls through to a country-wide zone or the
 * fallback — a wrong delivery charge, quoted confidently. A saved address
 * carried a state, so only one-time and guest addresses were affected, which is
 * exactly the combination least likely to be noticed in manual testing.
 *
 * Keeping the list here rather than inline in the JSX lets a test assert the
 * form still collects all of it, so a future refactor cannot drop a field the
 * rate engine reads.
 */
export const MANUAL_DELIVERY_ADDRESS_FIELDS = [
  "country",
  "firstName",
  "lastName",
  "address",
  "apartment",
  "city",
  "postalCode",
  "state",
  "phone",
] as const;

/** Saved delivery addresses collapse the form until the shopper chooses manual entry. */
export function shouldShowManualDeliveryAddressForm(input: {
  isAuthenticated: boolean;
  savedAddressesLoaded: boolean;
  savedAddressCount: number;
  addressMode: "saved" | "manual";
}): boolean {
  return (
    !input.isAuthenticated ||
    !input.savedAddressesLoaded ||
    input.savedAddressCount === 0 ||
    input.addressMode === "manual"
  );
}

export type CheckoutCartProductRef = CartItem["productId"] | { _id?: unknown };
export type CheckoutCartItem = Omit<CartItem, "productId"> & {
  productId: CheckoutCartProductRef;
  categoryId?: unknown;
  variantLabel?: string;
  compareAtPrice?: number;
};

export type AppliedCoupon = {
  code: string;
  discount: number;
  type: string;
  discountTarget?: "subtotal" | "shipping";
  maxDiscount?: number;
  /** A scoped coupon's goods discount by seller. */
  vendorShares?: Record<string, number>;
  /** The seller whose delivery a seller's own free-shipping coupon covers. */
  shippingVendorId?: string;
};

export type CheckoutVendorRateGroup = {
  vendorId: string;
  vendorName: string;
  selectedOptionId?: string;
  cost: number;
  options: Array<{
    id: string;
    name: string;
    cost: number;
    deliveryDays?: { min: number; max: number };
  }>;
};

export type CheckoutShippingResolution = {
  available: boolean;
  mode: "single" | "vendor";
  shippingCost: number;
  singleOptions: ShippingRateOption[];
  customs?: { dutyAmount?: number; collectedAtCheckout?: boolean };
};

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  callback_url: string;
  redirect: true;
  modal: {
    ondismiss: () => void;
  };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open: () => void };
  }
}

export const floatingInputClass = FLOATING_INPUT_CLASS;
export const floatingLabelClass = FLOATING_LABEL_CLASS;
const RAZORPAY_SCRIPT_ID = "razorpay-checkout-js";
const STRIPE_ELEMENT_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial';

export function createStripeElementStyle(isDark: boolean): StripeElementStyle {
  return {
    base: {
      fontSize: "16px",
      color: isDark ? "#f8fafc" : "#0f172a",
      fontFamily: STRIPE_ELEMENT_FONT_FAMILY,
      "::placeholder": { color: isDark ? "#94a3b8" : "#64748b" },
      "::selection": {
        backgroundColor: isDark ? "#334155" : "#bfdbfe",
        color: isDark ? "#f8fafc" : "#0f172a",
      },
    },
    invalid: { color: isDark ? "#f87171" : "#dc2626" },
  };
}

function loadRazorpayCheckoutScript() {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Razorpay checkout is unavailable"));
      return;
    }
    if (window.Razorpay) {
      resolve();
      return;
    }

    const existing = document.getElementById(
      RAZORPAY_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Razorpay checkout")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = RAZORPAY_SCRIPT_ID;
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Razorpay checkout"));
    document.body.appendChild(script);
  });
}

/**
 * Opens Razorpay Checkout in redirect mode, for the storefront and for every
 * vendor→platform payment alike.
 *
 * Razorpay returns the payer through `callbackUrl` with a full-page POST
 * whichever method they pay with. FPX (Malaysian online banking) cannot finish
 * any other way, and the method is only chosen inside Razorpay's window, so
 * every payment takes that road; see lib/payments/razorpay-callback.ts.
 *
 * The promise therefore never resolves — a payment leaves the page. It rejects
 * with `canceledMessage` when the payer closes the window without paying, and
 * the caller's error handling takes over from there.
 */
export async function openRazorpayCheckout(options: {
  keyId: string;
  razorpayOrderId: string;
  /** In subunits, as Razorpay's order reported it. */
  amount: number;
  currency: string;
  name: string;
  description?: string;
  callbackUrl: string;
  prefill?: RazorpayCheckoutOptions["prefill"];
  notes?: Record<string, string>;
  canceledMessage: string;
}): Promise<void> {
  // A callback-less Checkout would strand an FPX payer at the bank again.
  if (
    !options.keyId ||
    !options.razorpayOrderId ||
    !options.amount ||
    !options.callbackUrl
  ) {
    throw new Error("Failed to initialize Razorpay payment");
  }

  await loadRazorpayCheckoutScript();
  const Razorpay = window.Razorpay;
  if (!Razorpay) {
    throw new Error("Razorpay checkout is unavailable");
  }

  return new Promise<void>((_resolve, reject) => {
    new Razorpay({
      key: options.keyId,
      amount: options.amount,
      currency: options.currency,
      name: options.name,
      description: options.description,
      order_id: options.razorpayOrderId,
      prefill: options.prefill,
      notes: options.notes,
      callback_url: options.callbackUrl,
      redirect: true,
      modal: {
        ondismiss: () => reject(new Error(options.canceledMessage)),
      },
    }).open();
  });
}

export function getCheckoutProductId(productId: CheckoutCartProductRef): string {
  if (typeof productId === "string") return productId;
  if (typeof productId === "object" && productId && "_id" in productId) {
    const id = productId._id;
    if (id) return String(id);
  }
  return String(productId);
}

function cleanCheckoutField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function formatPreorderDate(value?: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getCouponErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;

  const errors = "errors" in payload ? payload.errors : null;
  if (errors && typeof errors === "object") {
    const firstFieldErrors = Object.values(
      errors as Record<string, unknown>,
    )[0];
    if (
      Array.isArray(firstFieldErrors) &&
      typeof firstFieldErrors[0] === "string"
    ) {
      return firstFieldErrors[0];
    }
  }

  const message = "message" in payload ? payload.message : null;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export function buildCheckoutAddressPayload(
  input: {
    firstName?: unknown;
    lastName?: unknown;
    address?: unknown;
    apartment?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
    country?: unknown;
    phone?: unknown;
  },
  fallbackPhone = "",
): CheckoutAddressPayload {
  const firstName = cleanCheckoutField(input.firstName);
  const lastName = cleanCheckoutField(input.lastName);
  const phone = cleanCheckoutField(input.phone) || fallbackPhone.trim();

  return {
    fullName: `${firstName} ${lastName}`.trim(),
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    street: cleanCheckoutField(input.address),
    apartment: cleanCheckoutField(input.apartment) || undefined,
    city: cleanCheckoutField(input.city),
    state: cleanCheckoutField(input.state),
    postalCode: cleanCheckoutField(input.postalCode),
    country: cleanCheckoutField(input.country),
    phone: phone || undefined,
  };
}

export function PaymentProviderLogo({
  provider,
}: {
  provider:
    | "paypal"
    | "razorpay"
    | "paystack"
    | "pesapal"
    | "iotec"
    | "orange_money"
    | "mtn_momo";
}) {
  const config = {
    paypal: {
      label: "P",
      className: "text-[#003087]",
      textClassName: "italic",
    },
    razorpay: {
      label: "R",
      className: "text-[#0b5fff]",
      textClassName: "",
    },
    paystack: {
      label: "P",
      className: "text-[#09a5db]",
      textClassName: "",
    },
    pesapal: {
      label: "P",
      className: "text-[#0B8F55]",
      textClassName: "",
    },
    iotec: {
      label: "iT",
      className: "text-[#0F766E]",
      textClassName: "",
    },
    orange_money: {
      label: "OM",
      className: "text-[#FF7900]",
      textClassName: "",
    },
    mtn_momo: {
      label: "MoMo",
      className: "text-[#8a6d00]",
      textClassName: "",
    },
  }[provider];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[3px] bg-white px-1 text-[13px] font-black leading-none shadow-xs",
        config.className,
        config.textClassName,
      )}
    >
      {config.label}
    </span>
  );
}
