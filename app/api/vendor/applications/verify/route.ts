import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { AuthenticationError, handleApiError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { verifyVendorCheckoutSession } from "@/lib/vendors/vendor-stripe-billing";
import { verifyPlatformPayment } from "@/lib/payments/platform-payments";
import { PlatformPayment, VendorApplication } from "@/models";
import { PLATFORM_PAYMENT_KIND, USER_ROLES } from "@/config/app.config";

async function resolveApplicant() {
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
  return session;
}

/**
 * GET /api/vendor/applications/verify?session_id=cs_...
 * Local/dev fallback for Stripe Checkout when webhooks are delayed.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await resolveApplicant();
    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:application:verify",
      "moderate",
      session.user.role,
    );

    const sessionId = request.nextUrl.searchParams.get("session_id");
    const platformPaymentId =
      request.nextUrl.searchParams.get("platform_payment");
    if (!sessionId && !platformPaymentId) {
      return NextResponse.json(
        { success: false, message: "Session ID required" },
        { status: 400 },
      );
    }

    await connectDB();
    const settings = await getSettings();

    // Non-Stripe gateways return with our PlatformPayment id instead of a
    // Stripe session — same webhook-delay fallback, different rail.
    if (platformPaymentId && !sessionId) {
      const payment = await PlatformPayment.findOne({
        _id: platformPaymentId,
        kind: PLATFORM_PAYMENT_KIND.SUBSCRIPTION,
        userId: session.user.id,
      });
      if (!payment) {
        return NextResponse.json(
          { success: false, message: "Vendor application payment not found" },
          { status: 404 },
        );
      }
      const { paid } = await verifyPlatformPayment(payment, settings);
      const application = payment.applicationId
        ? await VendorApplication.findById(payment.applicationId)
            .select("status paymentStatus")
            .lean<{
              _id: unknown;
              status?: string;
              paymentStatus?: string;
            } | null>()
        : null;
      return successResponse({
        applicationId: application ? String(application._id) : null,
        status: application?.status ?? null,
        // Renewals carry no application; `paid` is the authoritative signal.
        paymentStatus: application?.paymentStatus ?? (paid ? "paid" : null),
        paid,
      });
    }

    const application = await verifyVendorCheckoutSession(
      sessionId as string,
      settings,
      session.user.id,
    );
    if (!application || String(application.userId) !== session.user.id) {
      return NextResponse.json(
        { success: false, message: "Vendor application payment not found" },
        { status: 404 },
      );
    }

    return successResponse({
      applicationId: String(application._id),
      status: application.status,
      paymentStatus: application.paymentStatus,
    });
  } catch (error) {
    console.error("Vendor application verify error:", error);
    return handleApiError(error);
  }
}
