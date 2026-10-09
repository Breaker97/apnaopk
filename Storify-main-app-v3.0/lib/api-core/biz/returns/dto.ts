import type { ReturnCase, ReturnListItem, ReturnRefundBreakdown } from "@/contracts/mobile/biz/v1/returns";
import { heldReturnUnits } from "@/lib/returns/held-units";
import type { BizUpload } from "@/contracts/mobile/biz/v1/uploads";
import { toMoney } from "@/lib/api-core/shop/money";
import { imageSet } from "@/lib/api-core/shop/images";
import { grantCan } from "@/lib/api-core/biz/access";
import { BizUploadRecord } from "@/models/biz-upload.model";
import { withMaskedRefundAccount, withoutRefundDestinationUnlessPayer } from "@/lib/returns/refund-settlement";
import { RETURN_STATUS, REFUND_IN_MOTION_STATUSES, returnMayRestock, returnGoodsBack, returnHasRestocked, returnRestockPlan } from "@/lib/returns/returns";
import { recordVersion, canSettleVendorReturn, type ReturnRecord, type ReturnOrder, type ReturnContext } from "./context";

export function refundBreakdown(value: { itemsSubtotal?: number; discountAdjustment?: number; tax?: number; shipping?: number; restockingFee?: number; returnShippingFee?: number; total?: number }, currency: string): ReturnRefundBreakdown {
  return { subtotal: toMoney(value.itemsSubtotal, currency), discount: toMoney(value.discountAdjustment, currency), tax: toMoney(value.tax, currency), shipping: toMoney(value.shipping, currency), restockingFee: toMoney(value.restockingFee, currency), returnShippingFee: toMoney(value.returnShippingFee, currency), total: toMoney(value.total, currency) };
}
export function returnActions(row: ReturnRecord, context: ReturnContext): ReturnCase["actions"] {
  if (!grantCan(context.workspace, "HANDLE_RETURNS")) return [];
  const actions: ReturnCase["actions"] = [];
  const terminal = ["rejected", "cancelled", "closed"].includes(row.status);
  const pending = REFUND_IN_MOTION_STATUSES.includes(row.refundStatus);
  if (!terminal && !pending && !(Number(row.actualRefund?.amount) > 0) && !returnHasRestocked(row)) {
    if (row.status === RETURN_STATUS.REQUESTED) actions.push("approve", "reject");
    actions.push("cancel");
  }
  if (!["rejected", "cancelled"].includes(row.status) && row.status !== RETURN_STATUS.REQUESTED && row.returnMethod !== "no_shipping") actions.push("record_receipt");
  if (returnMayRestock(row.status) && returnGoodsBack(row) && returnRestockPlan(row.items, { itemsCounted: Boolean(row.itemsCountedAt), inventoryRestored: row.inventoryRestored }).length > 0) actions.push("restock");
  if (heldReturnUnits(row).some((line) => line.held > 0)) actions.push("record_disposition");
  if (["approved", "awaiting_shipment", "in_transit"].includes(row.status) && row.returnMethod !== "no_shipping") actions.push("record_tracking");
  if (!terminal && !pending) actions.push("close");
  if (row.refundStatus === "manual_required" && (grantCan(context.workspace, "ISSUE_REFUNDS") || canSettleVendorReturn(row, context))) actions.push("record_settlement");
  else if (!terminal && !pending && canSettleVendorReturn(row, context) && Number(row.estimatedRefund?.total) > Number(row.actualRefund?.amount || 0)) actions.push("record_settlement");
  return actions;
}
export function returnListItem(row: ReturnRecord, context: ReturnContext, customerName?: string): ReturnListItem {
  return { id: String(row._id), number: row.returnNumber, orderId: String(row.orderId), orderNumber: row.orderNumber,
    status: row.status, refundStatus: row.refundStatus, ...(customerName ? { customerName } : {}), itemCount: (row.items || []).reduce((sum, item) => sum + Number(item.quantityRequested || 0), 0),
    estimatedRefund: toMoney(row.estimatedRefund?.total, row.estimatedRefund?.currency || "USD"), createdAt: (row.createdAt || row.requestedAt).toISOString(), actions: returnActions(row, context) };
}
export async function toReturnCase(row: ReturnRecord, order: ReturnOrder, context: ReturnContext): Promise<ReturnCase> {
  const currency = order.currency || row.estimatedRefund?.currency || "USD";
  const held = heldReturnUnits(row);
  const payerView = context.workspace.workspace === "vendor" ? withoutRefundDestinationUnlessPayer(row) : row;
  const shown = context.workspace.kind === "admin" || context.workspace.kind === "vendor" ? payerView : withMaskedRefundAccount(payerView);
  const workspaceId = context.workspace.workspace === "vendor" ? context.workspace.vendor.id : "platform";
  const evidenceRows = (row.evidenceIds || []).length ? await BizUploadRecord.find({ _id: { $in: row.evidenceIds }, purpose: "return_evidence", state: "ready",
    ...(context.workspace.workspace === "vendor" ? { workspaceId } : {}), "target.kind": { $in: ["order", "return"] }, "target.id": { $in: [String(row.orderId), String(row._id)] } }).select("value").lean<Array<{ value?: BizUpload }>>() : [];
  const evidence = evidenceRows.flatMap((record) => record.value ? [{ ...record.value, url: undefined, image: undefined, expiresAt: undefined }] : []);
  const timestampEvents: ReturnCase["timeline"] = (["requestedAt", "approvedAt", "rejectedAt", "receivedAt", "inspectedAt", "refundedAt", "closedAt"] as const).flatMap((key) => row[key] ? [{ at: row[key]!.toISOString(), kind: key, message: key.replace(/At$/, ""), by: row.updatedBy || row.createdBy }] : []);
  return { ...returnListItem(row, context, order.shippingAddress?.fullName), version: recordVersion(row), reason: row.reason,
    customerNote: row.customerNote, ...(context.workspace.workspace === "platform" ? { adminNote: row.adminNote } : {}), vendorNote: row.vendorNote, rejectionReason: row.rejectionReason, returnMethod: row.returnMethod,
    refundPayer: row.refundPayer === "vendor" ? "vendor" : "platform", items: row.items.map((item) => ({ orderItemIndex: item.orderItemIndex, productId: String(item.productId), variantId: item.variantId ? String(item.variantId) : undefined,
      name: item.name, ...(item.image ? { image: imageSet(item.image) } : {}), quantityRequested: item.quantityRequested, quantityApproved: item.quantityApproved, quantityReceived: item.quantityReceived, quantityRestocked: Number(item.quantityRestocked || 0) + (held.find((line) => row.items[line.itemIndex]?.orderItemIndex === item.orderItemIndex)?.restocked || 0), quantityHeld: held.find((line) => row.items[line.itemIndex]?.orderItemIndex === item.orderItemIndex)?.held || 0, quantityWrittenOff: held.find((line) => row.items[line.itemIndex]?.orderItemIndex === item.orderItemIndex)?.writtenOff || 0, condition: item.condition })),
    evidence, estimate: refundBreakdown(row.estimatedRefund, currency), refunded: toMoney(row.actualRefund?.amount, currency), destination: shown.refundDestination,
    returnTo: row.returnTo ? { name: row.returnTo.name || "", address: row.returnTo.address || "", locationId: row.returnTo.locationId ? String(row.returnTo.locationId) : undefined } : undefined,
    shipment: row.shipment ? { carrier: row.shipment.carrier, trackingNumber: row.shipment.trackingNumber, labelAvailable: Boolean(row.shipment.labelUrl || row.shipment.labelFileKey) } : undefined,
    timeline: [...timestampEvents, ...(row.bizTimeline || []).map((event) => ({ at: event.at.toISOString(), kind: event.kind, message: event.message, by: event.by }))].sort((a, b) => a.at.localeCompare(b.at)),
    settlement: row.actualRefund?.settledAt ? { method: row.actualRefund.settledMethod, reference: row.actualRefund.settledReference, settledAt: row.actualRefund.settledAt.toISOString(), transactionId: row.actualRefund.paymentTransactionId ? String(row.actualRefund.paymentTransactionId) : undefined } : undefined,
    canPreviewRefund: grantCan(context.workspace, "ISSUE_REFUNDS") && !["rejected", "cancelled", "closed"].includes(row.status) && !REFUND_IN_MOTION_STATUSES.includes(row.refundStatus), canOverrideEligibility: grantCan(context.workspace, "OVERRIDE_RETURN_ELIGIBILITY") };
}
