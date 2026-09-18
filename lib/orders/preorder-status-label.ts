/**
 * A pre-order's state, in words a shopper reads.
 *
 * One map, because the account area now shows this in two places — the orders
 * list and the order detail page — and two copies of the same eight strings
 * drift the moment a state is added. `lib/orders/preorders.ts` owns the enum
 * itself but reaches for mongoose on the way in, so it cannot be imported by a
 * client component; the keys here are deliberately the same literals.
 *
 * An unknown state is de-underscored rather than dropped: a value this map has
 * not caught up with still tells the shopper more than a blank line does.
 */
const PREORDER_STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  payment_due: "Payment due",
  delayed: "Delayed",
  partially_ready: "Partially ready",
  ready: "Ready",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function getPreorderStatusLabel(status?: string): string | null {
  if (!status) return null;
  return PREORDER_STATUS_LABELS[status] || status.replace(/_/g, " ");
}
