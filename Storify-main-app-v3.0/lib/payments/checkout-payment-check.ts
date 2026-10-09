/**
 * The shape every redirect gateway's verify core answers in
 * (lib/payments/<provider>-verify.ts): what the gateway says of the payment,
 * and the settlement — the gateway's finalizer, which proves the payment
 * again before it writes anything.
 *
 * The website's verify routes settle whatever the state, as they always have
 * (the finalizer refuses a payment that has not gone through); the shopper
 * app reads the state first and settles only a payment the gateway reports
 * complete, so it can tell "not yet" from "refused".
 */

/** Whose payment it is: the signed-in shopper's orders, or a guest's cart. */
export interface CheckoutPaymentScope {
  /** Scopes the order (or attempt) lookup to this shopper. */
  sessionUserId?: string;
  /** The guest's cart (the web's `cart_session`, the app's `X-Cart-Token`), closed when the order settles. */
  cartSessionId?: string;
  /** Who to send the confirmation to, when the gateway reports nobody. */
  customerEmail?: string;
}

/** The order a settled payment belongs to. */
export interface SettledCheckoutPayment {
  orderId: string;
  orderNumber: string;
  /** The payment was already on the order (a replay, the webhook first). */
  alreadyPaid: boolean;
}

export interface GatewayPaymentCheck<State extends string> {
  /** The gateway's own word for where the payment stands. */
  state: State;
  settle: () => Promise<SettledCheckoutPayment>;
}
