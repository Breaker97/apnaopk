import { randomUUID } from "node:crypto";
import { Types, type ClientSession } from "mongoose";
import type { RefundPreviewRequest, RefundPreview, RefundExecuteRequest, RefundResult, ReturnActionRequest, ReturnActionResult, RefundTarget, ReturnCase } from "@/contracts/mobile/biz/v1/returns";
import { Order, ReturnRequest, PaymentTransaction } from "@/models";
import { assertCapability } from "@/lib/api-core/biz/access";
import { bizOperationBinding, runDurableBizOperation, readDurableBizOperation, type BizOperationExecution } from "@/lib/api-core/biz/durable-operation";
import { mongoBizOperationStore } from "@/lib/api-next/biz-operation-store";
import { createBizQuote, claimBizQuote } from "@/lib/api-next/biz-quote";
import { runTransaction } from "@/lib/db-transaction";
import { quantizeToCurrency } from "@/lib/intl/money";
import { toMoney } from "@/lib/api-core/shop/money";
import { getOrderRefundCeiling } from "@/lib/orders/preorder-cancel-refund";
import { orderRefundRoom } from "@/lib/orders/order-refund-room";
import { refundOrderPayment } from "@/lib/orders/order-refund";
import { resolveOrderReturnPolicy, unrefundableDeliveryFor } from "@/lib/returns/return-policy";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import { priceReturnAsItStands, recomputeReturnEstimate, loadPriorReturnUnits, openReturnQuantitiesByIndex, refundedQuantitiesByIndex, refundedDeliveryTotal } from "@/lib/returns/return-plan";
import { mergeReturnOverrides, assertReturnOverrides } from "@/lib/returns/return-price-overrides";
import { allocateReturnRefund, allocateOrderRefund, scaleRefundAllocation, type RefundAllocationShare } from "@/lib/returns/refund-allocation";
import { refundSettlesOutOfBand, vendorHeldRefundShares, describeRefundDestination } from "@/lib/returns/refund-settlement";
import { splitRefundCreditFirst } from "@/lib/store-credit/order-credit";
import { issueStoreCredit } from "@/lib/store-credit/store-credit";
import { orderStoreCreditRefundProblem } from "@/lib/store-credit/refund-to-credit";
import { postRefund, postRestockedCost, postRefundSettlementReclass } from "@/lib/finance/post-events";
import { returnRestockPlan, returnGoodsBack, returnMayRestock, OPEN_RETURN_STATUSES, REFUND_IN_MOTION_STATUSES } from "@/lib/returns/returns";
import { restockBizReturn } from "./action";
import { scopedReturn, scopedReturnOrder, returnSettings, recordVersion, assertVersion, canSettleVendorReturn, authorizedReturnLocations, refuse, runReturnTransaction, type ReturnContext, type ReturnOrder, type ReturnRecord } from "./context";
import { refundBreakdown, toReturnCase } from "./dto";
import { returnActionAftermath, returnRefundNotice } from "./aftermath";
import { recordReturnOrderEvent } from "./audit";
import { loadOrderDetail } from "@/lib/api-core/biz/orders/detail";
import { authorizeReturnOperation } from "./operation-access";
import { refreshBizRefundReports } from "@/lib/payments/biz-refund-reconciliation";

type Context = ReturnContext & { actorId: string; key?: string };
type Estimate = ReturnRecord["estimatedRefund"];
interface Draft {
  target: RefundTarget; orderId: string; returnId?: string; version: string; orderVersion: string; currency: string;
  amount: number; maximum: number; collected: number; previouslyRefunded: number; credit: number; gateway: number;
  estimate: Estimate; allocation: RefundAllocationShare[] | null; manual: boolean; outOfBand: boolean; payer: "platform" | "vendor";
  whole: boolean; lines: Array<{ orderItemIndex: number; quantity: number }>;
  stock: RefundPreview["stock"]; request: RefundPreviewRequest;
}
interface Receipt {
  _id: Types.ObjectId; orderId: Types.ObjectId; bizOperationId: string; bizOperationLeg: string; status: string; currency: string; provider: string;
  grossAmount: number; metadata: { bizKey: string; bizTarget: RefundTarget; bizDraft: Draft; bizGatewayState?: string; bizHeadroomReserved?: boolean; bizGatewayReports?: Record<string, { id: string; amount: number; status: string; provider?: string }>; gatewayCalled?: boolean; [key: string]: unknown };
}
async function targetRecords(target: RefundTarget, context: ReturnContext, session?: ClientSession) {
  if (target.kind === "return") return scopedReturn(target.id, context, session);
  return { order: await scopedReturnOrder(target.id, context, session), returned: undefined };
}
function fullStatus(order: ReturnOrder, collected: number) { return quantizeToCurrency(Number(order.refundedTotal || 0), order.currency || "USD") >= collected ? "refunded" : "partially_refunded"; }

async function buildBizRefundDraft(input: RefundPreviewRequest, context: ReturnContext, session?: ClientSession): Promise<Draft> {
  const { order, returned } = await targetRecords(input.target, context, session); const settings = await returnSettings();
  const currency = order.currency || settings.general?.defaultCurrency || "USD"; const money = (value: number) => quantizeToCurrency(value, currency);
  if (!["paid", "partially_paid", "partially_refunded"].includes(order.paymentStatus)) refuse("REFUND_NOT_ALLOWED", "Only collected payments can be refunded.");
  if (returned && (["requested", "rejected", "cancelled", "closed"].includes(returned.status) || REFUND_IN_MOTION_STATUSES.includes(returned.refundStatus))) refuse("REFUND_PENDING", "This return is not available for another refund.");
  if (await PaymentTransaction.exists({ orderId: order._id, type: "refund", status: "pending", "metadata.bizHeadroomReserved": true })) refuse("REFUND_PENDING", "Reconcile the existing refund before issuing another.");
  const collected = money(getOrderRefundCeiling({ ...order, currency }));
  const historical = typeof order.refundedTotal === "number" ? order.refundedTotal : (await PaymentTransaction.aggregate<{ total: number }>([{ $match: { orderId: order._id, type: "refund", status: "succeeded" } }, { $group: { _id: null, total: { $sum: "$grossAmount" } } }]))[0]?.total || 0;
  const previouslyRefunded = money(historical);
  const policy = resolveOrderReturnPolicy(order, settings);
  const shipping = Math.max(0, Number(order.shippingCost || 0) - (isFreeShippingCouponType(order.coupon?.type) ? Number(order.discount || 0) : 0));
  const deliveryAlreadyRefunded = await refundedDeliveryTotal(order._id);
  if (typeof input.deliveryRefund === "number" && input.deliveryRefund > money(Math.max(0, shipping - deliveryAlreadyRefunded))) refuse("REFUND_AMOUNT_EXCEEDED", "Delivery has already been refunded or was not charged.");
  const room = orderRefundRoom({ ceiling: collected, refunded: previouslyRefunded, heldDelivery: unrefundableDeliveryFor({ policy, dispatched: ["shipped", "delivered"].includes(order.status), chargedShipping: shipping, alreadyRefunded: deliveryAlreadyRefunded }), namedDelivery: Number(input.deliveryRefund || 0), currency });
  let estimate: Estimate; let maximum = room.limit; let allocation: RefundAllocationShare[] | null = null;
  const lines = (input.items || []).map((line) => ({ orderItemIndex: line.index, quantity: line.quantity }));
  if (new Set(lines.map((line) => line.orderItemIndex)).size !== lines.length) refuse("RETURN_ITEM_LISTED_TWICE", "Choose each refund line once.");
  if (returned) {
    if (lines.length) refuse("REFUND_NOT_ALLOWED", "Refund a return from its approved and received quantities.");
    const priced = input.faultOverride ? { ...returned, faultOverride: { ...input.faultOverride } } : returned;
    const overrides = mergeReturnOverrides(returned, input);
    const prior = await loadPriorReturnUnits({ orderId: order._id, before: returned.createdAt, excludeReturnId: returned._id });
    await assertReturnOverrides({ returnRequest: priced, order, settings, priorUnitsByIndex: prior, body: input, overrides });
    estimate = priceReturnAsItStands({ returnRequest: priced, order, settings, priorUnitsByIndex: prior, overrides });
    maximum = money(Math.min(maximum, Math.max(0, estimate.total - Number(returned.actualRefund?.amount || 0))));
  } else {
    if (input.feeOverride || input.faultOverride) refuse("REFUND_NOT_ALLOWED", "Return fees and fault are decided on a return case.");
    const [claimed, refunded] = await Promise.all([openReturnQuantitiesByIndex(order._id), refundedQuantitiesByIndex(order._id)]);
    for (const line of lines) {
      const item = order.items[line.orderItemIndex];
      if (!item || line.quantity > Math.max(0, item.quantity - (claimed.get(line.orderItemIndex)?.quantity || 0) - (refunded.get(line.orderItemIndex) || 0))) refuse("RETURN_QUANTITY_CHANGED", "These goods are already returned or refunded.");
    }
    const subtotal = lines.length ? lines.reduce((sum, line) => sum + Number(order.items[line.orderItemIndex].price || 0) * line.quantity, 0) : Math.max(0, room.goodsLeft - Number(order.tax || 0));
    const tax = lines.length && order.subtotal > 0 ? Number(order.tax || 0) * subtotal / order.subtotal : Number(order.tax || 0);
    estimate = { itemsSubtotal: money(subtotal), tax: money(tax), shipping: money(Number(input.deliveryRefund || 0)), discountAdjustment: 0, restockingFee: 0, returnShippingFee: 0, total: money(subtotal + tax + Number(input.deliveryRefund || 0)), currency };
    if (lines.length) {
      estimate = recomputeReturnEstimate({ items: lines.map((line) => ({ orderItemIndex: line.orderItemIndex, vendorId: order.items[line.orderItemIndex].vendorId, unitPrice: order.items[line.orderItemIndex].price, quantityApproved: line.quantity })), order, settings, merchantAtFault: false, priorUnitsByIndex: refunded, policyApplied: { shippingRefund: "never", restockingFeePercent: 0, returnShippingFee: 0 }, overrides: { deliveryOverride: { amount: Number(input.deliveryRefund || 0) } } });
      maximum = money(Math.min(maximum, estimate.total));
    }
  }
  const amount = money(input.amount ?? maximum);
  if (!(amount > 0) || amount > maximum) refuse("REFUND_AMOUNT_EXCEEDED", "This amount exceeds what is left to refund.");
  const whole = !returned && !lines.length && amount === room.limit;
  if (!returned && !whole && !lines.length && await ReturnRequest.exists({ orderId: order._id, status: { $in: OPEN_RETURN_STATUSES } })) refuse("REFUND_NOT_ALLOWED", "Name the goods, refund their return, or refund the whole remaining order.");
  allocation = returned ? allocateReturnRefund({ amount, currency, items: returned.items.map((item) => ({ ...item, quantityApproved: returned.itemsCountedAt ? item.quantityReceived : item.quantityApproved })), estimate, policy, commissionRatioByVendor: new Map((order.subOrders || []).map((sub) => [String(sub.vendorId), Number(sub.commission || 0) / Math.max(1, Number(sub.subtotal || 0))])) }) : allocateOrderRefund({ amount, currency, lines: (lines.length ? lines : order.items.map((item, index) => ({ orderItemIndex: index, quantity: item.quantity }))).map((line) => ({ ...order.items[line.orderItemIndex], quantity: line.quantity })), shipping: input.deliveryRefund, orderTax: order.tax, orderSubtotal: order.subtotal, shippingByVendor: new Map((order.subOrders || []).map((sub) => [String(sub.vendorId), Number(sub.shippingCost || 0)])) });
  const payer = returned?.refundPayer === "vendor" ? "vendor" : "platform";
  const outOfBand = refundSettlesOutOfBand(order) || payer === "vendor";
  const split = splitRefundCreditFirst({ amount, order, currency });
  if (String(order.paymentMethod || "").toLowerCase().trim() === "pesapal" && split.gateway > 0 && !input.manual) refuse("REFUND_NOT_ALLOWED", "This payment provider cannot confirm an automatic refund. Record an already-sent settlement explicitly.");
  if (split.credit > 0) { const problem = await orderStoreCreditRefundProblem(order); if (problem) refuse("REFUND_NOT_ALLOWED", problem); if (input.manual || payer === "vendor") refuse("REFUND_NOT_ALLOWED", "The original credit portion must be restored by the platform."); }
  if (input.manual && !input.settlement) refuse("SETTLEMENT_NOT_ALLOWED", "Record how the already-sent money was paid.");
  if (!returned && outOfBand && !input.manual) refuse("SETTLEMENT_NOT_ALLOWED", "Record the already-sent payment, or use a return case whose manual settlement can be tracked.");
  if (!returned && vendorHeldRefundShares({ order, allocation }).length && input.manual) refuse("SETTLEMENT_NOT_ALLOWED", "Vendor-held cash must be settled against its own return.");
  if (input.restoreInventory && !returned) refuse("REFUND_NOT_ALLOWED", "Receive and restock goods through a return case.");
  const mayRestock = Boolean(returned && returnGoodsBack(returned) && returnMayRestock(returned.status));
  if (input.restoreInventory && !mayRestock) refuse("RETURN_ACTION_NOT_ALLOWED", "Receive the returned goods before restoring stock.");
  if (returned && input.restoreInventory && input.locationId && !(await authorizedReturnLocations(returned, context)).some((location) => location._id === input.locationId)) refuse("RETURN_LOCATION_NOT_ALLOWED", "Choose an authorized return location.");
  const stock = returned && mayRestock ? returnRestockPlan(returned.items, { itemsCounted: Boolean(returned.itemsCountedAt), inventoryRestored: returned.inventoryRestored }).map((line) => ({ index: line.orderItemIndex, quantity: line.quantity, locationId: input.locationId, effect: input.restoreInventory ? "restock" as const : "none" as const })) : [];
  return { target: input.target, orderId: String(order._id), returnId: returned ? String(returned._id) : undefined, version: recordVersion(returned || order), orderVersion: recordVersion(order), currency, amount, maximum, collected, previouslyRefunded, credit: split.credit, gateway: split.gateway, estimate, allocation, manual: Boolean(input.manual), outOfBand, payer, whole, lines, stock, request: input };
}

export async function previewBizRefund(input: RefundPreviewRequest, context: Context): Promise<RefundPreview> {
  assertCapability(context.workspace, "ISSUE_REFUNDS");
  const draft = await buildBizRefundDraft(input, context);
  const binding = bizOperationBinding({ actorId: context.actorId, workspace: context.workspace, key: randomUUID(), routeId: "refunds.execute", target: `${input.target.kind}:${input.target.id}`, payload: input });
  const quote = await createBizQuote({ binding, purpose: "refund", snapshot: { draft }, expiresAt: new Date(Date.now() + 5 * 60_000) });
  const { returned, order } = await targetRecords(input.target, context);
  const ratio = draft.estimate.total > 0 ? draft.amount / draft.estimate.total : 1;
  const scaled = { ...draft.estimate }; for (const field of ["itemsSubtotal", "discountAdjustment", "tax", "shipping", "restockingFee", "returnShippingFee"] as const) scaled[field] = quantizeToCurrency(draft.estimate[field] * ratio, draft.currency);
  scaled.itemsSubtotal = quantizeToCurrency(scaled.itemsSubtotal + draft.amount - (scaled.itemsSubtotal - scaled.discountAdjustment + scaled.tax + scaled.shipping - scaled.restockingFee - scaled.returnShippingFee), draft.currency); scaled.total = draft.amount;
  return { ...quote, target: input.target, version: draft.version, amount: toMoney(draft.amount, draft.currency), maximum: toMoney(draft.maximum, draft.currency), collected: toMoney(draft.collected, draft.currency), previouslyRefunded: toMoney(draft.previouslyRefunded, draft.currency), breakdown: refundBreakdown(scaled, draft.currency), destination: { kind: draft.credit === draft.amount ? "existing_credit" : draft.outOfBand || draft.manual ? "manual" : "original", label: returned && draft.outOfBand ? describeRefundDestination(returned.refundDestination) : order.paymentMethod || "Original payment", payer: draft.payer, settlementRequired: draft.outOfBand && !draft.manual && draft.gateway > 0 }, resultingPaymentStatus: draft.previouslyRefunded + draft.amount >= draft.collected ? "refunded" : "partially_refunded", resultingReturnStatus: returned ? Number(returned.actualRefund?.amount || 0) + draft.amount >= draft.estimate.total ? "refunded" : "partially_refunded" : undefined, stock: draft.stock, warnings: draft.outOfBand && !draft.manual ? ["Manual settlement must be recorded after money is sent."] : [] };
}

async function reserve(draft: Draft, operation: BizOperationExecution, context: Context, session: ClientSession) {
  const { order, returned } = await targetRecords(draft.target, context, session);
  assertVersion(order, draft.orderVersion, "REFUND_PREVIEW_CHANGED"); if (returned) assertVersion(returned, draft.version, "REFUND_PREVIEW_CHANGED");
  const reserved = await Order.updateOne({ _id: order._id, updatedAt: order.updatedAt ?? { $exists: false }, refundedTotal: order.refundedTotal ?? { $exists: false }, $expr: { $lte: [{ $add: [{ $ifNull: ["$refundedTotal", draft.previouslyRefunded] }, draft.amount] }, draft.collected] } }, { $set: { refundedTotal: quantizeToCurrency(draft.previouslyRefunded + draft.amount, draft.currency) }, $inc: { "storeCredit.refunded": draft.credit, __v: 1 } }, { session });
  if (!reserved.modifiedCount) refuse("REFUND_AMOUNT_EXCEEDED", "Another refund changed the available amount.");
  const gatewayProvider = String(order.paymentMethod || "").toLowerCase().trim() === "card" ? "stripe" : String(order.paymentMethod || "").toLowerCase().trim();
  const legs = [{ leg: "gateway", amount: draft.gateway, provider: draft.outOfBand || draft.manual ? "manual" : gatewayProvider }, { leg: "credit", amount: draft.credit, provider: "store_credit" }].filter((leg) => leg.amount > 0);
  const quantityLeg = draft.gateway > 0 ? "gateway" : "credit";
  const rows = await PaymentTransaction.create(legs.map((leg) => ({ orderId: order._id, orderNumber: order.orderNumber, type: "refund", status: "pending", provider: leg.provider, paymentMethod: order.paymentMethod, currency: draft.currency, grossAmount: leg.amount, feeAmount: 0, netAmount: 0, refundedAmount: 0, refundAllocation: scaleRefundAllocation(draft.allocation, leg.amount, draft.currency)?.map((share) => ({ ...share, vendorId: share.vendorId || undefined })), bizOperationId: operation.id, bizOperationLeg: leg.leg, createdBy: context.actorId, metadata: { source: "biz-return-refund", bizKey: context.key, bizTarget: draft.target, bizDraft: draft, bizHeadroomReserved: true, bizGatewayState: "reserved", gatewayCalled: leg.leg === "gateway" && !draft.outOfBand && !draft.manual, channel: order.channel, ...(draft.lines.length && leg.leg === quantityLeg ? { refundedLines: draft.lines } : {}), ...(leg.leg === "credit" ? { storeCredit: true, storeCreditRestores: true } : {}) } })), { session, ordered: true });
  if (returned) await ReturnRequest.updateOne({ _id: returned._id }, { $inc: { "actualRefund.amount": draft.amount, __v: 1 }, $set: { status: Number(returned.actualRefund?.amount || 0) + draft.amount >= draft.estimate.total ? (draft.outOfBand ? "refunded" : "refund_pending") : "partially_refunded", refundStatus: draft.outOfBand && !draft.manual && draft.gateway > 0 ? "manual_required" : "processing", "actualRefund.paymentTransactionId": rows[0]._id, estimatedRefund: draft.estimate, ...(draft.request.faultOverride ? { faultOverride: draft.request.faultOverride } : {}), ...mergeReturnOverrides(returned, draft.request) }, $addToSet: { "actualRefund.paymentTransactionIds": { $each: rows.map((row) => row._id) } } }, { session });
  await recordReturnOrderEvent({ operationId: operation.id, leg: "refund:requested", actorId: context.actorId, context, orderId: order._id, orderNumber: order.orderNumber, action: "REFUND", summary: `Refund of ${toMoney(draft.amount, draft.currency).formatted} requested${returned ? ` for return ${returned.returnNumber}` : ""}`, metadata: { amount: draft.amount, currency: draft.currency, returnNumber: returned?.returnNumber, pending: true }, session });
  return rows[0]._id.toString();
}

const gatewayTerminalStatuses: Readonly<Record<string, { succeeded: readonly string[]; failed: readonly string[] }>> = {
  stripe: { succeeded: ["succeeded"], failed: ["failed", "canceled"] },
  paypal: { succeeded: ["completed"], failed: ["failed", "cancelled"] },
  razorpay: { succeeded: ["processed"], failed: ["failed"] },
  paystack: { succeeded: ["processed"], failed: ["failed"] },
};
/** Exact totals and each provider's own terminal vocabulary are required. */
export function gatewayReceiptAmounts(row: Pick<Receipt, "provider" | "grossAmount" | "currency" | "metadata">): { succeeded: number; failed: number } | null {
  const reports = Object.values(row.metadata.bizGatewayReports || {}); if (!reports.length) return null;
  const legacyProvider = String(row.provider || "").toLowerCase();
  // Older single-provider receipts omitted per-report provider. A mixed
  // reading cannot safely infer the identity of any unlabelled component.
  const mayUseLegacyProvider = reports.every((report) => report.provider === undefined || String(report.provider).toLowerCase() === legacyProvider);
  const seen = new Set<string>(); let success = 0; let reported = 0;
  for (const report of reports) {
    if (!report.id || seen.has(report.id) || !Number.isFinite(report.amount) || report.amount <= 0) return null;
    const provider = report.provider === undefined && mayUseLegacyProvider ? legacyProvider : String(report.provider || "").toLowerCase();
    const vocabulary = Object.hasOwn(gatewayTerminalStatuses, provider) ? gatewayTerminalStatuses[provider] : undefined; const status = String(report.status || "").toLowerCase();
    if (!vocabulary) return null;
    seen.add(report.id); reported += report.amount;
    if (vocabulary.succeeded.includes(status)) success += report.amount;
    else if (!vocabulary.failed.includes(status)) return null;
  }
  const money = (amount: number) => quantizeToCurrency(amount, row.currency);
  return money(reported) === money(row.grossAmount) ? { succeeded: money(success), failed: money(reported - success) } : null;
}
async function finishReceipt(row: Receipt, context: Context, forceManual = false) {
  if (row.status === "succeeded") { await postRefund({ orderId: row.orderId, refundId: row._id, amount: row.grossAmount }); const settlement = row.metadata.settlement as { method?: string } | undefined; if (settlement?.method) await postRefundSettlementReclass({ refundId: row._id, method: settlement.method }); return; }
  const draft = row.metadata.bizDraft;
  if (row.status === "failed") return;
  const outcome = row.bizOperationLeg === "gateway" && !forceManual && !draft.manual ? gatewayReceiptAmounts(row) : { succeeded: row.grossAmount, failed: 0 };
  if (row.bizOperationLeg === "gateway" && !forceManual && !draft.manual && (draft.outOfBand || !outcome)) return;
  const provenAmount = outcome?.succeeded ?? row.grossAmount; const released = outcome?.failed ?? 0;
  if (row.bizOperationLeg === "credit") {
    const order = await scopedReturnOrder(draft.orderId, context);
    await issueStoreCredit({ customerId: order.customerId, currency: row.currency, amount: row.grossAmount, source: "order_refund_restore", orderId: row.orderId, returnId: draft.returnId, paymentTransactionId: row._id, createdBy: context.actorId, idempotencyKey: `biz:${row.bizOperationId}:credit` });
  }
  await runTransaction("biz refund receipt finalization", async (session) => {
    const updated = await PaymentTransaction.updateOne({ _id: row._id, status: "pending" }, { $set: { status: provenAmount > 0 ? "succeeded" : "failed", ...(provenAmount > 0 ? { grossAmount: provenAmount, refundAllocation: scaleRefundAllocation(draft.allocation, provenAmount, row.currency)?.map((share) => ({ ...share, vendorId: share.vendorId || undefined })) } : {}), refundedAmount: provenAmount, netAmount: -provenAmount, "metadata.bizHeadroomReserved": false, "metadata.bizFinalizedAt": new Date(), "metadata.bizExpectedAmount": row.grossAmount, "metadata.bizReleasedAmount": released, ...(forceManual || draft.manual ? { "metadata.settlement": { required: true, payer: draft.payer, ...draft.request.settlement, settledAt: new Date(), settledBy: context.actorId } } : {}) } }, { session });
    if (!updated.modifiedCount) return;
    // A split refund claims named units once. Proven gateway failure must not
    // release goods whose original credit is still being restored.
    if (row.bizOperationLeg === "gateway" && provenAmount === 0 && draft.credit > 0 && draft.lines.length) {
      await PaymentTransaction.updateOne({ bizOperationId: row.bizOperationId, bizOperationLeg: "credit", status: { $in: ["pending", "succeeded"] } }, { $set: { "metadata.refundedLines": draft.lines } }, { session });
      await PaymentTransaction.updateOne({ _id: row._id }, { $unset: { "metadata.refundedLines": "" } }, { session });
    }
    const auditedOrder = await scopedReturnOrder(draft.orderId, context, session);
    await recordReturnOrderEvent({ operationId: row.bizOperationId, leg: `refund:${row.bizOperationLeg}:settled`, actorId: context.actorId, context, orderId: row.orderId, orderNumber: auditedOrder.orderNumber, action: "REFUND", summary: released > 0 ? `Refund provider confirmed ${toMoney(provenAmount, row.currency).formatted} sent and ${toMoney(released, row.currency).formatted} unsuccessful` : `Refund of ${toMoney(provenAmount, row.currency).formatted} settled`, metadata: { amount: provenAmount, currency: row.currency, released, paymentTransactionId: String(row._id) }, session });
    if (released > 0) { await Order.updateOne({ _id: row.orderId }, { $inc: { refundedTotal: -released, __v: 1 } }, { session }); if (draft.returnId) await ReturnRequest.updateOne({ _id: draft.returnId }, { $inc: { "actualRefund.amount": -released, __v: 1 } }, { session }); }
    // Credit never came from a gateway charge. Apply each proven gateway leg
    // once, across the order's actual succeeded charge rows in oldest order.
    if (row.bizOperationLeg === "gateway") {
      const charges = await PaymentTransaction.find({ orderId: row.orderId, type: "charge", status: "succeeded" }, undefined, { session }).sort({ createdAt: 1 }).lean<Array<{ _id: Types.ObjectId; grossAmount: number; refundedAmount?: number; netAmount: number }>>();
      let left = provenAmount;
      for (const charge of charges) { const part = quantizeToCurrency(Math.min(left, Math.max(0, charge.grossAmount - Number(charge.refundedAmount || 0))), row.currency); if (part <= 0) continue; await PaymentTransaction.updateOne({ _id: charge._id }, { $inc: { refundedAmount: part, netAmount: -part } }, { session }); left = quantizeToCurrency(left - part, row.currency); }
    }
    const pending = await PaymentTransaction.exists({ bizOperationId: row.bizOperationId, status: "pending" }).session(session);
    if (!pending) {
      const order = await scopedReturnOrder(draft.orderId, context, session);
      const failed = await PaymentTransaction.exists({ bizOperationId: row.bizOperationId, "metadata.bizReleasedAmount": { $gt: 0 } }).session(session);
      await Order.updateOne({ _id: order._id }, { $set: { paymentStatus: Number(order.refundedTotal || 0) > 0 ? fullStatus(order, draft.collected) : "paid" }, $inc: { __v: 1 } }, { session });
      if (draft.returnId) { const returned = await ReturnRequest.findById(draft.returnId, undefined, { session }).lean<ReturnRecord | null>(); await ReturnRequest.updateOne({ _id: draft.returnId }, { $set: { status: Number(returned?.actualRefund?.amount || 0) >= Number(returned?.estimatedRefund.total || 0) ? "refunded" : Number(returned?.actualRefund?.amount || 0) > 0 ? "partially_refunded" : returned?.itemsCountedAt ? "received" : "approved", refundStatus: failed ? "failed" : "succeeded", refundedAt: new Date(), ...(forceManual || draft.manual ? { "actualRefund.settledMethod": draft.request.settlement?.method, "actualRefund.settledReference": draft.request.settlement?.reference, "actualRefund.settledAt": new Date(), "actualRefund.settledBy": context.actorId } : {}) }, $inc: { __v: 1 } }, { session }); }
      if (draft.whole && !failed) await ReturnRequest.updateMany({ orderId: row.orderId, status: { $in: OPEN_RETURN_STATUSES }, refundStatus: { $nin: REFUND_IN_MOTION_STATUSES } }, { $set: { status: "closed", refundStatus: "not_required", closedAt: new Date(), refundedByOrderAt: new Date(), refundedByOrderTransactionId: row._id }, $inc: { __v: 1 } }, { session });
    }
  });
  if (provenAmount > 0) { await postRefund({ orderId: row.orderId, refundId: row._id, amount: provenAmount }); if ((forceManual || draft.manual) && draft.request.settlement) await postRefundSettlementReclass({ refundId: row._id, method: draft.request.settlement.method }); }
}

type GatewayReport = { id: string; provider: string; amount: number; status: string };
async function rememberGatewayEvidence(row: Receipt, input: { provider?: string; ids?: string[]; reports?: GatewayReport[]; state: string; gatewayCalled?: boolean }) {
  const reports = (input.reports || []).filter((report) => /^[A-Za-z0-9_-]{1,200}$/.test(report.id) && Number.isFinite(report.amount) && report.amount > 0);
  const ids = [...new Set([...(input.ids || []), ...reports.map((report) => report.id)].filter((id) => /^[A-Za-z0-9_-]{1,200}$/.test(id)))];
  await PaymentTransaction.updateOne({ _id: row._id, status: "pending" }, { $set: { "metadata.bizGatewayState": input.state, ...(input.provider ? { provider: input.provider } : {}), ...(input.gatewayCalled !== undefined ? { "metadata.gatewayCalled": input.gatewayCalled } : {}) }, ...(ids.length ? { $addToSet: { "metadata.gatewayRefundIds": { $each: ids } } } : {}) });
  if (ids.length) await PaymentTransaction.updateOne({ _id: row._id, status: "pending", externalId: { $in: [null, ""] } }, { $set: { externalId: ids[0] } });
  for (const report of reports) {
    const field = `metadata.bizGatewayReports.${report.id}`;
    // A late HTTP pending answer cannot overwrite a terminal webhook report.
    await PaymentTransaction.updateOne({ _id: row._id, status: "pending", $or: [{ [field]: { $exists: false } }, { [`${field}.status`]: { $nin: ["succeeded", "completed", "success", "processed", "failed", "canceled", "cancelled", "COMPLETED", "FAILED", "CANCELLED"] } }] }, { $set: { [field]: report } });
  }
}

async function sendReservedGateway(row: Receipt, context: Context) {
  if (row.bizOperationLeg !== "gateway" || row.metadata.bizDraft.outOfBand || row.metadata.bizDraft.manual) return;
  const claimed = await PaymentTransaction.updateOne({ _id: row._id, status: "pending", "metadata.bizGatewayState": "reserved" }, { $set: { "metadata.bizGatewayState": "sending" } });
  if (!claimed.modifiedCount) return;
  try {
    const order = await scopedReturnOrder(String(row.orderId), context);
    const response = await refundOrderPayment({ order, amount: row.grossAmount, reason: row.metadata.bizDraft.request.reason, actor: context.actorId, idempotencyKey: `biz:${row.bizOperationId}:gateway`, gatewayMetadata: { storifyBizOperationId: row.bizOperationId, storifyBizOperationLeg: "gateway" } });
    const ids = response.externalRefundIds || (response.externalRefundId ? [response.externalRefundId] : []);
    // Split adapters report each actual amount/provider. Legacy single-ID
    // adapters have one exact requested amount; never divide a multi-ID total.
    const reports = response.refundReports ?? (ids.length === 1 && response.status ? [{ id: ids[0], provider: response.provider, amount: row.grossAmount, status: response.status }] : []);
    await rememberGatewayEvidence(row, { provider: response.provider, ids, reports, state: "reported", gatewayCalled: response.gatewayCalled });
  } catch (error) {
    // PartialRefundError carries proven IDs and per-leg evidence. Its absent
    // remainder is still unknown; an exception alone never releases a claim.
    const partial = (error && typeof error === "object" ? error : {}) as { provider?: string; refundIds?: string[]; refundReports?: GatewayReport[] };
    await rememberGatewayEvidence(row, { provider: partial.provider, ids: Array.isArray(partial.refundIds) ? partial.refundIds : [], reports: Array.isArray(partial.refundReports) ? partial.refundReports : [], state: "unknown" });
  }
}
async function reconcileReceipts(operationId: string, context: Context, forceManual = false) {
  const rows = await PaymentTransaction.find({ bizOperationId: operationId, type: "refund" }).lean<Receipt[]>();
  for (const row of rows) {
    await sendReservedGateway(row, context);
    if (row.status === "pending" && row.bizOperationLeg === "gateway" && !row.metadata.bizDraft.outOfBand && !row.metadata.bizDraft.manual) await refreshBizRefundReports(row._id).catch(() => undefined);
    const current = await PaymentTransaction.findById(row._id).lean<Receipt | null>(); if (current) await finishReceipt(current, context, forceManual);
  }
  return PaymentTransaction.find({ bizOperationId: operationId, type: "refund" }).lean<Receipt[]>();
}
async function receiptResult(rows: Receipt[], context: Context, operation: RefundResult["operation"]): Promise<RefundResult> {
  const draft = rows[0].metadata.bizDraft; const { returned } = await targetRecords(draft.target, context);
  const order = draft.target.kind === "order" ? await loadOrderDetail(draft.orderId, context) : null;
  if (returned) { await returnActionAftermath(returned, rows[0].bizOperationId); await returnRefundNotice(returned); }
  const released = rows.reduce((sum, row) => sum + Number(row.metadata.bizReleasedAmount || 0), 0);
  return { operation, refundId: String(rows[0]._id), settlementStatus: rows.some((row) => row.status === "pending") ? draft.outOfBand && !draft.manual ? "manual_required" : "processing" : released > 0 ? "failed" : "succeeded", amount: toMoney(quantizeToCurrency(draft.amount - released, draft.currency), draft.currency), ...(order ? { order } : {}), ...(returned ? { return: await toReturnCase(returned, await scopedReturnOrder(draft.orderId, context), context) } : {}), warnings: rows.some((row) => row.status === "pending") ? ["Refund settlement is not confirmed. Reserved money remains unavailable."] : released > 0 ? ["The provider confirmed an unsuccessful portion. Only the proven refund was booked."] : [] };
}

export async function executeBizRefund(input: RefundExecuteRequest, context: Context): Promise<RefundResult> {
  assertCapability(context.workspace, "ISSUE_REFUNDS");
  const binding = bizOperationBinding({ actorId: context.actorId, workspace: context.workspace, key: context.key, routeId: "refunds.execute", target: `${input.preview.target.kind}:${input.preview.target.id}`, payload: input.preview });
  const result = await runDurableBizOperation<{ refundId: string }>({ binding, store: mongoBizOperationStore,
    authorize: async () => { await targetRecords(input.preview.target, context); },
    async reconcile(operation) {
      const rows = await reconcileReceipts(operation.id, context);
      // A durable receipt means never invoke the gateway again, even when a
      // process died between 'sending' and the provider's missing answer.
      return rows.length ? { state: "succeeded", data: { refundId: String(rows[0]._id) }, resources: [{ kind: "refund", id: String(rows[0]._id) }] } : { state: "not_applied" };
    },
    async execute(operation) {
      let refundId = ""; let restocked: Awaited<ReturnType<typeof restockBizReturn>> = [];
      await runReturnTransaction("biz refund quote and monetary reservation", async (session) => {
        const quote = await claimBizQuote({ token: input.previewToken, binding, purpose: "refund", operationId: operation.id, session });
        const draft = quote.snapshot.draft as unknown as Draft;
        const current = await buildBizRefundDraft(input.preview, context, session);
        if (JSON.stringify(current) !== JSON.stringify(draft)) refuse("REFUND_PREVIEW_CHANGED", "Refund eligibility or price changed. Preview it again.");
        refundId = await reserve(current, operation, context, session);
        if (current.request.restoreInventory && current.returnId) { const { returned } = await scopedReturn(current.returnId, context, session); restocked = await restockBizReturn({ returned, context, operation, session, actorId: context.actorId, locationId: current.request.locationId }); }
      });
      const rows = await PaymentTransaction.find({ bizOperationId: operation.id }).lean<Receipt[]>();
      await reconcileReceipts(operation.id, context);
      if (restocked.length) await postRestockedCost({ orderId: rows[0].orderId, restocked, eventKey: `return-${input.preview.target.id}-step-${operation.id}` });
      return { data: { refundId }, resources: [{ kind: "refund", id: refundId }] };
    },
  });
  const receipt = await PaymentTransaction.findById(result.data.refundId).lean<Receipt | null>(); if (!receipt) refuse("REFUND_OUTCOME_UNKNOWN", "The refund receipt is not available yet.");
  return receiptResult(await reconcileReceipts(receipt.bizOperationId, context), context, result.operation);
}

export async function readBizRefund(id: string, context: Context): Promise<RefundResult> {
  if (!Types.ObjectId.isValid(id)) refuse("REFUND_NOT_ALLOWED", "Refund not found.", 404);
  const row = await PaymentTransaction.findOne({ _id: id, type: "refund", "metadata.source": "biz-return-refund" }).lean<Receipt | null>();
  if (!row) refuse("REFUND_NOT_ALLOWED", "Refund not found.", 404);
  await targetRecords(row.metadata.bizTarget, context);
  // Polling is the originating operator's receipt, not an order-wide finance
  // search. Case detail remains readable by other authorized handlers.
  const own = await mongoBizOperationStore.read(context.actorId, row.metadata.bizKey);
  if (own?.id !== row.bizOperationId) refuse("REFUND_NOT_ALLOWED", "Refund not found.", 404);
  await authorizeReturnOperation(own, context);
  const operation = await readDurableBizOperation({ actorId: context.actorId, workspace: context.workspace, key: row.metadata.bizKey, store: mongoBizOperationStore, authorize: async () => { await authorizeReturnOperation(own, context); } });
  return receiptResult(await reconcileReceipts(row.bizOperationId, context), context, operation);
}

export async function settleBizReturn(input: ReturnActionRequest, id: string, context: Context): Promise<ReturnActionResult> {
  const loaded = await scopedReturn(id, context);
  if (context.workspace.kind !== "admin" && !canSettleVendorReturn(loaded.returned, context)) refuse("SETTLEMENT_NOT_ALLOWED", "Only the refund payer may record settlement.", 403);
  if (!input.settlement) refuse("SETTLEMENT_NOT_ALLOWED", "Record how the money was paid.");
  const binding = bizOperationBinding({ actorId: context.actorId, workspace: context.workspace, key: context.key, routeId: "returns.action", target: id, payload: input });
  const settleReceipts = async (operationId: string) => {
    const rows = await PaymentTransaction.find({ "metadata.bizSettlementOperationId": operationId }).lean<Receipt[]>();
    for (const row of rows) await finishReceipt(row, context, true);
    const current = await scopedReturn(id, context); await returnRefundNotice(current.returned);
    return toReturnCase(current.returned, current.order, context);
  };
  const result = await runDurableBizOperation<ReturnCase>({ binding, store: mongoBizOperationStore, authorize: async () => { const current = await scopedReturn(id, context); if (context.workspace.kind !== "admin" && !canSettleVendorReturn(current.returned, context)) refuse("SETTLEMENT_NOT_ALLOWED", "The refund payer changed.", 403); },
    async reconcile(operation) { const { returned } = await scopedReturn(id, context); return returned.bizOperationReceipts?.some((receipt) => receipt.operationId === operation.id) ? { state: "succeeded", data: await settleReceipts(operation.id), resources: [{ kind: "return" as const, id }] } : { state: "not_applied" }; },
    async execute(operation) {
      await operation.remember({ action: "record_settlement" });
      await runReturnTransaction("biz manual settlement claim", async (session) => {
        const { returned } = await scopedReturn(id, context, session); assertVersion(returned, input.version);
        let rows = await PaymentTransaction.find({ "metadata.bizTarget.kind": "return", "metadata.bizTarget.id": id, status: "pending" }, undefined, { session }).lean<Receipt[]>();
        if (rows.some((row) => !row.metadata.bizDraft.outOfBand || row.bizOperationLeg !== "gateway" || row.metadata.bizSettlementOperationId)) refuse("SETTLEMENT_NOT_ALLOWED", "A provider, credit, or already-claimed refund cannot be manually settled.");
        if (!rows.length) {
          if (!canSettleVendorReturn(returned, context)) refuse("SETTLEMENT_NOT_ALLOWED", "Issue the refund preview before recording settlement.");
          const request: RefundPreviewRequest = { target: { kind: "return", id }, manual: true, settlement: input.settlement };
          const draft = await buildBizRefundDraft(request, context, session);
          await reserve(draft, operation, context, session);
          rows = await PaymentTransaction.find({ bizOperationId: operation.id }, undefined, { session }).lean<Receipt[]>();
        }
        await PaymentTransaction.updateMany({ _id: { $in: rows.map((row) => row._id) } }, { $set: { "metadata.bizSettlementOperationId": operation.id, "metadata.bizDraft.request.settlement": input.settlement } }, { session });
        await ReturnRequest.updateOne({ _id: id }, { $push: { bizOperationReceipts: { operationId: operation.id, kind: "record_settlement", at: new Date() }, bizTimeline: { operationId: operation.id, kind: "record_settlement", message: "Refund payment recorded", at: new Date(), by: context.actorId } }, $inc: { __v: 1 } }, { session });
      });
      return { data: await settleReceipts(operation.id), resources: [{ kind: "return" as const, id }] };
    },
  });
  return { operation: result.operation, return: result.data };
}
