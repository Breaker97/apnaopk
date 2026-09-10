import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { Vendor, VendorSubscription } from "@/models";
import { getSettings } from "@/models/settings.model";
import { validateBody } from "@/lib/api/validate";
import {
  AuthenticationError,
  NotFoundError,
  ValidationError,
  handleApiError,
} from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { assertStripeBillingReady } from "@/lib/vendors/vendor-plan-stripe";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import { VENDOR_STATUS } from "@/config/app.config";

const PortalBodySchema = z.object({
  locale: z.string().min(2).max(12).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    await connectDB();

    const vendor = await Vendor.findOne({
      userId: session.user.id,
      status: VENDOR_STATUS.APPROVED,
    })
      .select("_id stripeCustomerId")
      .lean<{ _id: unknown; stripeCustomerId?: string | null } | null>();
    if (!vendor) throw new NotFoundError("Vendor");

    const subscription = await VendorSubscription.findOne({
      vendorId: String(vendor._id),
      provider: "stripe",
      stripeCustomerId: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .select("stripeCustomerId")
      .lean<{ stripeCustomerId?: string | null } | null>();
    const customerId =
      subscription?.stripeCustomerId || vendor.stripeCustomerId;
    if (!customerId) {
      throw new ValidationError("Stripe billing account not found");
    }

    const body = await validateBody(request, PortalBodySchema);
    const settings = await getSettings();
    const stripe = getStripeForSecretKey(assertStripeBillingReady(settings));
    const origin = (
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000"
    ).replace(/\/$/, "");
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/${body.locale || "en"}/vendor/dashboard`,
    });

    return successResponse({ url: portal.url });
  } catch (error) {
    console.error("Vendor billing portal error:", error);
    return handleApiError(error);
  }
}
