/**
 * Which gateways can take a payment back through a dispute, and the names
 * Storify keeps their disputes under.
 *
 * Pure and dependency-free, because the admin refund dialog asks the same
 * question the webhooks and the dispute sync do — can this order have a
 * chargeback, and whose? — and must not pull a payment SDK into the browser to
 * find out.
 */

export type DisputeGateway = "stripe" | "razorpay" | "paystack" | "paypal";

const METHOD_GATEWAYS: Record<string, DisputeGateway> = {
  card: "stripe",
  stripe: "stripe",
  razorpay: "razorpay",
  paystack: "paystack",
  paypal: "paypal",
};

/** The gateway an order's disputes come from, or null when no chargeback can reach it. */
export function disputeGatewayForMethod(
  paymentMethod: string | null | undefined,
): DisputeGateway | null {
  return METHOD_GATEWAYS[String(paymentMethod || "").toLowerCase().trim()] ?? null;
}

/**
 * The id a dispute's money is recorded under.
 *
 * Stripe (`du_…`, or `dp_…` on older API versions), Razorpay (`disp_…`) and PayPal (`PP-D-…`) ids already say
 * whose they are. Paystack's are bare numbers from the same kind of sequence
 * its refunds use, so a Paystack dispute is prefixed — otherwise dispute 4001
 * and refund 4001 on one order would read as the same money.
 */
export function disputeKey(gateway: DisputeGateway, disputeId: string): string {
  const id = String(disputeId || "").trim();
  return gateway === "paystack" ? `paystack-dispute:${id}` : id;
}

export const DISPUTE_GATEWAY_LABEL: Record<DisputeGateway, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  paystack: "Paystack",
  paypal: "PayPal",
};

/** Where an admin answers a dispute. */
export const DISPUTE_RESPONSE_PLACE: Record<DisputeGateway, string> = {
  stripe: "the Stripe dashboard",
  razorpay: "the Razorpay dashboard, under Disputes",
  paystack: "the Paystack dashboard, under Disputes",
  paypal: "the PayPal Resolution Center",
};
