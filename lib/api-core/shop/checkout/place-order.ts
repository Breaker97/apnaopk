import {
  CHECKOUT_REASONS,
  PlaceOrderRequest,
  PlacedOrder,
} from "@/contracts/mobile/shop/v1/checkout";
import { API_BASE_PATH } from "@/contracts/mobile/shop/v1/common";
import type { ClientInfo } from "@/lib/api-core/client-info";
import { idempotencyScope } from "@/lib/api-core/pipeline";
import type { MobileSession } from "@/lib/api-core/ports";
import { defineRoute } from "@/lib/api-core/registry";
import { shopAppAuditContext } from "@/lib/api-core/shop/audit-context";
import { toMoney } from "@/lib/api-core/shop/money";
import { withRequestScope } from "@/lib/api/request-scope";
import { appBaseUrl } from "@/lib/app-url";
import type { AuditContext } from "@/lib/audit";
import { CheckoutQuoteChangedError } from "@/lib/checkout/checkout-quote";
import { placeCodOrder } from "@/lib/checkout/place-cod-order";
import { prepareCheckout } from "@/lib/checkout/prepare-checkout";
import { Order } from "@/models";
import {
  admitAppCart,
  appCheckoutIdentity,
  assertDelivery,
  inShopperWords,
  toCheckoutError,
  toPlaceInput,
} from "./app-checkout";
import { pricesChanged } from "./quote";

/**
 * The answer for the order a key already placed, or null when it placed none.
 *
 * The idempotency store replays a key's answer once it has kept it, but an
 * order can exist without a kept answer: the request wrote it and then failed
 * on a later step (emptying the cart, say), which frees the key, or the
 * answer could not be saved. The order itself carries the key, so it is the
 * answer either way — a retry never places a second one.
 */
async function orderPlacedWith(idempotencyKey: string): Promise<PlacedOrder | null> {
  const order = await Order.findOne({ idempotencyKey })
    .select("_id orderNumber total currency")
    .lean<{ _id: unknown; orderNumber: string; total: number; currency?: string } | null>();
  return order
    ? {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        paymentMethod: "cod",
        total: toMoney(order.total, order.currency || "USD"),
      }
    : null;
}

/** The order model's unique index refusing a second order for one key. */
function isSecondOrderForKey(error: unknown): boolean {
  const { code, keyPattern } = (error ?? {}) as { code?: unknown; keyPattern?: Record<string, unknown> };
  return code === 11000 && Boolean(keyPattern && "idempotencyKey" in keyPattern);
}

/**
 * Who placed the order, for its timeline: the signed-in shopper, or, for a
 * guest, who has no account to name, only where the request came from.
 * `shopAppAuditContext` describes the device and takes a session, so a guest's
 * is the same `origin` without one.
 */
function placedBy(input: {
  session: MobileSession | null;
  client: ClientInfo;
  requestId?: string;
  locale: string;
}): AuditContext {
  const { session, client, requestId, locale } = input;
  if (session) {
    return shopAppAuditContext({
      session,
      client,
      requestId,
      locale,
      method: "POST",
      path: "/checkout/orders",
    });
  }
  return {
    origin: {
      ...(client.ip ? { ip: client.ip } : {}),
      ...(requestId ? { requestId } : {}),
      method: "POST",
      path: `${API_BASE_PATH}/${locale}/checkout/orders`,
      userAgent: ["Storify shop app", client.platform, client.appVersion]
        .filter(Boolean)
        .join(" "),
    },
  };
}

/**
 * POST /checkout/orders: place the cart as a cash-on-delivery order, at the
 * quote the shopper accepted (`quoteHash`). The web checkout's own path —
 * the same pricing, form rules, coupon, stock and order
 * (lib/checkout/prepare-checkout.ts, place-cod-order.ts) — held to the
 * quote's hash instead of the cart's stored prices.
 *
 * `Idempotency-Key` is required: a retry with the same key answers with the
 * order the first request placed — from the idempotency store, or from the
 * order itself, which is stamped with the key (`orderPlacedWith`).
 */
export const placeOrderRoute = defineRoute({
  id: "checkout.orders.place",
  method: "POST",
  path: "/checkout/orders",
  auth: "optional",
  cache: { kind: "private" },
  // The web checkout's own counter and preset. A replay counts too.
  rateLimit: { bucket: "payments:checkout", preset: "strict" },
  demo: "default",
  idempotency: "required",
  status: 201,
  input: PlaceOrderRequest,
  output: PlacedOrder,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client, mobileApp, locale, requestId }) =>
    withRequestScope(async () => {
      // The pipeline has refused a request without one.
      const orderKey = `${idempotencyScope(session, client)}:${client.idempotencyKey}`;
      const placed = await orderPlacedWith(orderKey);
      if (placed) return placed;

      assertDelivery(input);
      const body = toPlaceInput(input, "cod", locale);
      const identity = appCheckoutIdentity(session, client, appBaseUrl());
      try {
        const draft = await prepareCheckout(body, identity, {
          mode: "place",
          admitCart: admitAppCart(mobileApp),
          acceptedQuote: input.quoteHash,
        });
        const { order } = await placeCodOrder(draft, {
          idempotencyKey: orderKey,
          audit: placedBy({ session, client, requestId, locale }),
        });
        return {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          paymentMethod: "cod" as const,
          total: toMoney(order.total, draft.settings.general?.defaultCurrency || "USD"),
        };
      } catch (error) {
        if (error instanceof CheckoutQuoteChangedError) {
          throw await pricesChanged({
            input: { ...input, paymentMethod: "cod" },
            session,
            client,
            mobileApp,
            locale,
          });
        }
        // Another request with this key wrote its order first; the stock and
        // the coupon this one took were given back. That order is the answer.
        if (isSecondOrderForKey(error)) {
          const first = await orderPlacedWith(orderKey);
          if (first) return first;
        }
        throw await inShopperWords(toCheckoutError(error), locale);
      }
    }),
});
