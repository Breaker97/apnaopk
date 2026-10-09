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
  buildGuestInvoicePdf,
  lookUpGuestOrder,
} from "@/lib/orders/guest-order-tracking";

export const POST = withApi(
  {},
  async ({ request }) => {
    // Public, unauthenticated endpoint guarded only by email/phone match.
    // Held like order tracking, and sharing its count per order: a strict
    // limit per order and address, and the address to ten times that
    // (brute-forcing contact details, PDF scraping).
    await rateLimitByIP(request, "strict", SHOPPING_ADDRESS_ALLOWANCE);

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
        return new Response("Order not found", { status: 404 });
    }

    const { order } = lookup;
    const pdfBuffer = await buildGuestInvoicePdf(order);

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${order.orderNumber}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  },
);
