/**
 * What a redirect gateway's start wrote for the payment to land on: the
 * pending order, or — on a gateway switched over to checkout attempts — the
 * attempt that becomes the order once the money arrives (no number yet).
 */
export interface GatewayCheckoutRecord {
  kind: "order" | "attempt";
  /** The order's or the attempt's `_id`, as the database handed it over. */
  id: unknown;
  /** "" for an attempt. */
  orderNumber: string;
}
