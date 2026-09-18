import { connectDB } from "@/lib/db";
import { Cart } from "@/models";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { updateCheckoutSnapshot } from "@/lib/orders/abandoned-checkouts";
import type { Address } from "@/types";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";
import { getSettingsLean } from "@/models/settings.model";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";

type TrackCheckoutBody = {
  locale?: string;
  email?: string;
  phone?: string;
  customerName?: string;
  buyerAcceptsMarketing?: boolean;
  shippingAddress?: Address;
  billingAddress?: TrackCheckoutBody["shippingAddress"];
  subtotalPrice?: number;
  shippingPrice?: number;
  totalTax?: number;
  totalDiscounts?: number;
  totalPrice?: number;
  presentmentCurrency?: string;
};

const isOptionalObject = (value: unknown) =>
  value === undefined || (typeof value === "object" && value !== null);
// Best-effort tracker: every field optional, addresses may be partial.
const TrackCheckoutSchema = z.object({
  locale: z.string().max(10).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
  customerName: z.string().max(200).optional(),
  buyerAcceptsMarketing: z.boolean().optional(),
  shippingAddress: z.custom<TrackCheckoutBody["shippingAddress"]>(isOptionalObject).optional(),
  billingAddress: z.custom<TrackCheckoutBody["billingAddress"]>(isOptionalObject).optional(),
  subtotalPrice: z.number().optional(),
  shippingPrice: z.number().optional(),
  totalTax: z.number().optional(),
  totalDiscounts: z.number().optional(),
  totalPrice: z.number().optional(),
  presentmentCurrency: z.string().max(10).optional(),
});

export const PATCH = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "checkout:abandoned-track",
        "moderate",
        session.user.role,
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "checkout:abandoned-track",
        "moderate",
      );
    } else {
      await rateLimitByIP(request, "moderate");
    }

    await connectDB();

    // Switched off in the checkout settings: nothing is recorded. The storefront
    // stops calling once it has the setting; this covers an open tab.
    const settings = await getSettingsLean();
    if (!normalizeCheckoutSettings(settings.checkout).abandonedCheckouts.enabled) {
      return successResponse({ tracked: false });
    }

    const cartQuery = session?.user?.id
      ? { userId: session.user.id }
      : cartSessionId
        ? { sessionId: cartSessionId }
        : null;

    if (!cartQuery) {
      throw new ValidationError({ cart: ["Cart is empty"] });
    }

    const cart = await Cart.findOne(cartQuery);
    if (!cart || !cart.items?.length) {
      throw new ValidationError({ cart: ["Cart is empty"] });
    }

    const body: TrackCheckoutBody = await validateOptionalBody(
      request,
      TrackCheckoutSchema,
    );
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    await updateCheckoutSnapshot(cart, {
      origin,
      locale: body.locale || "en",
      email: body.email || session?.user?.email,
      phone: body.phone,
      customerName: body.customerName || session?.user?.name,
      customerLocale: body.locale,
      buyerAcceptsMarketing: body.buyerAcceptsMarketing,
      shippingAddress: body.shippingAddress,
      billingAddress: body.billingAddress,
      sourceName: "online_store",
      landingSite: request.headers.get("referer") || undefined,
      subtotalPrice: body.subtotalPrice,
      shippingPrice: body.shippingPrice,
      totalTax: body.totalTax,
      totalDiscounts: body.totalDiscounts,
      totalPrice: body.totalPrice,
      presentmentCurrency: body.presentmentCurrency,
    });

    return successResponse({
      checkoutId: String(cart._id),
      checkoutUrl: cart.checkoutUrl,
    });
  },
);
