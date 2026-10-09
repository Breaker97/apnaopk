import type {
  PushPayment,
  PushPaymentMethod,
  PushVerification,
} from "@/contracts/mobile/shop/v1/checkout";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import type { ClientInfo } from "@/lib/api-core/client-info";
import { MobileApiError } from "@/lib/api-core/errors";
import { idempotencyScope } from "@/lib/api-core/pipeline";
import type { MobileSession } from "@/lib/api-core/ports";
import { toMoney } from "@/lib/api-core/shop/money";
import { ValidationError } from "@/lib/api/errors";
import {
  amountDueNow,
  CANCELLED_BEFORE_CAPTURE,
  SOLD_OUT_AFTER_CAPTURE,
} from "@/lib/payments/finalize-order";
import { IotecApiError } from "@/lib/payments/iotec";
import { verifyIotecOrderPayment } from "@/lib/payments/iotec-verify";
import { MtnMomoApiError } from "@/lib/payments/mtn-momo";
import { verifyMtnMomoOrderPayment } from "@/lib/payments/mtn-momo-verify";
import { Order } from "@/models";

/**
 * The shopper app's side of mobile-money payments: whose push orders a caller
 * may see, how long the app waits on the phone, and the web's verification
 * (lib/payments/{iotec,mtn-momo}-verify.ts) as the contract words it.
 */

/** How often the app asks, in seconds. */
export const PUSH_POLL_INTERVAL_SECONDS = 3;

/**
 * How long the app waits on the phone, in seconds: the website's success
 * page's own windows (components/checkout/success-content.tsx), ioTec 30 × 3 s
 * and MTN 40 × 4 s — MTN's payer often has to find the phone first.
 */
export const PUSH_WINDOW_SECONDS: Record<PushPaymentMethod, number> = {
  iotec: 90,
  mtn_momo: 160,
};

/** The order fields the app's push answers read. */
export const PUSH_ORDER_FIELDS =
  "_id orderNumber status paymentStatus paymentMethod customerId idempotencyKey total currency preorderOutstandingAmount storeCredit createdAt mtnMomoReferenceId iotecExternalId iotecTransactionId";

export type PushOrder = {
  _id: unknown;
  orderNumber: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod: PushPaymentMethod;
  customerId?: unknown;
  idempotencyKey?: string;
  total?: number;
  currency?: string;
  preorderOutstandingAmount?: number;
  storeCredit?: Parameters<typeof amountDueNow>[0]["storeCredit"];
  createdAt?: Date;
  mtnMomoReferenceId?: string;
  iotecExternalId?: string;
  iotecTransactionId?: string;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Orders the app placed under this caller's idempotency scope. */
export function placedInScope(scope: string): Record<string, unknown> {
  return { idempotencyKey: { $regex: `^${escapeRegExp(scope)}:` } };
}

/**
 * Whose push orders this caller may ask about: a signed-in shopper's own, or
 * the ones the app placed under this caller's scope — for a guest, the cart
 * of its `X-Cart-Token`. Stricter than the website, whose verify routes let a
 * guest who holds a reference ask about it.
 */
export function pushOrderOwnership(
  session: MobileSession | null,
  client: ClientInfo,
): Record<string, unknown> {
  const scoped = placedInScope(idempotencyScope(session, client));
  return session ? { $or: [{ customerId: session.user.id }, scoped] } : scoped;
}

/** The reference the app holds: the id we minted before the prompt went out. */
export function pushReferenceOf(order: PushOrder): string {
  return String(
    (order.paymentMethod === "mtn_momo" ? order.mtnMomoReferenceId : order.iotecExternalId) || "",
  );
}

/** The order's reference field, for a lookup by the app's reference. */
export function pushReferenceField(method: PushPaymentMethod): "mtnMomoReferenceId" | "iotecExternalId" {
  return method === "mtn_momo" ? "mtnMomoReferenceId" : "iotecExternalId";
}

/**
 * A push order as the app waits on it. The wait runs from the checkout's
 * prompt, or from `promptedAt` for a prompt sent again (Pay now).
 */
export function pushPaymentOf(order: PushOrder, promptedAt?: number): PushPayment {
  const startedAt = promptedAt ?? (order.createdAt ? new Date(order.createdAt).getTime() : Date.now());
  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    reference: pushReferenceOf(order),
    amount: toMoney(amountDueNow(order), order.currency || "USD"),
    expiresAt: new Date(startedAt + PUSH_WINDOW_SECONDS[order.paymentMethod] * 1000).toISOString(),
    pollIntervalSeconds: PUSH_POLL_INTERVAL_SECONDS,
  };
}

const RECORDED: string[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_PAID,
  PAYMENT_STATUS.REFUNDED,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
];

function providerUnavailable(): MobileApiError {
  return new MobileApiError(
    503,
    "SERVICE_UNAVAILABLE",
    "The mobile money provider did not answer. Ask again in a moment.",
    { headers: { "Retry-After": String(PUSH_POLL_INTERVAL_SECONDS) } },
  );
}

/** A provider that answered with an error, or did not answer at all. */
function isProviderFailure(error: unknown): boolean {
  if (error instanceof IotecApiError || error instanceof MtnMomoApiError) return true;
  // fetch's own failures: a dropped connection, a timeout.
  return error instanceof TypeError || (error as { name?: string })?.name === "AbortError";
}

/**
 * What the provider says about an order's payment now, settling the order
 * when the money is in — the website's verification, held to this one order.
 * A payment already recorded is answered without asking the provider again.
 */
export async function verifyPushOrder(
  order: PushOrder,
  ctx: { session: MobileSession | null; client: ClientInfo },
): Promise<PushVerification> {
  const ids = { orderId: String(order._id), orderNumber: order.orderNumber };
  if (RECORDED.includes(String(order.paymentStatus))) return { status: "PAID", ...ids };

  const ownOrder = Boolean(ctx.session && String(order.customerId ?? "") === ctx.session.user.id);
  const common = {
    customerId: ownOrder ? ctx.session!.user.id : undefined,
    orderScope: { _id: order._id },
    cartSessionId: ctx.client.cartToken,
    customerEmail: ctx.session?.user.email,
  };
  const cancelled = order.status === ORDER_STATUS.CANCELLED;

  let result: { status: string; orderId: string; orderNumber: string; reason?: string };
  try {
    result =
      order.paymentMethod === "mtn_momo"
        ? await verifyMtnMomoOrderPayment({ ...common, referenceId: String(order.mtnMomoReferenceId || "") })
        : await verifyIotecOrderPayment({
            ...common,
            transactionId: order.iotecTransactionId || undefined,
            externalId: order.iotecExternalId,
          });
  } catch (error) {
    if (isProviderFailure(error)) throw providerUnavailable();
    // The money arrived for an order that was called off (or whose goods
    // sold out meanwhile): the finalizer sent it back or told the admins to.
    if (error instanceof ValidationError && cancelledMeanwhile(error)) {
      return { status: "CANCELLED", ...ids };
    }
    throw error;
  }

  if (result.status === "completed") return { status: "PAID", ...ids };
  if (cancelled) return { status: "CANCELLED", ...ids };
  if (result.status === "failed" || result.status === "invalid") {
    await closeFailedPrompt(order);
    return { status: "FAILED", ...ids, ...(result.reason ? { reason: result.reason } : {}) };
  }
  return { status: "PENDING", ...ids };
}

/**
 * Record the provider's "failed" on the order, as the MTN reconciler does
 * when it hears it (`paymentReconcileClosedAt`): nothing can arrive against
 * this prompt any more. Without it a shopper who declined could not be
 * prompted again (Pay now) until a sweep came round — ten minutes for MTN,
 * six hours for ioTec. Only while the order still waits on this same prompt.
 * Also for a prompt the provider refused outright (a 4xx: nothing queued).
 */
export async function closeFailedPrompt(order: PushOrder): Promise<void> {
  const reference = pushReferenceOf(order);
  if (!reference) return;
  await Order.updateOne(
    {
      _id: order._id,
      paymentStatus: PAYMENT_STATUS.PENDING,
      [pushReferenceField(order.paymentMethod)]: reference,
    },
    { $set: { paymentReconcileClosedAt: new Date() } },
  );
}

/** The finalizer's refusals of a payment for an order that will not ship. */
function cancelledMeanwhile(error: ValidationError): boolean {
  return error.message === CANCELLED_BEFORE_CAPTURE || error.message === SOLD_OUT_AFTER_CAPTURE;
}
