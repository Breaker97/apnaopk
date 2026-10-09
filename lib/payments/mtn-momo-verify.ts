import "server-only";

import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import {
  getMtnMomoCredentials,
  getMtnMomoFailureReason,
  getMtnMomoRequestToPayStatus,
  getMtnMomoTransactionState,
  MtnMomoApiError,
} from "@/lib/payments/mtn-momo";
import { finalizeMtnMomoOrder } from "@/lib/payments/mtn-momo-orders";
import { resolveMtnMomoCredentials } from "@/lib/settings/credentials";

/**
 * What an MTN MoMo order payment came to, asked on the shopper's behalf:
 * MTN's own status for the order's request-to-pay, and — once MTN reports it
 * paid — the order settled by the idempotent finalizer the callback and the
 * reconcile sweep share.
 *
 * Moved here from POST /api/payments/mtn-momo/verify, which the success page
 * polls; the shopper app's POST /checkout/push/verify asks the same.
 *
 * Whose order: a signed-in shopper's own (`customerId`, the web's rule), and
 * whatever else the caller's `orderScope` adds (the app's guest is held to
 * the cart it checked out from). An order outside that scope is "not found".
 */
export async function verifyMtnMomoOrderPayment(params: {
  /** The X-Reference-Id we minted for requesttopay. */
  referenceId: string;
  /** The signed-in shopper: only their orders. */
  customerId?: string;
  /** More conditions on the order, from the caller. */
  orderScope?: Record<string, unknown>;
  /** The guest's cart, emptied once the payment settles. */
  cartSessionId?: string;
  customerEmail?: string;
}) {
  const { referenceId } = params;
  const orderQuery: Record<string, unknown> = {
    ...params.orderScope,
    paymentMethod: "mtn_momo",
    mtnMomoReferenceId: referenceId,
  };
  if (params.customerId) orderQuery.customerId = params.customerId;

  const order = await Order.findOne(orderQuery).select("_id orderNumber");
  if (!order) {
    throw new ValidationError("Order not found for MTN MoMo transaction");
  }

  const settings = await getSettings();
  const resolved = resolveMtnMomoCredentials(settings.payment?.mtn_momo);
  const creds = getMtnMomoCredentials(resolved);

  let transaction;
  try {
    transaction = await getMtnMomoRequestToPayStatus({
      creds,
      referenceId,
    });
  } catch (err) {
    // The status endpoint can briefly 404 right after the 202 while the
    // platform registers the request. On a polling path that is "not
    // finished yet", never "failed" — the next poll answers.
    if (err instanceof MtnMomoApiError && err.httpStatus === 404) {
      return {
        status: "pending" as const,
        orderId: String(order._id),
        orderNumber: order.orderNumber as string,
      };
    }
    throw err;
  }

  const state = getMtnMomoTransactionState(transaction);
  if (state !== "completed") {
    return {
      status: state,
      orderId: String(order._id),
      orderNumber: order.orderNumber as string,
      // The bare code (APPROVAL_REJECTED, EXPIRED, NOT_ENOUGH_FUNDS…) so
      // the client can say why instead of a generic "failed".
      ...(state === "failed"
        ? { reason: getMtnMomoFailureReason(transaction) }
        : {}),
    };
  }

  const result = await finalizeMtnMomoOrder({
    referenceId,
    transaction,
    mode: creds.mode,
    settings,
    sessionUserId: params.customerId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });

  return {
    status: "completed" as const,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    alreadyPaid: result.alreadyPaid,
  };
}
