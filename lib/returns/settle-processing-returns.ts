import "server-only";

import { PaymentTransaction } from "@/models/payment-transaction.model";
import { ReturnRequest } from "@/models/return-request.model";
import { RETURN_REFUND_STATUS } from "@/lib/returns/returns";
import {
  gatewayRefundSettled,
  refundRowLegIds,
} from "@/lib/orders/refund-gateway-status";

/**
 * A return whose refund the gateway had only accepted, once it says it sent it.
 *
 * Razorpay and Paystack answer a refund "pending" for days; the return is then
 * held `processing` rather than called refunded (the admin return route). The
 * gateway's own report is what lets it go: when every refund the return's
 * money stands for has been reported sent, the return reads refunded and the
 * shopper is told so. A refund the gateway refuses reverses through
 * `reverseFailedOrderRefund`, which reopens the return itself.
 *
 * A refund that was waiting on someone to record it by hand (Pesapal, or a
 * seller's own) is left alone: no gateway report ever says it went.
 */

type Report = { id?: unknown; gatewayProvider?: string; gatewayStatus?: string };

type WaitingReturn = {
  _id: unknown;
  actualRefund?: { paymentTransactionId?: unknown; paymentTransactionIds?: unknown[]; provider?: string } | null;
};

type Row = {
  _id: unknown;
  status?: string;
  externalId?: string;
  metadata?: {
    gatewayRefundIds?: unknown;
    chargeExternalId?: unknown;
    gatewayRefundsSettled?: unknown;
    settlement?: { required?: boolean; settledAt?: unknown } | null;
  } | null;
};

/** How many returns were released from `processing` by these reports. */
export async function settleReturnsOnGatewayReports(
  orderId: unknown,
  reports: ReadonlyArray<Report>,
): Promise<number> {
  const sent = new Set(
    reports
      .filter((report) => report?.id && gatewayRefundSettled(report.gatewayProvider, report.gatewayStatus))
      .map((report) => String(report.id)),
  );
  if (sent.size === 0) return 0;

  const waiting = await ReturnRequest.find({
    orderId,
    refundStatus: RETURN_REFUND_STATUS.PROCESSING,
  })
    .select("actualRefund.paymentTransactionId actualRefund.paymentTransactionIds actualRefund.provider")
    .lean<WaitingReturn[]>();
  const candidates = waiting.filter((request) => request.actualRefund?.provider !== "pesapal");
  if (candidates.length === 0) return 0;

  const rowIds = new Set<string>();
  const rowsOf = new Map<string, string[]>();
  for (const request of candidates) {
    const ids = [
      ...(request.actualRefund?.paymentTransactionIds || []),
      request.actualRefund?.paymentTransactionId,
    ]
      .filter(Boolean)
      .map(String);
    rowsOf.set(String(request._id), [...new Set(ids)]);
    for (const id of ids) rowIds.add(id);
  }
  const rows = await PaymentTransaction.find({ _id: { $in: [...rowIds] }, type: "refund" })
    .select("status externalId metadata.gatewayRefundIds metadata.chargeExternalId metadata.gatewayRefundsSettled metadata.settlement")
    .lean<Row[]>();
  const byId = new Map(rows.map((row) => [String(row._id), row]));

  // What each row has had reported sent so far, this delivery included. Kept on
  // the row: a refund over two charges is reported by two deliveries.
  const settledLegs = new Map<string, Set<string>>();
  for (const row of rows) {
    const legs = refundRowLegIds(row);
    const before = new Set(
      Array.isArray(row.metadata?.gatewayRefundsSettled)
        ? (row.metadata?.gatewayRefundsSettled as unknown[]).map(String)
        : [],
    );
    const fresh = legs.filter((leg) => sent.has(leg) && !before.has(leg));
    if (fresh.length > 0 && row.status === "succeeded") {
      await PaymentTransaction.updateOne(
        { _id: row._id },
        { $addToSet: { "metadata.gatewayRefundsSettled": { $each: fresh } } },
      );
      for (const leg of fresh) before.add(leg);
    }
    settledLegs.set(String(row._id), before);
  }

  let released = 0;
  for (const request of candidates) {
    const mine = (rowsOf.get(String(request._id)) || []).map((id) => byId.get(id)).filter(Boolean) as Row[];
    if (mine.length === 0) continue;
    const allSent = mine.every((row) => {
      if (row.status !== "succeeded") return false;
      // Waiting on someone to send it by hand: no gateway report says it went.
      if (row.metadata?.settlement?.required && !row.metadata.settlement.settledAt) return false;
      const legs = refundRowLegIds(row);
      const done = settledLegs.get(String(row._id)) || new Set<string>();
      return legs.length > 0 && legs.every((leg) => done.has(leg));
    });
    if (!allSent) continue;

    const settled = await ReturnRequest.findOneAndUpdate(
      { _id: request._id, refundStatus: RETURN_REFUND_STATUS.PROCESSING },
      { $set: { refundStatus: RETURN_REFUND_STATUS.SUCCEEDED, "actualRefund.confirmedAt": new Date() } },
      { returnDocument: "after" },
    ).lean();
    if (!settled) continue;
    released += 1;
    try {
      const { notifyReturnRequestCustomer } = await import("@/lib/notifications/notifications");
      const { getSettings } = await import("@/models/settings.model");
      await notifyReturnRequestCustomer(settled, String(settled.status), await getSettings());
    } catch (error) {
      console.error("Failed to tell a shopper their return refund went:", error);
    }
  }
  return released;
}
