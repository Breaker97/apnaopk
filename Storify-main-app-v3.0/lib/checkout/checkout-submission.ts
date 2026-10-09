import "server-only";
import { ValidationError } from "@/lib/api/errors";
import {
  normalizeCheckoutSettings,
  type CheckoutSettings,
} from "@/lib/checkout/checkout-config";
import {
  checkoutIssuesToErrors,
  evaluateCheckoutSubmission,
  type CheckoutFieldAnswer,
} from "@/lib/checkout/checkout-form-policy";
import type { ISettings } from "@/models/settings.model";
import { normalizePhoneNumber } from "@/lib/sms/phone";

type SubmissionAddress = {
  firstName?: string;
  lastName?: string;
  apartment?: string;
  postalCode?: string;
  state?: string;
  phone?: string;
  /** Read only to resolve a typed phone number into the one the store can text. */
  country?: string;
};

const FIELD_NAMES: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  account: "Account",
  customerNote: "Order note",
  firstName: "First name",
  lastName: "Last name",
  apartment: "Apartment",
  postalCode: "Postal code",
  state: "State",
};

/** A readable name for an error key: the admin's label for custom fields. */
function fieldName(key: string, checkout: CheckoutSettings): string {
  const [scope, field] = key.includes(".") ? key.split(".", 2) : ["", key];
  if (scope === "customFields") {
    return checkout.customFields.find((entry) => entry.id === field)?.label || "Field";
  }
  const configured =
    field in checkout.fields
      ? checkout.fields[field as keyof CheckoutSettings["fields"]].label
      : "";
  const name = configured || FIELD_NAMES[field] || field;
  return scope === "billingAddress" ? `Billing ${name.toLowerCase()}` : name;
}

type SubmissionInput = {
  // `sms` and `shipping` only for the country a typed phone number is read
  // against; nothing else here looks at them.
  settings: Pick<ISettings, "checkout" | "sms" | "shipping">;
  user?: { email?: string | null; phone?: string | null } | null;
  digitalOnly: boolean;
  body: {
    email?: string;
    phone?: string;
    paymentMethod?: string;
    iotecChannel?: string;
    customerNote?: string;
    customFields?: Record<string, unknown>;
  };
  shippingAddress?: SubmissionAddress;
  billingAddress?: SubmissionAddress;
};

type SubmissionResult = {
  checkout: CheckoutSettings;
  customerNote?: string;
  checkoutFields: CheckoutFieldAnswer[];
  contactPhone?: string;
};

/**
 * What one checkout request leaves unanswered of the checkout settings,
 * without refusing it: the field errors (keyed like the request body) next to
 * what the order would carry. For a quote, asked while the shopper is still
 * filling the form in (the shopper app's checkout). `enforceCheckoutSubmission`
 * is this and a refusal.
 */
export function reviewCheckoutSubmission(
  input: SubmissionInput,
): SubmissionResult & { errors?: Record<string, string[]> } {
  const checkout = normalizeCheckoutSettings(input.settings.checkout);
  const result = evaluateCheckoutSubmission({
    settings: checkout,
    isAuthenticated: Boolean(input.user),
    digitalOnly: input.digitalOnly,
    email: input.body.email,
    phone: input.body.phone,
    accountEmail: input.user?.email || undefined,
    accountPhone: input.user?.phone || undefined,
    paymentMethod: input.body.paymentMethod,
    iotecChannel: input.body.iotecChannel,
    shippingAddress: input.digitalOnly ? undefined : input.shippingAddress,
    billingAddress: input.billingAddress,
    customerNote: input.body.customerNote,
    customFields: input.body.customFields,
    // The same rule the form ran in the browser: a contact number the store
    // cannot resolve to a real one is refused here too, rather than accepted
    // into an order whose text-message consent then lands nowhere.
    resolvePhone: (value) =>
      normalizePhoneNumber(value, {
        country: input.shippingAddress?.country,
        defaultCountry:
          input.settings.sms?.defaultCountry ||
          input.settings.shipping?.origin?.country,
      }) ?? null,
  });

  const contactPhone = input.body.phone?.trim() || undefined;
  return {
    checkout,
    customerNote: result.customerNote,
    checkoutFields: result.answers,
    contactPhone,
    ...(result.issues.length > 0
      ? { errors: checkoutIssuesToErrors(result.issues) }
      : {}),
  };
}

/**
 * Hold one storefront checkout request to the checkout settings, the way the
 * form already did. Shared by the online-checkout route and the Stripe intent
 * route so the two ways of paying cannot enforce different forms.
 *
 * Throws a ValidationError keyed like the request body; returns what the
 * order should carry — the note, the answered custom fields, and the contact
 * phone that stands in for a delivery phone the address left out.
 */
export function enforceCheckoutSubmission(input: SubmissionInput): SubmissionResult {
  const { errors, ...result } = reviewCheckoutSubmission(input);
  if (errors) {
    const error = new ValidationError(errors);
    // The checkout shows `message` as its banner; "Validation failed: phone"
    // tells a shopper nothing, so lead with the first human sentence.
    const [firstKey] = Object.keys(errors);
    error.message = `${fieldName(firstKey, result.checkout)}: ${errors[firstKey]?.[0] ?? "Please check your details"}`;
    throw error;
  }
  return result;
}
