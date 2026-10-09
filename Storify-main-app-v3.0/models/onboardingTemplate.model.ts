/**
 * OnboardingTemplate Model
 *
 * Singleton document holding the admin's customization of the become-a-vendor
 * wizard: step order + labels + visibility, and per-field label / required /
 * visible overrides, plus any custom steps and fields.
 *
 * It stores only the OVERRIDE layer over the built-in registry
 * (lib/vendor-onboarding-fields.ts). When no document exists, the flow is the
 * registry defaults — byte-for-byte today's hardcoded wizard. `getOnboardingTemplate`
 * never creates a document, so "no template" stays a clean, side-effect-free
 * fallback; the admin PUT upserts the single row keyed by `key`.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import type {
  OnboardingStepKind,
  OnboardingFieldWidget,
} from "@/lib/vendors/vendor-onboarding-fields";

interface IOnboardingTemplateFieldOption {
  label: string;
  value: string;
}

export interface IOnboardingTemplateField {
  /** Stable per-field id (survives reorder). */
  id: string;
  /** System field key, or a `custom_*` key for admin-created fields. */
  key: string;
  widget: OnboardingFieldWidget;
  /** Admin label override; empty falls back to the registry's i18n label. */
  label?: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  visible: boolean;
  /** True for built-in registry fields, false for admin-created ones. */
  system: boolean;
  /** Choices for a `select` widget. */
  options?: IOnboardingTemplateFieldOption[];
}

export interface IOnboardingTemplateStep {
  id: string;
  /** System step key (`account`/`business`/...) or a `custom_*` key. */
  key: string;
  kind: OnboardingStepKind;
  /** Admin label override; empty falls back to the registry's i18n label. */
  label?: string;
  /** A hidden step is skipped in the wizard (only where structurally valid). */
  enabled: boolean;
  system: boolean;
  fields: IOnboardingTemplateField[];
}

export interface IOnboardingTemplate extends Document {
  /** Singleton discriminator; only ever "default". */
  key: string;
  steps: IOnboardingTemplateStep[];
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OnboardingTemplateFieldOptionSchema =
  new Schema<IOnboardingTemplateFieldOption>(
    {
      label: { type: String, default: "" },
      value: { type: String, default: "" },
    },
    { _id: false },
  );

const OnboardingTemplateFieldSchema = new Schema<IOnboardingTemplateField>(
  {
    id: { type: String, required: true },
    key: { type: String, required: true },
    widget: { type: String, required: true },
    label: { type: String },
    placeholder: { type: String },
    helpText: { type: String },
    required: { type: Boolean, default: false },
    visible: { type: Boolean, default: true },
    system: { type: Boolean, default: false },
    options: {
      type: [OnboardingTemplateFieldOptionSchema],
      default: undefined,
    },
  },
  { _id: false },
);

const OnboardingTemplateStepSchema = new Schema<IOnboardingTemplateStep>(
  {
    id: { type: String, required: true },
    key: { type: String, required: true },
    kind: { type: String, required: true },
    label: { type: String },
    enabled: { type: Boolean, default: true },
    system: { type: Boolean, default: false },
    fields: { type: [OnboardingTemplateFieldSchema], default: [] },
  },
  { _id: false },
);

const OnboardingTemplateSchema = new Schema<IOnboardingTemplate>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "default",
    },
    steps: { type: [OnboardingTemplateStepSchema], default: [] },
    updatedBy: { type: String },
  },
  { timestamps: true },
);

export const OnboardingTemplate: Model<IOnboardingTemplate> =
  mongoose.models.OnboardingTemplate ||
  mongoose.model<IOnboardingTemplate>(
    "OnboardingTemplate",
    OnboardingTemplateSchema,
  );

/**
 * Read the singleton template, or null when the admin has never customized the
 * flow. Never creates a document — a missing template means "use the registry
 * defaults", the byte-for-byte legacy wizard.
 */
export async function getOnboardingTemplate(): Promise<IOnboardingTemplate | null> {
  return OnboardingTemplate.findOne({ key: "default" }).lean<IOnboardingTemplate | null>();
}
