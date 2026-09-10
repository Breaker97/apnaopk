import { z } from "zod";
import { VendorApplication, VendorPlan } from "@/models";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_BILLING_INTERVAL,
  type VendorApplicationPaymentStatus,
  type VendorBillingInterval,
} from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { isValidObjectId } from "@/lib/api/validate";
import {
  collectRequiredViolations,
  resolveOnboardingConfig,
  sanitizeOnboardingResponses,
  type OnboardingConfig,
} from "@/lib/vendors/vendor-onboarding";
import type { ISettings } from "@/models/settings.model";
import type {
  IVendorApplicationData,
  IVendorApplicationPlanSnapshot,
} from "@/models/vendorApplication.model";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import { vendorDocumentReferenceSchema } from "@/lib/vendors/vendor-documents";

export const VendorApplicationPayloadSchema = z.object({
  storeName: z
    .string()
    .min(3, "Store name must be at least 3 characters")
    .max(100, "Store name cannot exceed 100 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(1000, "Description cannot exceed 1000 characters"),
  logo: z.string().url("Logo must be a valid URL").nullable().optional(),
  banner: z.string().url("Banner must be a valid URL").nullable().optional(),
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      phone: z
        .string()
        .trim()
        .max(24, "Invalid phone number")
        .regex(/^$|^\+?[0-9\s().-]{4,22}$/, "Invalid phone number")
        .optional(),
    })
    .nullable()
    .optional(),
  socialLinks: z
    .object({
      website: z
        .string()
        .url("Website must be a valid URL")
        .nullable()
        .optional(),
      facebook: z
        .string()
        .url("Facebook must be a valid URL")
        .nullable()
        .optional(),
      instagram: z
        .string()
        .url("Instagram must be a valid URL")
        .nullable()
        .optional(),
      twitter: z
        .string()
        .url("Twitter must be a valid URL")
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  bankDetails: z
    .object({
      accountName: z.string().optional(),
      accountNumber: z.string().optional(),
      bankName: z.string().optional(),
      routingNumber: z.string().optional(),
      swiftCode: z.string().optional(),
    })
    .nullable()
    .optional(),
  documents: z
    .object({
      businessLicense: vendorDocumentReferenceSchema(
        "Business license must be an uploaded document",
      ),
      taxId: z.string().max(60, "Tax ID cannot exceed 60 characters").optional(),
      taxCertificate: vendorDocumentReferenceSchema(
        "Tax certificate must be an uploaded document",
      ),
      governmentId: vendorDocumentReferenceSchema(
        "Government ID must be an uploaded document",
      ),
    })
    .nullable()
    .optional(),
  planId: z.string().optional().or(z.literal("")).nullable(),
  responses: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .optional(),
  termsAccepted: z.literal(true, {
    error: "Vendor subscription terms must be accepted",
  }),
});

type VendorApplicationPayload = z.infer<
  typeof VendorApplicationPayloadSchema
>;

export interface VendorPlanForApplication {
  _id: unknown;
  name: string;
  description?: string;
  price: number;
  billingInterval: string;
  commissionRate: number;
  trialDays?: number;
  features?: string[];
  limits?: { products?: number | null; staff?: number | null };
  capabilities?: { aiAuthoring?: boolean };
  status: string;
  stripeProductId?: string | null;
  stripePriceId?: string | null;
  stripePriceCurrency?: string | null;
  stripePriceActive?: boolean;
}

interface PreparedVendorApplication {
  onboardingConfig: OnboardingConfig;
  applicationData: IVendorApplicationData;
  chosenPlan: VendorPlanForApplication | null;
  planSnapshot: IVendorApplicationPlanSnapshot | null;
  requiresPayment: boolean;
}

/**
 * Build the query that finds a vendor's billing application.
 *
 * `VendorApplication.userId` is unique, so a re-apply after rejection reuses
 * the row rather than adding one — but rows written before that index, and
 * rows bound to the vendor versus only to the user, can still yield more than
 * one match. So this must always be paired with
 * `VENDOR_APPLICATION_LATEST_SORT`. Without it Mongo returns an arbitrary
 * match, and two call sites reading "the" application can disagree — the admin
 * writes the Stripe price onto one row while checkout reads another, which
 * surfaces as a missing billing record or a stale plan price.
 *
 * Matches rows bound to the vendor as well as ones still carrying only the
 * owning user (submitted before the Vendor record existed); the sort then picks
 * the newest of either kind, which is the row the vendor is currently acting on.
 */
export function vendorApplicationLookupQuery(input: {
  vendorId?: unknown;
  userId: unknown;
}): Record<string, unknown> {
  return input.vendorId
    ? { $or: [{ vendorId: input.vendorId }, { userId: input.userId }] }
    : { userId: input.userId };
}

/** Newest-first ordering; every application lookup must apply it. */
export const VENDOR_APPLICATION_LATEST_SORT = { createdAt: -1 } as const;

/**
 * The one way to resolve "this vendor's current application". Returns a
 * hydrated document so callers can mutate and save it.
 */
export function findLatestVendorApplication(input: {
  vendorId?: unknown;
  userId: unknown;
}) {
  return VendorApplication.findOne(vendorApplicationLookupQuery(input)).sort(
    VENDOR_APPLICATION_LATEST_SORT,
  );
}

/**
 * Whether a plan has to be paid for BEFORE the vendor may sell.
 *
 * A paid plan with trial days does not: the trial is exactly the promise that
 * no payment method is taken up front. The charge is deferred, not waived —
 * when the trial lapses the subscription drops back onto the standard
 * payment-required rail (see `getEffectiveSubscription`).
 */
export function vendorPlanRequiresUpfrontPayment(
  plan: Pick<
    VendorPlanForApplication,
    "price" | "billingInterval" | "trialDays"
  > | null,
): boolean {
  return Boolean(
    plan &&
      plan.billingInterval !== VENDOR_BILLING_INTERVAL.NONE &&
      Number(plan.price || 0) > 0 &&
      Number(plan.trialDays || 0) <= 0,
  );
}

/** True when the plan starts the vendor on a no-payment-method free trial. */
export function vendorPlanStartsTrial(
  plan: Pick<
    VendorPlanForApplication,
    "price" | "billingInterval" | "trialDays"
  > | null,
): boolean {
  return Boolean(
    plan &&
      plan.billingInterval !== VENDOR_BILLING_INTERVAL.NONE &&
      Number(plan.price || 0) > 0 &&
      Number(plan.trialDays || 0) > 0,
  );
}

function buildVendorApplicationPlanSnapshot(
  plan: VendorPlanForApplication | null,
): IVendorApplicationPlanSnapshot | null {
  if (!plan) return null;
  return {
    name: plan.name,
    price: Number(plan.price || 0),
    currency: String(plan.stripePriceCurrency || "USD").toUpperCase(),
    billingInterval: plan.billingInterval as VendorBillingInterval,
    commissionRate: Number(plan.commissionRate || 0),
    trialDays: Number(plan.trialDays || 0),
    features: Array.isArray(plan.features) ? plan.features : [],
    limits: {
      products: plan.limits?.products ?? null,
      staff: plan.limits?.staff ?? null,
    },
    capabilities: {
      aiAuthoring: Boolean(plan.capabilities?.aiAuthoring),
    },
    stripeProductId: plan.stripeProductId ?? null,
    stripePriceId: plan.stripePriceId ?? null,
  };
}

function cleanOptionalUrl(value: string | null | undefined) {
  return value && value.trim() ? value.trim() : undefined;
}

function cleanApplicationData(
  data: VendorApplicationPayload,
  onboardingConfig: OnboardingConfig,
): IVendorApplicationData {
  const cleanSocialLinks = data.socialLinks
    ? {
        website: cleanOptionalUrl(data.socialLinks.website),
        facebook: cleanOptionalUrl(data.socialLinks.facebook),
        instagram: cleanOptionalUrl(data.socialLinks.instagram),
        twitter: cleanOptionalUrl(data.socialLinks.twitter),
      }
    : undefined;
  const hasSocialLinks =
    cleanSocialLinks && Object.values(cleanSocialLinks).some(Boolean);

  const cleanAddress =
    data.address && Object.values(data.address).some(Boolean)
      ? {
          street: data.address.street || "",
          city: data.address.city || "",
          state: data.address.state || "",
          postalCode: data.address.postalCode || "",
          country: data.address.country || "",
          phone: data.address.phone || "",
        }
      : undefined;

  const cleanBankDetails =
    data.bankDetails && Object.values(data.bankDetails).some(Boolean)
      ? {
          accountName: data.bankDetails.accountName || "",
          accountNumber: data.bankDetails.accountNumber || "",
          bankName: data.bankDetails.bankName || "",
          routingNumber: data.bankDetails.routingNumber || "",
          swiftCode: data.bankDetails.swiftCode || "",
        }
      : undefined;

  const cleanDocuments = data.documents
    ? Object.fromEntries(
        Object.entries(data.documents).filter(([, value]) => Boolean(value)),
      )
    : undefined;
  const hasDocuments = cleanDocuments && Object.keys(cleanDocuments).length > 0;

  const cleanResponses = sanitizeOnboardingResponses(
    onboardingConfig,
    data.responses,
  );

  return {
    storeName: data.storeName.trim(),
    description: data.description.trim(),
    logo: cleanOptionalUrl(data.logo) ?? null,
    banner: cleanOptionalUrl(data.banner) ?? null,
    address: cleanAddress ?? null,
    socialLinks: hasSocialLinks ? cleanSocialLinks : null,
    bankDetails: cleanBankDetails ?? null,
    documents: hasDocuments ? cleanDocuments : null,
    responses:
      Object.keys(cleanResponses).length > 0 ? cleanResponses : undefined,
  };
}

async function resolveChosenVendorPlan(
  requestedPlanId: string | null | undefined,
  settings: ISettings,
): Promise<VendorPlanForApplication | null> {
  const plansOn =
    Boolean(settings.multiVendorMode?.enabled) &&
    Boolean(settings.vendorConfig?.plansEnabled);
  if (!plansOn) return null;

  const hasActivePlan = await VendorPlan.exists({ status: "active" });
  if (!hasActivePlan) return null;

  const loadActive = async (id: string) =>
    id && isValidObjectId(id)
      ? ((await VendorPlan.findOne({
          _id: id,
          status: "active",
        }).lean()) as VendorPlanForApplication | null)
      : null;

  const normalizedRequested =
    typeof requestedPlanId === "string" ? requestedPlanId : "";
  const defaultPlanId = settings.vendorConfig?.defaultPlanId || "";

  const chosenPlan =
    (await loadActive(normalizedRequested)) ?? (await loadActive(defaultPlanId));

  if (!chosenPlan && settings.vendorConfig?.requirePlanSelection) {
    throw new ValidationError({
      planId: ["Please choose a plan to continue"],
    });
  }

  return chosenPlan;
}

export async function prepareVendorApplication(
  data: VendorApplicationPayload,
  settings: ISettings,
): Promise<PreparedVendorApplication> {
  const onboardingConfig = await resolveOnboardingConfig();

  if (
    data.address?.country?.trim() &&
    !isCountryAllowed(
      data.address.country,
      settings.general?.countryAvailability,
    )
  ) {
    throw new ValidationError({
      country: ["Selected country is not available"],
    });
  }

  const violations = collectRequiredViolations(onboardingConfig, {
    storeName: data.storeName,
    description: data.description,
    address: data.address,
    documents: (data.documents ?? undefined) as Record<string, string> | undefined,
    responses: data.responses,
  });
  if (Object.keys(violations).length > 0) {
    throw new ValidationError(violations);
  }

  const chosenPlan = await resolveChosenVendorPlan(data.planId, settings);
  const planSnapshot = buildVendorApplicationPlanSnapshot(chosenPlan);

  return {
    onboardingConfig,
    applicationData: cleanApplicationData(data, onboardingConfig),
    chosenPlan,
    planSnapshot,
    requiresPayment: vendorPlanRequiresUpfrontPayment(chosenPlan),
  };
}

/**
 * Whether the applicant may still change and (re)submit the application.
 *
 * Rejected is deliberately in the list: a rejection is a review outcome, not
 * a ban. The applicant fixes what the reason names and submits the same row
 * again (`userId` is unique, so there is no second row to make). Anything
 * terminal for the *account* — fraud, abuse — is expressed by banning the
 * user, which closes every door at once rather than just this one.
 */
export function canEditVendorApplication(status?: string | null): boolean {
  return (
    !status ||
    status === VENDOR_APPLICATION_STATUS.DRAFT ||
    status === VENDOR_APPLICATION_STATUS.PAYMENT_PENDING ||
    status === VENDOR_APPLICATION_STATUS.PAID_PENDING_SUBMIT ||
    status === VENDOR_APPLICATION_STATUS.REJECTED
  );
}

/**
 * The payment status an application rests at the moment it is submitted.
 *
 * Three outcomes, and the difference between the last two matters: a free plan
 * owes nothing ever (`not_required`), while a trial plan owes its first period
 * the day the trial ends (`unpaid`) — which is one of the statuses
 * `/api/vendor/applications/checkout` accepts, so the same row can be paid
 * later without being rewritten.
 */
export function initialApplicationPaymentStatus(
  plan: Pick<
    VendorPlanForApplication,
    "price" | "billingInterval" | "trialDays"
  > | null,
): VendorApplicationPaymentStatus {
  if (vendorPlanRequiresUpfrontPayment(plan)) {
    return VENDOR_APPLICATION_PAYMENT_STATUS.PENDING;
  }
  if (vendorPlanStartsTrial(plan)) {
    return VENDOR_APPLICATION_PAYMENT_STATUS.UNPAID;
  }
  return VENDOR_APPLICATION_PAYMENT_STATUS.NOT_REQUIRED;
}

