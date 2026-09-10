import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import { capturePayPalOrder, type PayPalCredentials } from "@/lib/payments/paypal";
import { gatewayFeeUpdate, paypalFee } from "@/lib/payments/gateway-fee";
import {
  amountDueNow,
  finalizeCapturedOrder,
  type SettingsDocument,
} from "@/lib/payments/finalize-order";

type FinalizePayPalOrderParams = {
  /** PayPal's order id, stored on the order at checkout. */
  paypalOrderId: string;
  creds: PayPalCredentials;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
  actor?: AuditContext;
  schedule?: (task: () => Promise<void>) => void;
};

/**
 * Captures a PayPal order the shopper has approved and settles the order
 * behind it. The capture call itself runs inside the verifier, i.e. only for
 * an order that is still pending and not cancelled — money is never taken
 * for an order nobody can fulfil.
 */
export function finalizePayPalOrder(params: FinalizePayPalOrderParams) {
  return finalizeCapturedOrder({
    provider: {
      paymentMethod: "paypal",
      label: "PayPal",
      recoveryGateway: "paypal",
    },
    findOrder: (scope) =>
      Order.findOne({ ...scope, paypalOrderId: params.paypalOrderId }),
    notFoundMessage: "Order not found for PayPal capture",
    verify: async (order) => {
      const capture = await capturePayPalOrder({
        creds: params.creds,
        orderId: params.paypalOrderId,
      });

      if (!capture.captureId) {
        throw new ValidationError("PayPal capture failed: missing capture id");
      }

      const captureStatus =
        capture.raw?.status ||
        capture.raw?.purchase_units?.[0]?.payments?.captures?.[0]?.status;
      if (typeof captureStatus === "string" && captureStatus !== "COMPLETED") {
        throw new ValidationError(
          `PayPal capture not completed: ${captureStatus}`,
        );
      }

      const captureAmount =
        capture.raw?.purchase_units?.[0]?.payments?.captures?.[0]?.amount
          ?.value;
      const captureCurrency =
        capture.raw?.purchase_units?.[0]?.payments?.captures?.[0]?.amount
          ?.currency_code;

      // A completed capture ALWAYS carries amount+currency. Missing fields
      // mean we are looking at something other than a capture (e.g. an
      // authorization) — previously verification was silently skipped in
      // that case, letting an unverified payment mark the order paid. Reject
      // instead.
      if (
        typeof captureAmount !== "string" ||
        typeof captureCurrency !== "string"
      ) {
        throw new ValidationError(
          "PayPal capture response is missing amount details",
        );
      }

      const expectedCurrency = (
        order.currency ||
        params.settings.general?.defaultCurrency ||
        "USD"
      ).toUpperCase();
      if (captureCurrency !== expectedCurrency) {
        throw new ValidationError("PayPal currency mismatch");
      }
      const capturedCents = Math.round(Number(captureAmount) * 100);
      const expectedCents = Math.round(amountDueNow(order) * 100);
      if (!Number.isFinite(capturedCents) || capturedCents !== expectedCents) {
        throw new ValidationError("PayPal amount mismatch");
      }

      return {
        paymentId: capture.captureId,
        paymentUpdate: {
          paypalCaptureId: capture.captureId,
          // The capture response is the only place PayPal states its cut; the
          // order-details API does not repeat the breakdown afterwards.
          ...gatewayFeeUpdate(paypalFee(capture.raw)),
        },
        customerEmail: capture.raw?.payer?.email_address || undefined,
      };
    },
    settings: params.settings,
    sessionUserId: params.sessionUserId,
    cartSessionId: params.cartSessionId,
    customerEmail: params.customerEmail,
    actor: params.actor,
    schedule: params.schedule,
  });
}
