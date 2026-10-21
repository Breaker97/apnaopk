/**
 * What a failed refund call says about the money.
 *
 * A refund that throws is one of two very different things. The gateway can
 * have ANSWERED — a card that cannot be refunded, a gateway that is not set
 * up, a refund it says failed — in which case nothing moved and the claim on
 * the order can simply be handed back. Or nobody got an answer — a timeout, a
 * dropped connection, the gateway's own server failing — in which case the
 * refund may have been made before the reply was lost, and handing the claim
 * back lets the next try send it twice.
 *
 * `refundOrderPayment` marks the first kind. Anything NOT marked is read as
 * "may have moved", so a caller that never heard of the marker (or an error
 * that came from somewhere else) stays on the safe side: it holds the claim.
 *
 * A symbol from the global registry rather than a property or a class: this
 * module can be bundled more than once, and each copy must still recognise
 * the other's mark (see lib/process-singleton.ts).
 */
const NOT_SENT = Symbol.for("storify.refund.notSent");

/** Says this error is the gateway's answer: nothing was sent. Returns the same error. */
export function markRefundNotSent<T>(error: T): T {
  if (error && typeof error === "object") {
    try {
      Object.defineProperty(error, NOT_SENT, {
        value: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // A frozen error stays unmarked, which reads as "may have moved".
    }
  }
  return error;
}

/** True only for an error `refundOrderPayment` positively knows sent nothing. */
export function refundNotSent(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as Record<symbol, unknown>)[NOT_SENT] === true,
  );
}
