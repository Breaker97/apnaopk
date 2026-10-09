import type {
  PushPayment,
  PushPaymentMethod,
  PushVerification,
} from "@/contracts/mobile/shop/v1/checkout";
import type { ClientInfo } from "@/lib/api-core/client-info";
import { MobileApiError } from "@/lib/api-core/errors";
import type { MobileSession } from "@/lib/api-core/ports";
import {
  closeFailedPrompt,
  PUSH_ORDER_FIELDS,
  pushPaymentOf,
  verifyPushOrder,
  type PushOrder,
} from "@/lib/api-core/shop/checkout/app-push";
import { ValidationError } from "@/lib/api/errors";
import { appBaseUrl } from "@/lib/app-url";
import { connectDB } from "@/lib/db";
import { IotecApiError } from "@/lib/payments/iotec";
import { MtnMomoApiError } from "@/lib/payments/mtn-momo";
import { resendOrderPaymentPush } from "@/lib/payments/order-pay-push";
import { Order } from "@/models";
import { isValidObjectId } from "mongoose";
import { orderNotFound } from "./detail";

/**
 * Pay now, by mobile money: the shopper's own unpaid order prompts their
 * phone again — the same order, number and amount, nothing re-priced
 * (`resendOrderPaymentPush`, the website's Pay now). Then the app waits on it
 * exactly as after checkout (`PushPayment`, `verifyPushOrder`).
 *
 * Signed in only: an order is the session's to pay (plan D-P5). Called by
 * POST /orders/{id}/pay and POST /orders/{id}/pay/verify for a push method.
 */

async function findPushOrder(orderId: string, userId: string): Promise<PushOrder> {
  if (!isValidObjectId(orderId)) throw orderNotFound();
  await connectDB();
  const order = await Order.findOne({ _id: orderId, customerId: userId })
    .select(PUSH_ORDER_FIELDS)
    .lean<PushOrder | null>();
  if (!order) throw orderNotFound();
  return order;
}

function conflict(reason: string, message: string, details?: Record<string, unknown>) {
  return new MobileApiError(409, "CONFLICT", message, { reason, ...(details ? { details } : {}) });
}

function notThisMethod(): MobileApiError {
  return conflict(
    "PAYMENT_METHOD_UNAVAILABLE",
    "This order is not paid that way. Pay with the method it was placed with.",
  );
}

/** The website's refusals of a prompt sent again, as the contract words them. */
function toPayNowError(error: ValidationError, order: PushOrder): unknown {
  const message = error.errors._error?.[0] ?? error.message;
  if (message === "Order not found") return orderNotFound();
  if (message.startsWith("The last payment request is still live")) {
    // The prompt is on the phone: wait on it, as after checkout, from now.
    return conflict("PAYMENT_PENDING", message, pushPaymentOf(order, Date.now()));
  }
  if (message === "This order has nothing left to pay" || message.startsWith("This order was not paid for with mobile money")) {
    return conflict("ORDER_NOT_PAYABLE", "This order has nothing to pay.");
  }
  if (message.startsWith("This order has no mobile money number to prompt")) {
    return new MobileApiError(400, "VALIDATION_ERROR", "Enter the mobile money number to prompt.", {
      reason: "PHONE_INVALID",
      errors: { payerPhone: ["Enter a valid mobile money number."] },
    });
  }
  if (message.startsWith("Mobile money is not")) return conflict("PAYMENT_METHOD_UNAVAILABLE", message);
  if (message.startsWith("Something on this order has sold out")) return conflict("OUT_OF_STOCK", message);
  return new MobileApiError(400, "VALIDATION_ERROR", message);
}

/**
 * POST /orders/{id}/pay with a push method: prompt the phone again, and
 * answer what to wait on. A provider that refuses: 409 PAYMENT_FAILED. One
 * that does not answer: the order holds the new reference and may have
 * prompted, so it is answered as sent and the polling finds out.
 */
export async function payOrderByPush(input: {
  orderId: string;
  method: PushPaymentMethod;
  /** A number to prompt instead of the order's own. */
  payerPhone?: string;
  session: MobileSession;
  locale: string;
}): Promise<PushPayment> {
  const order = await findPushOrder(input.orderId, input.session.user.id);
  if (order.paymentMethod !== input.method) throw notThisMethod();

  const startedAt = Date.now();
  try {
    await resendOrderPaymentPush({
      orderId: String(order._id),
      customerId: input.session.user.id,
      origin: appBaseUrl(),
      locale: input.locale,
      phone: input.payerPhone,
    });
  } catch (error) {
    if (error instanceof ValidationError) throw toPayNowError(error, order);
    const refused =
      (error instanceof IotecApiError || error instanceof MtnMomoApiError) &&
      error.httpStatus >= 400 &&
      error.httpStatus < 500;
    if (refused) {
      // Nothing was queued: the order may be prompted again straight away.
      await closeFailedPrompt(await findPushOrder(String(order._id), input.session.user.id));
      throw conflict(
        "PAYMENT_FAILED",
        "The mobile money provider refused this payment request, so nothing was charged. Check the number, or try again later.",
      );
    }
    // No answer, or an unreadable one: the prompt may be on the phone.
    console.error(`Pay now prompt for order ${String(order._id)} has an unknown outcome:`, error);
  }
  return pushPaymentOf(await findPushOrder(String(order._id), input.session.user.id), startedAt);
}

/** POST /orders/{id}/pay/verify with a push method: what the provider says now. */
export async function verifyOrderPushPayment(input: {
  orderId: string;
  method: PushPaymentMethod;
  session: MobileSession;
  client: ClientInfo;
}): Promise<PushVerification> {
  const order = await findPushOrder(input.orderId, input.session.user.id);
  if (order.paymentMethod !== input.method) throw notThisMethod();
  return verifyPushOrder(order, { session: input.session, client: input.client });
}
