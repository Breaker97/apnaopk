/**
 * Whether a Stripe PaymentIntent pays for the register sale being written.
 *
 * A POS card sale is recorded paid and the goods are handed over on the spot,
 * on the strength of the intent id the register sends back. Checking only
 * "succeeded, same amount, not used yet" let any such intent through: one
 * taken online, one another cashier or another shop took, or one already
 * refunded — an intent stays `succeeded` after its charge is refunded. The
 * intent the register opens (`/api/pos/payments/stripe/intent`) records the
 * channel, the cashier and the location, and this holds the sale to them.
 *
 * Returns what is wrong, or null when the intent pays for this sale.
 */

type ChargeLike = {
  amount_refunded?: number | null;
  refunded?: boolean | null;
  disputed?: boolean | null;
};

export type PosStripeIntentLike = {
  status: string;
  currency: string;
  amount_received?: number | null;
  metadata?: Record<string, string> | null;
  /** Retrieved with `expand: ["latest_charge"]`, so an object when present. */
  latest_charge?: string | ChargeLike | null;
};

export function posStripeIntentProblem(
  intent: PosStripeIntentLike,
  expected: {
    /** In Stripe's smallest unit (`toStripeAmount`). */
    amount: number;
    currency: string;
    cashierId: string;
    posLocationId?: string;
  },
): string | null {
  // `processing` can still fail, and the sale is written paid and handed
  // over on the spot — nothing would take it back.
  if (intent.status !== "succeeded") return "Stripe payment was not completed";

  const metadata = intent.metadata ?? {};
  if (metadata.channel !== "pos") {
    return "This card payment was not taken at the register";
  }
  if (metadata.staffId !== expected.cashierId) {
    return "This card payment was taken by another cashier";
  }
  if (
    metadata.posLocationId &&
    expected.posLocationId &&
    metadata.posLocationId !== expected.posLocationId
  ) {
    return "This card payment was taken at another location";
  }

  if (
    intent.amount_received !== expected.amount ||
    intent.currency !== expected.currency
  ) {
    return "Stripe payment amount does not match order total";
  }

  const charge = intent.latest_charge;
  if (!charge || typeof charge !== "object") {
    return "The card payment could not be confirmed";
  }
  if ((charge.amount_refunded ?? 0) > 0 || charge.refunded || charge.disputed) {
    return "This card payment has been refunded or disputed";
  }
  return null;
}
