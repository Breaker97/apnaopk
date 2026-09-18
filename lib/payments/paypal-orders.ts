import { Order } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import {
  captureOrReadPayPalOrder,
  type PayPalCredentials,
} from "@/lib/payments/paypal";
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
  /**
   * Set by the webhook, which only calls once PayPal reports the capture
   * complete. The money is already taken then, so a cancelled order may be
   * verified — and refunded — instead of left holding it.
   */
  alreadyCaptured?: boolean;
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
      // The capture runs inside `verify`, so a cancelled order is never
      // captured at all rather than captured and refunded — unless PayPal has
      // already said it was.
      capturesOnVerify: !params.alreadyCaptured,
    },
    findOrder: (scope) =>
      Order.findOne({ ...scope, paypalOrderId: params.paypalOrderId }),
    notFoundMessage: "Order not found for PayPal capture",
    verify: async (order) => {
      const capture = await captureOrReadPayPalOrder({
        creds: params.creds,
        orderId: params.paypalOrderId,
      });

      if (!capture.captureId) {
        throw new ValidationError("PayPal capture failed: missing capture id");
      }

      // The CAPTURE's status, never the order's. PayPal marks the order
      // COMPLETED while holding the capture PENDING — a payment review, an
      // eCheck, a receiving preference — and a pending capture can still be
      // denied. Reading the order's status first shipped goods on money that
      // never arrived. A pending capture stays unrecorded until the webhook
      // reports it complete.
      const captureStatus =
        capture.raw?.purchase_units?.[0]?.payments?.captures?.[0]?.status;
      if (captureStatus !== "COMPLETED") {
        throw new ValidationError(
          `PayPal payment not completed yet: ${captureStatus || "unknown"}`,
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
  });
}
