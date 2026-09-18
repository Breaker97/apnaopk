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
import { PESAPAL_CURRENCIES, isPesapalCurrency } from "@/lib/payments/pesapal";
import {
  ORANGE_MONEY_CURRENCIES,
  isOrangeMoneyCurrency,
} from "@/lib/payments/orange-money";
import { MTN_MOMO_CURRENCIES, isMtnMomoCurrency } from "@/lib/payments/mtn-momo";

export type CheckoutGatewayId =
  | "stripe"
  | "paypal"
  | "razorpay"
  | "paystack"
  | "pesapal"
  | "iotec"
  | "orange_money"
  | "mtn_momo";

export type CheckoutGatewayReadiness =
  | { ready: true }
  | { ready: false; missing: "credentials" }
  // Per-country wallets settle only their own currencies; keys cannot fix that.
  | { ready: false; missing: "currency"; currencies: string[] };

/**
 * Whether each online gateway could take a payment at checkout once switched
 * on: its credentials resolve (a saved value or the `.env` fallback) and, for
 * the per-country wallets, it settles the store currency.
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
  const payment = settings.payment;
  const currency = settings.general?.defaultCurrency;

  const stripe = resolveStripeCredentials(payment?.stripe);
  const paypal = resolvePayPalCredentials(payment?.paypal);
  const razorpay = resolveRazorpayCredentials(payment?.razorpay);
  const paystack = resolvePaystackCredentials(payment?.paystack);
  const pesapal = resolvePesapalCredentials(payment?.pesapal);
  const iotec = resolveIotecCredentials(payment?.iotec);
  const orangeMoney = resolveOrangeMoneyCredentials(payment?.orange_money);
  const mtnMomo = resolveMtnMomoCredentials(payment?.mtn_momo);

  const readiness = (
    hasCredentials: boolean,
    wallet?: { settles: boolean; currencies: Set<string> },
  ): CheckoutGatewayReadiness => {
    // The currency first: it is the one no amount of keys will fix.
    if (wallet && !wallet.settles) {
      return { ready: false, missing: "currency", currencies: [...wallet.currencies] };
    }
    return hasCredentials ? { ready: true } : { ready: false, missing: "credentials" };
  };

  return {
    stripe: readiness(Boolean(stripe.secretKey)),
    paypal: readiness(Boolean(paypal.clientId && paypal.clientSecret)),
    razorpay: readiness(Boolean(razorpay.keyId && razorpay.keySecret)),
    paystack: readiness(Boolean(paystack.secretKey)),
    pesapal: readiness(
      Boolean(pesapal.consumerKey && pesapal.consumerSecret && pesapal.ipnId),
      { settles: isPesapalCurrency(currency), currencies: PESAPAL_CURRENCIES },
    ),
    iotec: readiness(
      Boolean(iotec.clientId && iotec.clientSecret && iotec.walletId),
    ),
    orange_money: readiness(
      Boolean(
        orangeMoney.clientId && orangeMoney.clientSecret && orangeMoney.merchantKey,
      ),
      { settles: isOrangeMoneyCurrency(currency), currencies: ORANGE_MONEY_CURRENCIES },
    ),
    mtn_momo: readiness(
      Boolean(mtnMomo.subscriptionKey && mtnMomo.apiUser && mtnMomo.apiKey),
      { settles: isMtnMomoCurrency(currency), currencies: MTN_MOMO_CURRENCIES },
    ),
  };
}
