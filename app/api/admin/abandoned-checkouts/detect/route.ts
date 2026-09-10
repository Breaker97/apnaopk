import { Cart } from "@/models";
import { successResponse } from "@/lib/api/response";
import {
  ensureCheckoutToken,
  getCheckoutSubtotal,
  upsertAbandonedCheckoutSnapshot,
} from "@/lib/orders/abandoned-checkouts";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

const DetectCheckoutsSchema = z.object({
  minutes: z.number().optional(),
  locale: z.string().max(10).optional(),
});

export const POST = withApi(
  { auth: "admin" },
  async ({ request }) => {
    const body = await validateOptionalBody(request, DetectCheckoutsSchema);
    const minutes = typeof body.minutes === "number" ? body.minutes : 10;
    const threshold = new Date(Date.now() - minutes * 60 * 1000);
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const candidates = await Cart.find({
      status: "active",
      checkoutStartedAt: { $lte: threshold },
      lastActionAt: { $lte: threshold },
      "items.0": { $exists: true },
      $or: [
        { email: { $exists: true, $ne: "" } },
        { phone: { $exists: true, $ne: "" } },
      ],
    }).limit(250);

    for (const cart of candidates) {
      ensureCheckoutToken(cart, { origin, locale: body.locale || cart.customerLocale || "en" });
      cart.status = "abandoned";
      cart.recoveryStatus = cart.recoveryStatus || "not_recovered";
      cart.recoveryEmailStatus = cart.recoveryEmailStatus || "not_sent";
      cart.abandonedAt = cart.abandonedAt || new Date();
      cart.subtotalPrice = cart.subtotalPrice ?? getCheckoutSubtotal(cart);
      cart.totalPrice = cart.totalPrice ?? cart.subtotalPrice;
      await cart.save();
      await upsertAbandonedCheckoutSnapshot(cart, {
        abandonedAt: cart.abandonedAt,
        status: "open",
      });
    }

    return successResponse(
      { matched: candidates.length, modified: candidates.length },
      "Abandoned checkouts marked",
    );
  },
);
