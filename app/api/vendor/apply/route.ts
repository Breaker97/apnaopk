import { connectDB } from "@/lib/db";
import { User, Vendor, VendorApplication, VendorSubscription } from "@/models";
import { NextRequest } from "next/server";
import {
  handleApiError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  USER_ROLES,
  VENDOR_APPLICATION_STATUS,
  VENDOR_SUBSCRIPTION_TERMS_VERSION,
  VENDOR_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";
import { createdResponse } from "@/lib/api/response";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { buildSubscriptionForPlan } from "@/lib/vendors/vendor-subscriptions";
import {
  sendAdminNewVendorApplicationEmail,
  sendVendorApplicationPendingEmail,
} from "@/lib/email/vendor-emails";
import { notifyAdminVendorApplicationPending } from "@/lib/notifications/notifications";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { assertStorefrontWriteAllowed } from "@/lib/maintenance";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import {
  canEditVendorApplication,
  initialApplicationPaymentStatus,
  prepareVendorApplication,
  VENDOR_APPLICATION_LATEST_SORT,
  VendorApplicationPayloadSchema,
} from "@/lib/vendors/vendor-application";

/**
 * POST /api/vendor/apply
 * Submit vendor application
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getRegistrationSession({
      headers: await headers(),
    });
    if (!session) throw new AuthenticationError();
    if (
      session.user.emailVerificationStatus === "blocked_pending" &&
      session.user.emailVerificationAudience !== USER_ROLES.VENDOR
    ) {
      throw new AuthenticationError();
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:apply:submit",
      "moderate",
      session.user.role
    );

    await connectDB();
    const settings = await getSettings();
    assertStorefrontWriteAllowed(settings.maintenance, settings.general?.storeName);
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    if (!settings.vendorConfig?.allowRegistration) {
      throw new ValidationError("Vendor registration is currently closed");
    }

    // One Vendor per user (`userId` is unique). A rejected one is the single
    // case that may come back through here: the applicant fixes what the
    // rejection named and submits again, and the same row returns to
    // pending. Anything else that exists — pending, approved, suspended — is
    // a live or under-review store, not something to re-create.
    const existingVendor = await Vendor.findOne({ userId: session.user.id });
    const isReapplication =
      existingVendor?.status === VENDOR_STATUS.REJECTED;
    if (existingVendor && !isReapplication) {
      throw new ValidationError({
        general: ["You already have a vendor application"],
      });
    }

    const validatedData = await validateBody(
      request,
      VendorApplicationPayloadSchema,
    );
    const prepared = await prepareVendorApplication(validatedData, settings);
    const appData = prepared.applicationData;
    if (prepared.planSnapshot) {
      prepared.planSnapshot.currency = String(
        prepared.chosenPlan?.stripePriceCurrency ||
          settings.general?.defaultCurrency ||
          "USD",
      ).toUpperCase();
    }

    // Generate slug from store name
    const slug = appData.storeName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    // Check for existing slug and make it unique. A re-applicant's own row is
    // not a collision — a store keeping its name keeps its slug.
    const existingSlug = await Vendor.findOne({
      slug,
      ...(existingVendor ? { _id: { $ne: existingVendor._id } } : {}),
    });
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    let application = await VendorApplication.findOne({
      userId: session.user.id,
    }).sort(VENDOR_APPLICATION_LATEST_SORT);
    if (application && !canEditVendorApplication(application.status)) {
      throw new ValidationError("This vendor application has already been submitted");
    }

    application =
      application ??
      (await VendorApplication.create({
        userId: session.user.id,
        applicationData: appData,
        status: VENDOR_APPLICATION_STATUS.DRAFT,
        paymentStatus: initialApplicationPaymentStatus(prepared.chosenPlan),
      }));
    const wasRejected =
      application.status === VENDOR_APPLICATION_STATUS.REJECTED;

    // Create — or, for a re-application, reset — the vendor profile with
    // pending status. Commission is projected from the chosen plan (or the
    // settings/default when none) via the single authority; planId records
    // provenance. Store stays inactive until admin approval. Paid plans remain
    // financially inactive until admin verification creates a seven-day
    // payment invitation.
    const vendorFields = {
      storeName: appData.storeName,
      slug: finalSlug,
      description: appData.description,
      logo: appData.logo || undefined,
      banner: appData.banner || undefined,
      status: VENDOR_STATUS.PENDING,
      storeActive: false,
      commission: resolveVendorCommission(null, prepared.chosenPlan, settings),
      commissionSource: prepared.chosenPlan
        ? ("plan" as const)
        : ("default" as const),
      planId: prepared.chosenPlan?._id ?? undefined,
      // On the derived access model with no deviations: whatever their chosen
      // plan sells, or the commission-only baseline when they picked none.
      //
      // This has to be written explicitly. `Vendor.permissions` still defaults
      // to the full 48-string list, and an ABSENT override array is what makes
      // resolveVendorAccess fall back to that list — which would hand every
      // self-registering vendor everything and defeat plan gating entirely.
      permissionOverrides: [],
      stripeCustomerId: application?.stripeCustomerId ?? undefined,
      address: appData.address || undefined,
      documents: appData.documents || undefined,
      onboardingResponses: appData.responses || undefined,
      socialLinks: appData.socialLinks || undefined,
      bankDetails: appData.bankDetails || undefined,
    };
    let vendor;
    if (existingVendor) {
      // Mongoose drops `undefined` from `$set`, so anything the new submission
      // no longer carries has to be unset explicitly — otherwise the rejected
      // attempt's values survive underneath the new ones.
      const setFields: Record<string, unknown> = {};
      const unsetFields: Record<string, ""> = {};
      for (const [key, value] of Object.entries(vendorFields)) {
        if (value === undefined) unsetFields[key] = "";
        else setFields[key] = value;
      }
      vendor = await Vendor.findByIdAndUpdate(
        existingVendor._id,
        {
          $set: setFields,
          ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
        },
        { returnDocument: "after" },
      );
      if (!vendor) throw new NotFoundError("Vendor");

      // The rejected attempt's subscription is still on the row — a free plan
      // activates at apply time and nothing cancels it on rejection — and it
      // would collide with the one-active-slot index the moment a new one is
      // written.
      await VendorSubscription.updateMany(
        {
          vendorId: vendor._id,
          status: {
            $in: [
              VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
              ...ACTIVE_SUBSCRIPTION_STATUSES,
            ],
          },
        },
        {
          $set: {
            status: VENDOR_SUBSCRIPTION_STATUS.CANCELLED,
            occupiesActiveSlot: false,
            providerStatus: "superseded_by_reapplication",
          },
        },
      );
    } else {
      vendor = await Vendor.create({
        userId: session.user.id,
        ...vendorFields,
      });
    }

      if (prepared.chosenPlan) {
        try {
          const subscriptionPayload: Record<string, unknown> =
            buildSubscriptionForPlan(
              vendor._id,
              prepared.chosenPlan,
              session.user.id,
              {
                activationMode: prepared.requiresPayment ? "auto" : undefined,
                // Must match the application snapshot resolved above, or the
                // first period and every renewal disagree on the currency.
                storeCurrency: settings.general?.defaultCurrency,
              },
            );
          if (prepared.requiresPayment) {
            Object.assign(subscriptionPayload, {
              status: VENDOR_SUBSCRIPTION_STATUS.INCOMPLETE,
              trialStart: null,
              trialEnd: null,
              currentPeriodStart: null,
              currentPeriodEnd: null,
              occupiesActiveSlot: false,
              provider: "stripe",
              paymentProviderRef: null,
              lastPaymentAt: null,
              providerStatus: "not_started",
            });
          }
          Object.assign(subscriptionPayload, {
            applicationId: application._id,
          });
          await VendorSubscription.create(subscriptionPayload);
        } catch (subError) {
          // A first attempt leaves nothing behind; a re-application returns
          // the row to the rejected state it came from rather than deleting a
          // record the admin's review history points at.
          const rollback = isReapplication
            ? Vendor.updateOne(
                { _id: vendor._id },
                { $set: { status: VENDOR_STATUS.REJECTED, storeActive: false } },
              )
            : Vendor.deleteOne({ _id: vendor._id });
          await rollback.catch((rollbackError) =>
            console.error(
              "Failed to roll back vendor after subscription failure",
              rollbackError,
            ),
          );
          throw subError;
        }
    }

    if (wasRejected) {
      // Everything the previous attempt accumulated on the row, except the
      // Stripe customer (reusable). The new submission starts its review and
      // billing clocks from zero.
      application.rejectedAt = null;
      application.rejectionReason = null;
      application.approvedAt = null;
      application.paymentExpiredAt = null;
      application.setupAccessExpiredAt = null;
      application.trialEndedAt = null;
      application.paymentReminder3SentAt = null;
      application.paymentReminder6SentAt = null;
      application.activationNotifiedAt = null;
      application.refundedAt = null;
      application.paymentCompletedAt = null;
      application.checkoutExpiresAt = null;
      application.stripeCheckoutSessionId = null;
      application.stripeSubscriptionId = null;
      application.stripeLatestInvoiceId = null;
      application.stripePaymentIntentId = null;
      application.stripeProviderStatus = null;
    }

    application.vendorId = vendor._id;
    application.applicationData = appData;
    application.set("planId", prepared.chosenPlan?._id ?? null);
    application.planSnapshot = prepared.planSnapshot;
    application.status = VENDOR_APPLICATION_STATUS.SUBMITTED;
    application.paymentStatus = initialApplicationPaymentStatus(
      prepared.chosenPlan,
    );
    application.submittedAt = new Date();
    application.termsAcceptedAt = new Date();
    application.termsVersion = VENDOR_SUBSCRIPTION_TERMS_VERSION;
    application.termsAcceptedIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      null;
    application.termsAcceptedUserAgent =
      request.headers.get("user-agent") || null;
    application.paymentDueAt = null;
    application.lastError = null;
    await application.save();

    await User.updateOne(
      { _id: session.user.id },
      {
        $set: {
          emailVerificationAudience: USER_ROLES.VENDOR,
          updatedAt: new Date(),
        },
        // The application is now a real Vendor; drop the resumable draft.
        $unset: { vendorOnboarding: "" },
      },
    );

    const adminUsers = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
    })
      .select("_id email")
      .lean();
    const adminEmails = [
      ...adminUsers.map((user) => String(user.email || "")),
      settings.general?.storeEmail || "",
    ];
    const notificationSettings = normalizeNotificationSettings(
      settings.notifications,
    );
    const adminVendorChannels = notificationSettings.admin.newVendors;
    const vendorApplicationChannels =
      notificationSettings.vendor.applicationStatus;

    await Promise.all([
      vendorApplicationChannels.email && session.user.email
        ? sendVendorApplicationPendingEmail({
            vendorEmail: session.user.email,
            vendorName: session.user.name,
            storeName: vendor.storeName,
            settings,
          })
        : Promise.resolve(false),
      adminVendorChannels.email
        ? sendAdminNewVendorApplicationEmail({
            adminEmails,
            vendorEmail: session.user.email,
            vendorName: session.user.name,
            storeName: vendor.storeName,
            settings,
          })
        : Promise.resolve(false),
      ...adminUsers.map((admin) =>
        notifyAdminVendorApplicationPending(
          String(admin._id),
          {
            vendorId: String(vendor._id),
            storeName: vendor.storeName,
            vendorEmail: session.user.email,
            vendorName: session.user.name,
            submittedAt: application.submittedAt ?? undefined,
          },
          { settings, channels: adminVendorChannels },
        ),
      ),
    ]);

    return createdResponse({
      message: "Vendor application submitted successfully",
      vendor,
    });
  } catch (error) {
    console.error("Vendor application error:", error);
    return handleApiError(error);
  }
}
