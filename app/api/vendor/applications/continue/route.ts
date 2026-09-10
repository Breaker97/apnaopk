import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { AuthenticationError, ValidationError, handleApiError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { Vendor, VendorApplication } from "@/models";
import {
  remainingSetupAccessSeconds,
  resolveVendorPaymentAccess,
  VENDOR_SETUP_ACCESS_COOKIE,
} from "@/lib/vendors/vendor-payment-access";
import {
  VENDOR_APPLICATION_LATEST_SORT,
  vendorApplicationLookupQuery,
} from "@/lib/vendors/vendor-application";

/**
 * POST /api/vendor/applications/continue
 * Remembers that the approved vendor chose to use their restricted setup
 * dashboard. The server still checks the application deadline on every page.
 */
export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();

    await connectDB();
    const vendor = await Vendor.findOne({ userId: session.user.id })
      .select("_id status")
      .lean();
    if (!vendor) throw new ValidationError("Vendor profile not found");

    const application = await VendorApplication.findOne(
      vendorApplicationLookupQuery({
        vendorId: vendor._id,
        userId: session.user.id,
      }),
    )
      .sort(VENDOR_APPLICATION_LATEST_SORT)
      .select("status paymentDueAt")
      .lean<{ status?: string; paymentDueAt?: Date | null } | null>();
    const accessMode = resolveVendorPaymentAccess({
      vendorStatus: vendor.status,
      applicationStatus: application?.status,
      paymentDueAt: application?.paymentDueAt,
    });
    if (accessMode !== "setup" || !application?.paymentDueAt) {
      throw new ValidationError(
        "Your seven-day setup access has ended. Complete subscription payment to reactivate your dashboard.",
      );
    }

    const response = successResponse({ continued: true });
    response.cookies.set(
      VENDOR_SETUP_ACCESS_COOKIE,
      String(vendor._id),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: remainingSetupAccessSeconds(application.paymentDueAt),
      },
    );
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
