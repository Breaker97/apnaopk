/**
 * Admin API for the vendor onboarding flow builder.
 *
 * GET  → the full editable template (registry seeded + stored overrides), plus
 *        marketplace/plans flags for the builder UI.
 * PUT  → validate + persist the singleton template, clamping system-field
 *        integrity server-side (see toStoredSteps).
 */

import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import {
  OnboardingTemplate,
  getOnboardingTemplate,
} from "@/models/onboardingTemplate.model";
import {
  buildEditableTemplate,
  toStoredSteps,
  type EditableTemplate,
} from "@/lib/vendors/onboarding-template-editor";
import { auditCreate, auditUpdate, createAuditContext } from "@/lib/audit";

const OptionSchema = z.object({
  label: z.string().max(120).optional(),
  value: z.string().max(120).optional(),
});

const FieldSchema = z
  .object({
    id: z.string().max(64).optional(),
    key: z.string().min(1).max(64),
    widget: z.string().max(24),
    label: z.string().max(160).optional(),
    placeholder: z.string().max(200).optional(),
    helpText: z.string().max(400).optional(),
    required: z.boolean().optional(),
    visible: z.boolean().optional(),
    system: z.boolean().optional(),
    options: z.array(OptionSchema).max(50).optional(),
  })
  .passthrough();

const StepSchema = z
  .object({
    id: z.string().max(64).optional(),
    key: z.string().min(1).max(64),
    kind: z.string().max(24),
    label: z.string().max(160).optional(),
    enabled: z.boolean().optional(),
    system: z.boolean().optional(),
    fields: z.array(FieldSchema).max(80),
  })
  .passthrough();

const TemplateSchema = z.object({
  steps: z.array(StepSchema).min(1).max(24),
});

async function loadEditable() {
  await connectDB();
  const [settings, stored] = await Promise.all([
    getSettings(),
    getOnboardingTemplate(),
  ]);
  const template = buildEditableTemplate(
    stored,
    settings.vendorConfig?.requiredDocuments ?? [],
  );
  return {
    template,
    marketplaceEnabled: Boolean(settings.multiVendorMode?.enabled),
    plansEnabled: Boolean(settings.vendorConfig?.plansEnabled),
  };
}

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:onboardingTemplate:get", preset: "lenient" },
  },
  async () => {
    return successResponse(await loadEditable());
  },
);

export const PUT = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:onboardingTemplate:save", preset: "moderate" },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, TemplateSchema);
    const storedSteps = toStoredSteps(body as unknown as EditableTemplate);

    await connectDB();
    const auditContext = createAuditContext(request, session);
    const existing = await OnboardingTemplate.findOne({ key: "default" });

    if (existing) {
      const before = existing.toObject() as unknown as Record<string, unknown>;
      existing.set("steps", storedSteps);
      existing.updatedBy = session.user.id;
      await existing.save();
      await auditUpdate(
        auditContext,
        "vendorOnboardingTemplate",
        String(existing._id),
        before,
        existing.toObject() as unknown as Record<string, unknown>,
        "Vendor onboarding flow",
      );
    } else {
      const created = await OnboardingTemplate.create({
        key: "default",
        steps: storedSteps,
        updatedBy: session.user.id,
      });
      await auditCreate(
        auditContext,
        "vendorOnboardingTemplate",
        String(created._id),
        created.toObject() as unknown as Record<string, unknown>,
        "Vendor onboarding flow",
      );
    }

    return successResponse(await loadEditable(), "Onboarding flow saved");
  },
);
