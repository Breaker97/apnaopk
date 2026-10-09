import {
  CHECKOUT_REASONS,
  PUSH_PAYMENT_METHODS,
  PushPayment,
  PushPaymentRequest,
} from "@/contracts/mobile/shop/v1/checkout";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import type { ClientInfo } from "@/lib/api-core/client-info";
import { MobileApiError } from "@/lib/api-core/errors";
import { idempotencyScope } from "@/lib/api-core/pipeline";
import type { MobileSession } from "@/lib/api-core/ports";
import { defineRoute } from "@/lib/api-core/registry";
import { ValidationError } from "@/lib/api/errors";
import { withRequestScope } from "@/lib/api/request-scope";
import { appBaseUrl } from "@/lib/app-url";
import { CheckoutQuoteChangedError } from "@/lib/checkout/checkout-quote";
import { startIotecPayment } from "@/lib/checkout/gateway-start/iotec";
import { startMtnMomoPayment } from "@/lib/checkout/gateway-start/mtn-momo";
import { prepareCheckout } from "@/lib/checkout/prepare-checkout";
import { resolveCheckoutGatewayReadiness } from "@/lib/payments/checkout-gateways";
import { IotecApiError } from "@/lib/payments/iotec";
import { MtnMomoApiError } from "@/lib/payments/mtn-momo";
import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  admitAppCart,
  appCheckoutIdentity,
  assertDelivery,
  inShopperWords,
  toCheckoutError,
  toPlaceInput,
} from "./app-checkout";
import {
  placedInScope,
  PUSH_ORDER_FIELDS,
  PUSH_WINDOW_SECONDS,
  pushPaymentOf,
  verifyPushOrder,
  type PushOrder,
} from "./app-push";
import { pricesChanged } from "./quote";

const METHOD_NAMES = { mtn_momo: "MTN MoMo", iotec: "ioTec" } as const;

function methodUnavailable(message: string): MobileApiError {
  return new MobileApiError(409, "CONFLICT", message, { reason: "PAYMENT_METHOD_UNAVAILABLE" });
}

function paymentFailed(): MobileApiError {
  return new MobileApiError(
    409,
    "CONFLICT",
    "The mobile money provider refused this payment request, so nothing was charged. Check the number, or choose another way to pay.",
    { reason: "PAYMENT_FAILED" },
  );
}

/** The order a key already placed, or null when it placed none. */
async function pushOrderPlacedWith(idempotencyKey: string): Promise<PushOrder | null> {
  return Order.findOne({ idempotencyKey }).select(PUSH_ORDER_FIELDS).lean<PushOrder | null>();
}

/**
 * The answer for an order this key placed: the prompt to wait on, or — when
 * the provider refused it and the order was retired — that refusal again.
 */
function answerFor(order: PushOrder): PushPayment {
  if (isRetired(order)) throw paymentFailed();
  return pushPaymentOf(order);
}

/** Called off, or written off by the provider's refusal. */
function isRetired(order: PushOrder): boolean {
  return order.status === ORDER_STATUS.CANCELLED || order.paymentStatus === PAYMENT_STATUS.EXPIRED;
}

/** The order model's unique index refusing a second order for one key. */
function isSecondOrderForKey(error: unknown): boolean {
  const { code, keyPattern } = (error ?? {}) as { code?: unknown; keyPattern?: Record<string, unknown> };
  return code === 11000 && Boolean(keyPattern && "idempotencyKey" in keyPattern);
}

/** A provider that answered with an error, or did not answer at all. */
function isProviderFailure(error: unknown): boolean {
  if (error instanceof IotecApiError || error instanceof MtnMomoApiError) return true;
  return error instanceof TypeError || (error as { name?: string })?.name === "AbortError";
}

/** Switched on, with its keys, in a currency it settles — before anything is written. */
async function assertMethodReady(method: PushPaymentRequest["paymentMethod"]): Promise<void> {
  const settings = await getSettings();
  const name = METHOD_NAMES[method];
  if (!settings.payment?.[method]?.enabled) throw methodUnavailable(`${name} is not available.`);
  const readiness = resolveCheckoutGatewayReadiness(settings)[method];
  if (!readiness.ready) {
    throw methodUnavailable(
      readiness.missing === "currency"
        ? `${name} can't take payments in ${readiness.currency}.`
        : `${name} is not available.`,
    );
  }
}

/**
 * One live prompt per shopper. While an earlier request of this caller's is
 * still waiting on the phone, a second would put two prompts there — and a
 * shopper who approves both has paid twice, to providers that cannot send
 * money back. So the earlier one is asked about first, and only a request the
 * provider has finished with (paid, declined, expired) lets a new one go.
 */
async function refuseWhileEarlierPromptLive(
  scope: string,
  ctx: { session: MobileSession | null; client: ClientInfo },
): Promise<void> {
  const longest = Math.max(...Object.values(PUSH_WINDOW_SECONDS));
  const earlier = await Order.findOne({
    ...placedInScope(scope),
    paymentMethod: { $in: PUSH_PAYMENT_METHODS },
    paymentStatus: PAYMENT_STATUS.PENDING,
    status: { $ne: ORDER_STATUS.CANCELLED },
    // The provider has already said this one failed.
    paymentReconcileClosedAt: { $exists: false },
    createdAt: { $gte: new Date(Date.now() - longest * 1000) },
  })
    .sort({ createdAt: -1 })
    .select(PUSH_ORDER_FIELDS)
    .lean<PushOrder | null>();
  if (!earlier) return;
  const live = pushPaymentOf(earlier);
  if (Date.parse(live.expiresAt) <= Date.now()) return;

  // The provider's word, settling the earlier order if it was paid. A provider
  // that does not answer is taken as still waiting: the safe side.
  const verdict = await verifyPushOrder(earlier, ctx).catch(() => null);
  if (verdict && verdict.status !== "PENDING") return;
  throw new MobileApiError(
    409,
    "CONFLICT",
    "A payment request is already waiting on your phone. Approve it there, or wait until it expires.",
    { reason: "PAYMENT_PENDING", details: live },
  );
}

/** A refusal of the push start as the contract words it. */
function toPushError(error: unknown): unknown {
  if (error instanceof ValidationError) {
    const phone = error.errors.iotecPhone ?? error.errors.mtnMomoPhone;
    if (phone) {
      return new MobileApiError(400, "VALIDATION_ERROR", phone[0], {
        reason: "PHONE_INVALID",
        errors: { payerPhone: phone },
      });
    }
    const message = error.errors._error?.[0] ?? "";
    if (
      /^(ioTec Pay|MTN MoMo) is (disabled|not configured)/.test(message) ||
      message.startsWith("ioTec Pay requires a minimum amount") ||
      message.includes("has no minor unit")
    ) {
      return methodUnavailable(message);
    }
  }
  // The gateway clients' own "not configured" (keys, a live target).
  if (
    error instanceof Error &&
    !(error instanceof ValidationError) &&
    /^(ioTec Pay|MTN MoMo) is not configured/.test(error.message)
  ) {
    return methodUnavailable(error.message);
  }
  return toCheckoutError(error);
}

/**
 * POST /checkout/push: place the cart as an order awaiting a mobile-money
 * payment, at the quote the shopper accepted, and have the provider prompt
 * the shopper's phone. The website's own path (lib/checkout/prepare-checkout.ts
 * and lib/checkout/gateway-start/): the order and its goods are held before
 * the prompt can exist, and a provider that refuses retires the order.
 *
 * `Idempotency-Key` is required, and the order carries it: a retry answers
 * with the same order and reference, never a second prompt. A provider that
 * did not answer leaves the order pending with its reference — the prompt may
 * be on the phone — so that is answered as started, and the app's polling
 * finds out.
 */
export const pushStartRoute = defineRoute({
  id: "checkout.push.start",
  method: "POST",
  path: "/checkout/push",
  auth: "optional",
  cache: { kind: "private" },
  // The web checkout's own counter and preset, as placing a COD order. A
  // replay counts too.
  rateLimit: { bucket: "payments:checkout", preset: "strict" },
  demo: "default",
  idempotency: "required",
  status: 201,
  input: PushPaymentRequest,
  output: PushPayment,
  reasons: { values: CHECKOUT_REASONS },
  handler: ({ input, session, client, mobileApp, locale }) =>
    withRequestScope(async () => {
      // The pipeline has refused a request without one.
      const scope = idempotencyScope(session, client);
      const orderKey = `${scope}:${client.idempotencyKey}`;
      const placed = await pushOrderPlacedWith(orderKey);
      if (placed) return answerFor(placed);

      assertDelivery(input);
      await assertMethodReady(input.paymentMethod);
      await refuseWhileEarlierPromptLive(scope, { session, client });

      const body = toPlaceInput(input, input.paymentMethod, locale);
      const identity = appCheckoutIdentity(session, client, appBaseUrl());
      try {
        const draft = await prepareCheckout(body, identity, {
          mode: "place",
          admitCart: admitAppCart(mobileApp),
          acceptedQuote: input.quoteHash,
        });
        if (input.paymentMethod === "mtn_momo") {
          await startMtnMomoPayment(draft, { phone: input.payerPhone, idempotencyKey: orderKey });
        } else {
          await startIotecPayment(draft, {
            channel: "mobile_money",
            phone: input.payerPhone,
            idempotencyKey: orderKey,
          });
        }
      } catch (error) {
        if (error instanceof CheckoutQuoteChangedError) {
          throw await pricesChanged({
            input: { ...input, paymentMethod: input.paymentMethod },
            session,
            client,
            mobileApp,
            locale,
          });
        }
        // Whatever failed, an order this key wrote that is still pending may
        // have a prompt on the phone (a provider that did not answer, or
        // answered nonsense): the app waits on it like any other. One the
        // provider refused was retired: PAYMENT_FAILED. And another request
        // with this key may have written its order first.
        const order = await pushOrderPlacedWith(orderKey);
        if (order && !isRetired(order)) return pushPaymentOf(order);
        if (order && (isProviderFailure(error) || isSecondOrderForKey(error))) throw paymentFailed();
        throw await inShopperWords(toPushError(error), locale);
      }

      const order = await pushOrderPlacedWith(orderKey);
      if (!order) throw new Error("The push order was not found after it was placed");
      return pushPaymentOf(order);
    }),
});
