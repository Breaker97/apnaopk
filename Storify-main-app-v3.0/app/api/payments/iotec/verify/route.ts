import { NextResponse } from "next/server";
import { getSettings } from "@/models/settings.model";
import { verifyIotecOrderPayment } from "@/lib/payments/iotec-verify";
import { isPlatformPaymentReference } from "@/models/platformPayment.model";
import {
  findPlatformPaymentByReference,
  verifyPlatformPayment,
} from "@/lib/payments/platform-payments";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";
import { validateBody } from "@/lib/api/validate";

const IotecVerifySchema = z.object({
  transactionId: z.string().max(500).optional(),
  externalId: z.string().max(500).optional(),
});

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    // Mobile-money payers approve on their phone, so the success page polls
    // this route ~30 times before giving up. "moderate" (20 per 15 min) would
    // cut that short with a 429 the client reads as a failed payment.
    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:iotec-verify",
        "lenient",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:iotec-verify",
        "lenient",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      await rateLimitByIP(request, "lenient");
    }

    const body = await validateBody(request, IotecVerifySchema);
    const transactionId = String(body?.transactionId || "").trim();
    const externalId = String(body?.externalId || "").trim();
    if (transactionId.length > 100 || externalId.length > 100) {
      throw new ValidationError("Invalid ioTec reference");
    }
    // Card payments redirect back with only the external reference (the
    // transaction id is not in the return URL), so either identifier works.
    if (!transactionId && !externalId) {
      throw new ValidationError("ioTec transaction ID is required");
    }

    // Vendor→platform payments (boosts, subscriptions) share the gateway;
    // their prefix-marked external references never exist on an Order.
    if (externalId && isPlatformPaymentReference(externalId)) {
      const platformPayment = await findPlatformPaymentByReference(externalId);
      if (!platformPayment) {
        throw new ValidationError("Unknown ioTec reference");
      }
      const settings = await getSettings();
      const { paid } = await verifyPlatformPayment(platformPayment, settings);
      return NextResponse.json({
        success: true,
        data: { platformPayment: true, paid },
      });
    }

    // See lib/payments/iotec-verify.ts.
    const data = await verifyIotecOrderPayment({
      transactionId,
      externalId,
      customerId: session?.user?.id,
      cartSessionId,
      customerEmail: session?.user?.email,
    });
    return NextResponse.json({ success: true, data });
  },
);
