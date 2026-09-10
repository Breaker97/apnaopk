/**
 * Vendor onboarding configuration.
 *
 * Resolves the become-a-vendor wizard the storefront renders: the ordered
 * steps + fields (built-in registry merged with the admin's OnboardingTemplate
 * overrides), whether the subscription/plan step applies, and the plan catalog.
 *
 * When no OnboardingTemplate exists the resolved flow equals the registry
 * defaults — byte-for-byte the pre-builder wizard. The subscription step is
 * present only when the marketplace is on, the plans feature is enabled, AND at
 * least one active plan exists; otherwise it is dropped and the applicant
 * silently falls back to the default commission.
 */

import { getSettings } from "@/models/settings.model";
import { VendorPlan } from "@/models";
import { getOnboardingTemplate } from "@/models/onboardingTemplate.model";
import { connectDB } from "@/lib/db";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import type { VendorBillingInterval } from "@/config/app.config";
import {
  ONBOARDING_REGISTRY,
  ONBOARDING_STEP_KINDS,
  SYSTEM_FIELDS_BY_KEY,
  SYSTEM_STEPS_BY_KEY,
  type OnboardingFieldWidget,
  type OnboardingStepKind,
  type RegistryField,
  type RegistryStep,
} from "@/lib/vendors/vendor-onboarding-fields";
import type {
  IOnboardingTemplate,
  IOnboardingTemplateField,
} from "@/models/onboardingTemplate.model";

export interface PublicVendorPlan {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  billingInterval: VendorBillingInterval;
  commissionRate: number;
  trialDays: number;
  features: string[];
  limits: { products?: number | null; staff?: number | null };
  isDefault: boolean;
}

/** A single field as the wizard should render it (already visibility-filtered). */
export interface ResolvedField {
  key: string;
  widget: OnboardingFieldWidget;
  system: boolean;
  /** Admin label override, or null to fall back to `labelKey` / `defaultLabel`. */
  label: string | null;
  /** i18n key for a system field's default label (absent for custom fields). */
  labelKey?: string;
  defaultLabel: string;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  isDocument: boolean;
  /** Structurally required — the client shows it but never lets it be blank. */
  locked: boolean;
  options?: { label: string; value: string }[];
}

/** A resolved wizard step with only its visible fields, in order. */
export interface ResolvedStep {
  key: string;
  kind: OnboardingStepKind;
  label: string | null;
  labelKey?: string;
  defaultLabel: string;
  fields: ResolvedField[];
}

export interface OnboardingConfig {
  /** Ordered, visibility-filtered steps the wizard renders. */
  steps: ResolvedStep[];
  /** Show the subscription step (feature on AND ≥1 active plan). */
  plansEnabled: boolean;
  plans: PublicVendorPlan[];
  defaultCommissionRate: number;
  /** Force a plan choice before finishing (only meaningful when plansEnabled). */
  requirePlanSelection: boolean;
  /** Plan auto-applied when the applicant picks none. */
  defaultPlanId: string | null;
  /** Whether paid vendor plan checkout can create Stripe sessions. */
  stripeBillingReady: boolean;
}

/** Build a resolved field from the registry defaults alone (no template). */
function resolveDefaultField(
  field: RegistryField,
  requiredDocuments: Set<string>,
): ResolvedField {
  const required = Boolean(
    field.locked ||
      field.requiredByDefault ||
      (field.isDocument && requiredDocuments.has(field.key)),
  );
  return {
    key: field.key,
    widget: field.widget,
    system: true,
    label: null,
    labelKey: field.labelKey,
    defaultLabel: field.defaultLabel,
    placeholder: field.defaultPlaceholder ?? null,
    helpText: null,
    required,
    isDocument: Boolean(field.isDocument),
    locked: Boolean(field.locked),
  };
}

/** Merge a stored template field over its registry descriptor (system fields). */
function resolveSystemField(
  stored: IOnboardingTemplateField,
  registry: RegistryField,
): ResolvedField {
  const locked = Boolean(registry.locked);
  return {
    key: registry.key,
    widget: registry.widget,
    system: true,
    label: stored.label?.trim() ? stored.label.trim() : null,
    labelKey: registry.labelKey,
    defaultLabel: registry.defaultLabel,
    placeholder:
      stored.placeholder ?? registry.defaultPlaceholder ?? null,
    helpText: stored.helpText?.trim() ? stored.helpText.trim() : null,
    // A locked field can never be un-required.
    required: locked ? true : Boolean(stored.required),
    isDocument: Boolean(registry.isDocument),
    locked,
  };
}

/** Resolve an admin-created custom field straight from its stored definition. */
function resolveCustomField(stored: IOnboardingTemplateField): ResolvedField {
  return {
    key: stored.key,
    widget: stored.widget,
    system: false,
    label: stored.label?.trim() ? stored.label.trim() : null,
    defaultLabel: stored.label?.trim() || stored.key,
    placeholder: stored.placeholder ?? null,
    helpText: stored.helpText?.trim() ? stored.helpText.trim() : null,
    required: Boolean(stored.required),
    isDocument: stored.widget === "document",
    locked: false,
    options:
      stored.widget === "select" && Array.isArray(stored.options)
        ? stored.options
            .filter((o) => o && typeof o.value === "string")
            .map((o) => ({ label: o.label || o.value, value: o.value }))
        : undefined,
  };
}

/** All steps at registry defaults — the legacy flow when no template exists. */
function resolveDefaultSteps(requiredDocuments: Set<string>): ResolvedStep[] {
  return ONBOARDING_REGISTRY.map((step: RegistryStep) => ({
    key: step.key,
    kind: step.kind,
    label: null,
    labelKey: step.labelKey,
    defaultLabel: step.defaultLabel,
    fields: step.fields.map((f) => resolveDefaultField(f, requiredDocuments)),
  }));
}

/** Apply an admin template over the registry, yielding the wizard's steps. */
function resolveTemplateSteps(
  template: IOnboardingTemplate,
  requiredDocuments: Set<string>,
): ResolvedStep[] {
  // Every system field key the admin has placed somewhere — used to append any
  // registry field the template never mentioned (e.g. one added in a later
  // release), so upgrades never silently drop a built-in field.
  const seenSystemKeys = new Set(
    template.steps.flatMap((s) =>
      s.fields.filter((f) => f.system).map((f) => f.key),
    ),
  );

  const steps: ResolvedStep[] = [];
  for (const step of template.steps) {
    const isSystemStep = Boolean(step.system);
    const isRemovableKind =
      step.kind === ONBOARDING_STEP_KINDS.CUSTOM ||
      step.kind === ONBOARDING_STEP_KINDS.SUBSCRIPTION;
    // A disabled step is dropped, but never the structural account/business/
    // review steps — hiding those would break signup or submit.
    if (step.enabled === false && isRemovableKind) continue;

    const fields: ResolvedField[] = [];
    for (const stored of step.fields) {
      if (stored.system) {
        const registry = SYSTEM_FIELDS_BY_KEY[stored.key];
        if (!registry) continue; // stale key removed from the registry
        const resolved = resolveSystemField(stored, registry);
        // Hidden system field: keep only if locked (locked can't be hidden).
        if (stored.visible === false && !resolved.locked) continue;
        fields.push(resolved);
      } else {
        if (stored.visible === false) continue;
        fields.push(resolveCustomField(stored));
      }
    }

    steps.push({
      key: step.key,
      kind: step.kind,
      label: step.label?.trim() ? step.label.trim() : null,
      labelKey: isSystemStep
        ? (ONBOARDING_REGISTRY.find((r) => r.key === step.key)?.labelKey ??
          undefined)
        : undefined,
      defaultLabel:
        ONBOARDING_REGISTRY.find((r) => r.key === step.key)?.defaultLabel ??
        step.label ??
        step.key,
      fields,
    });
  }

  // Forward-compat: append any registry field the template never referenced to
  // its home step (defaults), so a newly-shipped built-in field still appears.
  for (const registryStep of ONBOARDING_REGISTRY) {
    for (const field of registryStep.fields) {
      if (seenSystemKeys.has(field.key)) continue;
      const target = steps.find((s) => s.key === registryStep.key);
      if (target) target.fields.push(resolveDefaultField(field, requiredDocuments));
    }
  }

  return steps;
}

/**
 * Enforce structural ordering + subscription gating on the resolved steps:
 * account first, review last, exactly one subscription step iff plans apply.
 */
/** Build a resolved step straight from the registry (used to re-insert a
 * structural step a crafted template dropped). */
function registryResolvedStep(
  stepKey: string,
  requiredDocuments: Set<string>,
): ResolvedStep | null {
  const rs = ONBOARDING_REGISTRY.find((r) => r.key === stepKey);
  if (!rs) return null;
  return {
    key: rs.key,
    kind: rs.kind,
    label: null,
    labelKey: rs.labelKey,
    defaultLabel: rs.defaultLabel,
    fields: rs.fields.map((f) => resolveDefaultField(f, requiredDocuments)),
  };
}

function normalizeSteps(
  steps: ResolvedStep[],
  plansEnabled: boolean,
  requiredDocuments: Set<string>,
): ResolvedStep[] {
  let out = steps.slice();

  // Subscription step present iff the plans feature applies.
  out = out.filter(
    (s) => s.kind !== ONBOARDING_STEP_KINDS.SUBSCRIPTION || plansEnabled,
  );
  if (plansEnabled && !out.some((s) => s.kind === ONBOARDING_STEP_KINDS.SUBSCRIPTION)) {
    const reg = registryResolvedStep("subscription", requiredDocuments);
    if (reg) out.push(reg);
  }

  // The structural steps must always exist — a crafted/partial template that
  // dropped one would otherwise yield a wizard with no signup, no store fields,
  // or no submit. Re-insert any missing one from the registry defaults.
  for (const key of ["account", "business", "review"]) {
    const kind = SYSTEM_STEPS_BY_KEY[key]?.kind;
    if (kind && !out.some((s) => s.kind === kind)) {
      const reg = registryResolvedStep(key, requiredDocuments);
      if (reg) out.push(reg);
    }
  }

  // Stable order with account pinned first and review pinned last.
  const rank = (s: ResolvedStep) =>
    s.kind === ONBOARDING_STEP_KINDS.ACCOUNT
      ? 0
      : s.kind === ONBOARDING_STEP_KINDS.REVIEW
        ? 2
        : 1;
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * The submitted application shape the server checks required fields against.
 * System fields live in their typed slots; custom answers live in `responses`.
 */
interface OnboardingSubmission {
  storeName?: string;
  description?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  } | null;
  documents?: Record<string, string> | null;
  responses?: Record<string, string | boolean>;
}

// Where each system field's submitted value lives in the apply payload.
const SYSTEM_VALUE_PATH: Record<
  string,
  (s: OnboardingSubmission) => unknown
> = {
  storeName: (s) => s.storeName,
  description: (s) => s.description,
  country: (s) => s.address?.country,
  state: (s) => s.address?.state,
  city: (s) => s.address?.city,
  address: (s) => s.address?.street,
  pincode: (s) => s.address?.postalCode,
  phone: (s) => s.address?.phone,
  businessLicense: (s) => s.documents?.businessLicense,
  taxId: (s) => s.documents?.taxId,
  taxCertificate: (s) => s.documents?.taxCertificate,
  governmentId: (s) => s.documents?.governmentId,
};

const isBlank = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/**
 * Server-side enforcement of the resolved template's required fields — the
 * authority the client mirrors. Account fields are enforced at signup, so they
 * are skipped here. Returns a field→message map (empty when valid).
 */
export function collectRequiredViolations(
  config: OnboardingConfig,
  submission: OnboardingSubmission,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const step of config.steps) {
    if (
      step.kind === ONBOARDING_STEP_KINDS.ACCOUNT ||
      step.kind === ONBOARDING_STEP_KINDS.REVIEW ||
      step.kind === ONBOARDING_STEP_KINDS.SUBSCRIPTION
    ) {
      continue;
    }
    for (const field of step.fields) {
      if (!field.required) continue;
      const value = field.system
        ? SYSTEM_VALUE_PATH[field.key]?.(submission)
        : submission.responses?.[field.key];
      const missing =
        field.widget === "checkbox" ? value !== true : isBlank(value);
      if (missing) {
        const label = field.label || field.defaultLabel;
        errors[field.key] = [`${label} is required`];
      }
    }
  }
  return errors;
}

/** A stored custom answer, self-describing so the admin view survives a later
 * edit or deletion of the field definition. */
interface StoredOnboardingResponse {
  label: string;
  value: string | boolean;
}

/**
 * Keep only answers to fields that are actual visible custom fields in the
 * resolved template, dropping unknown/hidden keys so no junk reaches the DB.
 * The field's label is captured alongside the value so the admin can read the
 * answer without re-resolving the (possibly since-changed) template.
 */
export function sanitizeOnboardingResponses(
  config: OnboardingConfig,
  responses: Record<string, unknown> | undefined,
): Record<string, StoredOnboardingResponse> {
  if (!responses) return {};
  const allowed = new Map<string, ResolvedField>();
  for (const step of config.steps) {
    for (const field of step.fields) {
      if (!field.system) allowed.set(field.key, field);
    }
  }
  const clean: Record<string, StoredOnboardingResponse> = {};
  for (const [key, field] of allowed) {
    const raw = responses[key];
    const label = field.label || field.defaultLabel;
    if (field.widget === "checkbox") {
      clean[key] = { label, value: raw === true || raw === "true" };
    } else if (typeof raw === "string" && raw.trim() !== "") {
      clean[key] = { label, value: raw };
    }
  }
  return clean;
}

export async function resolveOnboardingConfig(): Promise<OnboardingConfig> {
  await connectDB();
  const settings = await getSettings();

  const multiVendor = Boolean(settings.multiVendorMode?.enabled);
  const plansFeature = Boolean(settings.vendorConfig?.plansEnabled);
  const stripeCreds = resolveStripeCredentials(settings.payment?.stripe);
  const stripeBillingReady = Boolean(
    settings.payment?.stripe?.enabled && stripeCreds.secretKey,
  );
  const defaultCommissionRate =
    settings.orders?.commission?.vendorRate ?? DEFAULT_VENDOR_COMMISSION_RATE;
  const requiredDocuments = new Set<string>(
    settings.vendorConfig?.requiredDocuments ?? [],
  );

  let plans: PublicVendorPlan[] = [];
  if (multiVendor && plansFeature) {
    const docs = await VendorPlan.find({ status: "active" })
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    plans = docs.map((p) => ({
      id: String(p._id),
      name: p.name,
      description: p.description || undefined,
      price: p.price ?? 0,
      currency: String(
        p.stripePriceCurrency ||
          settings.general?.defaultCurrency ||
          "USD",
      ).toUpperCase(),
      billingInterval: p.billingInterval,
      commissionRate: p.commissionRate ?? 0,
      trialDays: p.trialDays ?? 0,
      features: Array.isArray(p.features) ? p.features : [],
      limits: {
        products: p.limits?.products ?? null,
        staff: p.limits?.staff ?? null,
      },
      isDefault: Boolean(p.isDefault),
    }));
  }

  const plansEnabled = multiVendor && plansFeature && plans.length > 0;
  const defaultPlanId = settings.vendorConfig?.defaultPlanId ?? null;

  const template = await getOnboardingTemplate();
  const rawSteps = template
    ? resolveTemplateSteps(template, requiredDocuments)
    : resolveDefaultSteps(requiredDocuments);
  const steps = normalizeSteps(rawSteps, plansEnabled, requiredDocuments);

  return {
    steps,
    plansEnabled,
    plans,
    defaultCommissionRate,
    requirePlanSelection:
      plansEnabled && Boolean(settings.vendorConfig?.requirePlanSelection),
    // Only surface a default that is actually an active, offerable plan.
    defaultPlanId:
      defaultPlanId && plans.some((p) => p.id === defaultPlanId)
        ? defaultPlanId
        : null,
    stripeBillingReady,
  };
}
