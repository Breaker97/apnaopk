import { notifyReturnRequestCustomer, notifyReturnOpenedOnBehalf } from "@/lib/notifications/notifications";
import { postRestockedCost } from "@/lib/finance/post-events";
import { runStockMovementAftermath } from "@/lib/inventory/inventory";
import type { ReturnRecord } from "./context";
import { heldRestockEventKey } from "@/lib/returns/held-units";
import { returnSettings } from "./context";

/** The existing notification dispatcher and ledger use permanent dedupe keys. */
export async function returnCreationAftermath(rows: ReturnRecord[], openedBy: "staff" | "vendor") {
  const settings = await returnSettings();
  await Promise.allSettled(rows.flatMap((row) => [notifyReturnRequestCustomer(row, row.status, settings, { openedForShopper: true }), notifyReturnOpenedOnBehalf(row, settings, openedBy)]));
}
export async function returnActionAftermath(row: ReturnRecord, operationId: string) {
  const lines = (row.restockedLines || []).filter((line) => line.step === operationId);
  if (lines.length) { await postRestockedCost({ orderId: row.orderId, restocked: lines, eventKey: `return-${row._id}-step-${operationId}` }); await runStockMovementAftermath(lines.map((line) => ({ ...line, productId: String(line.productId), variantId: line.variantId ? String(line.variantId) : undefined })), 1); }
  for (const disposition of row.unsellableDispositions || []) {
    if (disposition.bizOperationId !== operationId || disposition.action !== "restocked") continue;
    const units = [{ productId: String(disposition.productId), variantId: disposition.variantId ? String(disposition.variantId) : undefined, quantity: disposition.quantity }];
    await postRestockedCost({ orderId: row.orderId, restocked: units, eventKey: heldRestockEventKey(row._id, disposition._id) }); await runStockMovementAftermath(units, 1);
  }
  const action = row.bizOperationReceipts?.find((receipt) => receipt.operationId === operationId)?.kind;
  if (action && !["restock", "record_disposition"].includes(action)) await returnRefundNotice(row);
}
export async function returnRefundNotice(row: ReturnRecord) {
  await notifyReturnRequestCustomer(row, row.status, await returnSettings()).catch(() => undefined);
}
