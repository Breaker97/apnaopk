import { Order, PaymentTransaction } from "@/models";
import {
  logRefundInFlightReleaseError,
  releaseRefundInFlightWrite,
} from "@/lib/orders/refund-in-flight";

/**
 * A refund the gateway made that Storify then failed to record.
 *
 * Everything after the gateway call — the order's payment state, the refund
 * row, the ledger — can still fail (a database blip), and it used to fail as
 * an ordinary error. The admin read "refund failed" about money that had gone,
 * and a retry sent it a second time. Worse, the reservation stayed on
 * `refundedTotal` with no row behind it: when the gateway's own report
 * arrived it reserved the amount again, so one refund counted twice — or, at
 * the ceiling, was refused and never recorded at all.
 *
 * So the refund is handed to the gateway's report to record, which it does
 * whole — the row, the ledger, the points — and the reservation is given back
 * for it to take. Unless the row was written after all, in which case nothing
 * is undone. Either way an admin is told the money went, and not to send it
 * again.
 */
export async function settleRefundRecordedLate(params: {
  orderId: unknown;
  orderNumber: string;
  amount: number;
  currency?: string;
  /** The provider the money went through, as `refundOrderPayment` named it. */
  provider: string;
  externalRefundIds: string[];
  /** The in-flight stamp the reservation carried. */
  refundStamp: Date;
  error: unknown;
}): Promise<{ recorded: boolean }> {
  const ids = params.externalRefundIds.filter(Boolean);
  const recorded =
    ids.length > 0
      ? Boolean(
          await PaymentTransaction.exists({
            orderId: params.orderId,
            type: "refund",
            $or: [
              { externalId: { $in: ids } },
              { "metadata.gatewayRefundIds": { $in: ids } },
            ],
          }).catch(() => null),
        )
      : false;

  if (!recorded) {
    await Order.updateOne(
      { _id: params.orderId },
      { $inc: { refundedTotal: -params.amount } },
    ).catch((err) =>
      console.error("Failed to hand back an unrecorded refund's reservation:", err),
    );
  }
  await Order.updateOne(
    ...releaseRefundInFlightWrite(params.orderId, params.refundStamp),
  ).catch(logRefundInFlightReleaseError);

  // Pesapal sends no report of a refund back, so nothing records it for them.
  const reportsBack = params.provider !== "pesapal";
  const what = `${params.amount} ${String(params.currency || "").toUpperCase()}`.trim();
  const why = params.error instanceof Error ? params.error.message : String(params.error);
  const { notifyAdminsPaymentAnomaly } = await import("@/lib/notifications/notifications");
  await notifyAdminsPaymentAnomaly({
    title: "A refund went through but was not recorded",
    message: recorded
      ? `The ${what} refund on order #${params.orderNumber} went through ${params.provider} and its record was written, but the rest of the update failed (${why}). Open the order and check its status — do not send the refund again.`
      : `The ${what} refund on order #${params.orderNumber} went through ${params.provider}${ids.length ? ` (${ids.join(", ")})` : ""}, but the store could not record it (${why}). ${
          reportsBack
            ? `It is recorded from ${params.provider}'s own report when that arrives.`
            : "Record it on the order as already refunded."
        } Do not send it again.`,
    dedupeKey: `refund-recorded-late:${String(params.orderId)}:${params.refundStamp.getTime()}`,
    link: `/admin/orders/${String(params.orderId)}`,
  }).catch((err) =>
    console.error("Failed to report a refund that was not recorded:", err),
  );
  return { recorded };
}
