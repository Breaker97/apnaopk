/**
 * Vendor→platform payments (product boosts, plan subscription periods) over
 * every storefront gateway — the first non-order payment rail in the app.
 *
 * Layer A gateway libs (lib/stripe.ts, lib/paypal.ts, …) are order-agnostic
 * and reused as-is; this module owns the PlatformPayment attempt record,
 * initiation per provider, authoritative verification, and the guarded
 * mark-paid + kind dispatch that every completion route (webhook, IPN,
 * callback, verify) funnels into. Non-Stripe gateways have no webhook-event
 * lease, so the guarded update here is the idempotency line.
 */

import { Types } from "mongoose";
import type Stripe from "stripe";
import { BoostCampaign, PlatformPayment } from "@/models";
import type { IPlatformPayment } from "@/models/platformPayment.model";
import { PLATFORM_PAYMENT_REFERENCE_PREFIX } from "@/models/platformPayment.model";
import type {
  IPlatformPaymentMethodSettings,
  ISettings,
} from "@/models/settings.model";
import {
  getOrangeMoneyCredentials,
  getOrangeMoneyTransactionState,
  getOrangeMoneyTransactionStatus,
  isOrangeMoneyCurrency,
  ORANGE_MONEY_CURRENCIES,
  orangeMoneyChargeCurrency,
  submitOrangeMoneyPayment,
} from "@/lib/payments/orange-money";
import {
  getMtnMomoCredentials,
  getMtnMomoRequestToPayStatus,
  getMtnMomoTransactionState,
  isMtnMomoCurrency,
  MTN_MOMO_CURRENCIES,
  MtnMomoApiError,
  mtnMomoCallbackUrl,
  mtnMomoChargeCurrency,
  normalizeMtnMomoMsisdn,
  requestMtnMomoPayment,
} from "@/lib/payments/mtn-momo";
import { randomUUID } from "crypto";
import { ValidationError } from "@/lib/api/errors";
import { getStripeForSecretKey, toStripeAmount } from "@/lib/payments/stripe";
import {
  amountsMatchForCurrency,
  currencyMinorUnitExponent,
} from "@/lib/intl/money";
import { assertStripeBillingReady } from "@/lib/vendors/vendor-plan-stripe";
import {
  resolveIotecCredentials,
  resolveMtnMomoCredentials,
  resolveOrangeMoneyCredentials,
  resolvePayPalCredentials,
  resolvePesapalCredentials,
} from "@/lib/settings/credentials";
import { capturePayPalOrder, createPayPalOrder } from "@/lib/payments/paypal";
import {
  createRazorpayOrder,
  captureRazorpayPayment,
  fetchRazorpayPayment,
  getRazorpayCredentials,
  getRazorpayCurrencyExponent,
  verifyRazorpayPaymentSignature,
} from "@/lib/payments/razorpay";
import {
  getPaystackCredentials,
  getPaystackCurrencyExponent,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "@/lib/payments/paystack";
import {
  getPesapalCredentials,
  getPesapalTransactionState,
  getPesapalTransactionStatus,
  isPesapalCurrency,
  normalizePesapalCountryCode,
  PESAPAL_CURRENCIES,
  submitPesapalOrder,
  type PesapalTransactionStatus,
} from "@/lib/payments/pesapal";
import {
  IOTEC_CURRENCY,
  IOTEC_MIN_AMOUNT,
  getIotecCredentials,
  getIotecTransactionState,
  getIotecTransactionStatusByExternalId,
  normalizeUgandaMsisdn,
  submitIotecCardCollection,
  submitIotecCollection,
} from "@/lib/payments/iotec";
import { cancelBoostCampaign, fulfillBoostCampaign } from "@/lib/boosts/boosts";
import {
  BOOST_CANCEL_REASON,
  PLATFORM_PAYMENT_GATEWAYS,
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_PROVIDER,
  PLATFORM_PAYMENT_STATUS,
  type PlatformPaymentGateway,
  type PlatformPaymentKind,
} from "@/config/app.config";

// ---------------------------------------------------------------------------
// Gateway availability

/** Minimal credential presence per gateway — no network calls. An enabled
 * flag with no keys must not satisfy an approval/checkout gate that a real
 * charge would immediately fail. */
function gatewayConfigured(
  settings: ISettings,
  gateway: PlatformPaymentGateway,
): boolean {
  try {
    switch (gateway) {
      case PLATFORM_PAYMENT_PROVIDER.STRIPE:
        return Boolean(assertStripeBillingReady(settings));
      case PLATFORM_PAYMENT_PROVIDER.PAYPAL: {
        const creds = resolvePayPalCredentials(settings.payment?.paypal);
        return Boolean(creds.clientId && creds.clientSecret);
      }
      case PLATFORM_PAYMENT_PROVIDER.RAZORPAY: {
        const creds = getRazorpayCredentials({
          keyId: settings.payment?.razorpay?.keyId,
          keySecret: settings.payment?.razorpay?.keySecret,
        });
        return Boolean(creds.keyId && creds.keySecret);
      }
      case PLATFORM_PAYMENT_PROVIDER.PAYSTACK: {
        const creds = getPaystackCredentials({
          publicKey: settings.payment?.paystack?.publicKey,
          secretKey: settings.payment?.paystack?.secretKey,
        });
        return Boolean(creds.secretKey);
      }
      case PLATFORM_PAYMENT_PROVIDER.PESAPAL: {
        const creds = getPesapalCredentials(
          resolvePesapalCredentials(settings.payment?.pesapal),
        );
        return Boolean(creds.consumerKey && creds.consumerSecret && creds.ipnId);
      }
      case PLATFORM_PAYMENT_PROVIDER.IOTEC: {
        const creds = getIotecCredentials(
          resolveIotecCredentials(settings.payment?.iotec),
        );
        return Boolean(creds.clientId && creds.clientSecret && creds.walletId);
      }
      case PLATFORM_PAYMENT_PROVIDER.ORANGE_MONEY: {
        const creds = getOrangeMoneyCredentials(
          resolveOrangeMoneyCredentials(settings.payment?.orange_money),
        );
        return Boolean(
          creds.clientId && creds.clientSecret && creds.merchantKey,
        );
      }
      case PLATFORM_PAYMENT_PROVIDER.MTN_MOMO: {
        const creds = getMtnMomoCredentials(
          resolveMtnMomoCredentials(settings.payment?.mtn_momo),
        );
        return Boolean(creds.subscriptionKey && creds.apiUser && creds.apiKey);
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/**
 * The gateways a vendor may actually pay through: the feature's allowlist ∩
 * the gateway's own enabled flag in Payments ∩ credential presence ∩ hard
 * currency constraints. COD never appears — nothing is delivered for a
 * platform payment.
 */
export function resolvePlatformPaymentMethods(
  settings: ISettings,
  allowlist: Partial<IPlatformPaymentMethodSettings> | undefined,
): PlatformPaymentGateway[] {
  const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();
  return PLATFORM_PAYMENT_GATEWAYS.filter((gateway) => {
    if ((allowlist?.[gateway] ?? true) === false) return false;
    if (!settings.payment?.[gateway]?.enabled) return false;
    // ioTec settles UGX only; offering it under any other store currency
    // would silently mis-denominate the charge.
    if (gateway === PLATFORM_PAYMENT_PROVIDER.IOTEC && currency !== IOTEC_CURRENCY) {
      return false;
    }
    // Same rule, wider list: Pesapal is an East African acquirer and refuses
    // everything outside PESAPAL_CURRENCIES. Offering it under a currency it
    // cannot settle sends the vendor to a gateway error at the last step, after
    // a boost checkout has already reserved its days.
    if (
      gateway === PLATFORM_PAYMENT_PROVIDER.PESAPAL &&
      !isPesapalCurrency(currency)
    ) {
      return false;
    }
    // Same rule again: Orange Money is a per-country wallet and settles only
    // the currency its national operator issued the merchant key for.
    if (
      gateway === PLATFORM_PAYMENT_PROVIDER.ORANGE_MONEY &&
      !isOrangeMoneyCurrency(currency)
    ) {
      return false;
    }
    // And once more for MTN MoMo, whose OpCo contract settles one wallet
    // currency only.
    if (
      gateway === PLATFORM_PAYMENT_PROVIDER.MTN_MOMO &&
      !isMtnMomoCurrency(currency)
    ) {
      return false;
    }
    return gatewayConfigured(settings, gateway);
  });
}

// ---------------------------------------------------------------------------
// Attempt creation

interface CreatePlatformPaymentInput {
  kind: PlatformPaymentKind;
  campaignId?: string;
  /** kind "boost" — frozen so fulfilment can refuse a stale attempt. */
  boostTerms?: { position: number; startDay: string; endDay: string };
  subscriptionId?: string;
  applicationId?: string;
  planId?: string;
  periodStart?: Date;
  periodEnd?: Date;
  /** kind "commission" — the debt this attempt pays. */
  commissionInvoiceId?: string;
  vendorId: string;
  userId: string;
  provider: (typeof PLATFORM_PAYMENT_PROVIDER)[keyof typeof PLATFORM_PAYMENT_PROVIDER];
  amount: number;
  currency: string;
}

/**
 * Create a payment attempt, expiring any previous pending attempt for the
 * same campaign/subscription first — at most one open attempt per target, so
 * a vendor abandoning PayPal and retrying with Paystack never leaves two
 * live references racing to finalize.
 */
export async function createPlatformPaymentAttempt(
  input: CreatePlatformPaymentInput,
): Promise<IPlatformPayment> {
  const targetFilter = input.campaignId
    ? { campaignId: new Types.ObjectId(input.campaignId) }
    : input.subscriptionId
      ? { subscriptionId: new Types.ObjectId(input.subscriptionId) }
      : input.commissionInvoiceId
        ? {
            commissionInvoiceId: new Types.ObjectId(input.commissionInvoiceId),
          }
        : { applicationId: new Types.ObjectId(String(input.applicationId)) };

  await PlatformPayment.updateMany(
    {
      kind: input.kind,
      ...targetFilter,
      status: PLATFORM_PAYMENT_STATUS.PENDING,
    },
    { $set: { status: PLATFORM_PAYMENT_STATUS.EXPIRED } },
  );

  const id = new Types.ObjectId();
  const reference = `${PLATFORM_PAYMENT_REFERENCE_PREFIX[input.kind]}${id.toString()}-${Date.now().toString(36)}`;

  return PlatformPayment.create({
    _id: id,
    kind: input.kind,
    campaignId: input.campaignId ? new Types.ObjectId(input.campaignId) : null,
    boostTerms: input.boostTerms ?? null,
    commissionInvoiceId: input.commissionInvoiceId
      ? new Types.ObjectId(input.commissionInvoiceId)
      : null,
    subscriptionId: input.subscriptionId
      ? new Types.ObjectId(input.subscriptionId)
      : null,
    applicationId: input.applicationId
      ? new Types.ObjectId(input.applicationId)
      : null,
    planId: input.planId ? new Types.ObjectId(input.planId) : null,
    periodStart: input.periodStart ?? null,
    periodEnd: input.periodEnd ?? null,
    vendorId: new Types.ObjectId(input.vendorId),
    userId: input.userId,
    provider: input.provider,
    status: PLATFORM_PAYMENT_STATUS.PENDING,
    amount: input.amount,
    currency: input.currency.toUpperCase(),
    reference,
  });
}

// ---------------------------------------------------------------------------
// Initiation

type PlatformPaymentInitiation =
  | { type: "redirect"; url: string }
  | {
      type: "razorpay";
      keyId: string;
      razorpayOrderId: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      prefill: { email?: string; name?: string; contact?: string };
    }
  | { type: "polling" };

interface PlatformPayerInfo {
  email: string;
  name?: string;
  phone?: string;
  address?: {
    country?: string;
    city?: string;
    street?: string;
    state?: string;
    postalCode?: string;
  };
}

interface InitiatePlatformPaymentInput {
  payment: IPlatformPayment;
  settings: ISettings;
  /** Absolute URL the payer returns to after paying (no trailing params). */
  successUrl: string;
  cancelUrl: string;
  payer: PlatformPayerInfo;
  description: string;
  /**
   * When the reservation behind this attempt lapses. Passed to gateways that
   * can expire a session, so an abandoned checkout stops being payable near the
   * moment its inventory goes back on sale.
   */
  expiresAt?: Date;
  /** Stripe Checkout metadata (must include a distinguishing `kind`). */
  stripeMetadata?: Record<string, string>;
  iotecChannel?: "mobile_money" | "card";
  iotecPhone?: string;
  mtnMomoPhone?: string;
}

function withParam(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
}

/**
 * Start the gateway flow for a pending attempt. Two-phase write throughout
 * (persist our reference → call the gateway → patch the gateway's ids), the
 * same shape the ioTec order flow documents: completion callbacks can arrive
 * before the initiating request returns.
 */
export async function initiatePlatformPayment(
  input: InitiatePlatformPaymentInput,
): Promise<PlatformPaymentInitiation> {
  const { payment, settings, payer } = input;
  const currency = payment.currency.toUpperCase();
  const storeName = settings.general?.storeName || "Store";
  const paymentId = String(payment._id);

  switch (payment.provider) {
    case PLATFORM_PAYMENT_PROVIDER.STRIPE: {
      const secretKey = assertStripeBillingReady(settings);
      const stripe = getStripeForSecretKey(secretKey);
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: payer.email || undefined,
          client_reference_id: paymentId,
          line_items: [
            {
              price_data: {
                currency: currency.toLowerCase(),
                unit_amount: toStripeAmount(payment.amount, currency),
                product_data: { name: input.description },
              },
              quantity: 1,
            },
          ],
          metadata: input.stripeMetadata,
          // Mirrored onto the PaymentIntent so payment_intent.* webhook events
          // can recognize platform charges and skip the order finalizer.
          payment_intent_data: input.stripeMetadata
            ? { metadata: input.stripeMetadata }
            : undefined,
          // Stripe requires expires_at to be at least 30 minutes after session
          // creation, so a short hold is clamped up. When the clamp binds the
          // session briefly outlives the hold; fulfilment re-asserts the
          // reservation and cancels with SLOT_RESOLD if the days went, so the
          // vendor is never charged for inventory they cannot get.
          expires_at: Math.floor(
            Math.max(
              input.expiresAt?.getTime() ?? Date.now() + 24 * 60 * 60 * 1000,
              Date.now() + 31 * 60 * 1000,
            ) / 1000,
          ),
          success_url: withParam(
            input.successUrl,
            "session_id",
            "{CHECKOUT_SESSION_ID}",
          ),
          cancel_url: input.cancelUrl,
        },
        { idempotencyKey: `platform-payment-${paymentId}` },
      );
      await PlatformPayment.updateOne(
        { _id: payment._id },
        { $set: { stripeCheckoutSessionId: session.id } },
      );
      if (!session.url) {
        throw new ValidationError("Stripe did not return a Checkout URL");
      }
      return { type: "redirect", url: session.url };
    }

    case PLATFORM_PAYMENT_PROVIDER.PAYPAL: {
      const creds = resolvePayPalCredentials(settings.payment?.paypal);
      if (!creds.clientId || !creds.clientSecret) {
        throw new ValidationError("PayPal is not configured");
      }
      const { orderId, approvalUrl } = await createPayPalOrder({
        creds: {
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          mode: creds.mode,
        },
        currency,
        total: payment.amount,
        returnUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        referenceId: payment.reference,
      });
      await PlatformPayment.updateOne(
        { _id: payment._id },
        { $set: { paypalOrderId: orderId } },
      );
      return { type: "redirect", url: approvalUrl };
    }

    case PLATFORM_PAYMENT_PROVIDER.RAZORPAY: {
      const creds = getRazorpayCredentials({
        keyId: settings.payment?.razorpay?.keyId,
        keySecret: settings.payment?.razorpay?.keySecret,
      });
      const order = await createRazorpayOrder({
        creds,
        amount: payment.amount,
        currency,
        receipt: payment.reference,
        notes: { kind: payment.kind, paymentId },
      });
      await PlatformPayment.updateOne(
        { _id: payment._id },
        { $set: { razorpayOrderId: order.id } },
      );
      return {
        type: "razorpay",
        keyId: creds.keyId,
        razorpayOrderId: order.id,
        amount: order.amount,
        currency: order.currency,
        name: storeName,
        description: input.description,
        prefill: { email: payer.email, name: payer.name },
      };
    }

    case PLATFORM_PAYMENT_PROVIDER.PAYSTACK: {
      if (!payer.email) {
        throw new ValidationError("An email address is required for Paystack");
      }
      const creds = getPaystackCredentials({
        publicKey: settings.payment?.paystack?.publicKey,
        secretKey: settings.payment?.paystack?.secretKey,
      });
      const transaction = await initializePaystackTransaction({
        creds,
        email: payer.email,
        amount: payment.amount,
        currency,
        reference: payment.reference,
        callbackUrl: withParam(input.successUrl, "reference", payment.reference),
        metadata: { kind: payment.kind, paymentId },
      });
      return { type: "redirect", url: transaction.authorization_url };
    }

    case PLATFORM_PAYMENT_PROVIDER.PESAPAL: {
      const resolved = resolvePesapalCredentials(settings.payment?.pesapal);
      const creds = getPesapalCredentials(resolved);
      if (!creds.ipnId) {
        throw new ValidationError(
          "Pesapal is not configured. Register the IPN URL and add its IPN ID.",
        );
      }
      // resolvePlatformPaymentMethods already withholds Pesapal under an
      // unsettleable currency; this is the same rule at the charge itself, for
      // the paths that carry their own currency (a plan snapshot priced before
      // the store currency changed) rather than the store default.
      if (!isPesapalCurrency(currency)) {
        throw new ValidationError(
          `Pesapal cannot settle ${currency}. Price this in one of ${[...PESAPAL_CURRENCIES].join(", ")}.`,
        );
      }
      // Refuse fractional amounts in a zero-decimal currency up front rather
      // than rounding: the boost path quantizes its own total, but a plan price
      // is stored raw, and a rounded charge would fail finalize's amount
      // cross-check AFTER the vendor's money moved. Same guard ioTec applies.
      if (
        currencyMinorUnitExponent(currency) === 0 &&
        !Number.isInteger(payment.amount)
      ) {
        throw new ValidationError(
          `${currency} charges must be whole numbers. Adjust the price to a whole ${currency} amount.`,
        );
      }
      const nameParts = (payer.name || "").trim().split(/\s+/).filter(Boolean);
      const pesapalOrder = await submitPesapalOrder({
        creds,
        merchantReference: payment.reference,
        currency,
        amount: payment.amount,
        description: input.description,
        callbackUrl: input.successUrl,
        cancellationUrl: input.cancelUrl,
        notificationId: creds.ipnId,
        billingAddress: {
          email_address: payer.email,
          phone_number: payer.phone,
          country_code: normalizePesapalCountryCode(payer.address?.country),
          first_name: nameParts[0] || "Vendor",
          last_name: nameParts.slice(1).join(" ") || nameParts[0] || "Vendor",
          line_1: payer.address?.street,
          line_2: undefined,
          city: payer.address?.city,
          state: payer.address?.state,
          postal_code: payer.address?.postalCode,
          zip_code: payer.address?.postalCode,
        },
      });
      if (
        !pesapalOrder.order_tracking_id ||
        !pesapalOrder.redirect_url ||
        pesapalOrder.merchant_reference !== payment.reference
      ) {
        throw new ValidationError("Pesapal returned an invalid order response");
      }
      await PlatformPayment.updateOne(
        { _id: payment._id },
        { $set: { pesapalOrderTrackingId: pesapalOrder.order_tracking_id } },
      );
      return { type: "redirect", url: pesapalOrder.redirect_url };
    }

    case PLATFORM_PAYMENT_PROVIDER.ORANGE_MONEY: {
      const resolved = resolveOrangeMoneyCredentials(
        settings.payment?.orange_money,
      );
      const creds = getOrangeMoneyCredentials(resolved);
      if (!isOrangeMoneyCurrency(currency)) {
        throw new ValidationError(
          `Orange Money cannot settle ${currency}. Price this in one of ${[...ORANGE_MONEY_CURRENCIES].join(", ")}.`,
        );
      }
      // Same zero-decimal guard as Pesapal, for the same reason: a rounded
      // charge would fail finalize's cross-check after the vendor's money moved.
      if (
        currencyMinorUnitExponent(currency) === 0 &&
        !Number.isInteger(payment.amount)
      ) {
        throw new ValidationError(
          `${currency} charges must be whole numbers. Adjust the price to a whole ${currency} amount.`,
        );
      }
      const orangePayment = await submitOrangeMoneyPayment({
        creds,
        // Our prefix-marked reference doubles as Orange's order_id, which is
        // what the notification echoes — so the callback can dispatch on it.
        orderId: payment.reference,
        amount: payment.amount,
        currency: orangeMoneyChargeCurrency(creds.mode, currency),
        returnUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        notifUrl: new URL(
          "/api/payments/orange-money/callback",
          input.successUrl,
        ).toString(),
        reference: input.description,
      });

      // Unlike Pesapal there is no adoption path: the pay token exists only in
      // this response, and without it the attempt can never be verified. So a
      // lost write is fatal — better to fail before the vendor is sent to a
      // payment page whose outcome we could never read.
      const stored = await PlatformPayment.updateOne(
        { _id: payment._id },
        {
          $set: {
            orangeMoneyPayToken: orangePayment.pay_token,
            orangeMoneyNotifToken: orangePayment.notif_token,
          },
        },
      );
      if (stored.modifiedCount !== 1) {
        throw new ValidationError(
          "Orange Money payment session could not be stored. Please try again.",
        );
      }
      return { type: "redirect", url: orangePayment.payment_url };
    }

    case PLATFORM_PAYMENT_PROVIDER.MTN_MOMO: {
      const resolved = resolveMtnMomoCredentials(settings.payment?.mtn_momo);
      const creds = getMtnMomoCredentials(resolved);
      if (!isMtnMomoCurrency(currency)) {
        throw new ValidationError(
          `MTN MoMo cannot settle ${currency}. Price this in one of ${[...MTN_MOMO_CURRENCIES].join(", ")}.`,
        );
      }
      // Same zero-decimal guard as Pesapal/Orange, for the same reason: a
      // rounded charge would fail finalize's cross-check after the vendor's
      // money moved.
      if (
        currencyMinorUnitExponent(currency) === 0 &&
        !Number.isInteger(payment.amount)
      ) {
        throw new ValidationError(
          `${currency} charges must be whole numbers. Adjust the price to a whole ${currency} amount.`,
        );
      }
      const msisdn = normalizeMtnMomoMsisdn(
        input.mtnMomoPhone || payer.phone,
        creds.targetEnvironment,
      );
      if (!msisdn) {
        throw new ValidationError(
          "A valid MTN mobile money number is required for MTN MoMo",
        );
      }

      // Two-phase, but the reference comes FIRST: requesttopay returns no id,
      // so the UUID must be on the attempt before the prompt can exist
      // anywhere. A stored reference for a call that then fails is harmless
      // (its status reads 404/pending forever); the reverse — a live prompt
      // whose reference we failed to store — is money nothing can verify.
      const mtnMomoReferenceId = randomUUID();
      const stored = await PlatformPayment.updateOne(
        { _id: payment._id },
        { $set: { mtnMomoReferenceId } },
      );
      if (stored.modifiedCount !== 1) {
        throw new ValidationError(
          "MTN MoMo payment session could not be stored. Please try again.",
        );
      }
      await requestMtnMomoPayment({
        creds,
        referenceId: mtnMomoReferenceId,
        amount: payment.amount,
        currency: mtnMomoChargeCurrency(creds.mode, currency),
        // The prefix-marked reference, so the callback's externalId is
        // dispatchable straight to this attempt.
        externalId: payment.reference,
        payerMsisdn: msisdn,
        payerMessage: input.description.replace(/[^\w\s.-]/g, ""),
        payeeNote: payment.reference,
        // The registered host, not this request's origin — see
        // mtnMomoCallbackUrl: a mismatch fails the payment outright.
        callbackUrl: mtnMomoCallbackUrl(creds),
      });
      // No redirect: the vendor approves the PIN prompt on their phone and the
      // client polls the verify route until it resolves.
      return { type: "polling" };
    }

    case PLATFORM_PAYMENT_PROVIDER.IOTEC: {
      const resolved = resolveIotecCredentials(settings.payment?.iotec);
      const creds = getIotecCredentials(resolved);
      if (!creds.walletId) {
        throw new ValidationError(
          "ioTec Pay is not configured. Add the wallet ID in Admin → Settings → Payments.",
        );
      }
      if (currency !== IOTEC_CURRENCY) {
        throw new ValidationError(
          `ioTec Pay only accepts ${IOTEC_CURRENCY}. Set the store default currency to ${IOTEC_CURRENCY}.`,
        );
      }
      // Refuse fractional amounts up front instead of rounding: a rounded
      // charge would later fail finalize's amount check AFTER the payer's
      // money moved.
      if (!Number.isInteger(payment.amount)) {
        throw new ValidationError(
          `ioTec Pay supports whole-number ${currency} amounts only. Adjust the price to a whole number.`,
        );
      }
      const amount = payment.amount;
      if (amount < IOTEC_MIN_AMOUNT) {
        throw new ValidationError(
          `ioTec Pay requires a minimum amount of ${IOTEC_MIN_AMOUNT} ${currency}.`,
        );
      }
      const isCard = input.iotecChannel === "card";
      const iotecPayer = isCard
        ? payer.email
        : normalizeUgandaMsisdn(input.iotecPhone || payer.phone);
      if (!iotecPayer) {
        throw new ValidationError(
          isCard
            ? "An email address is required for ioTec card payments"
            : "A valid Ugandan mobile money number is required for ioTec Pay",
        );
      }
      const collection = isCard
        ? await submitIotecCardCollection({
            creds,
            externalId: payment.reference,
            currency,
            amount,
            payer: iotecPayer,
            redirectUrl: input.successUrl,
            payerName: payer.name,
            payerNote: input.description,
          })
        : await submitIotecCollection({
            creds,
            externalId: payment.reference,
            currency,
            amount,
            payer: iotecPayer,
            payerName: payer.name,
            payerNote: input.description,
          });
      if (!collection.id || (isCard && !collection.cardRedirectUrl)) {
        throw new ValidationError(
          isCard
            ? "ioTec returned an invalid card response"
            : "ioTec returned an invalid collection response",
        );
      }
      await PlatformPayment.updateOne(
        { _id: payment._id },
        { $set: { iotecTransactionId: collection.id } },
      );
      return isCard
        ? { type: "redirect", url: collection.cardRedirectUrl as string }
        : { type: "polling" };
    }

    default:
      throw new ValidationError("Unsupported payment method");
  }
}

// ---------------------------------------------------------------------------
// Completion-route lookups

export function findPlatformPaymentByReference(reference: string) {
  return PlatformPayment.findOne({ reference });
}

export function findPlatformPaymentByRazorpayOrderId(razorpayOrderId: string) {
  return PlatformPayment.findOne({ razorpayOrderId });
}

export function findPlatformPaymentByPayPalOrderId(paypalOrderId: string) {
  return PlatformPayment.findOne({ paypalOrderId });
}

// ---------------------------------------------------------------------------
// Finalization (the idempotency line)

/**
 * Guarded mark-paid + dispatch by kind. Exactly one caller (webhook, IPN,
 * verify — whichever lands first) wins the status flip; every replay
 * no-ops. Never trusts caller-supplied amounts: `verified` values must come
 * from an authoritative gateway API response, and a mismatch marks the
 * attempt failed instead of activating anything.
 */
export async function finalizePlatformPayment(
  payment: IPlatformPayment,
  verified: {
    amount?: number;
    currency?: string;
    patch?: Partial<
      Pick<
        IPlatformPayment,
        | "stripePaymentIntentId"
        | "paypalCaptureId"
        | "razorpayPaymentId"
        | "paystackTransactionId"
        | "iotecTransactionId"
        | "pesapalOrderTrackingId"
        | "orangeMoneyTxnId"
        | "mtnMomoTransactionId"
      >
    >;
  },
): Promise<{ paid: boolean; alreadyPaid: boolean }> {
  if (
    (verified.currency &&
      verified.currency.toUpperCase() !== payment.currency.toUpperCase()) ||
    (verified.amount !== undefined &&
      // At the CURRENCY's precision, not a fixed ×100: every gateway builds the
      // charge with the real minor-unit exponent, so comparing at 1/100 would
      // reject a correctly-collected JPY/UGX/KWD payment as a mismatch.
      !amountsMatchForCurrency(
        payment.amount,
        verified.amount,
        payment.currency,
      ))
  ) {
    await PlatformPayment.updateOne(
      { _id: payment._id, status: PLATFORM_PAYMENT_STATUS.PENDING },
      {
        $set: {
          status: PLATFORM_PAYMENT_STATUS.FAILED,
          failedAt: new Date(),
          failureReason: `Amount/currency mismatch: expected ${payment.amount} ${payment.currency}, gateway reported ${verified.amount} ${verified.currency}`,
        },
      },
    );
    console.error(
      `Platform payment ${payment._id} amount mismatch — expected ${payment.amount} ${payment.currency}, got ${verified.amount} ${verified.currency}`,
    );
    return { paid: false, alreadyPaid: false };
  }

  const paid = await PlatformPayment.findOneAndUpdate(
    // Only a not-yet-collected attempt may become paid. `$ne: "paid"` also
    // matched REFUNDED, so a reversed charge could be flipped back to paid —
    // and re-granted — by any later verify poll, because gateways keep
    // reporting a refunded charge's original "paid" state. EXPIRED stays
    // eligible on purpose: a superseded attempt the payer completed anyway
    // must still be recorded rather than silently swallowed.
    {
      _id: payment._id,
      status: {
        $in: [PLATFORM_PAYMENT_STATUS.PENDING, PLATFORM_PAYMENT_STATUS.EXPIRED],
      },
    },
    {
      $set: {
        status: PLATFORM_PAYMENT_STATUS.PAID,
        paidAt: new Date(),
        ...(verified.patch || {}),
      },
    },
    { new: true },
  );
  if (!paid) {
    // Not eligible for the flip. Either we lost the race to a concurrent
    // caller, a previous attempt crashed AFTER flipping to PAID but BEFORE the
    // benefit landed, or the attempt is terminal (refunded/failed).
    const existing = await PlatformPayment.findById(payment._id);
    if (existing?.status === PLATFORM_PAYMENT_STATUS.PAID) {
      // benefitGrantedAt separates "already granted" from "crashed mid-grant",
      // so gateway retries and verify polls repair the crash instead of
      // no-oping while the vendor's money sits ungranted.
      if (!existing.benefitGrantedAt) await grantPlatformBenefit(existing);
      return { paid: true, alreadyPaid: true };
    }
    // Refunded or failed: never report this as a live payment.
    return { paid: false, alreadyPaid: false };
  }

  await grantPlatformBenefit(paid);
  return { paid: true, alreadyPaid: false };
}

/**
 * Dispatch the purchased benefit by kind, then stamp benefitGrantedAt. Both
 * targets are re-run-safe (the campaign activation is CAS-guarded and
 * cross-checks the paying attempt's terms; the subscription writer reuses
 * the period stamped on the payment row), so a crash between the dispatch
 * and the stamp costs one redundant re-run, never a double grant.
 *
 * The stamp is written ONLY when the benefit actually landed. Stamping a
 * failed grant would mark a paid-but-ungranted attempt as complete and hide it
 * from both repair paths — the exact case the field exists to catch.
 */
async function grantPlatformBenefit(paid: IPlatformPayment): Promise<void> {
  if (paid.kind === PLATFORM_PAYMENT_KIND.BOOST) {
    const campaign = await fulfillBoostCampaign(paid);
    if (!campaign) {
      // fulfillBoostCampaign CASes on pending_payment, so it also returns null
      // for a campaign THIS payment already activated — the signature of a
      // crash between the activation and the benefitGrantedAt stamp. That is a
      // success to finish, not a failure to flag: treating it as unactivatable
      // would leave the repair path looping forever and mark a perfectly
      // healthy campaign as needing a refund.
      const granted = await BoostCampaign.findOne({
        _id: paid.campaignId,
        paymentId: paid._id,
      })
        .select("_id")
        .lean<{ _id: unknown } | null>();
      if (!granted) {
        // Money genuinely arrived for a campaign that cannot be activated (the
        // abandoned-checkout sweep cancelled it first, or the paying attempt no
        // longer matches its terms). Surface loudly and persist the reason —
        // the admin refunds out-of-band.
        console.error(
          `Boost payment ${paid._id} is paid but campaign ${paid.campaignId} was not activatable`,
        );
        await PlatformPayment.updateOne(
          { _id: paid._id, benefitGrantedAt: null },
          {
            $set: {
              failureReason: `Paid, but campaign ${paid.campaignId} was not activatable — refund out-of-band`,
            },
          },
        );
        return;
      }
    }
  } else if (paid.kind === PLATFORM_PAYMENT_KIND.COMMISSION) {
    // Nothing is granted here — the vendor already had the goods and the cash.
    // What lands is the settlement stamp that takes these sales out of the owed
    // balance, so the same commission is not billed to them twice.
    const { settleCommissionInvoice } = await import(
      "@/lib/finance/commission-invoices"
    );
    const settled = paid.commissionInvoiceId
      ? await settleCommissionInvoice({
          invoiceId: String(paid.commissionInvoiceId),
          paymentId: String(paid._id),
        })
      : 0;
    if (settled === 0) {
      // Paid, but nothing carried this invoice's claim. Either the claim was
      // released while the vendor was at the gateway, or it never landed. The
      // money is real, so say so loudly rather than stamping this complete —
      // benefitGrantedAt is what both repair paths key off.
      console.error(
        `Commission payment ${paid._id} is paid but claimed no sub-orders — refund or re-invoice out-of-band`,
      );
      await PlatformPayment.updateOne(
        { _id: paid._id, benefitGrantedAt: null },
        {
          $set: {
            failureReason:
              "Paid, but no sub-orders carried this invoice's claim — settle out-of-band",
          },
        },
      );
      return;
    }
  } else {
    const { finalizeSubscriptionPlatformPayment } = await import(
      "@/lib/vendors/vendor-subscription-payments"
    );
    await finalizeSubscriptionPlatformPayment(paid);
  }
  await PlatformPayment.updateOne(
    { _id: paid._id },
    { $set: { benefitGrantedAt: new Date(), failureReason: null } },
  );

  // Boost and subscription income, posted once the benefit actually landed —
  // the same moment the vendor got what they paid for. Keyed on the attempt,
  // so the retries this function is built to tolerate post nothing extra.
  const { postPlatformPaymentSafely } = await import("@/lib/finance/post-events");
  postPlatformPaymentSafely({
    _id: paid._id,
    kind: paid.kind,
    reference: paid.reference,
    vendorId: paid.vendorId,
    amount: paid.amount,
    currency: paid.currency,
    paidAt: paid.paidAt,
  });
}

/** Gateway reported a reversal/refund of a previously-paid attempt. */
export async function markPlatformPaymentReversed(payment: IPlatformPayment) {
  const updated = await PlatformPayment.findOneAndUpdate(
    { _id: payment._id, status: PLATFORM_PAYMENT_STATUS.PAID },
    { $set: { status: PLATFORM_PAYMENT_STATUS.REFUNDED } },
    { new: true },
  );
  if (!updated) return null;
  if (updated.kind === PLATFORM_PAYMENT_KIND.BOOST && updated.campaignId) {
    // Tear the campaign down only if THIS attempt is the one that bought it.
    // A campaign can carry several attempts (abandon PayPal, pay with Paystack,
    // then complete the still-open PayPal tab), and reversing a duplicate must
    // not revoke a boost the vendor genuinely paid for through another one.
    const campaign = await BoostCampaign.findById(updated.campaignId)
      .select("paymentId")
      .lean<{ paymentId?: unknown } | null>();
    const grantedByThisAttempt =
      campaign?.paymentId &&
      String(campaign.paymentId) === String(updated._id);
    if (grantedByThisAttempt) {
      await cancelBoostCampaign(
        String(updated.campaignId),
        BOOST_CANCEL_REASON.PAYMENT_REVERSED,
      );
    } else {
      console.error(
        `Platform payment ${updated._id} was reversed but campaign ${updated.campaignId} was activated by a different attempt (${campaign?.paymentId ?? "none"}); campaign left intact — review manually`,
      );
    }
  } else if (
    updated.kind === PLATFORM_PAYMENT_KIND.COMMISSION &&
    updated.commissionInvoiceId
  ) {
    // Same guard the campaign arm applies: an invoice can carry several
    // attempts, and reversing an abandoned duplicate must not hand back a claim
    // a different attempt genuinely paid for.
    const { CommissionInvoice } = await import("@/models");
    const invoice = await CommissionInvoice.findById(updated.commissionInvoiceId)
      .select("paymentId")
      .lean<{ paymentId?: unknown } | null>();
    const paidByThisAttempt =
      invoice?.paymentId && String(invoice.paymentId) === String(updated._id);

    if (paidByThisAttempt) {
      // Nothing to revoke, unlike a boost — the debt simply becomes outstanding
      // again, which is the truth once the money has gone back.
      const { releaseCommissionInvoice } = await import(
        "@/lib/finance/commission-invoices"
      );
      await releaseCommissionInvoice(
        String(updated.commissionInvoiceId),
        "reversed",
      );
    } else {
      console.error(
        `Commission payment ${updated._id} was reversed but invoice ${updated.commissionInvoiceId} was settled by a different attempt (${invoice?.paymentId ?? "none"}); claim left intact — review manually`,
      );
    }
  } else if (updated.kind === PLATFORM_PAYMENT_KIND.SUBSCRIPTION) {
    // No automated subscription rollback — flag for admin review.
    console.error(
      `Subscription payment ${updated._id} was reversed by the gateway; review vendor ${updated.vendorId}`,
    );
  }

  // Take the income back off the books. The benefit already unwinds above; the
  // money did not, so a marketplace that refunded a boost kept reporting the
  // revenue for it. Keyed on the attempt, so a re-delivered reversal webhook
  // posts nothing extra.
  //
  // Gated on `benefitGrantedAt`, which is the stamp the income posting sits
  // immediately behind: an attempt that took the money but never granted
  // anything posted no income, and reversing it would credit a refund against
  // revenue that was never recognised.
  if (updated.benefitGrantedAt) {
    const { postPlatformPaymentReversedSafely } = await import(
      "@/lib/finance/post-events"
    );
    postPlatformPaymentReversedSafely({
      _id: updated._id,
      kind: updated.kind,
      reference: updated.reference,
      vendorId: updated.vendorId,
      amount: updated.amount,
      currency: updated.currency,
      reversedAt: new Date(),
    });
  }

  return updated;
}

/**
 * The Pesapal transaction behind an attempt, adopting the tracking id the IPN
 * carried when the row has none of its own.
 *
 * initiatePlatformPayment is a two-phase write — submit to Pesapal, THEN store
 * `pesapalOrderTrackingId` — so a notification can land (or that second write
 * can fail outright) while the row still has no id. Without adoption such a row
 * can never ask Pesapal anything: every later IPN and poll answers "not paid"
 * forever while the vendor's money sits collected and nothing is granted.
 *
 * Adoption is safe because it is confirmed against Pesapal, not the caller:
 * only a transaction whose OWN `merchant_reference` equals this attempt's
 * reference is accepted, so a forged tracking id posted to the unsigned IPN
 * endpoint cannot attach someone else's payment to this row.
 */
async function fetchPesapalTransactionFor(
  payment: IPlatformPayment,
  settings: ISettings,
  hintedTrackingId?: string,
): Promise<{ transaction: PesapalTransactionStatus; trackingId: string }> {
  const trackingId = payment.pesapalOrderTrackingId || hintedTrackingId;
  if (!trackingId) {
    // Deliberately not a bare `paid: false`. "Unanswerable" and "not paid" read
    // the same to a caller, and that is exactly what let a lost initiation
    // write look like a settled question: the IPN answered 200, Pesapal stopped
    // retrying, and nothing ever asked again.
    throw new ValidationError(
      "This Pesapal attempt has no order tracking ID, so it cannot be verified",
    );
  }
  const creds = getPesapalCredentials(
    resolvePesapalCredentials(settings.payment?.pesapal),
  );
  const transaction = await getPesapalTransactionStatus({
    creds,
    orderTrackingId: trackingId,
  });
  if (transaction.merchant_reference !== payment.reference) {
    throw new ValidationError(
      "Pesapal transaction does not match this payment",
    );
  }
  if (!payment.pesapalOrderTrackingId) {
    // Best effort: the id also rides along on finalize's guarded write, so a
    // failure here (the unique index rejecting an id already stored elsewhere)
    // must not abort a verification we can otherwise complete.
    await PlatformPayment.updateOne(
      { _id: payment._id, pesapalOrderTrackingId: null },
      { $set: { pesapalOrderTrackingId: trackingId } },
    ).catch((error) =>
      console.error(
        `Failed to adopt Pesapal tracking id for platform payment ${payment._id}:`,
        error,
      ),
    );
    payment.pesapalOrderTrackingId = trackingId;
  }
  return { transaction, trackingId };
}

/**
 * Ask the gateway whether an already-PAID attempt has since been reversed, and
 * tear the benefit down if so. Returns true when a reversal was applied.
 *
 * Only Pesapal is polled: its status API exposes a `reversed` state and its IPN
 * re-delivers on reversal, so a chargeback is observable on re-fetch. Every
 * other gateway announces refunds through a dedicated webhook event instead
 * (Stripe `charge.refunded` → `processPlatformChargeRefunded`), so polling them
 * here would spend a network round trip to learn nothing.
 */
async function detectPlatformPaymentReversal(
  payment: IPlatformPayment,
  settings: ISettings,
  hintedTrackingId?: string,
): Promise<boolean> {
  if (
    payment.provider !== PLATFORM_PAYMENT_PROVIDER.PESAPAL ||
    !(payment.pesapalOrderTrackingId || hintedTrackingId)
  ) {
    return false;
  }
  try {
    const { transaction } = await fetchPesapalTransactionFor(
      payment,
      settings,
      hintedTrackingId,
    );
    if (getPesapalTransactionState(transaction) !== "reversed") return false;
    return Boolean(await markPlatformPaymentReversed(payment));
  } catch (error) {
    // A status lookup that fails must not break the verify response — the row
    // stays paid and the next IPN or verify poll tries again.
    console.error(
      `Pesapal reversal check failed for platform payment ${payment._id}:`,
      error,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verification (authoritative re-checks; all paths end in finalize)

interface VerifyPlatformPaymentPayload {
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  /** Set ONLY by webhook handlers that verified their own body signature. */
  fromVerifiedWebhook?: boolean;
  /**
   * The tracking id a Pesapal IPN was delivered for. Used only when the attempt
   * carries none of its own — see fetchPesapalTransactionFor, which accepts it
   * solely on Pesapal's own merchant_reference matching this attempt, so it
   * needs no trust from the caller.
   */
  pesapalOrderTrackingId?: string;
  /**
   * The `notif_token` an Orange Money notification presented. Orange signs
   * nothing, so this is the only shared secret the callback can offer; it is
   * checked against the token stored on the attempt, never trusted as given.
   */
  orangeMoneyNotifToken?: string;
}

/**
 * Re-check the gateway's authoritative status for a pending attempt and
 * finalize when paid. Used by the client-facing verify routes (redirect
 * returns, ioTec polling, Razorpay modal success) — webhooks/IPNs are the
 * async belt, this is the braces.
 */
export async function verifyPlatformPayment(
  payment: IPlatformPayment,
  settings: ISettings,
  payload: VerifyPlatformPaymentPayload = {},
): Promise<{ paid: boolean }> {
  // A reversed attempt is terminal: never re-verify it, and never let a
  // gateway that still reports the original "paid" state resurrect it.
  if (payment.status === PLATFORM_PAYMENT_STATUS.REFUNDED) {
    return { paid: false };
  }

  if (payment.status === PLATFORM_PAYMENT_STATUS.PAID) {
    // A chargeback can land long after the capture, so an already-paid row
    // still has to be asked whether the gateway reversed it. This runs BEFORE
    // the paid short-circuit — behind it, the reversal branch inside the
    // provider switch was unreachable (markPlatformPaymentReversed requires
    // status PAID, which the short-circuit had already returned on).
    if (
      await detectPlatformPaymentReversal(
        payment,
        settings,
        payload.pesapalOrderTrackingId,
      )
    ) {
      return { paid: false };
    }
    // Repair path: paid but the benefit dispatch crashed before landing.
    if (!payment.benefitGrantedAt) await grantPlatformBenefit(payment);
    return { paid: true };
  }

  switch (payment.provider) {
    case PLATFORM_PAYMENT_PROVIDER.STRIPE: {
      if (!payment.stripeCheckoutSessionId) return { paid: false };
      const secretKey = assertStripeBillingReady(settings);
      const stripe = getStripeForSecretKey(secretKey);
      const session = await stripe.checkout.sessions.retrieve(
        payment.stripeCheckoutSessionId,
      );
      if (session.payment_status !== "paid") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        amount:
          typeof session.amount_total === "number"
            ? session.amount_total /
              Math.pow(
                10,
                currencyMinorUnitExponent(session.currency || payment.currency),
              )
            : undefined,
        currency: session.currency || undefined,
        patch: {
          stripePaymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent as Stripe.PaymentIntent | null)?.id ??
                undefined,
        },
      });
      return { paid: result.paid };
    }

    case PLATFORM_PAYMENT_PROVIDER.PAYPAL: {
      if (!payment.paypalOrderId) return { paid: false };
      const creds = resolvePayPalCredentials(settings.payment?.paypal);
      if (!creds.clientId || !creds.clientSecret) {
        throw new ValidationError("PayPal is not configured");
      }
      const { raw, captureId } = await capturePayPalOrder({
        creds: {
          clientId: creds.clientId,
          clientSecret: creds.clientSecret,
          mode: creds.mode,
        },
        orderId: payment.paypalOrderId,
      });
      const capture = (
        raw as {
          purchase_units?: Array<{
            payments?: {
              captures?: Array<{
                status?: string;
                amount?: { currency_code?: string; value?: string };
              }>;
            };
          }>;
        }
      )?.purchase_units?.[0]?.payments?.captures?.[0];
      if (capture?.status !== "COMPLETED") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        amount: capture.amount?.value ? Number(capture.amount.value) : undefined,
        currency: capture.amount?.currency_code,
        patch: { paypalCaptureId: captureId || undefined },
      });
      return { paid: result.paid };
    }

    case PLATFORM_PAYMENT_PROVIDER.RAZORPAY: {
      const rzpPaymentId = payload.razorpayPaymentId;
      if (!payment.razorpayOrderId || !rzpPaymentId) return { paid: false };
      const creds = getRazorpayCredentials({
        keyId: settings.payment?.razorpay?.keyId,
        keySecret: settings.payment?.razorpay?.keySecret,
      });
      // The modal handler supplies a signature; only the webhook path — which
      // verified its own body signature before calling in — may omit it.
      // Without this, any authenticated vendor could feed arbitrary payment
      // ids into their own attempt's verify.
      if (payload.razorpaySignature) {
        const valid = verifyRazorpayPaymentSignature({
          orderId: payment.razorpayOrderId,
          paymentId: rzpPaymentId,
          signature: payload.razorpaySignature,
          keySecret: creds.keySecret,
        });
        if (!valid) {
          throw new ValidationError("Invalid Razorpay payment signature");
        }
      } else if (!payload.fromVerifiedWebhook) {
        throw new ValidationError("Razorpay payment signature is required");
      }
      let rzpPayment = await fetchRazorpayPayment({
        creds,
        paymentId: rzpPaymentId,
      });
      // Bind BEFORE capturing: a payment authorized against some other
      // Razorpay order must never be captured on this attempt's behalf.
      if (rzpPayment.order_id && rzpPayment.order_id !== payment.razorpayOrderId) {
        throw new ValidationError("Razorpay payment belongs to a different order");
      }
      if (rzpPayment.status === "authorized" && !rzpPayment.captured) {
        rzpPayment = await captureRazorpayPayment({
          creds,
          paymentId: rzpPayment.id,
          amount: payment.amount,
          currency: payment.currency,
        });
      }
      if (rzpPayment.status !== "captured") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        amount:
          rzpPayment.amount /
          Math.pow(10, getRazorpayCurrencyExponent(rzpPayment.currency)),
        currency: rzpPayment.currency,
        patch: { razorpayPaymentId: rzpPayment.id },
      });
      return { paid: result.paid };
    }

    case PLATFORM_PAYMENT_PROVIDER.PAYSTACK: {
      const creds = getPaystackCredentials({
        publicKey: settings.payment?.paystack?.publicKey,
        secretKey: settings.payment?.paystack?.secretKey,
      });
      const transaction = await verifyPaystackTransaction({
        creds,
        reference: payment.reference,
      });
      if (transaction.status !== "success") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        amount:
          transaction.amount /
          Math.pow(10, getPaystackCurrencyExponent(transaction.currency)),
        currency: transaction.currency,
        patch: { paystackTransactionId: String(transaction.id) },
      });
      return { paid: result.paid };
    }

    case PLATFORM_PAYMENT_PROVIDER.PESAPAL: {
      const { transaction, trackingId } = await fetchPesapalTransactionFor(
        payment,
        settings,
        payload.pesapalOrderTrackingId,
      );
      const state = getPesapalTransactionState(transaction);
      // Only a not-yet-collected attempt reaches here — an already-paid row was
      // handled by detectPlatformPaymentReversal above. A reversal at this
      // point means the money never landed with us, so fail the attempt rather
      // than leaving it pending for the sweep to cancel 25h later.
      if (state === "reversed") {
        await PlatformPayment.updateOne(
          { _id: payment._id, status: PLATFORM_PAYMENT_STATUS.PENDING },
          {
            $set: {
              status: PLATFORM_PAYMENT_STATUS.FAILED,
              failedAt: new Date(),
              failureReason: "Pesapal reported the transaction as reversed",
            },
          },
        );
        return { paid: false };
      }
      if (state !== "completed") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        amount: transaction.amount,
        currency: transaction.currency,
        // Carried on the guarded write too, so an adopted id lands even if the
        // best-effort patch in fetchPesapalTransactionFor could not.
        patch: { pesapalOrderTrackingId: trackingId },
      });
      return { paid: result.paid };
    }

    case PLATFORM_PAYMENT_PROVIDER.IOTEC: {
      const resolved = resolveIotecCredentials(settings.payment?.iotec);
      const creds = getIotecCredentials(resolved);
      const transaction = await getIotecTransactionStatusByExternalId({
        creds,
        externalId: payment.reference,
      });
      const state = getIotecTransactionState(transaction);
      if (state !== "completed") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        amount:
          typeof transaction.amount === "number" ? transaction.amount : undefined,
        currency: transaction.currency,
        patch: { iotecTransactionId: transaction.id },
      });
      return { paid: result.paid };
    }

    case PLATFORM_PAYMENT_PROVIDER.ORANGE_MONEY: {
      const resolved = resolveOrangeMoneyCredentials(
        settings.payment?.orange_money,
      );
      const creds = getOrangeMoneyCredentials(resolved);
      // Throw rather than report not-paid: an attempt we cannot answer for is
      // unknown, and recording unknown as unpaid is how a paid vendor loses
      // their boost. Same rule fetchPesapalTransactionFor states for Pesapal.
      if (!payment.orangeMoneyPayToken) {
        throw new Error(
          `Platform payment ${payment._id} has no Orange Money pay token; its status cannot be read.`,
        );
      }
      if (
        payload.orangeMoneyNotifToken &&
        payment.orangeMoneyNotifToken &&
        payload.orangeMoneyNotifToken !== payment.orangeMoneyNotifToken
      ) {
        console.error(
          `Orange Money notification for platform payment ${payment._id} carried an invalid notif token`,
        );
        return { paid: false };
      }
      const transaction = await getOrangeMoneyTransactionStatus({
        creds,
        orderId: payment.reference,
        amount: payment.amount,
        payToken: payment.orangeMoneyPayToken,
      });
      const state = getOrangeMoneyTransactionState(transaction);
      if (state !== "completed") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        // Deliberately no amount or currency. /transactionstatus reports
        // neither, and in sandbox Orange settles the placeholder "OUV" — which
        // finalizePlatformPayment would read as a currency mismatch and flip
        // the attempt to FAILED permanently. The amount is already confirmed:
        // we supplied it in the status call above, so SUCCESS answers for it.
        patch: { orangeMoneyTxnId: transaction.txnid },
      });
      return { paid: result.paid };
    }

    case PLATFORM_PAYMENT_PROVIDER.MTN_MOMO: {
      const resolved = resolveMtnMomoCredentials(settings.payment?.mtn_momo);
      const creds = getMtnMomoCredentials(resolved);
      // Throw rather than report not-paid: an attempt we cannot answer for is
      // unknown, and recording unknown as unpaid is how a paid vendor loses
      // their boost. Same rule as the Orange pay token.
      if (!payment.mtnMomoReferenceId) {
        throw new Error(
          `Platform payment ${payment._id} has no MTN MoMo reference id; its status cannot be read.`,
        );
      }
      let transaction;
      try {
        transaction = await getMtnMomoRequestToPayStatus({
          creds,
          referenceId: payment.mtnMomoReferenceId,
        });
      } catch (err) {
        // Briefly 404 right after the 202 while MTN registers the request —
        // "not finished yet" on a polling path, never "not paid" terminally.
        if (err instanceof MtnMomoApiError && err.httpStatus === 404) {
          return { paid: false };
        }
        throw err;
      }
      const state = getMtnMomoTransactionState(transaction);
      if (state !== "completed") return { paid: false };
      const result = await finalizePlatformPayment(payment, {
        // Amount and currency only when live: sandbox settles EUR whatever the
        // attempt was priced in, which finalizePlatformPayment would read as a
        // currency mismatch and flip the attempt to FAILED permanently.
        ...(creds.mode === "live"
          ? {
              amount: Number.isFinite(Number(transaction.amount))
                ? Number(transaction.amount)
                : undefined,
              currency: transaction.currency,
            }
          : {}),
        patch: {
          mtnMomoTransactionId: transaction.financialTransactionId || undefined,
        },
      });
      return { paid: result.paid };
    }

    default:
      return { paid: false };
  }
}

