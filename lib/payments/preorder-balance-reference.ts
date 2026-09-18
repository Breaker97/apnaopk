/**
 * How a pre-order balance records WHERE the money came from.
 *
 * `Order.preorderBalancePaymentIntentId` is one field doing two jobs: it is the
 * idempotency key for the balance whoever collected it, and — when a gateway
 * collected it — the id of the charge that did. An admin recording money that
 * arrived outside any gateway has no such id, so the reference is prefixed to
 * keep it unmistakably out of Stripe's id namespace (see `claimPreorderBalance`
 * in `preorder-balance.ts`: the asymmetry is what makes a card payment landing
 * after an offline record refund itself instead of being collected twice).
 *
 * This lives in a module of its own, free of the Stripe SDK and of every model,
 * because the refund side has to ask the same question from the other end. A
 * refund handed `offline:CASH-1183` as a PaymentIntent id does not fail
 * gracefully: Stripe raises "no such payment_intent" and the whole refund —
 * including the deposit it COULD have returned — dies with it.
 */

export const OFFLINE_BALANCE_REFERENCE_PREFIX = "offline:";

/**
 * Was this balance recorded by hand rather than taken by a gateway?
 *
 * True means the money never went through the gateway that holds the deposit,
 * so it cannot come back through it either — it has to be returned the way it
 * arrived.
 */
export function isOfflineBalanceReference(reference?: string | null): boolean {
  return String(reference || "").startsWith(OFFLINE_BALANCE_REFERENCE_PREFIX);
}

/**
 * A balance PayPal collected, recorded as `paypal:<captureId>`.
 *
 * Same field, same reason as `offline:` above: it is the balance's idempotency
 * key whoever collected it, so a PayPal capture has to be written there too —
 * or a card payment landing afterwards would read the balance as unpaid and
 * take it a second time. The prefix keeps a PayPal capture id out of Stripe's
 * namespace, where handing it to `paymentIntents.retrieve` fails the whole call.
 */
export const PAYPAL_BALANCE_REFERENCE_PREFIX = "paypal:";

export function isPayPalBalanceReference(reference?: string | null): boolean {
  return String(reference || "").startsWith(PAYPAL_BALANCE_REFERENCE_PREFIX);
}

/** The PayPal capture behind a `paypal:` reference, or undefined for any other. */
export function payPalCaptureIdFromBalanceReference(
  reference?: string | null,
): string | undefined {
  if (!isPayPalBalanceReference(reference)) return undefined;
  const id = String(reference).slice(PAYPAL_BALANCE_REFERENCE_PREFIX.length);
  return id || undefined;
}

/**
 * Whether a balance reference names a Stripe PaymentIntent.
 *
 * Every Stripe path — refunds, the stale-intent check, dashboard-refund
 * reconciliation — has to ask this rather than "is it not offline", which was
 * the whole question while Stripe was the only gateway that could collect a
 * balance, and stopped being it the day PayPal could.
 */
export function isStripeBalanceReference(
  reference?: string | null,
): reference is string {
  const value = String(reference || "");
  return (
    value.length > 0 &&
    !isOfflineBalanceReference(value) &&
    !isPayPalBalanceReference(value)
  );
}
