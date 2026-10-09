import type { ReturnCreateRequest, ReturnCreateResult, ReturnCase } from "@/contracts/mobile/biz/v1/returns";
import { Order, ReturnRequest, PaymentTransaction } from "@/models";
import { planReturnRequest, assertReturnEligible } from "@/lib/returns/return-plan";
import { getNextReturnNumber } from "@/lib/returns/return-number";
import { resolveReturnDestination } from "@/lib/returns/return-destination";
import { customReturnInstructions, isReturnLabelUrl } from "@/lib/returns/return-shipping";
import { validateRefundDestination } from "@/lib/returns/refund-settlement";
import { resolveBizUpload } from "@/lib/api-next/biz-upload";
import { bizOperationBinding, runDurableBizOperation } from "@/lib/api-core/biz/durable-operation";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { scopedReturnOrder, scopedReturn, returnSettings, onlyVendorId, assertReturnHandling, assertReturnOverride, assertVersion, authorizedReturnLocations, refuse, runReturnTransaction, type ReturnContext, type ReturnRecord } from "./context";
import { toReturnCase } from "./dto";
import { returnCreationAftermath } from "./aftermath";
import { recordReturnOrderEvent } from "./audit";

export async function createBizReturns(input: ReturnCreateRequest, context: ReturnContext & { actorId: string; key?: string }): Promise<ReturnCreateResult> {
  assertReturnHandling(context); assertReturnOverride(context, input.eligibilityOverride);
  const binding = bizOperationBinding({ actorId: context.actorId, workspace: context.workspace, key: context.key, routeId: "returns.create", target: input.orderId, payload: input });
  const loadResults = async (rows: ReturnRecord[]) => Promise.all(rows.map(async (row) => toReturnCase(row, await scopedReturnOrder(String(row.orderId), context), context)));
  const result = await runDurableBizOperation<ReturnCase[]>({ binding, store: mongoBizOperationStore,
    authorize: async (resources) => { await scopedReturnOrder(input.orderId, context); for (const resource of resources) await scopedReturn(resource.id, context); },
    async reconcile(operation) {
      const rows = await ReturnRequest.find({ bizCreateOperationId: operation.id }).lean<ReturnRecord[]>();
      if (!rows.length) return { state: "not_applied" };
      await returnCreationAftermath(rows, context.workspace.workspace === "vendor" ? "vendor" : "staff");
      return { state: "succeeded", data: await loadResults(rows), resources: rows.map((row) => ({ kind: "return" as const, id: String(row._id) })) };
    },
    async execute(operation) {
      await operation.remember({ eligibilityOverride: Boolean(input.eligibilityOverride) });
      const settings = await returnSettings();
      const evidenceIds = [...new Set(input.evidenceIds || [])];
      for (const id of evidenceIds) await resolveBizUpload({ id, actorId: context.actorId, grant: context.workspace, request: { purpose: "return_evidence", target: { kind: "order", id: input.orderId } } });
      const label = input.labelUploadId ? await resolveBizUpload({ id: input.labelUploadId, actorId: context.actorId, grant: context.workspace, request: { purpose: "return_label", target: { kind: "order", id: input.orderId } } }) : null;
      if (input.returnMethod === "label" && !label && !isReturnLabelUrl(input.labelUrl)) refuse("RETURN_ACTION_NOT_ALLOWED", "Provide a return label or its valid URL.");
      if (input.reason === "other" && !input.note?.trim()) refuse("RETURN_NOT_ELIGIBLE", "Explain the reason for this return.");
      if (input.refundDestination) { const problems = validateRefundDestination(input.refundDestination); if (problems.length) refuse("RETURN_NOT_ELIGIBLE", problems.join(". ")); }
      const rows = await runReturnTransaction("biz grouped return creation", async (session) => {
        const order = await scopedReturnOrder(input.orderId, context, session); assertVersion(order, input.version, "RETURN_QUANTITY_CHANGED");
        // Serialize native creators and refuse while the desktop creator owns
        // its short lease. Its next quantity read sees these committed cases.
        const touched = await Order.updateOne({ _id: order._id, $or: [{ returnRequestLockAt: { $exists: false } }, { returnRequestLockAt: null }, { returnRequestLockAt: { $lte: new Date(Date.now() - 15_000) } }] }, { $inc: { __v: 1 } }, { session });
        if (!touched.modifiedCount) refuse("RETURN_QUANTITY_CHANGED", "Another return is being opened. Refresh the order.");
        if (await PaymentTransaction.exists({ orderId: order._id, type: "refund", status: "pending", "metadata.bizHeadroomReserved": true }).session(session)) refuse("REFUND_PENDING", "Reconcile the pending refund before opening another return.");
        assertReturnEligible(order, settings, { override: Boolean(input.eligibilityOverride) });
        const plan = await planReturnRequest({ order, settings, reason: input.reason, items: input.items.map((item) => ({ orderItemIndex: item.index, quantity: item.quantity })), override: Boolean(input.eligibilityOverride) });
        const vendorId = onlyVendorId(context);
        if (vendorId && plan.groups.some((group) => group.ownerType !== "vendor" || group.ownerVendorId !== vendorId)) refuse("RETURN_ACTION_NOT_ALLOWED", "Only your own items can be returned.", 403);
        const now = new Date(); const docs: Record<string, unknown>[] = [];
        for (const group of plan.groups) {
          const owner = { orderId: order._id, ownerType: group.ownerType, ownerVendorId: group.ownerVendorId, vendorIds: group.vendorIds };
          const locations = await authorizedReturnLocations(owner, context);
          if (input.returnMethod !== "no_shipping" && context.scope.kind === "staff" && context.scope.staff.locationIds.length && !locations.length) refuse("RETURN_LOCATION_NOT_ALLOWED", "No return location is in your assignment.");
          const destination = input.returnMethod === "no_shipping" ? null : await resolveReturnDestination(owner, settings, context.scope.kind === "staff" && context.scope.staff.locationIds.length ? locations[0]?._id : undefined);
          docs.push({ returnNumber: await getNextReturnNumber(), ...owner, orderNumber: order.orderNumber, customerId: order.customerId,
            guestEmail: order.guestEmail, status: "approved", refundStatus: "pending", reason: input.reason, customerNote: input.note,
            items: group.items, estimatedRefund: group.estimatedRefund, policyApplied: group.policyApplied, refundPayer: group.refundPayer,
            refundDestination: input.refundDestination, returnMethod: input.returnMethod, returnTo: destination,
            returnInstructions: customReturnInstructions(settings), requestedAt: now, approvedAt: now,
            openedBy: context.workspace.workspace === "vendor" ? "vendor" : "staff", createdBy: context.actorId,
            eligibilityOverride: input.eligibilityOverride ? { note: input.eligibilityOverride.note, by: context.actorId, at: now } : undefined,
            shipment: label ? { labelFileKey: label.storageKey, labelFileName: label.value?.filename, labelAddedAt: now } : input.labelUrl ? { labelUrl: input.labelUrl, labelAddedAt: now } : undefined,
            evidenceIds, bizCreateOperationId: operation.id, bizCreateGroup: group.ownerType === "vendor" ? `vendor:${group.ownerVendorId}` : "admin",
            bizOperationReceipts: [{ operationId: operation.id, kind: "create", at: now }], bizTimeline: [{ operationId: operation.id, at: now, kind: "create", message: "Return opened and approved", by: context.actorId }] });
        }
        const created = await ReturnRequest.create(docs, { session, ordered: true });
        for (const row of created) await recordReturnOrderEvent({ operationId: operation.id, leg: `create:${row._id}`, actorId: context.actorId, context, orderId: order._id, orderNumber: order.orderNumber, action: "STATUS_CHANGE", summary: `Return ${row.returnNumber} opened and approved`, metadata: { returnNumber: row.returnNumber, status: "approved" }, session });
        return created.map((row) => row.toObject() as ReturnRecord);
      });
      await returnCreationAftermath(rows, context.workspace.workspace === "vendor" ? "vendor" : "staff");
      return { data: await loadResults(rows), resources: rows.map((row) => ({ kind: "return" as const, id: String(row._id) })) };
    },
  });
  return { operation: result.operation, returns: result.data };
}
