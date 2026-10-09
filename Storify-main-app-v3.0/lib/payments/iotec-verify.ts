import "server-only";

import { Order } from "@/models";
import { getSettings } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import {
  getIotecCredentials,
  getIotecTransactionState,
  getIotecTransactionStatus,
  getIotecTransactionStatusByExternalId,
} from "@/lib/payments/iotec";
import { finalizeIotecOrder } from "@/lib/payments/iotec-orders";
import { resolveIotecCredentials } from "@/lib/settings/credentials";

/**
 * What an ioTec order payment came to, asked on the shopper's behalf: ioTec's
 * own status for the order's collection, and — once ioTec reports it paid —
 * the order settled by the idempotent finalizer the callback shares.
 *
 * Moved here from POST /api/payments/iotec/verify, which the success page
 * polls; the shopper app's POST /checkout/push/verify asks the same.
 *
 * Whose order: a signed-in shopper's own (`customerId`, the web's rule), and
 * whatever else the caller's `orderScope` adds (the app's guest is held to
 * the cart it checked out from). An order outside that scope is "not found".
 */
export async function verifyIotecOrderPayment(params: {
  /** ioTec's transaction id; either this or `externalId`. */
  transactionId?: string;
  /** The external id we sent, which a card payment returns with. */
  externalId?: string;
  /** The signed-in shopper: only their orders. */
  customerId?: string;
  /** More conditions on the order, from the caller. */
  orderScope?: Record<string, unknown>;
  /** The guest's cart, emptied once the payment settles. */
  cartSessionId?: string;
  customerEmail?: string;
}) {
  const transactionId = params.transactionId || "";
  const externalId = params.externalId || "";

  const orderQuery: Record<string, unknown> = {
    ...params.orderScope,
    paymentMethod: "iotec",
  };
  if (transactionId) {
    orderQuery.iotecTransactionId = transactionId;
  } else {
    orderQuery.iotecExternalId = externalId;
  }
  if (params.customerId) orderQuery.customerId = params.customerId;

  const order = await Order.findOne(orderQuery).select(
    "_id orderNumber iotecTransactionId iotecExternalId",
  );
  if (!order) {
    throw new ValidationError("Order not found for ioTec transaction");
  }

  if (
    externalId &&
    order.iotecExternalId &&
    externalId !== order.iotecExternalId
  ) {
    throw new ValidationError("ioTec reference mismatch");
  }

  const settings = await getSettings();
  const resolved = resolveIotecCredentials(settings.payment?.iotec);
  const creds = getIotecCredentials(resolved);
  const transaction = transactionId
    ? await getIotecTransactionStatus({ creds, transactionId })
    : await getIotecTransactionStatusByExternalId({ creds, externalId });

  // The order's stored transaction id is authoritative; a status response
  // for a different collection must not finalize this order.
  if (
    transaction.id &&
    order.iotecTransactionId &&
    String(transaction.id) !== String(order.iotecTransactionId)
  ) {
    throw new ValidationError("ioTec reference mismatch");
  }
  // Falls back to the id on the status response for the brief window between
  // the collection being accepted and its id landing on the order.
  const resolvedTransactionId =
    transactionId || String(order.iotecTransactionId || transaction.id || "");
  if (!resolvedTransactionId) {
    throw new ValidationError("Order not found for ioTec transaction");
  }

  const status = getIotecTransactionState(transaction);
  if (status !== "completed") {
    return {
      status,
      orderId: String(order._id),
      orderNumber: order.orderNumber as string,
    };
  }

  const result = await finalizeIotecOrder({
    transactionId: resolvedTransactionId,
    externalId: externalId || order.iotecExternalId || undefined,
    transaction,
    settings,
    sessionUserId: params.customerId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });

  return {
    status,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    alreadyPaid: result.alreadyPaid,
  };
}
