import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { getSettings } from "@/models/settings.model";
import { resolveAddressHoldSettings } from "@/lib/orders/address-hold-policy";
import { verifyDeliveryAddress } from "@/lib/shipping/address-verification";

const BodySchema = z.object({
  address: z.object({
    street: z.string().trim().max(200),
    apartment: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100),
    state: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: z.string().trim().max(100),
  }),
});

/**
 * POST /api/checkout/address-check
 *
 * "Did you mean…" before an order is placed. Advice only — the shopper can
 * always keep what they typed — and only when the store turned it on and a
 * carrier is connected to ask. Anything the check can't decide is `unknown`,
 * which checkout treats as fine.
 */
export const POST = withApi(
  {
    auth: "optional",
    rateLimit: { action: "checkout:address-check", preset: "moderate" },
  },
  async ({ request }) => {
    const { address } = await validateBody(request, BodySchema);
    const settings = await getSettings();
    const config = resolveAddressHoldSettings(settings.shipping?.addressHold);
    if (!config.suggestAtCheckout) {
      return successResponse({ verdict: "unknown", messages: [] });
    }

    const verification = await verifyDeliveryAddress(address, { settings });
    // The free format layer is already enforced by the checkout form itself;
    // only a carrier's verdict is worth interrupting a shopper for.
    if (verification.checkedWith !== "carrier") {
      return successResponse({ verdict: "unknown", messages: [] });
    }
    return successResponse(verification);
  },
);
