import { PLATFORM_GATEWAY_PAYMENT_METHODS } from "@/lib/payments/payment-custody";

/**
 * The switch that decides, per gateway, whether a checkout writes an ORDER
 * before the shopper leaves to pay, or a checkout ATTEMPT.
 *
 * Every redirect gateway writes the whole order up front today, because the
 * gateway's reference has to be stored on something. Moving that to a
 * `CheckoutAttempt` row is the change the checkout-attempt work exists for,
 * and it is the riskiest change in the payment stack: at the moment a gateway
 * flips, some shoppers are sitting on that gateway's page with an order
 * already written for them. Their payment must still find its order.
 *
 * So the flip is per gateway, at runtime, and reversible **without a deploy**.
 * A gateway that misbehaves at two in the morning is turned off from the
 * settings, not from a pull request. Three rules make that safe, and all
 * three are load-bearing:
 *
 *  1. **This flag only decides what NEW checkouts write.** It never decides
 *     how a payment is settled.
 *  2. **The finalizers always look both ways** — attempt first, then the
 *     legacy pending order — whatever this says. So turning a gateway ON does
 *     not strand the orders already in flight, and turning it back OFF does
 *     not strand the attempts already open.
 *  3. **Legacy rows are retired before the flip**, by
 *     `scripts/retire-stale-gateway-orders.ts`, so the number of in-flight
 *     legacy orders is small and known rather than years deep.
 *
 * Empty by default: every gateway behaves exactly as it does today until
 * somebody names it here.
 *
 * Deliberately free of `server-only` and of any import but the custody
 * allowlist, so the rule can be asserted in tests.
 */

/**
 * Just enough of the settings document to answer. Structural rather than the
 * real `ISettings`, so the rule stays testable with a plain object and the
 * caller's own settings type — whatever shape Mongoose hands it back as —
 * satisfies it.
 */
type AttemptGatewaySettings = {
  payment?: unknown;
} | null;

/**
 * The gateways switched over, normalised: trimmed, lower-cased, de-duplicated,
 * and **filtered against the gateway allowlist**.
 *
 * The filter is what stops a typo from being a silent half-migration: a
 * settings value of `"razorpsy"` names no gateway, so it is dropped rather
 * than left to mean "some gateway, maybe". `cod` and `pay_later` can never
 * appear — they take no payment while the shopper waits, so they have nothing
 * to attempt.
 */
export function resolveAttemptGateways(
  settings: AttemptGatewaySettings,
): string[] {
  const payment = settings?.payment as
    | { attemptGateways?: unknown }
    | null
    | undefined;
  const raw = payment?.attemptGateways;
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(PLATFORM_GATEWAY_PAYMENT_METHODS);
  const seen = new Set<string>();
  for (const entry of raw) {
    const method = String(entry ?? "").trim().toLowerCase();
    if (method && allowed.has(method)) seen.add(method);
  }
  return [...seen];
}

/**
 * Does this gateway write attempts yet?
 *
 * Asked by the checkout branch that is about to write something. Nothing else
 * should ask it: a settler that consulted this flag would answer differently
 * from one minute to the next, which is precisely how an in-flight payment
 * gets lost. See rule 2 above.
 */
export function isAttemptGateway(
  settings: AttemptGatewaySettings,
  paymentMethod: string | null | undefined,
): boolean {
  const method = String(paymentMethod ?? "").trim().toLowerCase();
  if (!method) return false;
  return resolveAttemptGateways(settings).includes(method);
}
