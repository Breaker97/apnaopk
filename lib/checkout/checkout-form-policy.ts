import {
  CONFIGURABLE_ADDRESS_FIELDS,
  contactModeCollects,
  type CheckoutCustomField,
  type CheckoutCustomFieldType,
  type CheckoutSettings,
} from "@/lib/checkout/checkout-config";

/**
 * What the checkout settings require of one submission.
 *
 * Pure and shared: the storefront form runs it inside its zod refinement and
 * the payment routes run it on the request body, so a field the admin made
 * required is refused by the API as well — a tampered or stale client cannot
 * place an order the form would not have. Issues come back as codes; each
 * side words them (translated in the form, English in the API).
 */

export type CheckoutIssueCode =
  | "required"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_number"
  | "invalid_date"
  | "invalid_option"
  | "too_long"
  | "login_required";

type CheckoutIssue =
  | { scope: "contact"; field: "email" | "phone" | "account"; code: CheckoutIssueCode }
  | {
      scope: "shipping" | "billing";
      field: (typeof CONFIGURABLE_ADDRESS_FIELDS)[number];
      code: CheckoutIssueCode;
    }
  | { scope: "custom"; field: string; code: CheckoutIssueCode }
  | { scope: "note"; field: "customerNote"; code: CheckoutIssueCode };

/** One answered custom field, snapshotted onto the order with its label. */
export interface CheckoutFieldAnswer {
  key: string;
  label: string;
  type: CheckoutCustomFieldType;
  /** Always a string; a ticked checkbox is "true". */
  value: string;
}

type AddressInput = {
  firstName?: string;
  lastName?: string;
  apartment?: string;
  postalCode?: string;
  state?: string;
  phone?: string;
};

export const CHECKOUT_NOTE_MAX = 1000;
const TEXT_VALUE_MAX = 255;
const TEXTAREA_VALUE_MAX = 1000;

/**
 * Gateways that cannot open a payment without an email. The routes refuse a
 * guest who has none; the form asks for one inside the gateway's panel when
 * the contact step did not collect it.
 */
export function paymentMethodNeedsEmail(
  paymentMethod: string | undefined,
  iotecChannel?: string,
): boolean {
  if (!paymentMethod) return false;
  if (paymentMethod === "iotec") return iotecChannel === "card";
  return ["paystack", "pesapal", "orange_money"].includes(paymentMethod);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlausiblePhone(value: string): boolean {
  const digits = value.replace(/[^\d]/g, "");
  return digits.length >= 6 && digits.length <= 20 && /^[\d\s()+.-]+$/.test(value.trim());
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The custom fields a checkout shows: not hidden, and not delivery-only on a download cart. */
export function activeCheckoutCustomFields(
  settings: Pick<CheckoutSettings, "customFields">,
  options: { digitalOnly: boolean },
): CheckoutCustomField[] {
  return settings.customFields.filter(
    (field) =>
      field.visibility !== "hidden" &&
      !(options.digitalOnly && field.placement === "delivery"),
  );
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function resolveCustomValue(
  field: CheckoutCustomField,
  raw: unknown,
): { value: string; code?: CheckoutIssueCode } {
  if (field.type === "checkbox") {
    const checked = raw === true || raw === "true";
    return {
      value: checked ? "true" : "",
      code: field.visibility === "required" && !checked ? "required" : undefined,
    };
  }

  const value = clean(typeof raw === "number" ? String(raw) : raw);
  if (!value) {
    return {
      value,
      code: field.visibility === "required" ? "required" : undefined,
    };
  }

  const max = field.type === "textarea" ? TEXTAREA_VALUE_MAX : TEXT_VALUE_MAX;
  if (value.length > max) return { value, code: "too_long" };

  switch (field.type) {
    case "email":
      return { value, code: EMAIL_PATTERN.test(value) ? undefined : "invalid_email" };
    case "phone":
      return { value, code: isPlausiblePhone(value) ? undefined : "invalid_phone" };
    case "number":
      return {
        value,
        code: Number.isFinite(Number(value)) ? undefined : "invalid_number",
      };
    case "date":
      return { value, code: validDate(value) ? undefined : "invalid_date" };
    case "select":
      return {
        value,
        code: field.options.includes(value) ? undefined : "invalid_option",
      };
    default:
      return { value };
  }
}

/** The parts of the checkout settings a submission is held to. */
type CheckoutFormSettings = Pick<
  CheckoutSettings,
  "contact" | "fields" | "orderNote" | "customFields" | "accounts"
>;

export function evaluateCheckoutSubmission(input: {
  settings: CheckoutFormSettings;
  /** A signed-in shopper, whose account can stand in for missing contact details. */
  isAuthenticated: boolean;
  digitalOnly: boolean;
  email?: string;
  phone?: string;
  accountEmail?: string;
  accountPhone?: string;
  paymentMethod?: string;
  iotecChannel?: string;
  /** The delivery address; absent on a download-only cart. */
  shippingAddress?: AddressInput;
  /** Only when billing was entered separately (or is the only address). */
  billingAddress?: AddressInput;
  customerNote?: string;
  customFields?: Record<string, unknown>;
}): {
  issues: CheckoutIssue[];
  customerNote?: string;
  answers: CheckoutFieldAnswer[];
} {
  const { settings } = input;
  const issues: CheckoutIssue[] = [];

  if (!input.isAuthenticated && !settings.accounts.guestCheckout) {
    issues.push({ scope: "contact", field: "account", code: "login_required" });
  }

  // Contact. A signed-in shopper's account email counts: the contact step
  // shows the account instead of an email input.
  const email = clean(input.email) || clean(input.accountEmail);
  const phone =
    clean(input.phone) ||
    clean(input.shippingAddress?.phone) ||
    clean(input.accountPhone);
  const collects = contactModeCollects(settings.contact.mode);

  if (clean(input.email) && !EMAIL_PATTERN.test(clean(input.email))) {
    issues.push({ scope: "contact", field: "email", code: "invalid_email" });
  }
  if (clean(input.phone) && !isPlausiblePhone(clean(input.phone))) {
    issues.push({ scope: "contact", field: "phone", code: "invalid_phone" });
  }

  switch (settings.contact.mode) {
    case "email":
      if (!email) issues.push({ scope: "contact", field: "email", code: "required" });
      break;
    case "phone":
      if (!phone) issues.push({ scope: "contact", field: "phone", code: "required" });
      break;
    case "email_or_phone":
      if (!email && !phone) {
        issues.push({
          scope: "contact",
          field: collects.email ? "email" : "phone",
          code: "required",
        });
      }
      break;
    case "email_and_phone":
      if (!email) issues.push({ scope: "contact", field: "email", code: "required" });
      if (!phone) issues.push({ scope: "contact", field: "phone", code: "required" });
      break;
  }

  if (
    !input.isAuthenticated &&
    !email &&
    paymentMethodNeedsEmail(input.paymentMethod, input.iotecChannel) &&
    !issues.some((issue) => issue.scope === "contact" && issue.field === "email")
  ) {
    issues.push({ scope: "contact", field: "email", code: "required" });
  }

  // Address fields the admin made required. The three locked ones (country,
  // street, city) are enforced by the address schema itself.
  const checkAddress = (
    scope: "shipping" | "billing",
    address: AddressInput | undefined,
  ) => {
    if (!address) return;
    for (const key of CONFIGURABLE_ADDRESS_FIELDS) {
      if (settings.fields[key].visibility !== "required") continue;
      // The contact phone doubles as the delivery phone when the address
      // left it blank, so only a phone missing from both is missing.
      const value = key === "phone" ? clean(address.phone) || phone : clean(address[key]);
      if (!value) issues.push({ scope, field: key, code: "required" });
    }
  };
  if (!input.digitalOnly) checkAddress("shipping", input.shippingAddress);
  checkAddress("billing", input.billingAddress);

  // Order note.
  let customerNote: string | undefined;
  if (settings.orderNote.visibility !== "hidden") {
    const note = clean(input.customerNote);
    if (note.length > CHECKOUT_NOTE_MAX) {
      issues.push({ scope: "note", field: "customerNote", code: "too_long" });
    } else if (!note && settings.orderNote.visibility === "required") {
      issues.push({ scope: "note", field: "customerNote", code: "required" });
    }
    customerNote = note || undefined;
  }

  // Custom fields. Keys the settings do not list (a field deleted while the
  // shopper had checkout open, or anything invented) are dropped, not stored.
  const answers: CheckoutFieldAnswer[] = [];
  const submitted = input.customFields ?? {};
  for (const field of activeCheckoutCustomFields(settings, input)) {
    const { value, code } = resolveCustomValue(field, submitted[field.id]);
    if (code) {
      issues.push({ scope: "custom", field: field.id, code });
      continue;
    }
    if (value) {
      answers.push({ key: field.id, label: field.label, type: field.type, value });
    }
  }

  return { issues, customerNote, answers };
}

const ISSUE_MESSAGES: Record<CheckoutIssueCode, string> = {
  required: "This field is required",
  invalid_email: "Enter a valid email address",
  invalid_phone: "Enter a valid phone number",
  invalid_number: "Enter a number",
  invalid_date: "Enter a valid date",
  invalid_option: "Choose one of the options",
  too_long: "This answer is too long",
  login_required: "Please log in or create an account to check out",
};

/** The API's error map for a set of issues, keyed like the request body. */
export function checkoutIssuesToErrors(
  issues: CheckoutIssue[],
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key =
      issue.scope === "contact"
        ? issue.field
        : issue.scope === "shipping"
          ? `shippingAddress.${issue.field}`
          : issue.scope === "billing"
            ? `billingAddress.${issue.field}`
            : issue.scope === "custom"
              ? `customFields.${issue.field}`
              : issue.field;
    (errors[key] ||= []).push(ISSUE_MESSAGES[issue.code]);
  }
  return errors;
}
