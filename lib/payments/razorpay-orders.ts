import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  toRazorpayAmountSubunits,
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
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
};

/** Settles the order behind a captured Razorpay payment. */
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
    verify: (order) => {
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

      const expectedAmount = toRazorpayAmountSubunits(
        amountDueNow(order),
        expectedCurrency,
      );
      if (Number(params.payment.amount) !== expectedAmount) {
        throw new ValidationError("Razorpay amount mismatch");
      }

      if (
        params.payment.status !== "captured" &&
        params.payment.captured !== true
      ) {
        throw new ValidationError(
          `Razorpay payment not captured: ${params.payment.status}`,
        );
      }

      return {
        paymentId: params.payment.id,
        paymentUpdate: {
          razorpayPaymentId: params.payment.id,
          // `fee` appears once the payment is captured; an authorized-only
          // payment reports none, and gatewayFeeUpdate writes nothing for it.
          ...gatewayFeeUpdate(razorpayFee(params.payment)),
        },
        customerEmail: params.payment.email || undefined,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
  });
}
