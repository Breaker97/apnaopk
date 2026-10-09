import {
  fromStripeAmount,
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import {
  capturePayPalOrder as _capturePayPalOrder,
  getPayPalOrderRefundable,
  refundPayPalCapture,
  type PayPalCredentials,
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
import {
  isOfflineBalanceReference,
  isPayPalBalanceReference,
  isStripeBalanceReference,
  payPalCaptureIdFromBalanceReference,
} from "@/lib/payments/preorder-balance-reference";

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
  /** Individual evidence for split charges/providers; an aggregate last status cannot settle them. */
  refundReports?: Array<{ id: string; provider: string; amount: number; status: string }>;
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
  /** The checkout's PayPal order — asked how much of the deposit is refundable. */
  paypalOrderId?: string;
  /** The PayPal order that collected the balance, when PayPal collected it. */
  preorderBalancePaypalOrderId?: string;
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
  /**
   * Makes a repeat of THIS refund request return the refund already made
   * instead of a second one, where the gateway honours it (Stripe's
   * idempotency key, PayPal's request id). A caller that may run again after
   * a crash — the pre-order lifecycle worker — passes a stable one.
   */
  idempotencyKey?: string;
  /** Tags the gateway refund, so a resumed caller can find what it made. */
  gatewayMetadata?: Record<string, string>;
}): Promise<RefundGatewayResult> {
  const { order, amount, reason, manual, actor } = params;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Refund amount must be greater than 0");
  }

  const channel = normalizeMethod(order.channel);
  const method = normalizeMethod(order.paymentMethod);

  // Anything a gateway branch below cannot refund, or an explicit manual
  // flag, is recorded as paid back by hand: POS cash, COD, manual and bank
  // transfers, and the mobile-money methods (ioTec and Orange Money have no
  // refund API; MTN's needs the separate Disbursements product). A new
  // gateway branch here must add its method to GATEWAY_REFUND_METHODS, or
  // this gate returns first and the branch is never reached.
  //
  // The method test lives in `lib/refund-settlement.ts` so the return form can
  // ask the same question — "will this have to be paid by hand?" — without
  // importing every payment SDK to find out.
  if (manual || refundSettlesOutOfBand({
      paymentMethod: method,
      channel,
      stripePaymentIntentId: order.stripePaymentIntentId,
    })) {
    return { gatewayCalled: false, provider: manual ? "manual" : method || "manual" };
  }

  // A pre-order whose money sits on more than one gateway — a card deposit and
  // a PayPal balance, a PayPal deposit and a card one, or two PayPal captures —
  // cannot be refunded by any single branch below: each gives back only the
  // charge it knows, and the other half was simply unreachable.
  const legs = preorderRefundLegs(order, method);
  if (legs) {
    return refundAcrossPreorderLegs({
      order,
      legs,
      amount,
      reason,
      idempotencyKey: params.idempotencyKey,
      gatewayMetadata: params.gatewayMetadata,
    });
  }

  // Stripe card payments
  if (method === "card" || method === "stripe") {
    // A deposit-mode pre-order carries two charges: the deposit from checkout
    // and, once the shopper pays it, the balance. Refunding the order as a
    // whole is bigger than either one, so the intents are drained in turn —
    // deposit first, since it is the charge every such order has.
    //
    // Unless the balance never went through Stripe at all. An admin recording
    // money that arrived by hand stores `offline:<receipt>` in the same field,
    // and handing that to `paymentIntents.retrieve` does not degrade — Stripe
    // raises "no such payment_intent" and takes the DEPOSIT refund down with
    // it, so an order whose balance was recorded offline could not be refunded
    // at all, not even partially.
    const balanceRecordedOffline = isOfflineBalanceReference(
      order.preorderBalancePaymentIntentId,
    );
    const intentIds = [
      order.stripePaymentIntentId || order.paymentId,
      // A balance PayPal collected never reaches this branch — the legs path
      // above takes it — but only a Stripe intent may ever be handed to
      // Stripe, whatever else lands in the field in future.
      isStripeBalanceReference(order.preorderBalancePaymentIntentId)
        ? order.preorderBalancePaymentIntentId
        : undefined,
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
      // Naming the offline balance matters here: the shortfall is not a bug to
      // retry but money that arrived as cash or a transfer, which has to go
      // back the same way. Without saying so, the admin reads a generic
      // "exceeds" error and has no idea a second payment is involved at all.
      throw new Error(
        balanceRecordedOffline
          ? "This pre-order's balance was recorded outside the gateway, so only the deposit can be refunded automatically — return the balance the way it arrived"
          : "Refund exceeds what is left on this order's card payments",
      );
    }

    const refundIds: string[] = [];
    const refundReports: NonNullable<RefundGatewayResult["refundReports"]> = [];
    let lastStatus: string | undefined;
    // What went back, in Stripe's units, for a part-failure to report.
    let refundedMinor = 0;
    // A little before now, for asking Stripe what this attempt already made.
    const attemptStartedAt = Math.floor(Date.now() / 1000) - 5;
    for (const entry of headroom) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, entry.refundable);
      if (take <= 0) continue;
      let refund: { id: string; status?: string | null };
      try {
        const body = {
          payment_intent: entry.intentId,
          amount: take,
          reason: "requested_by_customer" as const,
          metadata: refundMetadata(reason, params.gatewayMetadata),
        };
        refund = await (params.idempotencyKey
          ? stripe.refunds.create(body, {
              idempotencyKey: `${params.idempotencyKey}:${entry.intentId}:${take}`,
            })
          : stripe.refunds.create(body));
      } catch (err) {
        // The connection dropped, or Stripe's own server failed: the refund
        // may have been made before the answer was lost. Asked of Stripe
        // rather than assumed failed — rolled back as a failure, a refund
        // that had gone through was sent again by the admin's retry.
        const landed = refundOutcomeUnknown(err)
          ? await findLandedStripeRefund({
              stripe,
              intentId: entry.intentId,
              amount: take,
              since: attemptStartedAt,
              metadata: params.gatewayMetadata,
              exclude: refundIds,
            })
          : null;
        if (!landed) {
          if (refundIds.length === 0) throw unknownOutcomeError("Stripe", err);
          // The deposit went back and the balance did not. Said plainly, as
          // the multi-gateway path says it, so nobody refunds the first part
          // twice: the gateway's own notification records it.
          const message = err instanceof Error ? err.message : String(err);
          throw new PartialRefundError(
            `Part of this refund went through (${refundIds.join(", ")}) but the next part failed: ${message}. The part already refunded is recorded from the gateway's own notification — refund only the remainder again.`,
            {
              refundedAmount: fromStripeAmount(refundedMinor, refundCurrency),
              refundIds: [...refundIds],
              refundReports: [...refundReports],
              provider: "stripe",
              failure: message,
            },
          );
        }
        refund = landed;
      }
      const refused = refusedRefundStatus("Stripe", refund.status);
      if (refused) {
        if (refundIds.length === 0) assertRefundNotRefused("Stripe", refund.status);
        throw new PartialRefundError(
          `Part of this refund went through (${refundIds.join(", ")}) but the next part failed: ${refused}. The part already refunded is recorded from the gateway's own notification — refund only the remainder again.`,
          {
            refundedAmount: fromStripeAmount(refundedMinor, refundCurrency),
            refundIds: [...refundIds, refund.id],
            refundReports: [...refundReports, { id: refund.id, provider: "stripe", amount: fromStripeAmount(take, refundCurrency), status: String(refund.status || "failed") }],
            provider: "stripe",
            failure: refused,
          },
        );
      }
      refundIds.push(refund.id);
      refundReports.push({ id: refund.id, provider: "stripe", amount: fromStripeAmount(take, refundCurrency), status: String(refund.status || "pending") });
      lastStatus = refund.status || lastStatus;
      refundedMinor += take;
      remaining -= take;
    }

    return {
      gatewayCalled: true,
      provider: "stripe",
      externalRefundId: refundIds[0],
      externalRefundIds: refundIds,
      refundReports,
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
      requestId: params.idempotencyKey
        ? `${params.idempotencyKey}:${captureId}`
        : undefined,
    }).catch((err: unknown) => {
      throw unknownOutcomeError("PayPal", err);
    });
    assertRefundNotRefused("PayPal", result.status);
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
    }).catch((err: unknown) => {
      throw unknownOutcomeError("Razorpay", err);
    });
    assertRefundNotRefused("Razorpay", result.status);
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
    }).catch((err: unknown) => {
      throw unknownOutcomeError("Paystack", err);
    });
    assertRefundNotRefused("Paystack", result.status);
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
    }).catch((err: unknown) => {
      throw unknownOutcomeError("Pesapal", err);
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

/**
 * A refund split across two charges whose first part went through and whose
 * next part did not.
 *
 * Carries what went, so a caller that can record it — a return, whose claim
 * it belongs on — does so, rather than handing the whole claim back and
 * leaving the part already paid refundable a second time.
 */
export class PartialRefundError extends Error {
  readonly refundedAmount: number;
  readonly refundIds: string[];
  readonly refundReports?: RefundGatewayResult["refundReports"];
  readonly provider: string;
  /** Why the next part failed, as the gateway said it. */
  readonly failure: string;

  constructor(
    message: string,
    details: {
      refundedAmount: number;
      refundIds: string[];
      refundReports?: RefundGatewayResult["refundReports"];
      provider: string;
      failure: string;
    },
  ) {
    super(message);
    this.name = "PartialRefundError";
    this.refundedAmount = details.refundedAmount;
    this.refundIds = details.refundIds;
    this.refundReports = details.refundReports;
    this.provider = details.provider;
    this.failure = details.failure;
  }
}

/** Statuses a gateway can answer a refund request with that mean it did not go. */
const REFUSED_REFUND_STATUSES = new Set(["failed", "canceled", "cancelled"]);

/**
 * The reason, when a gateway answered the refund request with a refund that
 * had already failed, or null when it did not.
 *
 * Stripe, PayPal, Razorpay and Paystack can each say so in the create
 * response itself. Recorded as money that went, such a refund stood until a
 * failure report arrived — and a report arriving before the row was written
 * found nothing to reverse, so the refund stood for good.
 */
function refusedRefundStatus(gateway: string, status: unknown): string | null {
  const value = String(status || "").trim().toLowerCase();
  return REFUSED_REFUND_STATUSES.has(value)
    ? `${gateway} refused the refund (${value})`
    : null;
}

function assertRefundNotRefused(gateway: string, status: unknown): void {
  const refused = refusedRefundStatus(gateway, status);
  if (refused) {
    throw new Error(
      `${refused}. Nothing was sent back — try again, or refund the shopper by hand.`,
    );
  }
}

/**
 * Whether an error leaves it unknown if the refund went through.
 *
 * A refusal — a declined refund, too little balance, a bad amount — is the
 * gateway's answer, and nothing moved. A dropped connection, a timeout or the
 * gateway's own server failing is not an answer at all: the refund may have
 * been made before the reply was lost.
 */
function refundOutcomeUnknown(err: unknown): boolean {
  const error = err as {
    type?: string;
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string; name?: string };
  } | null;
  if (!error) return false;
  if (error.type === "StripeConnectionError" || error.type === "StripeAPIError") {
    return true;
  }
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  const code = String(error.code || error.cause?.code || "");
  if (
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "UND_ERR_SOCKET",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
    ].includes(code)
  ) {
    return true;
  }
  return error.name === "TypeError" && /fetch failed/i.test(String(error.message || ""));
}

/**
 * The error to hand back when nobody knows whether the money went.
 *
 * Read as a plain failure, the admin retried — and a refund that had gone
 * through was sent a second time. What happened is on the gateway: if the
 * refund was made, its report records it on the order by itself.
 */
function unknownOutcomeError(gateway: string, err: unknown): unknown {
  if (!refundOutcomeUnknown(err)) return err;
  return new RefundOutcomeUnknownError(gateway);
}

/**
 * Nobody knows whether this refund went through — the gateway's answer was
 * lost. Never to be read as a refusal: retried as one, a refund that had gone
 * through was sent a second time. Reconciled against the gateway (or its own
 * report) before anything is sent again.
 */
export class RefundOutcomeUnknownError extends Error {
  readonly gateway: string;

  constructor(gateway: string) {
    super(
      `${gateway} did not answer, so it is not known whether this refund went through. Check the ${gateway} dashboard before refunding again — a refund that went through appears on the order by itself.`,
    );
    this.name = "RefundOutcomeUnknownError";
    this.gateway = gateway;
  }
}

/** The refund's note plus a caller's tags, within Stripe's metadata limits. */
function refundMetadata(
  reason: string | undefined,
  extra: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const metadata: Record<string, string> = {
    ...(reason ? { note: reason.slice(0, 500) } : {}),
    ...(extra || {}),
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * A refund Stripe made for this attempt although its answer never arrived:
 * on the same intent, for the same amount, since the attempt began.
 */
async function findLandedStripeRefund(params: {
  stripe: ReturnType<typeof getStripeForSecretKey>;
  intentId: string;
  /** Minor units, as the refund was asked for. */
  amount: number;
  since: number;
  metadata?: Record<string, string>;
  /** Refunds this attempt already counted. */
  exclude: string[];
}) {
  try {
    const recent = await params.stripe.refunds.list({
      payment_intent: params.intentId,
      created: { gte: params.since },
      limit: 20,
    });
    return (
      recent.data.find(
        (refund) =>
          refund.amount === params.amount &&
          (!params.metadata || Object.entries(params.metadata).every(([key, value]) => refund.metadata?.[key] === value)) &&
          !params.exclude.includes(refund.id) &&
          refund.status !== "failed" &&
          refund.status !== "canceled",
      ) ?? null
    );
  } catch {
    return null;
  }
}

/** One charge a pre-order's money sits on. */
type PreorderRefundLeg =
  | { gateway: "stripe"; intentId: string }
  | { gateway: "paypal"; captureId: string; paypalOrderId?: string };

/**
 * The charges behind a pre-order whose money is not all on one gateway.
 *
 * Null for every order the existing branches already handle whole — which is
 * nearly all of them, including the card deposit with a card balance, whose
 * two Stripe intents the Stripe branch has always drained in turn. Only a
 * PayPal half, or a PayPal deposit with any balance, comes here; the rest are
 * deliberately left on paths that are already proven.
 *
 * Deposit first, then balance, and never the same capture twice: a pay-later
 * order paid with PayPal is stamped `paypal` with no `paypalCaptureId`, so its
 * one capture appears once, as the balance.
 */
function preorderRefundLegs(
  order: OrderRefundContext,
  method: string,
): PreorderRefundLeg[] | null {
  const balance = order.preorderBalancePaymentIntentId;
  const balanceOnPayPal = isPayPalBalanceReference(balance);
  const depositOnPayPal = method === "paypal";
  if (!balanceOnPayPal && !(depositOnPayPal && balance)) return null;

  const legs: PreorderRefundLeg[] = [];
  if (method === "card" || method === "stripe") {
    const intentId = order.stripePaymentIntentId || order.paymentId;
    if (intentId) legs.push({ gateway: "stripe", intentId });
  } else if (depositOnPayPal && order.paypalCaptureId) {
    legs.push({
      gateway: "paypal",
      captureId: order.paypalCaptureId,
      paypalOrderId: order.paypalOrderId,
    });
  }

  const balanceCaptureId = payPalCaptureIdFromBalanceReference(balance);
  if (
    balanceCaptureId &&
    !legs.some((leg) => leg.gateway === "paypal" && leg.captureId === balanceCaptureId)
  ) {
    legs.push({
      gateway: "paypal",
      captureId: balanceCaptureId,
      paypalOrderId: order.preorderBalancePaypalOrderId,
    });
  } else if (
    isStripeBalanceReference(balance) &&
    !legs.some((leg) => leg.gateway === "stripe" && leg.intentId === balance)
  ) {
    legs.push({ gateway: "stripe", intentId: balance });
  }
  // An offline balance adds no leg: it never went through a gateway, so it
  // cannot come back through one. The headroom check below names it.
  return legs;
}

/**
 * Refund across every charge a pre-order's money sits on.
 *
 * Each leg is asked what it can still give back BEFORE any money moves —
 * Stripe from the charge, PayPal from its order — for the reason the Stripe
 * branch gives: a shortfall found halfway would leave the first refund issued
 * and the caller rolling the whole thing back as a failure. Asked of the
 * gateways rather than our books, so a refund issued from either dashboard is
 * never offered a second time.
 *
 * What pre-checking cannot rule out is a gateway failing mid-way for its own
 * reasons. Then the part already refunded is real, the caller records nothing,
 * and the gateway's refund webhook — which finds both halves now — records it.
 * The error says so, so nobody retries the part that already went back.
 */
async function refundAcrossPreorderLegs(params: {
  order: OrderRefundContext;
  legs: PreorderRefundLeg[];
  amount: number;
  reason?: string;
  idempotencyKey?: string;
  gatewayMetadata?: Record<string, string>;
}): Promise<RefundGatewayResult> {
  const { order, legs, amount, reason } = params;
  const settings = await getSettings();
  const currency = String(
    order.currency || settings.general?.defaultCurrency || "USD",
  ).toUpperCase();

  const needsStripe = legs.some((leg) => leg.gateway === "stripe");
  const needsPayPal = legs.some((leg) => leg.gateway === "paypal");

  const stripeSettings = settings.payment?.stripe;
  if (
    needsStripe &&
    (!stripeSettings?.enabled || !isStripeSecretKeyConfigured(stripeSettings.secretKey))
  ) {
    throw new Error("Stripe is not configured for refunds");
  }
  const stripe = needsStripe ? getStripeForSecretKey(stripeSettings?.secretKey) : null;

  const paypal = settings.payment?.paypal;
  if (needsPayPal && (!paypal?.enabled || !paypal.clientId || !paypal.clientSecret)) {
    throw new Error("PayPal is not configured for refunds");
  }
  const paypalCreds: PayPalCredentials | null = needsPayPal
    ? {
        clientId: String(paypal?.clientId),
        clientSecret: String(paypal?.clientSecret),
        mode: ((paypal?.mode as PayPalMode) || "sandbox") as PayPalMode,
      }
    : null;

  // Hundredths throughout: PayPal quotes to two places, and whole-unit
  // currencies carry through the same arithmetic unchanged.
  const toHundredths = (value: number) => Math.round(value * 100);

  const headroom: Array<{ leg: PreorderRefundLeg; refundable: number }> = [];
  for (const leg of legs) {
    if (leg.gateway === "stripe" && stripe) {
      const intent = await stripe.paymentIntents.retrieve(leg.intentId, {
        expand: ["latest_charge"],
      });
      const charge = intent.latest_charge;
      const minor =
        charge && typeof charge !== "string"
          ? Math.max(0, (charge.amount_captured ?? 0) - (charge.amount_refunded ?? 0))
          : Math.max(0, intent.amount_received ?? 0);
      headroom.push({ leg, refundable: toHundredths(fromStripeAmount(minor, currency)) });
    } else if (leg.gateway === "paypal" && paypalCreds) {
      if (!leg.paypalOrderId) {
        // Without the order PayPal cannot say what is left, and a guessed
        // figure is how money gets refunded twice.
        throw new Error(
          "Cannot refund via PayPal: this pre-order is missing the PayPal order its payment was made on",
        );
      }
      const { refundable } = await getPayPalOrderRefundable({
        creds: paypalCreds,
        orderId: leg.paypalOrderId,
      });
      headroom.push({ leg, refundable: toHundredths(refundable) });
    }
  }

  let remaining = toHundredths(amount);
  const available = headroom.reduce((sum, entry) => sum + entry.refundable, 0);
  if (available < remaining) {
    throw new Error(
      isOfflineBalanceReference(order.preorderBalancePaymentIntentId)
        ? "This pre-order's balance was recorded outside the gateway, so only the deposit can be refunded automatically — return the balance the way it arrived"
        : "Refund exceeds what is left on this order's payments",
    );
  }

  const refundIds: string[] = [];
  const refundReports: NonNullable<RefundGatewayResult["refundReports"]> = [];
  const providers: string[] = [];
  let lastStatus: string | undefined;
  let refundedHundredths = 0;
  for (const entry of headroom) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, entry.refundable);
    if (take <= 0) continue;
    try {
      if (entry.leg.gateway === "stripe" && stripe) {
        const minor = toStripeAmount(take / 100, currency);
        const body = {
          payment_intent: entry.leg.intentId,
          amount: minor,
          reason: "requested_by_customer" as const,
          metadata: refundMetadata(reason, params.gatewayMetadata),
        };
        const refund = await (params.idempotencyKey
          ? stripe.refunds.create(body, {
              idempotencyKey: `${params.idempotencyKey}:${entry.leg.intentId}:${minor}`,
            })
          : stripe.refunds.create(body));
        assertRefundNotRefused("Stripe", refund.status);
        refundIds.push(refund.id);
        refundReports.push({ id: refund.id, provider: "stripe", amount: take / 100, status: String(refund.status || "pending") });
        providers.push("stripe");
        lastStatus = refund.status || lastStatus;
      } else if (entry.leg.gateway === "paypal" && paypalCreds) {
        const result = await refundPayPalCapture({
          creds: paypalCreds,
          captureId: entry.leg.captureId,
          amount: take / 100,
          currency,
          reason,
          requestId: params.idempotencyKey
            ? `${params.idempotencyKey}:${entry.leg.captureId}`
            : undefined,
        });
        assertRefundNotRefused("PayPal", result.status);
        if (result.refundId) {
          refundIds.push(result.refundId);
          refundReports.push({ id: result.refundId, provider: "paypal", amount: take / 100, status: String(result.status || "PENDING") });
        }
        providers.push("paypal");
        lastStatus = result.status || lastStatus;
      }
    } catch (err) {
      if (refundIds.length === 0) {
        throw unknownOutcomeError(
          entry.leg.gateway === "stripe" ? "Stripe" : "PayPal",
          err,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new PartialRefundError(
        `Part of this refund went through (${refundIds.join(", ")}) but the next part failed: ${message}. The part already refunded is recorded from the gateway's own notification — refund only the remainder again.`,
        {
          refundedAmount: refundedHundredths / 100,
          refundIds: [...refundIds],
          refundReports: [...refundReports],
          provider: providers[0] || "stripe",
          failure: message,
        },
      );
    }
    refundedHundredths += take;
    remaining -= take;
  }

  return {
    gatewayCalled: true,
    // Named for the charge refunded first. A refund spanning two gateways has
    // no single provider, and every id it raised is in `externalRefundIds`.
    provider: providers[0] || "manual",
    externalRefundId: refundIds[0],
    externalRefundIds: refundIds,
    refundReports,
    status: lastStatus,
  };
}
