/**
 * Stripe Server Configuration
 * Server-side Stripe instance for API routes
 */

import Stripe from "stripe";
import { currencyMinorUnitExponent } from "@/lib/intl/money";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

// Create Stripe instance only if key is available
// This prevents build errors when key is not set
const stripeBySecretKey = new Map<string, Stripe>();

export function getStripeForSecretKey(secretKey?: string): Stripe {
  const key = secretKey || stripeSecretKey;
  if (!key) {
    throw new Error("Stripe is not configured. Missing secret key.");
  }

  const cached = stripeBySecretKey.get(key);
  if (cached) return cached;

  const instance = new Stripe(key, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });
  stripeBySecretKey.set(key, instance);
  return instance;
}

export function isStripeSecretKeyConfigured(secretKey?: string): boolean {
  return Boolean(secretKey || stripeSecretKey);
}

type StripePaymentFee = { amount: number; currency: string; rate?: number };

/**
 * The `expand` path that brings Stripe's fee along with a payment intent.
 *
 * Two hops, because Stripe does not put the fee on the intent: the intent names
 * a charge, and the charge names a balance transaction, which is where `fee`
 * lives. Expanding both fetches them in the same round trip as the intent.
 */
export const STRIPE_FEE_EXPAND = "latest_charge.balance_transaction";

/**
 * The fee on an intent retrieved with STRIPE_FEE_EXPAND; undefined when the
 * charge or its balance transaction is absent or was not expanded.
 *
 * The fee is denominated in the account's BALANCE currency, which is why the
 * currency travels with the amount rather than being assumed from the charge.
 */
export async function stripeFeeFromIntent(
  intent: Stripe.PaymentIntent,
): Promise<StripePaymentFee | undefined> {
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") return undefined;
  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === "string") {
    return undefined;
  }
  const { stripeFee } = await import("@/lib/payments/gateway-fee");
  return stripeFee(balanceTransaction);
}

/**
 * What Stripe kept on a payment intent, or undefined if it cannot be read.
 *
 * **Never throws.** This runs inside the webhook that creates the order, and an
 * order must not fail to exist because a reporting figure could not be read —
 * a missing fee is recoverable from the dashboard, a missing order is not.
 */
export async function fetchStripePaymentFee(
  stripeClient: Stripe,
  paymentIntentId: string,
): Promise<StripePaymentFee | undefined> {
  try {
    const intent = await stripeClient.paymentIntents.retrieve(paymentIntentId, {
      expand: [STRIPE_FEE_EXPAND],
    });
    return await stripeFeeFromIntent(intent);
  } catch (error) {
    console.error(
      `Could not read the Stripe fee for payment intent ${paymentIntentId}:`,
      error,
    );
    return undefined;
  }
}

/**
 * Convert a major-unit amount (e.g. dollars) into the smallest unit Stripe
 * expects for the given currency. Handles zero-decimal (UGX, JPY, …) and
 * three-decimal (KWD, BHD, …) currencies instead of assuming ×100.
 *
 * Stripe additionally requires three-decimal amounts to be a multiple of 10 in
 * the smallest unit (the last digit is always 0), which is why
 * `currencyPriceScale` caps stored prices for those currencies at 2 decimals.
 */
export function toStripeAmount(amount: number, currency: string): number {
  const exponent = currencyMinorUnitExponent(currency);
  const value = Number(amount || 0);
  if (exponent === 0) return Math.round(value);
  if (exponent === 3) return Math.round((value * 1000) / 10) * 10;
  return Math.round(value * 100);
}

/**
 * Convert a smallest-unit amount that came back FROM Stripe into major units.
 *
 * Invoice rows persist Stripe's `amount_due`/`amount_paid`/`amount_refunded`
 * verbatim, because those rows are the provider's financial record and must
 * keep matching what Stripe reports. Everything on our side of the boundary —
 * anything formatted for display, or summed alongside order money, which is
 * stored in major units — has to come back through here first. Skipping it
 * reports a $1,000 invoice as $100,000.
 */
export function fromStripeAmount(amount: number, currency: string): number {
  const exponent = currencyMinorUnitExponent(currency);
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  if (exponent === 0) return value;
  if (exponent === 3) return value / 1000;
  return value / 100;
}

// Export stripe for direct usage (may be null)
