/**
 * A cart as an API response may show it: its id and its lines.
 *
 * The cart document also carries the checkout snapshot — the shopper's email,
 * phone and addresses, their checkout answers, the recovery and checkout
 * tokens and the session id — and every cart response spread the whole
 * document, so whoever held the cookie (a recovery link hands one out) could
 * read all of it back. Routes add the figures they compute to this.
 */
export function cartResponse<T extends { _id: unknown; items?: unknown }>(
  cart: T,
): { _id: string; items: T["items"] | [] } {
  return { _id: String(cart._id), items: cart.items ?? [] };
}
