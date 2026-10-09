import type { ReturnList, ReturnListQuery, ReturnOptions, ReturnPreview, ReturnPreviewRequest } from "@/contracts/mobile/biz/v1/returns";
import { Types } from "mongoose";
import { ReturnRequest } from "@/models";
import { connectDB } from "@/lib/db";
import { returnDialogContext } from "@/lib/returns/create-return";
import { lineReturnWindowEndsAt } from "@/lib/returns/return-window";
import { resolveOrderReturnPolicy } from "@/lib/returns/return-policy";
import { planReturnRequest, assertReturnEligible } from "@/lib/returns/return-plan";
import { returnQueueStateFilter } from "./queue-filter";
import { escapeRegExp } from "@/lib/strings";
import { afterTimeCursor, encodeTimeCursor } from "@/lib/api-core/shop/time-cursor";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import { grantCan } from "@/lib/api-core/biz/access";
import { orderScopeFilter } from "@/lib/api-core/biz/scope";
import { bizUploadPolicy } from "@/lib/api-core/biz/uploads/policy";
import { returnActions, returnListItem, refundBreakdown } from "./dto";
import { scopedReturnOrder, returnSettings, recordVersion, onlyVendorId, authorizedReturnLocations, assertReturnOverride, returnOwnerFilter, refuse, type ReturnContext, type ReturnRecord } from "./context";

export async function readReturnQueue(input: ReturnListQuery, context: ReturnContext): Promise<ReturnList> {
  await connectDB();
  const limit = input.limit ?? 25;
  const conditions: Record<string, unknown>[] = [returnOwnerFilter(context.scope)];
  if (input.orderId) conditions.push({ orderId: Types.ObjectId.isValid(input.orderId) ? new Types.ObjectId(input.orderId) : null });
  if (input.cursor) conditions.push(afterTimeCursor(input.cursor));
  const stateFilter = returnQueueStateFilter(input.tab);
  if (stateFilter) conditions.push(stateFilter);
  const search = input.search ? escapeRegExp(input.search) : null;
  const rows = await ReturnRequest.aggregate<ReturnRecord & { authorizedOrder: Array<{ shippingAddress?: { fullName?: string } }> }>([
    { $match: { $and: conditions } },
    { $lookup: { from: "orders", localField: "orderId", foreignField: "_id", pipeline: [{ $match: orderScopeFilter(context.scope) }, { $project: { shippingAddress: 1 } }], as: "authorizedOrder" } },
    { $match: { "authorizedOrder.0": { $exists: true } } },
    ...(search ? [{ $match: { $or: [{ returnNumber: { $regex: search, $options: "i" } }, { orderNumber: { $regex: search, $options: "i" } }, { "authorizedOrder.shippingAddress.fullName": { $regex: search, $options: "i" } }] } }] : []),
    { $sort: { createdAt: -1, _id: -1 } }, { $limit: limit + 1 },
  ]);
  const selected = rows.slice(0, limit);
  return { items: selected.filter((row) => input.tab !== "actionable" || returnActions(row, context).length > 0).map((row) => returnListItem(row, context, row.authorizedOrder[0]?.shippingAddress?.fullName)), nextCursor: rows.length > limit ? encodeTimeCursor(selected[selected.length - 1]) : null };
}

export async function readReturnOptions(orderId: string, context: ReturnContext): Promise<ReturnOptions> {
  const order = await scopedReturnOrder(orderId, context); const settings = await returnSettings();
  const dialog = await returnDialogContext(order, settings, { onlyVendorId: onlyVendorId(context) });
  const owner = { ownerType: context.workspace.workspace === "vendor" ? "vendor" : "admin", ownerVendorId: onlyVendorId(context), vendorIds: [], orderId: order._id };
  const locations = await authorizedReturnLocations(owner as Parameters<typeof authorizedReturnLocations>[0], context);
  const reasons = ["wrong_size_or_variant", "damaged_or_defective", "not_as_described", "wrong_item_received", "arrived_late", "changed_mind", "other"];
  return { orderId, orderNumber: order.orderNumber, version: recordVersion(order), canOverride: grantCan(context.workspace, "OVERRIDE_RETURN_ELIGIBILITY"),
    reasons: reasons.map((code) => ({ code, label: code.replaceAll("_", " "), noteRequired: code === "other", evidenceRequired: false })), resolutions: ["refund"],
    methods: [{ id: "customer_ships", label: "Customer ships" }, { id: "label", label: "Return label" }, { id: "no_shipping", label: "No shipping required" }],
    lines: dialog.lines.filter((line) => line.blockedBy !== "not_yours").map((line) => ({ index: line.orderItemIndex, name: line.name, ...(line.image ? { image: imageSet(line.image) } : {}), ordered: line.ordered,
      eligible: line.blockedBy || dialog.problem || ((line.finalSale || line.windowClosed) && !grantCan(context.workspace, "OVERRIDE_RETURN_ELIGIBILITY")) ? 0 : line.returnable, finalSale: line.finalSale,
      ...(lineReturnWindowEndsAt(order, line.orderItemIndex, resolveOrderReturnPolicy(order, settings)) ? { returnWindowEndsAt: lineReturnWindowEndsAt(order, line.orderItemIndex, resolveOrderReturnPolicy(order, settings))!.toISOString() } : {}),
      ...(line.blockedBy || line.finalSale || line.windowClosed || dialog.problem ? { reason: line.blockedBy || (line.finalSale ? "FINAL_SALE" : line.windowClosed ? "RETURN_WINDOW_CLOSED" : "RETURN_NOT_ELIGIBLE") } : {}) })),
    locations: locations.map((location) => ({ id: location._id, name: location.name })), uploads: [bizUploadPolicy("return_evidence"), bizUploadPolicy("return_label")] };
}
export async function previewReturnCreation(input: ReturnPreviewRequest, context: ReturnContext): Promise<ReturnPreview> {
  assertReturnOverride(context, input.eligibilityOverride);
  const order = await scopedReturnOrder(input.orderId, context); const settings = await returnSettings();
  assertReturnEligible(order, settings, { override: Boolean(input.eligibilityOverride) });
  const plan = await planReturnRequest({ order, settings, reason: input.reason, items: input.items.map((item) => ({ orderItemIndex: item.index, quantity: item.quantity })), override: Boolean(input.eligibilityOverride) });
  const vendorId = onlyVendorId(context);
  if (vendorId && plan.groups.some((group) => group.ownerType !== "vendor" || group.ownerVendorId !== vendorId)) refuse("RETURN_ACTION_NOT_ALLOWED", "Only your own items can be returned.", 403);
  return { parcels: plan.groups.map((group) => ({ ownerName: group.ownerType === "admin" ? "Store" : undefined, items: group.items.map((item) => ({ index: item.orderItemIndex, quantity: item.quantityRequested })), refund: refundBreakdown(group.estimatedRefund, plan.currency) })), total: toMoney(plan.total, plan.currency), warnings: [] };
}
