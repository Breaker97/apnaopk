/**
 * Shared conversions for the onboarding flow builder.
 *
 *   registry (+ stored overrides)  ──buildEditableTemplate──▶  EditableTemplate
 *   EditableTemplate               ──toStoredSteps──────────▶  persisted steps
 *   EditableTemplate               ──resolveEditableForPreview▶ ResolvedStep[]
 *
 * The editable template always carries the FULL field list (every system field
 * plus custom ones), including hidden fields, so the admin can toggle anything.
 * `resolveEditableForPreview` drops hidden fields to mirror what the storefront
 * wizard renders. Pure module (no DB) — usable on client and server.
 */

import {
  CUSTOM_FIELD_TYPES,
  ONBOARDING_REGISTRY,
  ONBOARDING_STEP_KINDS,
  SYSTEM_FIELDS_BY_KEY,
  type OnboardingFieldWidget,
  type OnboardingStepKind,
} from "@/lib/vendors/vendor-onboarding-fields";
import type { ResolvedField, ResolvedStep } from "@/lib/vendors/vendor-onboarding";
import type {
  IOnboardingTemplate,
  IOnboardingTemplateField,
  IOnboardingTemplateStep,
} from "@/models/onboardingTemplate.model";

interface EditableFieldOption {
  label: string;
  value: string;
}

export interface EditableField {
  id: string;
  key: string;
  widget: OnboardingFieldWidget;
  /** Admin label override; "" means fall back to labelKey/defaultLabel. */
  label: string;
  placeholder: string;
  helpText: string;
  required: boolean;
  visible: boolean;
  system: boolean;
  /** i18n key for a system field's default label. */
  labelKey?: string;
  defaultLabel: string;
  isDocument: boolean;
  /** Locked fields can't be hidden or made optional (signup/store identity). */
  locked: boolean;
  options?: EditableFieldOption[];
}

export interface EditableStep {
  id: string;
  key: string;
  kind: OnboardingStepKind;
  label: string;
  enabled: boolean;
  system: boolean;
  defaultLabel: string;
  labelKey?: string;
  fields: EditableField[];
}

export interface EditableTemplate {
  steps: EditableStep[];
}

function registryFieldToEditable(
  key: string,
  requiredDocuments: Set<string>,
): EditableField {
  const f = SYSTEM_FIELDS_BY_KEY[key];
  const required = Boolean(
    f.locked || f.requiredByDefault || (f.isDocument && requiredDocuments.has(key)),
  );
  return {
    id: key,
    key,
    widget: f.widget,
    label: "",
    placeholder: f.defaultPlaceholder ?? "",
    helpText: "",
    required,
    visible: true,
    system: true,
    labelKey: f.labelKey,
    defaultLabel: f.defaultLabel,
    isDocument: Boolean(f.isDocument),
    locked: Boolean(f.locked),
    options: f.widget === "select" ? [] : undefined,
  };
}

function storedFieldToEditable(stored: IOnboardingTemplateField): EditableField {
  if (stored.system && SYSTEM_FIELDS_BY_KEY[stored.key]) {
    const base = registryFieldToEditable(stored.key, new Set());
    return {
      ...base,
      label: stored.label ?? "",
      placeholder: stored.placeholder ?? base.placeholder,
      helpText: stored.helpText ?? "",
      // Locked fields ignore stored required/visible — always on.
      required: base.locked ? true : Boolean(stored.required),
      visible: base.locked ? true : stored.visible !== false,
    };
  }
  // Custom field.
  return {
    id: stored.id || stored.key,
    key: stored.key,
    widget: stored.widget,
    label: stored.label ?? "",
    placeholder: stored.placeholder ?? "",
    helpText: stored.helpText ?? "",
    required: Boolean(stored.required),
    visible: stored.visible !== false,
    system: false,
    defaultLabel: stored.label || stored.key,
    isDocument: stored.widget === "document",
    locked: false,
    options:
      stored.widget === "select"
        ? (stored.options ?? []).map((o) => ({
            label: o.label ?? "",
            value: o.value ?? "",
          }))
        : undefined,
  };
}

/**
 * Build the full editable template from the registry, overlaying any stored
 * admin customization. Missing system fields/steps are appended so an upgrade
 * never drops a built-in.
 */
export function buildEditableTemplate(
  stored: IOnboardingTemplate | null | undefined,
  requiredDocuments: string[] = [],
): EditableTemplate {
  const reqDocs = new Set(requiredDocuments);

  const registryEditableStep = (stepKey: string): EditableStep => {
    const rs = ONBOARDING_REGISTRY.find((s) => s.key === stepKey)!;
    return {
      id: stepKey,
      key: stepKey,
      kind: rs.kind,
      label: "",
      enabled: true,
      system: true,
      defaultLabel: rs.defaultLabel,
      labelKey: rs.labelKey,
      fields: rs.fields.map((f) => registryFieldToEditable(f.key, reqDocs)),
    };
  };

  if (!stored || !Array.isArray(stored.steps) || stored.steps.length === 0) {
    return { steps: ONBOARDING_REGISTRY.map((s) => registryEditableStep(s.key)) };
  }

  const steps: EditableStep[] = [];
  const seenStepKeys = new Set<string>();
  for (const s of stored.steps) {
    seenStepKeys.add(s.key);
    const rs = ONBOARDING_REGISTRY.find((r) => r.key === s.key);
    if (rs) {
      // System step: overlay onto the registry, keep stored field order, then
      // append any registry field the stored template never mentioned.
      const base = registryEditableStep(s.key);
      const storedKeys = new Set(s.fields.map((f) => f.key));
      const fields: EditableField[] = s.fields
        .filter((f) => !f.system || SYSTEM_FIELDS_BY_KEY[f.key])
        .map(storedFieldToEditable);
      for (const rf of base.fields) {
        if (!storedKeys.has(rf.key)) fields.push(rf);
      }
      steps.push({
        ...base,
        label: s.label ?? "",
        enabled: s.enabled !== false,
        fields,
      });
    } else {
      // Custom step.
      steps.push({
        id: s.id || s.key,
        key: s.key,
        kind: ONBOARDING_STEP_KINDS.CUSTOM,
        label: s.label ?? "",
        enabled: s.enabled !== false,
        system: false,
        defaultLabel: s.label || s.key,
        fields: (s.fields ?? []).map(storedFieldToEditable),
      });
    }
  }

  // Append any registry step not present in the stored template.
  for (const rs of ONBOARDING_REGISTRY) {
    if (!seenStepKeys.has(rs.key)) steps.push(registryEditableStep(rs.key));
  }

  return { steps };
}

/**
 * Strip an editable template to the persisted override shape, clamping to
 * server-trusted invariants so a tampered client payload can't, e.g., change a
 * system field's widget, un-lock a locked field, or give a custom field an
 * unknown widget. Duplicate field keys within a step are dropped.
 */
export function toStoredSteps(
  template: EditableTemplate,
): IOnboardingTemplateStep[] {
  return template.steps.map((step) => {
    const registryStep = ONBOARDING_REGISTRY.find((s) => s.key === step.key);
    const seenKeys = new Set<string>();
    const fields: IOnboardingTemplateField[] = [];
    for (const f of step.fields) {
      const registry = SYSTEM_FIELDS_BY_KEY[f.key];
      const isSystem = Boolean(registry);
      if (!f.key || seenKeys.has(f.key)) continue;
      seenKeys.add(f.key);

      // System fields keep their registry widget; locked fields stay on.
      const widget: OnboardingFieldWidget = isSystem
        ? registry.widget
        : CUSTOM_FIELD_TYPES.includes(f.widget)
          ? f.widget
          : "text";
      const locked = isSystem && Boolean(registry.locked);

      fields.push({
        id: f.id || f.key,
        key: f.key,
        widget,
        label: f.label?.trim() || undefined,
        placeholder: f.placeholder?.trim() || undefined,
        helpText: f.helpText?.trim() || undefined,
        required: locked ? true : Boolean(f.required),
        visible: locked ? true : f.visible !== false,
        system: isSystem,
        options:
          widget === "select"
            ? (f.options ?? [])
                .map((o) => ({
                  label: (o.label ?? "").trim(),
                  value: (o.value ?? "").trim(),
                }))
                .filter((o) => o.value !== "")
                .map((o) => ({ label: o.label || o.value, value: o.value }))
            : undefined,
      });
    }
    return {
      id: step.id || step.key,
      key: step.key,
      // System steps keep their registry kind; anything else is a custom step.
      kind: registryStep ? registryStep.kind : ONBOARDING_STEP_KINDS.CUSTOM,
      label: step.label?.trim() || undefined,
      enabled: step.enabled !== false,
      system: Boolean(registryStep),
      fields,
    };
  });
}

function editableFieldToResolved(f: EditableField): ResolvedField {
  return {
    key: f.key,
    widget: f.widget,
    system: f.system,
    label: f.label?.trim() ? f.label.trim() : null,
    labelKey: f.system ? f.labelKey : undefined,
    defaultLabel: f.defaultLabel,
    placeholder: f.placeholder?.trim() ? f.placeholder.trim() : null,
    helpText: f.helpText?.trim() ? f.helpText.trim() : null,
    required: f.required,
    isDocument: f.isDocument,
    locked: f.locked,
    options:
      f.widget === "select"
        ? (f.options ?? [])
            .filter((o) => (o.value ?? "").trim() !== "")
            .map((o) => ({ label: o.label || o.value, value: o.value }))
        : undefined,
  };
}

/**
 * Resolve an editable template to the wizard's steps for the live preview —
 * visible fields only, disabled steps dropped (except structural ones), so the
 * admin sees exactly what an applicant would.
 */
export function resolveEditableForPreview(
  template: EditableTemplate,
): ResolvedStep[] {
  const out: ResolvedStep[] = [];
  for (const step of template.steps) {
    const removable =
      step.kind === ONBOARDING_STEP_KINDS.CUSTOM ||
      step.kind === ONBOARDING_STEP_KINDS.SUBSCRIPTION;
    if (!step.enabled && removable) continue;
    out.push({
      key: step.key,
      kind: step.kind,
      label: step.label?.trim() ? step.label.trim() : null,
      labelKey: step.system ? step.labelKey : undefined,
      defaultLabel: step.defaultLabel,
      fields: step.fields
        .filter((f) => f.visible || f.locked)
        .map(editableFieldToResolved),
    });
  }
  return out;
}
