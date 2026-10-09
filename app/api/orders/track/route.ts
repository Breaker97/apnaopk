import { successResponse, notFoundResponse } from "@/lib/api/response";
import { RateLimitError, ValidationError } from "@/lib/api/errors";
import { resolveClientIp } from "@/lib/api/client-ip";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  rateLimitByIP,
} from "@/lib/api/rate-limit-middleware";
import { rateLimitMessage } from "@/lib/api/rate-limit-message";
import { withApi } from "@/lib/api/handler";
import { validateOptionalBody } from "@/lib/api/validate";
import { TrackOrderBodySchema } from "@/lib/validations";
import {
  buildGuestTrackingView,
  lookUpGuestOrder,
} from "@/lib/orders/guest-order-tracking";

export const POST = withApi(
  {},
  async ({ request }) => {
    // Public, unauthenticated endpoint. Each order is held to a strict limit
    // per address (lib/orders/guest-order-tracking.ts) — guessing one
    // customer's contact details — and the address to ten times that, for
    // sweeping many orders. A household or a carrier's shared address
    // tracking different orders no longer shares five lookups in all.
    await rateLimitByIP(request, "strict", SHOPPING_ADDRESS_ALLOWANCE);

    // An empty or malformed body is routine on a public endpoint — a bot POSTs
    // to it, or the form submits before hydration — and `request.json()` throws
    // an unhandled SyntaxError rather than reporting it. Same answer as a body
    // that parsed but named nothing.
    const body = await validateOptionalBody(request, TrackOrderBodySchema);
    const lookup = await lookUpGuestOrder({
      orderNumber: body.orderNumber || body.orderId || "",
      contact: body.identifier || "",
      ip: resolveClientIp(request.headers) ?? undefined,
    });

    switch (lookup.kind) {
      case "rate_limited":
        throw new RateLimitError(
          await rateLimitMessage(request, lookup.retryAfter),
          lookup.retryAfter,
        );
      case "incomplete":
        throw new ValidationError("Order number and email or phone are required");
      case "not_found":
        return notFoundResponse("Order");
      case "found":
        return successResponse(await buildGuestTrackingView(lookup.order));
    }
  },
);
