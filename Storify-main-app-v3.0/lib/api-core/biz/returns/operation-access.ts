import { Types } from "mongoose";
import { PaymentTransaction } from "@/models";
import { assertCapability } from "@/lib/api-core/biz/access";
import type { StoredBizOperation } from "@/lib/api-core/biz/durable-operation";
import { MobileApiError } from "@/lib/api-core/errors";
import { assertReturnHandling, assertReturnOverride, canSettleVendorReturn, scopedReturn, scopedReturnOrder, type ReturnContext } from "./context";

const hidden = () => new MobileApiError(404, "NOT_FOUND", "Operation not found.");
/** Polling retains the original write authority and validates every immutable reference. */
export async function authorizeReturnOperation(operation: StoredBizOperation, context: ReturnContext & { actorId: string }): Promise<void> {
  const workspaceId = context.workspace.workspace === "vendor" ? context.workspace.vendor.id : "platform";
  if (operation.actorId !== context.actorId || operation.workspace !== context.workspace.workspace || operation.workspaceId !== workspaceId) throw hidden();
  let orderId: string; let returnId: string | undefined;
  if (operation.routeId === "returns.create") {
    assertReturnHandling(context);
    if (operation.checkpoint?.eligibilityOverride) assertReturnOverride(context, true);
    orderId = String((await scopedReturnOrder(operation.target, context))._id);
  } else if (operation.routeId === "returns.action") {
    assertReturnHandling(context);
    const { returned, order } = await scopedReturn(operation.target, context);
    const action = operation.checkpoint?.action ?? returned.bizOperationReceipts?.find((receipt) => receipt.operationId === operation.id)?.kind;
    if (!action) throw hidden();
    if (action === "record_settlement") {
      if (context.workspace.kind === "admin") assertCapability(context.workspace, "ISSUE_REFUNDS");
      else if (!canSettleVendorReturn(returned, context)) throw new MobileApiError(403, "AUTHORIZATION_ERROR", "Only the current refund payer may inspect settlement.", { reason: "SETTLEMENT_NOT_ALLOWED" });
    }
    orderId = String(order._id); returnId = String(returned._id);
  } else if (operation.routeId === "refunds.execute") {
    assertCapability(context.workspace, "ISSUE_REFUNDS");
    const match = /^(order|return):([0-9a-f]{24})$/i.exec(operation.target);
    if (!match) throw hidden();
    if (match[1] === "return") { const records = await scopedReturn(match[2], context); orderId = String(records.order._id); returnId = String(records.returned._id); }
    else orderId = String((await scopedReturnOrder(match[2], context))._id);
  } else throw hidden();
  for (const resource of operation.resources) {
    if (resource.kind === "order") { if (String((await scopedReturnOrder(resource.id, context))._id) !== orderId) throw hidden(); }
    else if (resource.kind === "return") {
      const { returned, order } = await scopedReturn(resource.id, context);
      if (String(order._id) !== orderId || (returnId && String(returned._id) !== returnId) || (operation.routeId === "returns.create" && returned.bizCreateOperationId !== operation.id)) throw hidden();
    } else if (resource.kind === "refund" && Types.ObjectId.isValid(resource.id)) {
      const receipt = await PaymentTransaction.findOne({ _id: resource.id, type: "refund", orderId, $or: [{ bizOperationId: operation.id }, { "metadata.bizSettlementOperationId": operation.id }] }).select("metadata.bizTarget").lean<{ metadata?: { bizTarget?: { kind: string; id: string } } } | null>();
      if (!receipt || (returnId && (receipt.metadata?.bizTarget?.kind !== "return" || receipt.metadata.bizTarget.id !== returnId))) throw hidden();
    } else throw hidden();
  }
}
