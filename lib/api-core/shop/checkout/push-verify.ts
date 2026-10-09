import {
  CHECKOUT_REASONS,
  PushVerification,
  PushVerifyRequest,
} from "@/contracts/mobile/shop/v1/checkout";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { withRequestScope } from "@/lib/api/request-scope";
import { Order } from "@/models";
import {
  PUSH_ORDER_FIELDS,
  pushOrderOwnership,
  pushReferenceField,
  verifyPushOrder,
  type PushOrder,
} from "./app-push";

/**
 * POST /checkout/push/verify, while the shopper approves on their phone: what
 * the provider says now. Once it says paid, the order is settled here — the
 * same idempotent finalizer the website's success page, the provider's
 * callback and the reconcile sweep use (lib/payments/*-verify.ts).
 *
 * Only the shopper or the cart the order was placed for may ask: anything
 * else is answered as if the payment did not exist.
 */
export const pushVerifyRoute = defineRoute({
  id: "checkout.push.verify",
  method: "POST",
  path: "/checkout/push/verify",
  auth: "optional",
  cache: { kind: "private" },
  // Its own counter: the app asks every few seconds for up to a few minutes
  // (`PUSH_WINDOW_SECONDS`), which the checkout's strict one would cut short.
  rateLimit: { bucket: "payments:push-verify", preset: "lenient" },
  demo: "default",
  input: PushVerifyRequest,
  output: PushVerification,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client }) =>
    withRequestScope(async () => {
      const order = await Order.findOne({
        ...pushOrderOwnership(session, client),
        paymentMethod: input.paymentMethod,
        [pushReferenceField(input.paymentMethod)]: input.reference,
      })
        .select(PUSH_ORDER_FIELDS)
        .lean<PushOrder | null>();
      if (!order) throw new MobileApiError(404, "NOT_FOUND", "There is no such payment.");
      return verifyPushOrder(order, { session, client });
    }),
});
