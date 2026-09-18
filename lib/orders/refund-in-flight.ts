/**
 * A refund Storify is in the middle of recording.
 *
 * Every in-app refund reserves `refundedTotal`, asks the gateway to send the
 * money, and only then writes its refund row. The gateway reports the refund
 * by webhook the moment it exists — often before that row is written — and the
 * webhook, finding no row under the refund's id, took it for one issued from
 * the dashboard: it reserved the amount again and wrote a row of its own. Then
 * the in-app flow wrote its row too. One refund, counted twice: the ledger
 * reversed twice, the vendor clawed back twice, and `refundedTotal` inflated
 * until it refused refunds the order was still owed.
 *
 * So the reservation carries a stamp, and the webhook waits while it stands:
 * it answers with an error the gateway retries, and by the retry the in-app
 * row exists under the same id. The stamp is cleared once the row is written
 * or the reservation is rolled back, and expires on its own, so a request that
 * crashed halfway cannot hold a real dashboard refund out of the books.
 */

/** How long a refund may sit between reservation and row before it is presumed dead. */
export const REFUND_IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;

/** The stamp's field on the order, set in the same write that reserves the refund. */
export const REFUND_IN_FLIGHT_FIELD = "refundInFlightAt";

/** Thrown by the webhook path so the gateway delivers the refund again later. */
export class RefundInFlightError extends Error {
  constructor(orderNumber: string) {
    super(
      `A refund on ${orderNumber} is still being recorded; the gateway will deliver this again`,
    );
    this.name = "RefundInFlightError";
  }
}

export function isRefundInFlight(
  order: { refundInFlightAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (!order.refundInFlightAt) return false;
  const stamped = new Date(order.refundInFlightAt).getTime();
  return (
    Number.isFinite(stamped) &&
    now.getTime() - stamped < REFUND_IN_FLIGHT_WINDOW_MS
  );
}

/**
 * The write that clears the stamp this refund set, as `Order.updateOne`
 * arguments. Conditional on it still being this refund's stamp, so one of two
 * overlapping refunds finishing cannot clear the other's.
 *
 * Handed back rather than executed so each caller writes through its own
 * `Order`, the one its tests already stand in for.
 */
export function releaseRefundInFlightWrite(
  orderId: unknown,
  stamp: Date,
): [Record<string, unknown>, Record<string, unknown>] {
  return [
    { _id: orderId, [REFUND_IN_FLIGHT_FIELD]: stamp },
    { $unset: { [REFUND_IN_FLIGHT_FIELD]: "" } },
  ];
}

/** A stamp that failed to clear expires on its own; it is only worth a log line. */
export function logRefundInFlightReleaseError(error: unknown): void {
  console.error("Failed to clear the refund in-flight stamp:", error);
}
