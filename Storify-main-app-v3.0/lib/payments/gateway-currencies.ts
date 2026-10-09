/**
 * Which currencies each gateway can take a payment in.
 *
 * Only the per-country wallets used to be held to a list. Every other gateway
 * was offered under any store currency once its keys were saved, so a store
 * that set PayPal up in dollars and then switched to taka kept PayPal on its
 * checkout: each shopper who chose it met a gateway error at the last step,
 * while the admin screen still read "Configured", "PayPal is connected" and
 * counted it as active, because nothing on it ever asked about the currency.
 *
 * The one table behind every reader: the storefront and the admin payment
 * screen (`resolveCheckoutGatewayReadiness`), the gateways a vendor may pay
 * through (`resolvePlatformPaymentMethods`), and the routes that start a
 * payment, which ask again of the currency actually being charged.
 *
 * Being on a list is necessary, not sufficient. Razorpay takes anything but
 * its home currency only once the merchant has activated International
 * Payments, PayPal takes BRL, CNY and MYR only on an account registered in
 * that country, and a Stripe account presents its own country's list — none
 * of which this app can see, so those stay the gateway's error to give. Where
 * a gateway's list differs by account, the union is kept: hiding a gateway
 * that could have taken the payment loses the sale just as surely as offering
 * one that cannot.
 */

import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { ValidationError } from "@/lib/api/errors";
import { normalizeCurrencyCode } from "@/lib/intl/currency-codes";
import { IOTEC_CURRENCY } from "@/lib/payments/iotec";
import { MTN_MOMO_CURRENCIES } from "@/lib/payments/mtn-momo";
import { ORANGE_MONEY_CURRENCIES } from "@/lib/payments/orange-money";
import { PESAPAL_CURRENCIES } from "@/lib/payments/pesapal";

/**
 * Stripe's presentment currencies: the union of the per-country lists at
 * docs.stripe.com/currencies, as published in September 2026.
 */
export const STRIPE_CURRENCIES: ReadonlySet<string> = new Set([
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM",
  "BBD", "BDT", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BWP", "BYN",
  "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CVE", "CZK", "DJF",
  "DKK", "DOP", "DZD", "EGP", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GIP",
  "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR",
  "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KRW", "KWD", "KYD",
  "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "MAD", "MDL", "MGA", "MKD", "MMK",
  "MNT", "MOP", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO",
  "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG",
  "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SEK", "SGD", "SHP",
  "SLE", "SOS", "SRD", "STD", "SZL", "THB", "TJS", "TND", "TOP", "TRY", "TTD",
  "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VND", "VUV", "WST", "XAF",
  "XCD", "XCG", "XOF", "XPF", "YER", "ZAR", "ZMW"
]);

/**
 * PayPal's REST currency codes, from
 * developer.paypal.com/api/rest/reference/currency-codes.
 */
export const PAYPAL_CURRENCIES: ReadonlySet<string> = new Set([
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD", "HUF",
  "ILS", "JPY", "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "SEK", "SGD", "THB",
  "TWD", "USD"
]);

/**
 * Razorpay's currencies, rupees included, as its international payments page
 * lists them (razorpay.com/docs/payments/international-payments). Kept as
 * published, withdrawn codes and all, so the list can be checked against the
 * page line for line.
 */
const RAZORPAY_CURRENCIES: ReadonlySet<string> = new Set([
  "AED", "ALL", "AMD", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD",
  "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BZD", "CAD", "CHF",
  "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD",
  "EGP", "ETB", "EUR", "FJD", "GBP", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD",
  "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "ISK", "JMD",
  "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KRW", "KWD", "KYD", "KZT", "LAK",
  "LKR", "LRD", "LSL", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MUR",
  "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD",
  "OMR", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB",
  "RWF", "SAR", "SCR", "SEK", "SGD", "SLL", "SOS", "SVC", "SZL", "THB", "TND",
  "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VND", "VUV",
  "XAF", "XCD", "XOF", "XPF", "YER", "ZAR", "ZMW"
]);

/**
 * Paystack's seven markets — Nigeria, Ghana, Kenya, South Africa, Côte
 * d'Ivoire, Egypt and Rwanda — and the dollars some of its accounts take.
 */
const PAYSTACK_CURRENCIES: ReadonlySet<string> = new Set([
  "EGP", "GHS", "KES", "NGN", "RWF", "USD", "XOF", "ZAR"
]);

const SETTLED_CURRENCIES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["stripe", STRIPE_CURRENCIES],
  ["paypal", PAYPAL_CURRENCIES],
  ["razorpay", RAZORPAY_CURRENCIES],
  ["paystack", PAYSTACK_CURRENCIES],
  ["pesapal", PESAPAL_CURRENCIES],
  ["iotec", new Set([IOTEC_CURRENCY])],
  ["orange_money", ORANGE_MONEY_CURRENCIES],
  ["mtn_momo", MTN_MOMO_CURRENCIES],
]);

/**
 * The store currency the way checkout charges it: the saved code, else the
 * default. Every gate reads it through here — a gate that treated an unset
 * currency as "none" would have hidden every gateway at once.
 */
export function storeCurrencyCode(
  settings:
    | { general?: { defaultCurrency?: string | null } | null }
    | null
    | undefined,
): string {
  return (
    normalizeCurrencyCode(settings?.general?.defaultCurrency) || DEFAULT_CURRENCY
  );
}

/**
 * The gateway behind a checkout payment method, or null for one no gateway
 * carries (cash on delivery). Checkout calls Stripe `card`, as an order does.
 */
export function gatewayForPaymentMethod(method: unknown): string | null {
  const key = String(method || "").trim().toLowerCase();
  if (key === "card") return "stripe";
  return SETTLED_CURRENCIES.has(key) ? key : null;
}

/** The currencies a gateway settles; null when it has no list to hold it to. */
export function settledCurrencies(gateway: string): ReadonlySet<string> | null {
  return SETTLED_CURRENCIES.get(gateway) ?? null;
}

export function gatewaySettlesCurrency(gateway: string, currency: unknown): boolean {
  const settled = settledCurrencies(gateway);
  return !settled || settled.has(normalizeCurrencyCode(currency));
}

/**
 * A gateway's currencies as a message can name them, or null when there are
 * too many to be worth reading — a refusal that lists Stripe's hundred and
 * thirty codes says nothing.
 */
export function listableCurrencies(settled: ReadonlySet<string>): string | null {
  return settled.size <= 12 ? [...settled].join(", ") : null;
}

/**
 * Refuse to start a shopper's payment through a gateway that cannot take its
 * currency.
 *
 * Checkout, the pay link and the balance card already leave such a gateway
 * out; this is for the request that arrives anyway — a page opened before the
 * store changed currency, or an order still priced in the old one. Asked
 * before anything is written, and answered in words a shopper can act on
 * rather than with the gateway's own error.
 */
export function assertPaymentMethodSettles(
  paymentMethod: unknown,
  currency: unknown,
): void {
  const gateway = gatewayForPaymentMethod(paymentMethod);
  if (!gateway || gatewaySettlesCurrency(gateway, currency)) return;
  throw new ValidationError(
    `This payment method can't take payments in ${normalizeCurrencyCode(currency)}. Please choose another one.`,
  );
}
