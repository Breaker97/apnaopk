/**
 * An order whose last refund may or may not have gone through.
 *
 * A gateway that never answers (a timeout, a dropped connection, its own
 * server failing) leaves a refund nobody can confirm. The in-app claim is
 * handed back so the gateway's own report can record the refund if it was made
 * — but nothing then stopped the admin from sending it again a moment later,
 * ahead of that report, and a refund that had gone through was paid twice.
 *
 * So the order is stamped, and no new refund goes to a gateway from it while
 * the stamp stands. It expires on its own: by then the gateway has reported
 * the refund if there was one (it appears on the order by itself), or the admin
 * has looked at the gateway and seen there is none.
 */

/** The stamp's field on the order. */
export const REFUND_UNCONFIRMED_FIELD = "refundUnconfirmedAt";

/** How long new gateway refunds on the order wait after an unanswered one. */
export const REFUND_UNCONFIRMED_WINDOW_MS = 10 * 60 * 1000;

/** The stamp's moment, when it still holds refunds back. */
export function refundUnconfirmedUntil(
  order: { refundUnconfirmedAt?: Date | string | null },
  now: Date = new Date(),
): Date | null {
  if (!order.refundUnconfirmedAt) return null;
  const stamped = new Date(order.refundUnconfirmedAt).getTime();
  if (!Number.isFinite(stamped)) return null;
  const until = stamped + REFUND_UNCONFIRMED_WINDOW_MS;
  return until > now.getTime() ? new Date(until) : null;
}

/** Why a refund through a gateway cannot be sent from this order right now, or null. */
export function refundUnconfirmedProblem(
  order: { refundUnconfirmedAt?: Date | string | null },
  now: Date = new Date(),
): string | null {
  const until = refundUnconfirmedUntil(order, now);
  if (!until) return null;
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return `The last refund on this order did not get an answer from the payment provider, so it may have gone through. Look at the provider's dashboard first: if it was made, it appears on this order by itself once the provider reports it. If nothing is there, you can refund again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/**
 * The write that stamps the order, as `Order.updateOne` arguments. Only ever
 * moves the stamp forward, so two unanswered refunds cannot shorten each other.
 */
export function holdRefundsWrite(
  orderId: unknown,
  at: Date = new Date(),
): [Record<string, unknown>, Record<string, unknown>] {
  return [{ _id: orderId }, { $max: { [REFUND_UNCONFIRMED_FIELD]: at } }];
}

/** A stamp that failed to write only costs the hold; it is worth a log line. */
export function logRefundUnconfirmedError(error: unknown): void {
  console.error("Failed to hold refunds after an unanswered one:", error);
}
