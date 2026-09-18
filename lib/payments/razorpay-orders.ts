import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  captureAuthorizedRazorpayPayment,
  toRazorpayAmountSubunits,
  type RazorpayCredentials,
  type RazorpayPayment,
} from "@/lib/payments/razorpay";
import { gatewayFeeUpdate, razorpayFee } from "@/lib/payments/gateway-fee";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";

type FinalizeRazorpayOrderParams = {
  razorpayOrderId: string;
  payment: RazorpayPayment;
  /**
   * Lets the verifier capture a payment Razorpay has only authorized. The
   * payer's verify call passes them; the webhook does not, because the events
   * it settles on (`payment.captured`, `order.paid`) are captured already.
   */
  creds?: RazorpayCredentials;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a Razorpay payment, capturing it if need be. */
export function finalizeRazorpayOrder(params: FinalizeRazorpayOrderParams) {
  return finalizeCapturedOrder({
    provider: {
      paymentMethod: "razorpay",
      label: "Razorpay",
      recoveryGateway: "razorpay",
    },
    findOrder: (scope) =>
      Order.findOne({ ...scope, razorpayOrderId: params.razorpayOrderId }),
    notFoundMessage: "Order not found for Razorpay payment",
    verify: async (order) => {
      if (params.payment.order_id !== params.razorpayOrderId) {
        throw new ValidationError("Razorpay order mismatch");
      }

      const expectedCurrency = (
        params.settings.general?.defaultCurrency || "USD"
      ).toUpperCase();
      const paymentCurrency = String(
        params.payment.currency || "",
      ).toUpperCase();
      if (paymentCurrency !== expectedCurrency) {
        throw new ValidationError("Razorpay currency mismatch");
      }

      const amountDue = amountDueNow(order);
      const expectedAmount = toRazorpayAmountSubunits(
        amountDue,
        expectedCurrency,
      );
      if (Number(params.payment.amount) !== expectedAmount) {
        throw new ValidationError("Razorpay amount mismatch");
      }

      // Captured here rather than by the route: `verify` runs only for an
      // order that is still unpaid and not cancelled, so an authorized payment
      // is never captured for an order that can no longer be settled.
      const payment = params.creds
        ? await captureAuthorizedRazorpayPayment({
            creds: params.creds,
            payment: params.payment,
            amount: amountDue,
            currency: expectedCurrency,
          })
        : params.payment;

      if (payment.status !== "captured" && payment.captured !== true) {
        throw new ValidationError(
          `Razorpay payment not captured: ${payment.status}`,
        );
      }

      return {
        paymentId: payment.id,
        paymentUpdate: {
          razorpayPaymentId: payment.id,
          // `fee` appears once the payment is captured; an authorized-only
          // payment reports none, and gatewayFeeUpdate writes nothing for it.
          ...gatewayFeeUpdate(razorpayFee(payment)),
        },
        customerEmail: payment.email || undefined,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}
