/**
 * Canonical registry of the vendor onboarding flow's built-in steps and fields.
 *
 * This is the single source of truth for what the become-a-vendor wizard looks
 * like BEFORE any admin customization. `resolveOnboardingConfig`
 * (lib/vendor-onboarding.ts) merges an admin's saved OnboardingTemplate over
 * these defaults; when no template exists the resolved flow equals this registry
 * exactly, which is byte-for-byte today's hardcoded wizard.
 *
 * Two field families:
 *  - System fields: bound to a specific Vendor column with a dedicated widget
 *    (country picker, phone, document upload). The admin may relabel them and,
 *    unless `locked`, toggle required/visible. Their `widget` (type) never
 *    changes.
 *  - Custom fields: added by the admin, rendered generically, answers stored in
 *    Vendor.onboardingResponses keyed by field key.
 */

// The high-level role of a step. System kinds have bespoke rendering (account =
// signup, subscription = plan cards, review = auto summary); "custom" steps hold
// only admin-created generic fields.
export const ONBOARDING_STEP_KINDS = {
  ACCOUNT: "account",
  BUSINESS: "business",
  SUBSCRIPTION: "subscription",
  REVIEW: "review",
  CUSTOM: "custom",
} as const;
export type OnboardingStepKind =
  (typeof ONBOARDING_STEP_KINDS)[keyof typeof ONBOARDING_STEP_KINDS];

/**
 * Every widget the field renderer knows how to draw. System fields use the
 * specialized ones (country/state/phone/document); custom fields are limited to
 * the generic subset in {@link CUSTOM_FIELD_TYPES}.
 */
const ONBOARDING_FIELD_WIDGETS = {
  TEXT: "text",
  EMAIL: "email",
  PASSWORD: "password",
  TEXTAREA: "textarea",
  SELECT: "select",
  CHECKBOX: "checkbox",
  PHONE: "phone",
  COUNTRY: "country",
  STATE: "state",
  DOCUMENT: "document",
} as const;
export type OnboardingFieldWidget =
  (typeof ONBOARDING_FIELD_WIDGETS)[keyof typeof ONBOARDING_FIELD_WIDGETS];

/** Widget types an admin may pick when creating a brand-new custom field. */
export const CUSTOM_FIELD_TYPES: OnboardingFieldWidget[] = [
  ONBOARDING_FIELD_WIDGETS.TEXT,
  ONBOARDING_FIELD_WIDGETS.TEXTAREA,
  ONBOARDING_FIELD_WIDGETS.SELECT,
  ONBOARDING_FIELD_WIDGETS.CHECKBOX,
  ONBOARDING_FIELD_WIDGETS.DOCUMENT,
];

export interface RegistryField {
  /** Stable key. System keys map to Vendor columns; also the responses key. */
  key: string;
  widget: OnboardingFieldWidget;
  /** i18n key resolved on the client when no admin label override is set. */
  labelKey: string;
  /** English fallback shown if the i18n key is missing (and in the builder). */
  defaultLabel: string;
  defaultPlaceholder?: string;
  /**
   * Structurally required by the flow (signup + store identity). A locked field
   * can never be hidden or have its required flag toggled off.
   */
  locked?: boolean;
  /** Default required state for a non-locked field. */
  requiredByDefault?: boolean;
  /** The value is an uploaded verification-document URL. */
  isDocument?: boolean;
}

export interface RegistryStep {
  key: string;
  kind: OnboardingStepKind;
  labelKey: string;
  defaultLabel: string;
  fields: RegistryField[];
}

/**
 * The default flow — mirrors the hardcoded wizard exactly. Only `storeName` and
 * the account fields are locked/required; everything else is optional by
 * default, matching today's behavior (documents become required only when the
 * admin marks them, historically via vendorConfig.requiredDocuments).
 */
export const ONBOARDING_REGISTRY: RegistryStep[] = [
  {
    key: "account",
    kind: ONBOARDING_STEP_KINDS.ACCOUNT,
    labelKey: "vendor.onboarding.steps.account",
    defaultLabel: "Your details",
    fields: [
      {
        key: "name",
        widget: ONBOARDING_FIELD_WIDGETS.TEXT,
        labelKey: "auth.fullName",
        defaultLabel: "Full name",
        defaultPlaceholder: "Enter your full name",
        locked: true,
      },
      {
        key: "email",
        widget: ONBOARDING_FIELD_WIDGETS.EMAIL,
        labelKey: "auth.email",
        defaultLabel: "Email",
        defaultPlaceholder: "Enter your email",
        locked: true,
      },
      {
        key: "password",
        widget: ONBOARDING_FIELD_WIDGETS.PASSWORD,
        labelKey: "auth.password",
        defaultLabel: "Password",
        defaultPlaceholder: "Enter password",
        locked: true,
      },
      {
        key: "confirmPassword",
        widget: ONBOARDING_FIELD_WIDGETS.PASSWORD,
        labelKey: "vendor.registration.confirmPassword",
        defaultLabel: "Confirm password",
        defaultPlaceholder: "Confirm password",
        locked: true,
      },
    ],
  },
  {
    key: "business",
    kind: ONBOARDING_STEP_KINDS.BUSINESS,
    labelKey: "vendor.onboarding.steps.business",
    defaultLabel: "Store & documents",
    fields: [
      {
        key: "storeName",
        widget: ONBOARDING_FIELD_WIDGETS.TEXT,
        labelKey: "vendor.registration.storeNameLabel",
        defaultLabel: "Store name",
        defaultPlaceholder: "Enter your store name",
        locked: true,
      },
      {
        key: "description",
        widget: ONBOARDING_FIELD_WIDGETS.TEXTAREA,
        labelKey: "vendor.registration.storeDescLabel",
        defaultLabel: "Store description",
        defaultPlaceholder: "Tell customers about your store",
      },
      {
        key: "country",
        widget: ONBOARDING_FIELD_WIDGETS.COUNTRY,
        labelKey: "vendor.onboarding.fields.country",
        defaultLabel: "Country",
        defaultPlaceholder: "Select country",
      },
      {
        key: "state",
        widget: ONBOARDING_FIELD_WIDGETS.STATE,
        labelKey: "vendor.onboarding.fields.state",
        defaultLabel: "State",
        // No default placeholder: the widget picks "Select state" (dropdown) or
        // "Enter state / region" (free-text) depending on the chosen country.
      },
      {
        key: "city",
        widget: ONBOARDING_FIELD_WIDGETS.TEXT,
        labelKey: "vendor.onboarding.fields.city",
        defaultLabel: "City",
        defaultPlaceholder: "Enter city",
      },
      {
        key: "address",
        widget: ONBOARDING_FIELD_WIDGETS.TEXT,
        labelKey: "vendor.onboarding.fields.address",
        defaultLabel: "Address",
        defaultPlaceholder: "Enter your complete address",
      },
      {
        key: "pincode",
        widget: ONBOARDING_FIELD_WIDGETS.TEXT,
        labelKey: "vendor.onboarding.fields.pincode",
        defaultLabel: "Pincode",
        defaultPlaceholder: "Enter pincode",
      },
      {
        key: "phone",
        widget: ONBOARDING_FIELD_WIDGETS.PHONE,
        labelKey: "vendor.onboarding.fields.phone",
        defaultLabel: "Phone",
      },
      {
        key: "businessLicense",
        widget: ONBOARDING_FIELD_WIDGETS.DOCUMENT,
        labelKey: "vendor.onboarding.fields.businessLicense",
        defaultLabel: "Business license / registration",
        isDocument: true,
      },
      {
        key: "taxId",
        widget: ONBOARDING_FIELD_WIDGETS.TEXT,
        labelKey: "vendor.onboarding.fields.taxId",
        defaultLabel: "Tax / VAT ID",
        defaultPlaceholder: "Enter your tax or VAT number",
        isDocument: true,
      },
      {
        key: "taxCertificate",
        widget: ONBOARDING_FIELD_WIDGETS.DOCUMENT,
        labelKey: "vendor.onboarding.fields.taxCertificate",
        defaultLabel: "Tax certificate",
        isDocument: true,
      },
      {
        key: "governmentId",
        widget: ONBOARDING_FIELD_WIDGETS.DOCUMENT,
        labelKey: "vendor.onboarding.fields.governmentId",
        defaultLabel: "Government ID (store owner)",
        isDocument: true,
      },
    ],
  },
  {
    key: "subscription",
    kind: ONBOARDING_STEP_KINDS.SUBSCRIPTION,
    labelKey: "vendor.onboarding.steps.subscription",
    defaultLabel: "Subscription",
    fields: [],
  },
  {
    key: "review",
    kind: ONBOARDING_STEP_KINDS.REVIEW,
    labelKey: "vendor.onboarding.steps.review",
    defaultLabel: "Review",
    fields: [],
  },
];

/** Fast lookup of a system field descriptor by key. */
export const SYSTEM_FIELDS_BY_KEY: Record<string, RegistryField> =
  Object.fromEntries(
    ONBOARDING_REGISTRY.flatMap((step) =>
      step.fields.map((field) => [field.key, field]),
    ),
  );

/** Fast lookup of a system step descriptor by key. */
export const SYSTEM_STEPS_BY_KEY: Record<string, RegistryStep> =
  Object.fromEntries(ONBOARDING_REGISTRY.map((step) => [step.key, step]));

