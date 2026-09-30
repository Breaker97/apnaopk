import { isRecord } from "@/lib/utils";
/**
 * Checkout settings — the checkout editor's data.
 *
 * Checkout is deliberately not a section template: the flow (contact →
 * address → shipping → payment) is conversion- and correctness-critical, so
 * admins configure it, they don't rebuild it. What is configurable:
 *   - chrome: the full store header/footer, or a focused minimal bar
 *   - trust copy next to the payment step + a secure badge
 *   - the policy-link row under the pay button
 *   - how the shopper is reached (email, phone, either, both)
 *   - every address field's label and whether it is required, optional or
 *     hidden — except the three a delivery cannot exist without
 *   - extra fields of the merchant's own, and an order note
 *   - guest checkout and account creation at checkout
 *   - abandoned-checkout tracking and automatic recovery emails
 *
 * The server reads the same settings (lib/checkout/checkout-form-policy.ts),
 * so a field the admin makes required is required of the API too, not only
 * of the form.
 *
 * Logo and colors are intentionally absent — the logo stays canonical in
 * `general.*` (Branding) and colors come from the active theme's settings,
 * so checkout can never drift off-brand.
 */

export type CheckoutChromeMode = "store" | "focused";

interface CheckoutPolicyLink {
  label: string;
  /** Relative ("/returns") or absolute URL; relative gets the locale prefix. */
  href: string;
  visible: boolean;
}

/**
 * How the shopper is contacted about the order.
 *   - "email":           email only (the original behaviour)
 *   - "phone":           phone only — orders are tracked and notified by SMS
 *   - "email_or_phone":  one of the two, the shopper's choice
 *   - "email_and_phone": both required
 */
/** Where a marketing checkbox may arrive already ticked. */
export type MarketingPreselectMode = "never" | "auto" | "countries" | "always";

const MARKETING_PRESELECT_MODES: readonly MarketingPreselectMode[] = [
  "never",
  "auto",
  "countries",
  "always",
];

export type CheckoutContactMode =
  | "email"
  | "phone"
  | "email_or_phone"
  | "email_and_phone";

const CHECKOUT_CONTACT_MODES: readonly CheckoutContactMode[] = [
  "email",
  "phone",
  "email_or_phone",
  "email_and_phone",
];

export type CheckoutFieldVisibility = "required" | "optional" | "hidden";

const FIELD_VISIBILITIES: readonly CheckoutFieldVisibility[] = [
  "required",
  "optional",
  "hidden",
];

/** Address fields whose requirement the admin decides. */
export const CONFIGURABLE_ADDRESS_FIELDS = [
  "firstName",
  "lastName",
  "apartment",
  "postalCode",
  "state",
  "phone",
] as const;
export type ConfigurableAddressField =
  (typeof CONFIGURABLE_ADDRESS_FIELDS)[number];

/**
 * Address fields that are always required on a delivery. Shipping is quoted
 * off them (DELIVERY_DESTINATION_FIELDS) and a courier cannot deliver without
 * them, so only their label is editable.
 */
export const LOCKED_ADDRESS_FIELDS = ["country", "address", "city"] as const;
type LockedAddressField = (typeof LOCKED_ADDRESS_FIELDS)[number];

interface CheckoutBuiltInField {
  /** "" = the built-in translated label. */
  label: string;
  visibility: CheckoutFieldVisibility;
}

export type CheckoutCustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "phone"
  | "date"
  | "select"
  | "checkbox";

export const CHECKOUT_CUSTOM_FIELD_TYPES: readonly CheckoutCustomFieldType[] = [
  "text",
  "textarea",
  "number",
  "email",
  "phone",
  "date",
  "select",
  "checkbox",
];

/** Where a custom field renders. "delivery" fields are skipped for download-only carts. */
export type CheckoutCustomFieldPlacement = "contact" | "delivery" | "additional";

export const CHECKOUT_CUSTOM_FIELD_PLACEMENTS: readonly CheckoutCustomFieldPlacement[] =
  ["contact", "delivery", "additional"];

export interface CheckoutCustomField {
  /** Stable key the value is stored under; `cf_` + [a-z0-9_]. Never reused. */
  id: string;
  label: string;
  type: CheckoutCustomFieldType;
  placement: CheckoutCustomFieldPlacement;
  visibility: CheckoutFieldVisibility;
  placeholder: string;
  helpText: string;
  /** Choices for "select"; ignored for every other type. */
  options: string[];
}

export interface CheckoutSettings {
  layout: {
    /**
     * "store" renders checkout inside the normal storefront chrome (the
     * pre-existing behaviour). "focused" hides the store header, footer,
     * bottom nav and assistant widget and shows a minimal logo + secure bar.
     */
    chrome: CheckoutChromeMode;
  };
  trust: {
    /** Shown under the Payment heading. "" = the built-in translated line. */
    message: string;
    /** Lock badge in the focused top bar and beside the trust message. */
    showSecureBadge: boolean;
    /** Optional help line under the pay button. "" = hidden. */
    supportText: string;
  };
  policyLinks: CheckoutPolicyLink[];
  contact: {
    mode: CheckoutContactMode;
    emailLabel: string;
    phoneLabel: string;
    /** The news-and-offers checkbox under the contact fields. */
    marketingOptIn: {
      enabled: boolean;
      label: string;
      /** Pre-ticked. Off by default: consent is opt-in, not opt-out. */
      defaultChecked: boolean;
      /**
       * Where the box may arrive pre-ticked. `always` is what a store that
       * ticked the old `defaultChecked` chose; `auto` follows the shopper's
       * delivery country, which is the only way to be right in both a
       * jurisdiction that allows opt-out and one that does not.
       */
      preselect: MarketingPreselectMode;
      /** ISO-2 codes for `preselect: "countries"`. */
      preselectCountries: string[];
      /**
       * Ask the shopper to confirm by email before anything is sent. They sit
       * at `pending` until they follow the link; the confirmation itself
       * carries no marketing.
       */
      doubleOptIn: boolean;
    };
    /**
     * The text-message twin of the box above, shown instead of it when the
     * shopper gives a phone number rather than an email. Never pre-ticked —
     * text marketing is consent the shopper has to give themselves.
     */
    smsOptIn: {
      enabled: boolean;
      label: string;
      /** The small print under it: rates, and how to stop. */
      fineprint: string;
    };
  };
  fields: Record<ConfigurableAddressField, CheckoutBuiltInField> &
    Record<LockedAddressField, { label: string }>;
  orderNote: {
    visibility: CheckoutFieldVisibility;
    label: string;
    placeholder: string;
  };
  customFields: CheckoutCustomField[];
  accounts: {
    /** Off = a shopper must be signed in (or create an account) to order. */
    guestCheckout: boolean;
    /** Offer "create an account" with a password field to guests. Needs email. */
    signupAtCheckout: boolean;
  };
  abandonedCheckouts: {
    /** Off = checkouts are not tracked and no recovery email is ever sent. */
    enabled: boolean;
    /** Email the recovery link automatically once a checkout is abandoned. */
    autoRecoveryEmail: boolean;
    /**
     * Minutes of inactivity before the FIRST recovery email goes out.
     *
     * Kept as its own field because every store already has one and the editor
     * still shows it as "when to send". The rungs after it live in `schedule`.
     */
    delayMinutes: number;
    /**
     * The whole ladder, in minutes from the moment the checkout was abandoned
     * — the first entry included, so one list describes the schedule.
     *
     * Three at most, which is Shopify's limit and roughly where a reminder
     * stops being a reminder. A store that wants only one email keeps one
     * entry; `[]` means "just the first", for the stores that had one before
     * this existed.
     */
    schedule: number[];
    /** Only email shoppers who ticked the marketing checkbox. */
    marketingConsentOnly: boolean;
  };
  /**
   * Holding the goods while a shopper is at the gateway — see
   * `lib/checkout/attempt-stock-hold.ts`.
   */
  stockHold: {
    /** Off = nothing is held until the payment lands, as it used to be. */
    enabled: boolean;
    /**
     * Minutes. Long enough for a 3-D Secure detour and a fumbled card, short
     * enough that a shop is not emptied by people who never paid.
     */
    minutes: number;
  };
}

export const MAX_CHECKOUT_POLICY_LINKS = 6;
export const MAX_CHECKOUT_CUSTOM_FIELDS = 20;
const MAX_CHECKOUT_FIELD_OPTIONS = 30;
export const CHECKOUT_LABEL_MAX = 80;
export const CHECKOUT_HELP_MAX = 200;
/** The recovery-email delays the editor offers, in minutes. */
export const ABANDONED_RECOVERY_DELAYS = [30, 60, 180, 360, 720, 1440] as const;

const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  layout: {
    chrome: "store",
  },
  trust: {
    message: "",
    showSecureBadge: true,
    supportText: "",
  },
  policyLinks: [
    { label: "Refund policy", href: "/returns", visible: true },
    { label: "Privacy policy", href: "/privacy", visible: true },
    { label: "Terms of service", href: "/terms", visible: true },
  ],
  contact: {
    mode: "email",
    emailLabel: "",
    phoneLabel: "",
    marketingOptIn: {
      enabled: true,
      label: "",
      defaultChecked: false,
      preselect: "never",
      preselectCountries: [],
      doubleOptIn: false,
    },
    smsOptIn: { enabled: false, label: "", fineprint: "" },
  },
  // What checkout collected before these were configurable: surname, street,
  // city, postcode and country required; the rest optional; no delivery phone.
  fields: {
    firstName: { label: "", visibility: "optional" },
    lastName: { label: "", visibility: "required" },
    apartment: { label: "", visibility: "optional" },
    postalCode: { label: "", visibility: "required" },
    state: { label: "", visibility: "optional" },
    phone: { label: "", visibility: "hidden" },
    country: { label: "" },
    address: { label: "" },
    city: { label: "" },
  },
  orderNote: { visibility: "hidden", label: "", placeholder: "" },
  customFields: [],
  accounts: {
    guestCheckout: true,
    signupAtCheckout: false,
  },
  abandonedCheckouts: {
    enabled: true,
    autoRecoveryEmail: false,
    delayMinutes: 60,
    // An hour, six hours, a day. The first while the shopper may still be at
    // their desk, the second that evening, the third the next day — after
    // which another email is not a reminder, it is a nuisance.
    schedule: [60, 360, 1440],
    marketingConsentOnly: false,
  },
  stockHold: {
    // On, but inert until a gateway is moved onto the attempt path: the hold
    // belongs to an attempt, and there are none until then.
    enabled: true,
    minutes: 15,
  },
};

function cloneDefaults(): CheckoutSettings {
  return JSON.parse(
    JSON.stringify(DEFAULT_CHECKOUT_SETTINGS),
  ) as CheckoutSettings;
}

/**
 * The ladder, cleaned up: known delays only, in order, no repeats, at most
 * three — and always starting with the first email's own delay, so the two
 * settings can never disagree about when the first one goes.
 *
 * A store that has never seen this setting gets a single-rung ladder rather
 * than the default three: switching a store to three emails is a decision its
 * merchant makes, not one an upgrade makes for them.
 */
function normalizeRecoverySchedule(
  value: unknown,
  firstDelayMinutes: number,
): number[] {
  const allowed = new Set<number>(ABANDONED_RECOVERY_DELAYS);
  const rest = Array.isArray(value)
    ? value
        .map((entry) => Number(entry))
        .filter((minutes) => allowed.has(minutes as never))
        .filter((minutes) => minutes > firstDelayMinutes)
    : [];
  return [...new Set([firstDelayMinutes, ...rest])]
    .sort((a, b) => a - b)
    .slice(0, 3);
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeChromeMode(value: unknown): CheckoutChromeMode {
  return value === "focused" ? "focused" : "store";
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** ISO-2 country codes, upper-cased and de-duplicated; anything else dropped. */
function normalizeCountryCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes = value
    .map((entry) => (typeof entry === "string" ? entry.trim().toUpperCase() : ""))
    .filter((code) => /^[A-Z]{2}$/.test(code));
  return Array.from(new Set(codes)).slice(0, 250);
}

function normalizePolicyLinks(value: unknown): CheckoutPolicyLink[] {
  if (!Array.isArray(value)) return cloneDefaults().policyLinks;

  return value
    .map((item) => {
      const source = isRecord(item) ? item : {};
      return {
        label: normalizeString(source.label, "").trim(),
        href: normalizeString(source.href, "").trim(),
        visible: normalizeBoolean(source.visible, true),
      };
    })
    .filter((link) => link.label && link.href)
    .slice(0, MAX_CHECKOUT_POLICY_LINKS);
}

function normalizeFields(value: unknown): CheckoutSettings["fields"] {
  const defaults = cloneDefaults().fields;
  const source = isRecord(value) ? value : {};
  const fields = { ...defaults };

  for (const key of CONFIGURABLE_ADDRESS_FIELDS) {
    const entry = isRecord(source[key]) ? source[key] : {};
    fields[key] = {
      label: normalizeText(entry.label, CHECKOUT_LABEL_MAX),
      visibility: normalizeEnum(
        entry.visibility,
        FIELD_VISIBILITIES,
        defaults[key].visibility,
      ),
    };
  }
  for (const key of LOCKED_ADDRESS_FIELDS) {
    const entry = isRecord(source[key]) ? source[key] : {};
    fields[key] = { label: normalizeText(entry.label, CHECKOUT_LABEL_MAX) };
  }

  // An address addressed to nobody. The order keeps a recipient name
  // (`fullName`) and couriers print it, so at least one name part stays
  // required — the surname, as before, when the admin turned both off.
  if (
    fields.firstName.visibility !== "required" &&
    fields.lastName.visibility !== "required"
  ) {
    fields.lastName = { ...fields.lastName, visibility: "required" };
  }

  return fields;
}

const CUSTOM_FIELD_ID = /^cf_[a-z0-9_]{1,40}$/;

function normalizeCustomFields(value: unknown): CheckoutCustomField[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const fields: CheckoutCustomField[] = [];

  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = normalizeText(item.label, CHECKOUT_LABEL_MAX);
    // The id is the key a value is stored under on every past order, and the
    // form's field path — a malformed or duplicate one would collide.
    if (!CUSTOM_FIELD_ID.test(id) || seen.has(id) || !label) continue;

    const type = normalizeEnum(item.type, CHECKOUT_CUSTOM_FIELD_TYPES, "text");
    const options =
      type === "select" && Array.isArray(item.options)
        ? Array.from(
            new Set(
              item.options
                .map((option) => normalizeText(option, CHECKOUT_LABEL_MAX))
                .filter(Boolean),
            ),
          ).slice(0, MAX_CHECKOUT_FIELD_OPTIONS)
        : [];
    // A dropdown with nothing to choose can never be answered.
    if (type === "select" && options.length === 0) continue;

    seen.add(id);
    fields.push({
      id,
      label,
      type,
      placement: normalizeEnum(
        item.placement,
        CHECKOUT_CUSTOM_FIELD_PLACEMENTS,
        "additional",
      ),
      visibility: normalizeEnum(item.visibility, FIELD_VISIBILITIES, "optional"),
      placeholder: normalizeText(item.placeholder, CHECKOUT_LABEL_MAX),
      helpText: normalizeText(item.helpText, CHECKOUT_HELP_MAX),
      options,
    });
    if (fields.length >= MAX_CHECKOUT_CUSTOM_FIELDS) break;
  }

  return fields;
}

function normalizeDelayMinutes(value: unknown, fallback: number): number {
  const minutes = typeof value === "number" ? Math.round(value) : NaN;
  if (!Number.isFinite(minutes)) return fallback;
  // Under half an hour mails shoppers still filling in the form; over a week
  // mails a cart nobody remembers.
  return Math.min(7 * 24 * 60, Math.max(30, minutes));
}

export function getDefaultCheckoutSettings(): CheckoutSettings {
  return cloneDefaults();
}

/** A fresh custom-field id. Random, so two admins adding fields never collide. */
export function createCheckoutCustomFieldId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `cf_${random.toLowerCase()}`;
}

/** Whether a contact mode collects an email / a phone at all. */
export function contactModeCollects(mode: CheckoutContactMode) {
  return {
    email: mode !== "phone",
    phone: mode !== "email",
  };
}

export function normalizeCheckoutSettings(value: unknown): CheckoutSettings {
  const defaults = cloneDefaults();
  const source = isRecord(value) ? value : {};

  const layout = isRecord(source.layout) ? source.layout : {};
  const trust = isRecord(source.trust) ? source.trust : {};
  const contact = isRecord(source.contact) ? source.contact : {};
  const marketing = isRecord(contact.marketingOptIn)
    ? contact.marketingOptIn
    : {};
  const sms = isRecord(contact.smsOptIn) ? contact.smsOptIn : {};
  const orderNote = isRecord(source.orderNote) ? source.orderNote : {};
  const accounts = isRecord(source.accounts) ? source.accounts : {};
  const stockHold = isRecord(source.stockHold) ? source.stockHold : {};
  const abandoned = isRecord(source.abandonedCheckouts)
    ? source.abandonedCheckouts
    : {};

  const contactMode = normalizeEnum(
    contact.mode,
    CHECKOUT_CONTACT_MODES,
    defaults.contact.mode,
  );
  const guestCheckout = normalizeBoolean(
    accounts.guestCheckout,
    defaults.accounts.guestCheckout,
  );

  return {
    layout: {
      chrome: normalizeChromeMode(layout.chrome),
    },
    trust: {
      message: normalizeString(trust.message, defaults.trust.message),
      showSecureBadge: normalizeBoolean(
        trust.showSecureBadge,
        defaults.trust.showSecureBadge,
      ),
      supportText: normalizeString(
        trust.supportText,
        defaults.trust.supportText,
      ),
    },
    // An explicitly-saved empty array stays empty (the admin removed every
    // link); only a missing/garbage value falls back to the defaults.
    policyLinks: normalizePolicyLinks(source.policyLinks),
    contact: {
      mode: contactMode,
      emailLabel: normalizeText(contact.emailLabel, CHECKOUT_LABEL_MAX),
      phoneLabel: normalizeText(contact.phoneLabel, CHECKOUT_LABEL_MAX),
      marketingOptIn: {
        enabled: normalizeBoolean(
          marketing.enabled,
          defaults.contact.marketingOptIn.enabled,
        ),
        label: normalizeText(marketing.label, CHECKOUT_HELP_MAX),
        defaultChecked: normalizeBoolean(
          marketing.defaultChecked,
          defaults.contact.marketingOptIn.defaultChecked,
        ),
        // A store saved before this setting existed said only yes or no, and
        // "yes" meant everywhere — so that is what it keeps meaning until the
        // merchant picks a narrower rule.
        preselect: normalizeEnum(
          marketing.preselect,
          MARKETING_PRESELECT_MODES,
          normalizeBoolean(
            marketing.defaultChecked,
            defaults.contact.marketingOptIn.defaultChecked,
          )
            ? "always"
            : defaults.contact.marketingOptIn.preselect,
        ),
        preselectCountries: normalizeCountryCodes(marketing.preselectCountries),
        doubleOptIn: normalizeBoolean(
          marketing.doubleOptIn,
          defaults.contact.marketingOptIn.doubleOptIn,
        ),
      },
      smsOptIn: {
        enabled: normalizeBoolean(sms.enabled, defaults.contact.smsOptIn.enabled),
        label: normalizeText(sms.label, CHECKOUT_HELP_MAX),
        fineprint: normalizeText(sms.fineprint, CHECKOUT_HELP_MAX),
      },
    },
    fields: normalizeFields(source.fields),
    orderNote: {
      visibility: normalizeEnum(
        orderNote.visibility,
        FIELD_VISIBILITIES,
        defaults.orderNote.visibility,
      ),
      label: normalizeText(orderNote.label, CHECKOUT_LABEL_MAX),
      placeholder: normalizeText(orderNote.placeholder, CHECKOUT_HELP_MAX),
    },
    customFields: normalizeCustomFields(source.customFields),
    accounts: {
      guestCheckout,
      // Accounts sign in by email, so a phone-only checkout has nothing to
      // create one with.
      signupAtCheckout:
        contactModeCollects(contactMode).email &&
        normalizeBoolean(
          accounts.signupAtCheckout,
          defaults.accounts.signupAtCheckout,
        ),
    },
    abandonedCheckouts: {
      enabled: normalizeBoolean(
        abandoned.enabled,
        defaults.abandonedCheckouts.enabled,
      ),
      autoRecoveryEmail: normalizeBoolean(
        abandoned.autoRecoveryEmail,
        defaults.abandonedCheckouts.autoRecoveryEmail,
      ),
      delayMinutes: normalizeDelayMinutes(
        abandoned.delayMinutes,
        defaults.abandonedCheckouts.delayMinutes,
      ),
      schedule: normalizeRecoverySchedule(
        abandoned.schedule,
        normalizeDelayMinutes(
          abandoned.delayMinutes,
          defaults.abandonedCheckouts.delayMinutes,
        ),
      ),
      marketingConsentOnly: normalizeBoolean(
        abandoned.marketingConsentOnly,
        defaults.abandonedCheckouts.marketingConsentOnly,
      ),
    },
    stockHold: {
      enabled: normalizeBoolean(stockHold.enabled, defaults.stockHold.enabled),
      // Bounded rather than free: an hour of held stock is a merchant
      // mistyping, and a minute is not a payment window.
      minutes: Math.min(
        60,
        Math.max(
          1,
          Math.round(Number(stockHold.minutes) || defaults.stockHold.minutes),
        ),
      ),
    },
  };
}

/** What the storefront may read: everything but the recovery-email internals. */
export function toPublicCheckoutSettings(settings: CheckoutSettings) {
  const { abandonedCheckouts, ...rest } = settings;
  return {
    ...rest,
    abandonedCheckouts: { enabled: abandonedCheckouts.enabled },
  };
}

export type PublicCheckoutSettings = ReturnType<typeof toPublicCheckoutSettings>;
