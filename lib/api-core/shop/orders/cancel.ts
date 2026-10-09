import { ORDER_CANCEL_REASONS, OrderCancelResult } from "@/contracts/mobile/shop/v1/orders";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { API_BASE_PATH } from "@/contracts/mobile/shop/v1/common";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { cancelOrderForCustomer } from "@/lib/orders/customer-cancel";
import { isCancellableByCustomer } from "@/lib/orders/customer-cancel-policy";
import { getPendingPaymentLock } from "@/lib/orders/pending-payment-lock";
import type { IOrder } from "@/types";
import { toMoney } from "../money";
import { orderCurrency } from "./dto";
import { buildOrderDetail, findCustomerOrder, orderNotFound } from "./detail";

function notCancellable(): MobileApiError {
  return new MobileApiError(409, "CONFLICT", "This order can no longer be cancelled.", {
    reason: "NOT_CANCELLABLE",
  });
}

function paymentInProgress(message: string): MobileApiError {
  return new MobileApiError(409, "CONFLICT", message, { reason: "PAYMENT_IN_PROGRESS" });
}

/**
 * POST /orders/{id}/cancel: the shopper calls off their own order.
 *
 * The whole cascade (status, stock, pre-order quota, coupon, labels, audit and
 * the refund) is `cancelOrderForCustomer`, the one the website runs. Before it,
 * the same rule the order's `canCancel` says: an order whose seller has
 * already handed a parcel to a courier is not called off half-way from a
 * button that says "Cancel order".
 */
export const orderCancelRoute = defineRoute({
  id: "orders.cancel",
  method: "POST",
  path: "/orders/{id}/cancel",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "orders:cancel", preset: "moderate" },
  demo: "default",
  reasons: { values: ORDER_CANCEL_REASONS },
  output: OrderCancelResult,
  handler: async ({ params, session, locale, client, requestId, mobileApp }) => {
    const existing = await findCustomerOrder(params.id, session.user.id);
    const lock = getPendingPaymentLock(existing);
    if (lock) throw paymentInProgress(lock);
    if (!isCancellableByCustomer(existing)) throw notCancellable();

    let result: Awaited<ReturnType<typeof cancelOrderForCustomer>>;
    try {
      result = await cancelOrderForCustomer({
        orderFilter: { _id: existing._id, customerId: session.user.id },
        auditContext: {
          userId: session.user.id,
          userEmail: session.user.email,
          userRole: session.user.role,
          origin: {
            ...(client.ip ? { ip: client.ip } : {}),
            requestId,
            method: "POST",
            path: `${API_BASE_PATH}/${locale}/orders/${params.id}/cancel`,
            userAgent: ["Storify shop app", client.platform, client.appVersion].filter(Boolean).join(" "),
          },
        },
        createdBy: session.user.id,
      });
    } catch (error) {
      // The cascade's own refusals, for a change that raced this request: its
      // status guard (another hand moved the order on) and the payment lock.
      if (error instanceof AuthorizationError) throw notCancellable();
      if (error instanceof ValidationError) throw paymentInProgress(error.message);
      throw error;
    }
    if (!result) throw orderNotFound();

    const order = result.order.toObject() as IOrder;
    const refund = result.refund as
      | { refunded?: boolean; amount?: number; currency?: string; failed?: boolean }
      | undefined;
    const refunded = refund?.refunded === true;
    const owed = refund?.failed === true;
    return {
      order: await buildOrderDetail(order, { appScheme: mobileApp.scheme, returnsIn: locale }),
      // Nothing collected, nothing to say.
      ...(refunded || owed
        ? {
            refund: {
              refunded,
              ...(refunded && typeof refund?.amount === "number"
                ? {
                    amount: toMoney(
                      refund.amount,
                      refund.currency || orderCurrency(order, DEFAULT_CURRENCY),
                    ),
                  }
                : {}),
              owed,
            },
          }
        : {}),
    };
  },
});
