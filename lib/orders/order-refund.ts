import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import {
  capturePayPalOrder as _capturePayPalOrder,
  refundPayPalCapture,
  type PayPalMode,
} from "@/lib/payments/paypal";
import {
  getRazorpayCredentials,
  isRazorpayConfigured,
  refundRazorpayPayment,
} from "@/lib/payments/razorpay";
import {
  getPaystackCredentials,
  isPaystackConfigured,
  refundPaystackTransaction,
} from "@/lib/payments/paystack";
import {
  getPesapalCredentials,
  refundPesapalTransaction,
} from "@/lib/payments/pesapal";
import { resolvePesapalCredentials } from "@/lib/settings/credentials";
import { getSettings } from "@/models/settings.model";
import { refundSettlesOutOfBand } from "@/lib/returns/refund-settlement";

// Reference unused import to keep tree-shaking happy without breaking types.
void _capturePayPalOrder;

type RefundGatewayResult = {
  /** Whether the gateway was actually called. */
  gatewayCalled: boolean;
  /** Provider that handled the refund (or "manual" if recorded only). */
  provider: string;
  /** Provider-specific refund identifier, when available. */
  externalRefundId?: string;
  /**
   * Every gateway refund this call raised, when it took more than one.
   *
   * A deposit-mode pre-order is settled by TWO Stripe charges — the deposit
   * taken at checkout and the balance taken later — so a refund that is larger
   * than the deposit has to reach both. The caller records them all against
   * the one refund row it writes, which is what stops the gateway's own
   * `charge.refunded` webhook from recording the second one a second time.
   */
  externalRefundIds?: string[];
  /** Provider-specific refund status string, when available. */
  status?: string;
};

type OrderRefundContext = {
  paymentMethod?: string;
  channel?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  /** The second Stripe charge on a deposit-mode pre-order — see below. */
  preorderBalancePaymentIntentId?: string;
  paypalCaptureId?: string;
  razorpayPaymentId?: string;
  paystackTransactionId?: string;
  pesapalConfirmationCode?: string;
  currency?: string;
};

function normalizeMethod(value?: string) {
  return String(value || "").toLowerCase();
}

/**
 * Process a refund through the appropriate payment gateway.
 *
 * Supported automatic refunds: Stripe (card), PayPal, Razorpay, Paystack, Pesapal.
 * Manual record-only paths: COD, manual, and POS channels — the caller is
 * expected to record a PaymentTransaction even when no gateway is called.
 *
 * Set `manual: true` to skip the gateway and treat the refund as already
 * settled out-of-band (e.g., refunded via a provider dashboard or in cash).
 */
export async function refundOrderPayment(params: {
  order: OrderRefundContext;
  amount: number;
  reason?: string;
  manual?: boolean;
  /** Who is issuing the refund; recorded in the gateway's audit trail. */
  actor?: string;
}): Promise<RefundGatewayResult> {
  const { order, amount, reason, manual, actor } = params;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Refund amount must be greater than 0");
  }

  const channel = normalizeMethod(order.channel);
  const method = normalizeMethod(order.paymentMethod);

  // POS, COD, manual, or explicit manual flag → no gateway call.
  // ioTec Pay collections and Orange Money web payments have no programmatic
  // refund API, so their refunds are always recorded out-of-band (issued by
  // hand in the ioTec / Orange merchant portal) rather than throwing the
  // "automatic refund not supported" fallback below. MTN MoMo is out-of-band
  // for a different reason: its Disbursements product does carry a refund
  // call, but that is a separate subscription with separate credentials and
  // production IP whitelisting a Collections merchant does not automatically
  // hold — a real branch below can replace its OUT_OF_BAND_METHODS entry
  // once Disbursements is onboarded. Adding a gateway branch for any of them
  // below would be unreachable until then: this gate returns first.
  //
  // The method test lives in `lib/refund-settlement.ts` so the return form can
  // ask the same question — "will this have to be paid by hand?" — without
  // importing every payment SDK to find out.
  if (manual || refundSettlesOutOfBand({ paymentMethod: method, channel })) {
    return { gatewayCalled: false, provider: manual ? "manual" : method || "manual" };
  }

  // Stripe card payments
  if (method === "card" || method === "stripe") {
    // A deposit-mode pre-order carries two charges: the deposit from checkout
    // and, once the shopper pays it, the balance. Refunding the order as a
    // whole is bigger than either one, so the intents are drained in turn —
    // deposit first, since it is the charge every such order has.
    const intentIds = [
      order.stripePaymentIntentId || order.paymentId,
      order.preorderBalancePaymentIntentId,
    ].filter(
      (id, index, all): id is string =>
        Boolean(id) && all.indexOf(id) === index,
    );
    if (intentIds.length === 0) {
      throw new Error(
        "Cannot refund via Stripe: order is missing a payment intent ID",
      );
    }
    const settings = await getSettings();
    const stripeSettings = settings.payment?.stripe;
    if (
      !stripeSettings?.enabled ||
      !isStripeSecretKeyConfigured(stripeSettings.secretKey)
    ) {
      throw new Error("Stripe is not configured for refunds");
    }
    // Use the same secret-key resolution as checkout so a merchant configured
    // via Settings UI (rather than env vars) can still issue refunds.
    const stripe = getStripeForSecretKey(stripeSettings.secretKey);
    const refundCurrency =
      order.currency || settings.general?.defaultCurrency || "USD";
    let remaining = toStripeAmount(amount, refundCurrency);

    // What each charge can still give back, asked BEFORE any money moves: a
    // shortfall discovered halfway through would leave the first refund issued
    // and the caller rolling the whole thing back as a failure.
    const headroom: Array<{ intentId: string; refundable: number }> = [];
    for (const intentId of intentIds) {
      const intent = await stripe.paymentIntents.retrieve(intentId, {
        expand: ["latest_charge"],
      });
      const charge = intent.latest_charge;
      const refundable =
        charge && typeof charge !== "string"
          ? Math.max(0, (charge.amount_captured ?? 0) - (charge.amount_refunded ?? 0))
          : Math.max(0, intent.amount_received ?? 0);
      if (refundable > 0) headroom.push({ intentId, refundable });
    }
    const available = headroom.reduce((sum, entry) => sum + entry.refundable, 0);
    if (available < remaining) {
      throw new Error(
        "Refund exceeds what is left on this order's card payments",
      );
    }

    const refundIds: string[] = [];
    let lastStatus: string | undefined;
    for (const entry of headroom) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, entry.refundable);
      if (take <= 0) continue;
      const refund = await stripe.refunds.create({
        payment_intent: entry.intentId,
        amount: take,
        reason: "requested_by_customer",
        metadata: reason ? { note: reason.slice(0, 500) } : undefined,
      });
      refundIds.push(refund.id);
      lastStatus = refund.status || lastStatus;
      remaining -= take;
    }

    return {
      gatewayCalled: true,
      provider: "stripe",
      externalRefundId: refundIds[0],
      externalRefundIds: refundIds,
      status: lastStatus,
    };
  }

  // PayPal
  if (method === "paypal") {
    const captureId = order.paypalCaptureId;
    if (!captureId) {
      throw new Error(
        "Cannot refund via PayPal: order is missing a capture ID",
      );
    }
    const settings = await getSettings();
    const paypal = settings.payment?.paypal;
    if (!paypal?.enabled || !paypal.clientId || !paypal.clientSecret) {
      throw new Error("PayPal is not configured for refunds");
    }
    const result = await refundPayPalCapture({
      creds: {
        clientId: paypal.clientId,
        clientSecret: paypal.clientSecret,
        mode: ((paypal.mode as PayPalMode) || "sandbox") as PayPalMode,
      },
      captureId,
      amount,
      currency: order.currency,
      reason,
    });
    return {
      gatewayCalled: true,
      provider: "paypal",
      externalRefundId: result.refundId,
      status: result.status,
    };
  }

  // Razorpay
  if (method === "razorpay") {
    const paymentId = order.razorpayPaymentId || order.paymentId;
    if (!paymentId) {
      throw new Error(
        "Cannot refund via Razorpay: order is missing a payment ID",
      );
    }
    const settings = await getSettings();
    const razorpay = settings.payment?.razorpay;
    if (
      !razorpay?.enabled ||
      !isRazorpayConfigured(razorpay.keyId, razorpay.keySecret)
    ) {
      throw new Error("Razorpay is not configured for refunds");
    }
    const creds = getRazorpayCredentials({
      keyId: razorpay.keyId,
      keySecret: razorpay.keySecret,
    });
    const result = await refundRazorpayPayment({
      creds,
      paymentId,
      amount,
      currency: order.currency,
      notes: reason ? { reason: reason.slice(0, 255) } : undefined,
    });
    return {
      gatewayCalled: true,
      provider: "razorpay",
      externalRefundId: result.id,
      status: result.status,
    };
  }

  // Paystack
  if (method === "paystack") {
    const reference = order.paystackTransactionId || order.paymentId;
    if (!reference) {
      throw new Error(
        "Cannot refund via Paystack: order is missing a transaction reference",
      );
    }
    const settings = await getSettings();
    const paystack = settings.payment?.paystack;
    if (
      !paystack?.enabled ||
      !isPaystackConfigured(paystack.secretKey)
    ) {
      throw new Error("Paystack is not configured for refunds");
    }
    const creds = getPaystackCredentials({
      secretKey: paystack.secretKey,
      publicKey: paystack.publicKey,
    });
    const result = await refundPaystackTransaction({
      creds,
      transaction: reference,
      amount,
      currency: order.currency,
      reason,
    });
    return {
      gatewayCalled: true,
      provider: "paystack",
      externalRefundId: String(result.id),
      status: result.status,
    };
  }

  if (method === "pesapal") {
    const confirmationCode = order.pesapalConfirmationCode;
    if (!confirmationCode) {
      throw new Error(
        "Cannot refund via Pesapal: order is missing a confirmation code",
      );
    }
    const settings = await getSettings();
    const resolved = resolvePesapalCredentials(settings.payment?.pesapal);
    if (!settings.payment?.pesapal?.enabled) {
      throw new Error("Pesapal is not configured for refunds");
    }
    const creds = getPesapalCredentials(resolved);
    const result = await refundPesapalTransaction({
      creds,
      confirmationCode,
      amount,
      // Shows up in Pesapal's refund audit trail, so name the actual actor.
      username: actor || "Store admin",
      remarks: reason || "Order refund",
    });
    return {
      gatewayCalled: true,
      provider: "pesapal",
      externalRefundId: confirmationCode,
      status: String(result.status || "200"),
    };
  }

  throw new Error(
    `Automatic refund is not supported for payment method "${method}". Pass manual: true to record an out-of-band refund.`,
  );
}
