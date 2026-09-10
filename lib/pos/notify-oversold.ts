import { notifyAdminsPaymentAnomaly } from "@/lib/notifications/notifications";
import type { POSOversoldLine } from "@/lib/pos/oversold";

/**
 * Tell the merchant a shelf is now short.
 *
 * A replayed offline sale is accepted even when the stock is gone, because the
 * goods left the shop hours ago and refusing the record would only hide that.
 * What must not happen is the discrepancy going unnoticed until a stock count
 * weeks later turns up an unexplained variance with no way back to its cause.
 *
 * Routed through the payment-anomaly channel because it is the same kind of
 * event: an operational incident that bypasses routine notification
 * preferences, rather than a sales notification somebody might reasonably have
 * switched off. It carries the order so the merchant can open the sale that
 * caused it.
 *
 * Best effort by design — the sale is already committed, and a notification
 * failure must never turn a completed order into an error at the counter.
 */
export async function notifyPOSOversold(params: {
  orderNumber: string;
  localReceiptNumber?: string;
  lines: POSOversoldLine[];
}): Promise<void> {
  if (params.lines.length === 0) return;

  const detail = params.lines
    .map(
      (line) =>
        `${line.name}: sold ${line.requested}, ${line.available} on hand`,
    )
    .join("; ");

  const receipt = params.localReceiptNumber
    ? ` (counter receipt ${params.localReceiptNumber})`
    : "";

  try {
    await notifyAdminsPaymentAnomaly({
      title: "Offline sale exceeded available stock",
      message:
        `Order ${params.orderNumber}${receipt} was rung up while a register ` +
        `was offline and has now synced, taking stock below zero. ` +
        `Recount and correct: ${detail}.`,
      // Dedupe key: one alert per order, not one per line.
      paymentIntentId: `pos-oversold:${params.orderNumber}`,
    });
  } catch (error) {
    console.error("Failed to report an oversold POS sale:", error);
  }
}
