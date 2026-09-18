import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { hasUncollectedPreorderBalance } from "@/lib/orders/order-payment-status";
import { isPlatformSettled } from "@/lib/payments/payment-custody";

/**
 * The one change a person may make to an order's payment status by hand:
 * record that money arrived on an order still waiting for it.
 *
 * - Only `paid`. Refunds have their own action, and moving an order back to
 *   pending re-opens a settlement its gateway will run again.
 * - Only from pending or part-paid, and never on a cancelled order.
 * - Not while a pre-order balance is still to come. That money is recorded,
 *   whole, from the pre-order screen, which checks it against what is owed.
 * - On money that settles onto the store's own gateway, only an admin, who
 *   can see the gateway and is reconciling it. Staff reporting a card payment
 *   the gateway never confirmed is exactly how a vendor gets paid out on
 *   money that is not there.
 */
export function assertManualPaymentStatusChange(params: {
  order: {
    status?: string;
    paymentStatus?: string;
    paymentMethod?: string | null;
    channel?: string | null;
    stripePaymentIntentId?: string | null;
    preorderOutstandingAmount?: number | null;
    preorderBalancePaidAt?: Date | string | null;
    subOrders?: Array<{
      status?: string;
      items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
    }> | null;
  };
  next: string;
  isAdmin: boolean;
}): void {
  const { order, next, isAdmin } = params;
  if (next !== PAYMENT_STATUS.PAID) {
    throw new ValidationError(
      "A payment can only be marked as received here. Refunds have their own action.",
    );
  }
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new ValidationError("A cancelled order cannot be marked as paid");
  }
  if (
    order.paymentStatus !== PAYMENT_STATUS.PENDING &&
    order.paymentStatus !== PAYMENT_STATUS.PARTIALLY_PAID
  ) {
    throw new ValidationError("Only unpaid orders can be marked as paid");
  }
  const hasBalanceToCome =
    Number(order.preorderOutstandingAmount || 0) > 0 &&
    (order.paymentStatus === PAYMENT_STATUS.PENDING ||
      hasUncollectedPreorderBalance(order));
  if (hasBalanceToCome) {
    throw new ValidationError(
      "This pre-order still owes its balance. Record the balance from the pre-order page, which checks it against what is owed.",
    );
  }
  const method = String(order.paymentMethod || "").toLowerCase();
  if (!isAdmin && method !== "cod" && isPlatformSettled(order)) {
    throw new AuthorizationError(
      "This order is paid through the store's payment gateway, so only an admin can mark it paid after checking the gateway.",
    );
  }
}
