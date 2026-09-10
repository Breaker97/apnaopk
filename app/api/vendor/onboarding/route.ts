/**
 * Vendor onboarding draft — resumable progress for the become-a-vendor wizard.
 *
 * Draft data lives on the User (User.vendorOnboarding) rather than on a Vendor
 * document, so an unfinished application never creates a half-formed Vendor
 * row. A real Vendor is only created when the applicant submits via
 * /api/vendor/apply, at which point the draft is cleared.
 *
 * Auth mirrors the sibling apply/documents routes: getRegistrationSession, so
 * an applicant who just signed up (and is therefore still pending email
 * verification) can save and resume their progress.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { User, Vendor, VendorApplication } from "@/models";
import {
  USER_ROLES,
  VENDOR_APPLICATION_STATUS,
  VENDOR_STATUS,
} from "@/config/app.config";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { VENDOR_APPLICATION_LATEST_SORT } from "@/lib/vendors/vendor-application";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import { vendorDocumentReferenceSchema } from "@/lib/vendors/vendor-documents";

const unauthorized = () =>
  NextResponse.json(
    { success: false, message: "Authentication required" },
    { status: 401 },
  );

async function resolveApplicant() {
  const session = await auth.api.getRegistrationSession({
    headers: await headers(),
  });
  if (!session) return null;
  if (
    session.user.emailVerificationStatus === "blocked_pending" &&
    session.user.emailVerificationAudience !== USER_ROLES.VENDOR
  ) {
    return null;
  }
  return session;
}

const OnboardingDraftSchema = z.object({
  // Numeric step kept for back-compat; the wizard now drives by stepKey. Range
  // widened to 4 for the added subscription step.
  step: z.number().int().min(1).max(4).optional(),
  stepKey: z.string().max(24).optional(),
  plan: z
    .object({
      planId: z.string().max(48).optional().or(z.literal("")),
      billingInterval: z.enum(["monthly", "yearly", "none"]).optional(),
      startTrial: z.boolean().optional(),
    })
    .optional(),
  storeName: z.string().max(100).optional(),
  description: z.string().max(1000).optional(),
  country: z.string().max(4).optional(),
  state: z.string().max(8).optional(),
  city: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  pincode: z.string().max(24).optional(),
  phone: z.string().max(20).optional(),
  phoneCode: z.string().max(8).optional(),
  documents: z
    .object({
      businessLicense: vendorDocumentReferenceSchema(
        "Business license must be an uploaded document",
      ),
      taxId: z.string().max(60).optional(),
      taxCertificate: vendorDocumentReferenceSchema(
        "Tax certificate must be an uploaded document",
      ),
      governmentId: vendorDocumentReferenceSchema(
        "Government ID must be an uploaded document",
      ),
    })
    .optional(),
  // Answers to admin-defined custom onboarding fields, keyed by field key.
  responses: z
    .record(z.string(), z.union([z.string(), z.boolean()]))
    .optional(),
});

type LeanVendorApplication = {
  _id: unknown;
  status?: string;
  rejectionReason?: string | null;
  paymentStatus?: string;
  planId?: unknown;
  planSnapshot?: {
    billingInterval?: "monthly" | "yearly" | "none";
    trialDays?: number;
  } | null;
  stripeCheckoutSessionId?: string | null;
  applicationData?: {
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
    responses?: Record<string, { value?: string | boolean }> | null;
  };
};

function applicationToDraft(application: LeanVendorApplication) {
  const data = application.applicationData || {};
  const address = data.address || {};
  const responses = Object.fromEntries(
    Object.entries(data.responses || {}).map(([key, value]) => [
      key,
      value?.value ?? "",
    ]),
  );

  return {
    stepKey:
      application.status === VENDOR_APPLICATION_STATUS.PAID_PENDING_SUBMIT
        ? "review"
        : "subscription",
    plan: {
      planId: application.planId ? String(application.planId) : "",
      billingInterval: application.planSnapshot?.billingInterval ?? "none",
      startTrial: Boolean(
        application.planSnapshot?.billingInterval !== "none" &&
          (application.planSnapshot?.trialDays ?? 0) > 0,
      ),
    },
    storeName: data.storeName || "",
    description: data.description || "",
    country: address.country || "",
    state: address.state || "",
    city: address.city || "",
    address: address.street || "",
    pincode: address.postalCode || "",
    phone: address.phone || "",
    documents: data.documents || {},
    responses,
  };
}

/**
 * GET /api/vendor/onboarding
 * Returns the saved draft (or null) for the current applicant. `hasApplication`
 * signals that a real Vendor already exists, so the wizard should show status
 * instead of resuming.
 */
export async function GET() {
  try {
    const session = await resolveApplicant();
    if (!session) return unauthorized();

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) {
      return NextResponse.json(
        { success: false, message: "Not found" },
        { status: 404 },
      );
    }

    // Doubles as the wizard's status source: unlike GET /api/vendor/apply
    // (which uses the strict session and 401s while the applicant is pending
    // email verification), this route reads the registration session, so a
    // freshly-registered vendor can still see their pending status on reload.
    const existingVendor = await Vendor.findOne({ userId: session.user.id })
      .select("status")
      .lean<{ status?: string } | null>();
    if (existingVendor) {
      const rejected = existingVendor.status === VENDOR_STATUS.REJECTED;
      // A rejected applicant gets the review's reason and their last
      // submission back as a draft, so "apply again" opens the wizard on what
      // they sent rather than on a blank form. A draft saved since — an edit
      // in progress — wins over the submission it is revising.
      const [application, user] = rejected
        ? await Promise.all([
            VendorApplication.findOne({ userId: session.user.id })
              .sort(VENDOR_APPLICATION_LATEST_SORT)
              .lean<LeanVendorApplication | null>(),
            User.findById(session.user.id)
              .select("vendorOnboarding")
              .lean<{ vendorOnboarding?: unknown } | null>(),
          ])
        : [null, null];
      return NextResponse.json({
        success: true,
        data: {
          hasApplication: true,
          status: existingVendor.status ?? null,
          canReapply: rejected,
          rejectionReason: rejected
            ? (application?.rejectionReason ?? null)
            : null,
          draft: rejected
            ? (user?.vendorOnboarding ??
              (application
                ? // Re-applicants walk the whole wizard from the first step.
                  { ...applicationToDraft(application), stepKey: undefined }
                : null))
            : null,
        },
      });
    }

    const application = await VendorApplication.findOne({
      userId: session.user.id,
    })
      .sort(VENDOR_APPLICATION_LATEST_SORT)
      .lean<LeanVendorApplication | null>();
    if (application) {
      return NextResponse.json({
        success: true,
        data: {
          hasApplication: false,
          draft: applicationToDraft(application),
          application: {
            id: String(application._id),
            status: application.status ?? null,
            paymentStatus: application.paymentStatus ?? null,
            planId: application.planId ? String(application.planId) : null,
            stripeCheckoutSessionId:
              application.stripeCheckoutSessionId ?? null,
          },
        },
      });
    }

    const user = await User.findById(session.user.id)
      .select("vendorOnboarding")
      .lean<{ vendorOnboarding?: unknown } | null>();

    return NextResponse.json({
      success: true,
      data: { hasApplication: false, draft: user?.vendorOnboarding ?? null },
    });
  } catch (error) {
    console.error("Vendor onboarding GET error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to load onboarding draft" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/vendor/onboarding
 * Saves partial wizard progress. No-op once a real application exists.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await resolveApplicant();
    if (!session) return unauthorized();

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:onboarding:save",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) {
      return NextResponse.json(
        { success: false, message: "Not found" },
        { status: 404 },
      );
    }

    // Never overwrite a submitted application's data with wizard drafts. A
    // rejected one is no longer under review — its owner is editing it to
    // apply again, and this draft is that edit.
    const existingVendor = await Vendor.findOne({ userId: session.user.id })
      .select("status")
      .lean<{ status?: string } | null>();
    if (existingVendor && existingVendor.status !== VENDOR_STATUS.REJECTED) {
      return NextResponse.json(
        { success: false, message: "You already have a vendor application" },
        { status: 400 },
      );
    }

    const submittedApplication = await VendorApplication.exists({
      userId: session.user.id,
      status: {
        $in: [
          VENDOR_APPLICATION_STATUS.SUBMITTED,
          VENDOR_APPLICATION_STATUS.APPROVED,
          VENDOR_APPLICATION_STATUS.REFUNDED,
        ],
      },
    });
    if (submittedApplication) {
      return NextResponse.json(
        { success: false, message: "You already have a vendor application" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const parsed = OnboardingDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Invalid draft data" },
        { status: 400 },
      );
    }

    if (
      parsed.data.country?.trim() &&
      !isCountryAllowed(
        parsed.data.country,
        settings.general?.countryAvailability,
      )
    ) {
      return NextResponse.json(
        { success: false, message: "Selected country is not available" },
        { status: 400 },
      );
    }

    await User.updateOne(
      { _id: session.user.id },
      {
        $set: {
          vendorOnboarding: { ...parsed.data, updatedAt: new Date() },
        },
      },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Vendor onboarding PUT error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save onboarding draft" },
      { status: 500 },
    );
  }
}
