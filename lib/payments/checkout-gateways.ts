import "server-only";

import type { ISettings } from "@/models/settings.model";
import {
  resolveIotecCredentials,
  resolveMtnMomoCredentials,
  resolveOrangeMoneyCredentials,
  resolvePayPalCredentials,
  resolvePaystackCredentials,
  resolvePesapalCredentials,
  resolveRazorpayCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import {
  settledCurrencies,
  storeCurrencyCode,
} from "@/lib/payments/gateway-currencies";

export const CHECKOUT_GATEWAY_IDS = [
  "stripe",
  "paypal",
  "razorpay",
  "paystack",
  "pesapal",
  "iotec",
  "orange_money",
  "mtn_momo",
] as const;

export type CheckoutGatewayId = (typeof CHECKOUT_GATEWAY_IDS)[number];

/** How each gateway is named to an operator, for messages about it. */
export const CHECKOUT_GATEWAY_LABELS: Record<CheckoutGatewayId, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  razorpay: "Razorpay",
  paystack: "Paystack",
  pesapal: "Pesapal",
  iotec: "ioTec",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
};

export type CheckoutGatewayReadiness =
  | { ready: true }
  | { ready: false; missing: "credentials" }
  // The store currency is not one the gateway settles; keys cannot fix that.
  // `currency` is the store's, `currencies` the gateway's own list.
  | { ready: false; missing: "currency"; currency: string; currencies: string[] };

type PaymentSettings = Partial<ISettings["payment"]> | null | undefined;

/**
 * The credential fields a gateway cannot take a payment without, under the
 * labels the admin payment screen prints on them.
 *
 * One table, two readers: readiness below asks only whether anything is
 * missing, and the settings save refuses to store a gateway switched on while
 * something is (`findGatewaysSwitchedOnWithoutKeys`). Keeping them apart is
 * how a gateway ends up saved in a state checkout will not offer.
 */
const REQUIRED_CREDENTIALS: Record<
  CheckoutGatewayId,
  readonly { key: string; label: string }[]
> = {
  // Both keys: the card form mounts in the browser with the publishable key,
  // so a secret key on its own still leaves checkout unable to offer a card.
  stripe: [
    { key: "publishableKey", label: "Publishable Key" },
    { key: "secretKey", label: "Secret Key" },
  ],
  paypal: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret" },
  ],
  razorpay: [
    { key: "keyId", label: "Key ID" },
    { key: "keySecret", label: "Key Secret" },
  ],
  // Paystack is initialised server-side; its public key is only used when
  // reading a transaction back, so checkout works without one.
  paystack: [{ key: "secretKey", label: "Secret Key" }],
  pesapal: [
    { key: "consumerKey", label: "Consumer Key" },
    { key: "consumerSecret", label: "Consumer Secret" },
    { key: "ipnId", label: "IPN ID" },
  ],
  iotec: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret" },
    { key: "walletId", label: "Wallet ID" },
  ],
  orange_money: [
    { key: "clientId", label: "Client ID" },
    { key: "clientSecret", label: "Client Secret" },
    { key: "merchantKey", label: "Merchant Key" },
  ],
  mtn_momo: [
    { key: "subscriptionKey", label: "Subscription Key" },
    { key: "apiUser", label: "API User" },
    { key: "apiKey", label: "API Key" },
  ],
};

function resolveGatewayCredentials(
  payment: PaymentSettings,
): Record<CheckoutGatewayId, object> {
  return {
    stripe: resolveStripeCredentials(payment?.stripe),
    paypal: resolvePayPalCredentials(payment?.paypal),
    razorpay: resolveRazorpayCredentials(payment?.razorpay),
    paystack: resolvePaystackCredentials(payment?.paystack),
    pesapal: resolvePesapalCredentials(payment?.pesapal),
    iotec: resolveIotecCredentials(payment?.iotec),
    orange_money: resolveOrangeMoneyCredentials(payment?.orange_money),
    mtn_momo: resolveMtnMomoCredentials(payment?.mtn_momo),
  };
}

/**
 * Per gateway, the labels of the credential fields that still have no value —
 * counting the `.env` fallback, which is a perfectly good place to keep them.
 */
export function missingGatewayCredentials(
  payment: PaymentSettings,
): Record<CheckoutGatewayId, string[]> {
  const resolved = resolveGatewayCredentials(payment);
  const missing = {} as Record<CheckoutGatewayId, string[]>;

  for (const gateway of CHECKOUT_GATEWAY_IDS) {
    const credentials = resolved[gateway] as Record<string, unknown>;
    missing[gateway] = REQUIRED_CREDENTIALS[gateway]
      .filter((field) => {
        const value = credentials[field.key];
        return typeof value !== "string" || !value.trim();
      })
      .map((field) => field.label);
  }

  return missing;
}

/**
 * Whether each online gateway could take a payment at checkout once switched
 * on: its credentials resolve (a saved value or the `.env` fallback) and it
 * settles the store currency (`lib/payments/gateway-currencies.ts`).
 *
 * The one rule behind two readers. The storefront offers a gateway only when
 * it is switched on AND ready (`/api/settings/public`), and the admin payment
 * screen says why a switched-on gateway is missing from checkout. The two used
 * to disagree — every switch counted as "active" and a wallet that cannot
 * settle the store currency read "Configured" — so a store could show
 * "8 active" while checkout offered cash on delivery alone.
 */
export function resolveCheckoutGatewayReadiness(settings: {
  general?: { defaultCurrency?: string | null } | null;
  payment?: Partial<ISettings["payment"]> | null;
}): Record<CheckoutGatewayId, CheckoutGatewayReadiness> {
  const currency = storeCurrencyCode(settings);
  const missing = missingGatewayCredentials(settings.payment);

  const readiness = {} as Record<CheckoutGatewayId, CheckoutGatewayReadiness>;
  for (const gateway of CHECKOUT_GATEWAY_IDS) {
    // The currency first: it is the one no amount of keys will fix.
    const settled = settledCurrencies(gateway);
    if (settled && !settled.has(currency)) {
      readiness[gateway] = {
        ready: false,
        missing: "currency",
        currency,
        currencies: [...settled],
      };
    } else {
      readiness[gateway] =
        missing[gateway].length === 0
          ? { ready: true }
          : { ready: false, missing: "credentials" };
    }
  }
  return readiness;
}

interface GatewayWithoutKeys {
  gateway: CheckoutGatewayId;
  label: string;
  /** Labels of the credential fields that would be left empty. */
  fields: string[];
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * The gateways a payment save would leave switched on without the keys they
 * need — what the settings route refuses the save over.
 *
 * `incoming` is one payment section as posted, merged over what is stored,
 * because a saved credential renders as an empty field (its value lives only
 * in the masked hint) and an untouched form echoes those blanks back. Run this
 * after `applyCredentialUpdateMarkers`, which drops the blanks that mean "keep
 * what is stored" and leaves `undefined` where the admin cleared a field.
 */
export function findGatewaysSwitchedOnWithoutKeys(
  incoming: Record<string, unknown>,
  stored: Record<string, unknown> | null | undefined,
): GatewayWithoutKeys[] {
  const merged: Record<string, unknown> = {};
  for (const gateway of CHECKOUT_GATEWAY_IDS) {
    const before = asRecord(stored?.[gateway]) ?? {};
    const patch = asRecord(incoming[gateway]);
    merged[gateway] = patch ? { ...before, ...patch } : before;
  }

  const missing = missingGatewayCredentials(
    merged as unknown as PaymentSettings,
  );

  return CHECKOUT_GATEWAY_IDS.filter(
    (gateway) =>
      (merged[gateway] as { enabled?: unknown }).enabled === true &&
      missing[gateway].length > 0,
  ).map((gateway) => ({
    gateway,
    label: CHECKOUT_GATEWAY_LABELS[gateway],
    fields: missing[gateway],
  }));
}
