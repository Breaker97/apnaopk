import type { ClientSession } from "mongoose";
import type { ReturnActionRequest, ReturnActionResult, ReturnCase } from "@/contracts/mobile/biz/v1/returns";
import { Order, Product, ReturnRequest } from "@/models";
import { bizOperationBinding, runDurableBizOperation, type BizOperationExecution } from "@/lib/api-core/biz/durable-operation";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { applyBizStockEffect } from "@/lib/api-core/biz/stock-effect";
import { productScopeFilter } from "@/lib/api-core/biz/scope";
import { priceReturnAsItStands, loadPriorReturnUnits } from "@/lib/returns/return-plan";
import { mergeReturnOverrides } from "@/lib/returns/return-price-overrides";
import { returnStatusChangeProblem, returnHasRestocked, returnStatusAfterCount, returnStatusForTracking, returnRestockPlan, returnMayRestock, returnGoodsBack, RETURN_DECLINE_MESSAGES, isReturnDeclineReason } from "@/lib/returns/returns";
import { returnShippingUpdates } from "@/lib/returns/return-destination";
import { resolveBizUpload } from "@/lib/api-next/biz-upload";
import { returnActionAftermath } from "./aftermath";
import { returnActions, toReturnCase } from "./dto";
import { disposeBizReturn } from "./disposition";
import { recordReturnOrderEvent } from "./audit";
import { assertReturnHandling, scopedReturn, assertVersion, returnSettings, authorizedReturnLocations, refuse, runReturnTransaction, type ReturnContext, type ReturnRecord } from "./context";

export async function restockBizReturn(input: { returned: ReturnRecord; context: ReturnContext; operation: BizOperationExecution; session: ClientSession; actorId: string; locationId?: string; selections?: Array<{ index: number; quantity: number }> }) {
  if (!returnMayRestock(input.returned.status) || !returnGoodsBack(input.returned)) refuse("RETURN_ACTION_NOT_ALLOWED", "Only goods that have arrived can be restocked.");
  const locations = await authorizedReturnLocations(input.returned, input.context);
  if (input.locationId && !locations.some((location) => location._id === input.locationId)) refuse("RETURN_LOCATION_NOT_ALLOWED", "Choose an authorized return location.");
  let plan = returnRestockPlan(input.returned.items, { itemsCounted: Boolean(input.returned.itemsCountedAt), inventoryRestored: input.returned.inventoryRestored });
  if (input.selections) {
    if (!input.selections.length || new Set(input.selections.map((line) => line.index)).size !== input.selections.length) refuse("RETURN_ITEM_LISTED_TWICE", "Choose each restock line once.");
    plan = input.selections.map((selection) => { const line = plan.find((candidate) => candidate.orderItemIndex === selection.index); if (!line || !Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > line.quantity) refuse("RETURN_QUANTITY_CHANGED", "Only the remaining received sellable units can be restocked."); return { ...line, quantity: selection.quantity }; });
  }
  const increments: Record<string, number> = {}; const filters: Record<string, unknown>[] = []; const restockedLines: Record<string, unknown>[] = [];
  for (const [index, line] of plan.entries()) {
    const product = await Product.findOne({ _id: line.productId, ...productScopeFilter(input.context.scope) }, undefined, { session: input.session }).select("shipping inventory locationInventory variants").lean<{ shipping?: { isPhysicalProduct?: boolean }; inventory?: { tracked?: boolean }; locationInventory?: Array<{ locationId: string; quantity: number }>; variants?: Array<{ _id: unknown; locationInventory?: Array<{ locationId: string; quantity: number }> }> } | null>();
    if (!product) refuse("RETURN_LOCATION_NOT_ALLOWED", "A returned product is no longer accessible.");
    const variant = line.variantId ? product.variants?.find((row) => String(row._id) === line.variantId) : undefined;
    const counters = variant?.locationInventory ?? product.locationInventory ?? [];
    const locationId = input.locationId ?? (counters.length ? locations.find((location) => counters.some((counter) => String(counter.locationId) === location._id))?._id : undefined);
    if (counters.length && !locationId) refuse("RETURN_LOCATION_NOT_ALLOWED", "Choose an authorized location for these goods.");
    if (product.shipping?.isPhysicalProduct !== false && product.inventory?.tracked !== false) {
      const moved = await applyBizStockEffect({ effectKey: input.operation.effectKey, leg: `return-${input.returned._id}-line-${line.orderItemIndex}`, productId: line.productId, variantId: line.variantId, locationId, quantity: line.quantity, scopeFilter: productScopeFilter(input.context.scope), session: input.session });
      if (!moved.success) refuse("RETURN_STATE_CHANGED", moved.error || "Stock changed concurrently.");
    }
    increments[`items.$[r${index}].quantityRestocked`] = line.quantity; filters.push({ [`r${index}.orderItemIndex`]: line.orderItemIndex });
    restockedLines.push({ ...line, locationId, step: input.operation.id, at: new Date(), by: input.actorId });
  }
  if (plan.length) await ReturnRequest.updateOne({ _id: input.returned._id }, { $inc: increments, $push: { restockedLines: { $each: restockedLines } } }, { session: input.session, arrayFilters: filters });
  return plan;
}

export async function actOnBizReturn(input: ReturnActionRequest, id: string, context: ReturnContext & { actorId: string; key?: string }): Promise<ReturnActionResult> {
  assertReturnHandling(context);
  // Settlement uses the same permanent receipts, with separate payer authority.
  if (input.action === "record_settlement") return (await import("./refund")).settleBizReturn(input, id, context);
  const binding = bizOperationBinding({ actorId: context.actorId, workspace: context.workspace, key: context.key, routeId: "returns.action", target: id, payload: input });
  const result = await runDurableBizOperation<ReturnCase>({ binding, store: mongoBizOperationStore,
    authorize: async () => { await scopedReturn(id, context); },
    async reconcile(operation) {
      const { returned, order } = await scopedReturn(id, context);
      if (returned.bizOperationReceipts?.some((receipt) => receipt.operationId === operation.id)) await returnActionAftermath(returned, operation.id);
      return returned.bizOperationReceipts?.some((receipt) => receipt.operationId === operation.id)
        ? { state: "succeeded", data: await toReturnCase(returned, order, context), resources: [{ kind: "return" as const, id }] } : { state: "not_applied" };
    },
    async execute(operation) {
      await operation.remember({ action: input.action });
      const settings = await returnSettings();
      await runReturnTransaction("biz return action and inventory", async (session) => {
        const { returned: before, order } = await scopedReturn(id, context, session); assertVersion(before, input.version);
        if (!returnActions(before, context).includes(input.action)) refuse("RETURN_ACTION_NOT_ALLOWED", "This action is no longer offered for the return.");
        const now = new Date(); const updates: Record<string, unknown> = { updatedBy: context.actorId };
        const status = ({ approve: "approved", reject: "rejected", cancel: "cancelled", close: "closed" } as Record<string, string>)[input.action];
        if (status) {
          const problem = returnStatusChangeProblem({ from: before.status, to: status, refundedAmount: before.actualRefund?.amount, restocked: returnHasRestocked(before) });
          if (problem) refuse("RETURN_ACTION_NOT_ALLOWED", problem);
          updates.status = status;
          if (status === "rejected" || status === "cancelled" || status === "closed") updates.refundStatus = Number(before.actualRefund?.amount || 0) > 0 ? before.refundStatus : "not_required";
          updates[status === "approved" ? "approvedAt" : status === "rejected" ? "rejectedAt" : "closedAt"] = now;
        }
        if (input.note !== undefined) updates[context.workspace.workspace === "vendor" ? "vendorNote" : "adminNote"] = input.note;
        if (input.action === "reject") {
          const decline = isReturnDeclineReason(input.declineReason) ? input.declineReason! : "other";
          const message = input.reason?.trim() || RETURN_DECLINE_MESSAGES[decline as keyof typeof RETURN_DECLINE_MESSAGES];
          if (!message) refuse("RETURN_ACTION_NOT_ALLOWED", "Explain why the return is rejected.");
          updates.declineReason = decline; updates.rejectionReason = message;
        }
        const assertUnique = (items: Array<{ index: number }>) => { if (new Set(items.map((item) => item.index)).size !== items.length || items.some((item) => !before.items.some((line) => line.orderItemIndex === item.index))) refuse("RETURN_ITEM_LISTED_TWICE", "Choose each return line once."); };
        let items = before.items;
        if (input.action === "approve" && input.approvedItems) {
          assertUnique(input.approvedItems);
          items = items.map((line) => { const asked = input.approvedItems!.find((item) => item.index === line.orderItemIndex); if (!asked) return line;
            if (asked.quantity > line.quantityRequested || asked.quantity < Number(line.quantityRestocked || 0)) refuse("RETURN_QUANTITY_CHANGED", "The approved quantity is not available.");
            return { ...line, quantityApproved: asked.quantity, quantityReceived: Math.min(line.quantityReceived, asked.quantity) }; });
          updates.items = items;
        }
        if (input.action === "record_receipt") {
          if (!input.receivedItems?.length) refuse("RETURN_QUANTITY_CHANGED", "Record the quantities and condition that arrived.");
          assertUnique(input.receivedItems);
          items = items.map((line) => { const asked = input.receivedItems!.find((item) => item.index === line.orderItemIndex); if (!asked) return line;
            const dispositions = (before.unsellableDispositions || []).filter((disposition) => before.items[disposition.itemIndex]?.orderItemIndex === asked.index);
            const disposed = dispositions.reduce((sum, disposition) => sum + disposition.quantity, 0);
            if (asked.quantity > line.quantityApproved || asked.quantity < Number(line.quantityRestocked || 0) + disposed || (disposed > 0 && asked.condition !== line.condition)) refuse("RETURN_QUANTITY_CHANGED", "A receipt cannot remove or change goods already restocked or disposed of.");
            return { ...line, quantityReceived: asked.quantity, condition: asked.condition, restockable: ["new", "opened"].includes(asked.condition) }; });
          updates.items = items; updates.receivedAt = now; updates.itemsCountedAt = now; updates.inspectedAt = now; updates.status = returnStatusAfterCount(before.status);
        }
        if (updates.items) {
          const prior = await loadPriorReturnUnits({ orderId: before.orderId, before: before.createdAt, excludeReturnId: before._id });
          const estimate = priceReturnAsItStands({ returnRequest: { ...before, items, ...(input.action === "record_receipt" ? { itemsCountedAt: now } : {}) }, order, settings, priorUnitsByIndex: prior, overrides: mergeReturnOverrides(before, {}) });
          updates.estimatedRefund = { ...estimate, total: Math.max(estimate.total, Number(before.actualRefund?.amount || 0)) };
        }
        if (input.action === "record_tracking") { if (!input.trackingNumber?.trim()) refuse("RETURN_ACTION_NOT_ALLOWED", "Enter a tracking number."); updates["shipment.trackingNumber"] = input.trackingNumber; updates["shipment.carrier"] = input.carrier; updates["shipment.trackingAddedBy"] = "staff"; updates["shipment.trackingAddedAt"] = now; updates.status = returnStatusForTracking(before.status) || before.status; }
        if (input.action === "approve") {
          const label = input.labelUploadId ? await resolveBizUpload({ id: input.labelUploadId, actorId: context.actorId, grant: context.workspace, request: { purpose: "return_label", target: { kind: "return", id } } }) : null;
          const shippingBefore = label ? { ...before, shipment: { ...before.shipment, labelFileKey: label.storageKey } } : before;
          Object.assign(updates, await returnShippingUpdates({ before: shippingBefore, body: { status: "approved", returnMethod: input.returnMethod || before.returnMethod || "customer_ships", returnToLocationId: input.locationId, labelUrl: input.labelUrl }, settings }));
          if (label) { delete updates["shipment.labelUrl"]; updates["shipment.labelFileKey"] = label.storageKey; updates["shipment.labelFileName"] = label.value?.filename; updates["shipment.labelAddedAt"] = now; }
          if (input.locationId && !(await authorizedReturnLocations(before, context)).some((location) => location._id === input.locationId)) refuse("RETURN_LOCATION_NOT_ALLOWED", "Choose an authorized return location.");
        }
        if (input.action === "restock") await restockBizReturn({ returned: before, context, operation, session, actorId: context.actorId, locationId: input.locationId, selections: input.restockItems });
        if (input.action === "record_disposition") await disposeBizReturn({ returned: before, selections: input.dispositions || [], context, operation, session, actorId: context.actorId, locationId: input.locationId });
        await ReturnRequest.updateOne({ _id: before._id }, { $set: updates, $inc: { __v: 1 }, $push: { bizOperationReceipts: { operationId: operation.id, kind: input.action, at: now }, bizTimeline: { operationId: operation.id, at: now, kind: input.action, message: input.note || input.action.replaceAll("_", " "), by: context.actorId } } }, { session });
        await Order.updateOne({ _id: order._id }, { $inc: { __v: 1 } }, { session });
        await recordReturnOrderEvent({ operationId: operation.id, leg: `return:${id}:${input.action}`, actorId: context.actorId, context, orderId: order._id, orderNumber: order.orderNumber, action: "STATUS_CHANGE", summary: `Return ${before.returnNumber}: ${input.action.replaceAll("_", " ")}`, metadata: { returnNumber: before.returnNumber, action: input.action }, session });
      });
      const { returned, order } = await scopedReturn(id, context);
      await returnActionAftermath(returned, operation.id);
      return { data: await toReturnCase(returned, order, context), resources: [{ kind: "return" as const, id }] };
    },
  });
  return { operation: result.operation, return: result.data };
}
