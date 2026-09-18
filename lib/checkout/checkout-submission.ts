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

type SubmissionAddress = {
  firstName?: string;
  lastName?: string;
  apartment?: string;
  postalCode?: string;
  state?: string;
  phone?: string;
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

/**
 * Hold one storefront checkout request to the checkout settings, the way the
 * form already did. Shared by the online-checkout route and the Stripe intent
 * route so the two ways of paying cannot enforce different forms.
 *
 * Throws a ValidationError keyed like the request body; returns what the
 * order should carry — the note, the answered custom fields, and the contact
 * phone that stands in for a delivery phone the address left out.
 */
export function enforceCheckoutSubmission(input: {
  settings: Pick<ISettings, "checkout">;
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
}): {
  checkout: CheckoutSettings;
  customerNote?: string;
  checkoutFields: CheckoutFieldAnswer[];
  contactPhone?: string;
} {
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
  });

  if (result.issues.length > 0) {
    const errors = checkoutIssuesToErrors(result.issues);
    const error = new ValidationError(errors);
    // The checkout shows `message` as its banner; "Validation failed: phone"
    // tells a shopper nothing, so lead with the first human sentence.
    const [firstKey] = Object.keys(errors);
    error.message = `${fieldName(firstKey, checkout)}: ${errors[firstKey]?.[0] ?? "Please check your details"}`;
    throw error;
  }

  const contactPhone = input.body.phone?.trim() || undefined;
  return {
    checkout,
    customerNote: result.customerNote,
    checkoutFields: result.answers,
    contactPhone,
  };
}
