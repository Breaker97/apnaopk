import {
  CHECKOUT_REASONS,
  RedirectVerification,
  RedirectVerifyRequest,
} from "@/contracts/mobile/shop/v1/checkout";
import { MobileApiError } from "@/lib/api-core/errors";
import { idempotencyScope } from "@/lib/api-core/pipeline";
import { defineRoute } from "@/lib/api-core/registry";
import { withRequestScope } from "@/lib/api/request-scope";
import { readAppPaymentReference } from "@/lib/checkout/app-payment-reference";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { toCheckoutError } from "./app-checkout";
import { loadRedirectRecord, verifyRedirectPayment } from "./redirect-payment";

function paymentNotFound(): MobileApiError {
  return new MobileApiError(404, "NOT_FOUND", "There is no such payment.");
}

/**
 * POST /checkout/redirect/verify: how a payment started with POST
 * /checkout/redirect went. The gateway is asked (lib/payments/<provider>-verify.ts)
 * and a payment it reports complete is settled by the website's own finalizer
 * — the same order, stock, emails and ledger as a website checkout; the
 * gateway's webhook or IPN settling it first is answered the same.
 *
 * Only the shopper (or the cart) the payment was started for may ask: the
 * reference is signed for them, and anybody else's reads as no payment.
 */
export const redirectVerifyRoute = defineRoute({
  id: "checkout.redirect.verify",
  method: "POST",
  path: "/checkout/redirect/verify",
  auth: "optional",
  cache: { kind: "private" },
  // Asked again while a payment is pending: the lenient preset the website's
  // card confirmation polls on, in its own counter.
  rateLimit: { bucket: "payments:redirect-verify", preset: "lenient" },
  demo: "default",
  input: RedirectVerifyRequest,
  output: RedirectVerification,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client }) =>
    withRequestScope(async () => {
      const reference = readAppPaymentReference(input.reference, idempotencyScope(session, client));
      if (!reference || reference.method !== input.paymentMethod) throw paymentNotFound();
      await connectDB();
      const record = await loadRedirectRecord(reference);
      if (!record) throw paymentNotFound();

      const settings = await getSettings();
      try {
        return await verifyRedirectPayment({
          method: input.paymentMethod,
          record,
          returnParams: input.returnParams ?? {},
          settings,
          scope: session
            ? { sessionUserId: session.user.id, customerEmail: session.user.email }
            : { cartSessionId: client.cartToken },
        });
      } catch (error) {
        throw toCheckoutError(error);
      }
    }),
});
