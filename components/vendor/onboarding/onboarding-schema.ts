/**
 * Builds the become-a-vendor form's validation dynamically from the resolved
 * onboarding steps, so the schema always matches whatever the admin's template
 * exposes (labels, required flags, custom fields). Mirrors the server-side rules
 * in /api/vendor/apply; the server remains the authority.
 */

import { z } from "zod";
import type { ResolvedField, ResolvedStep } from "@/lib/vendors/vendor-onboarding";
import { ONBOARDING_STEP_KINDS } from "@/lib/vendors/vendor-onboarding-fields";

const PHONE_RE = /^[0-9+\s().-]*$/;

/** Validator for one field, given whether it is effectively required here. */
function fieldSchema(
  field: ResolvedField,
  required: boolean,
  label: string,
): z.ZodTypeAny {
  const requiredMsg = `${label} is required`;

  switch (field.widget) {
    case "checkbox":
      return required
        ? z.boolean().refine((v) => v === true, { message: requiredMsg })
        : z.boolean().optional();

    case "document":
      return required
        ? z.string().min(1, requiredMsg)
        : z.string().optional().or(z.literal(""));

    case "email":
      return required
        ? z.string().min(1, requiredMsg).email("Enter a valid email")
        : z.string().email("Enter a valid email").optional().or(z.literal(""));

    case "password":
      return required
        ? z.string().min(8, `${label} must be at least 8 characters`)
        : z.string().optional().or(z.literal(""));

    case "phone": {
      const base = z
        .string()
        .trim()
        .max(20, "Enter a valid phone number")
        .regex(PHONE_RE, "Enter a valid phone number");
      return required
        ? base.min(1, requiredMsg)
        : base.optional().or(z.literal(""));
    }

    default: {
      // A few system fields carry a minimum length beyond "non-empty", matching
      // the legacy hardcoded schema so errors surface on the field, not only at
      // final submit (where the server re-checks).
      const MIN_LEN: Record<string, number> = { storeName: 3, name: 2 };
      if (required && MIN_LEN[field.key]) {
        return z
          .string()
          .min(
            MIN_LEN[field.key],
            `${label} must be at least ${MIN_LEN[field.key]} characters`,
          );
      }

      // text / textarea / select / country / state.
      // Store description keeps its special "blank or ≥20 chars" rule.
      if (field.key === "description") {
        const base = z
          .string()
          .max(1000, "Description cannot exceed 1000 characters");
        return required
          ? base.refine((v) => v.trim().length >= 20, {
              message: "Description must be at least 20 characters",
            })
          : base
              .refine((v) => v === "" || v.trim().length >= 20, {
                message: "Description must be at least 20 characters",
              })
              .optional()
              .or(z.literal(""));
      }
      return required
        ? z.string().min(1, requiredMsg)
        : z.string().optional().or(z.literal(""));
    }
  }
}

/**
 * Assemble the whole form schema. Account-step fields are validated only while
 * the applicant is actually signing up (`requireAccount`); a logged-in visitor
 * never sees them, so they must not block the final submit.
 */
export function buildOnboardingSchema(
  steps: ResolvedStep[],
  requireAccount: boolean,
  labelOf: (field: ResolvedField) => string,
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  let hasPassword = false;
  let hasConfirm = false;

  for (const step of steps) {
    const isAccount = step.kind === ONBOARDING_STEP_KINDS.ACCOUNT;
    for (const field of step.fields) {
      const effectiveRequired =
        field.required && (!isAccount || requireAccount);
      // A logged-in visitor's account fields go fully optional.
      const validator =
        isAccount && !requireAccount
          ? z.string().optional().or(z.literal(""))
          : fieldSchema(field, effectiveRequired, labelOf(field));
      shape[field.key] = validator;
      if (field.key === "password") hasPassword = true;
      if (field.key === "confirmPassword") hasConfirm = true;
    }
  }

  const object = z.object(shape);
  // Confirm-password match only matters while signing up with both present.
  if (requireAccount && hasPassword && hasConfirm) {
    return object.refine((d) => d.password === d.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    }) as unknown as z.ZodType<Record<string, unknown>>;
  }
  return object as z.ZodType<Record<string, unknown>>;
}
