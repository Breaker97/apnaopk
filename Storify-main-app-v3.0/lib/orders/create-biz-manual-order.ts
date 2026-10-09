import "server-only";
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import type { ManualOrderCreateRequest } from "@/contracts/mobile/biz/v1/order-creation";
import type { IOrder } from "@/types";
import type { AuditContext } from "@/lib/audit";
import type { BizOperationExecution } from "@/lib/api-core/biz/durable-operation";
import { DefiniteOperationFailure } from "@/lib/api-core/biz/durable-operation";
import { applyBizStockEffect } from "@/lib/api-core/biz/stock-effect";
import { stockMovementChangesAvailability } from "@/lib/inventory/inventory";
import { revalidateProductStock } from "@/lib/cache-invalidation";
import { markForMetaCatalog } from "@/lib/meta-catalog/mark-later";
import { orderScopeFilter, productScopeFilter } from "@/lib/api-core/biz/scope";
import { MobileApiError } from "@/lib/api-core/errors";
import { claimBizQuote } from "@/lib/api-next/biz-quote";
import { financeSession } from "@/lib/finance/transaction";
import { manualCreationTransaction } from "@/lib/orders/manual-creation-transaction";
import { postOrderPaid } from "@/lib/finance/post-events";
import { withStrictLedger } from "@/lib/finance/ledger";
import { allocateSubOrderShipping } from "@/lib/checkout/checkout-shipping";
import { buildVendorSubOrders } from "@/lib/orders/order-vendors";
import { getNextOnlineOrderNumber } from "@/lib/orders/order-number";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";
import { auditOrderPlaced } from "@/lib/orders/audit-order";
import { getPaymentProviderFromOrder } from "@/lib/payments/payment-transactions";
import { awardOrderLoyaltyPoints, refreshCustomerStatsForOrder } from "@/lib/customers/customer";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { Order } from "@/models/order.model";
import { Product } from "@/models/product.model";
import { Vendor } from "@/models/vendor.model";
import { Settings } from "@/models/settings.model";
import { InventoryLocation } from "@/models/inventory-location.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { prepareManualOrder, draftQuoteBinding } from "@/lib/api-core/biz/order-creation/quote";
import { creationRefusal, type CreationContext } from "@/lib/api-core/biz/order-creation/policy";

export function manualDraftReceipt(context: CreationContext, draftId: string) {
  return `biz-manual:${context.actorId}:${context.workspace.workspace === "vendor" ? context.workspace.vendor.id : "platform"}:${draftId}`;
}
export async function findManualOrderReceipt(operationId: string) {
  return Order.findOne({ bizOperationId: operationId }).lean<IOrder | null>();
}

/** The primary effect is one transaction: quote claim, exact stock, order, charge and birth audit. */
export async function commitBizManualOrder(context: CreationContext, request: ManualOrderCreateRequest, operation: BizOperationExecution, audit: AuditContext) {
  const existing = await findManualOrderReceipt(operation.id);
  if (existing) return existing;
  try {
    // Allocate identities before the transaction and remember them before effects.
    const checkpoint = operation.checkpoint || {};
    const prepared = await prepareManualOrder(context, request.draft);
    const orderId = typeof checkpoint.orderId === "string" ? checkpoint.orderId : String(new Types.ObjectId());
    const customerId = prepared.customer.customerId || (typeof checkpoint.guestId === "string" ? checkpoint.guestId : String(new Types.ObjectId()));
    const orderNumber = typeof checkpoint.orderNumber === "string" ? checkpoint.orderNumber : await getNextOnlineOrderNumber(prepared.settings.orders?.prefix);
    const placedAt = typeof checkpoint.placedAt === "string" ? checkpoint.placedAt : new Date().toISOString();
    await operation.remember({ ...checkpoint, orderId, guestId: customerId, orderNumber, placedAt });
    return await manualCreationTransaction(operation, "business manual order creation", async () => {
      const session = financeSession()!;
      const recovered = await Order.findOne({ bizOperationId: operation.id }).session(session).lean();
      if (recovered) return recovered;
      const draftReceipt = manualDraftReceipt(context, request.draft.draftId);
      if (await Order.exists({ idempotencyKey: draftReceipt }).session(session)) creationRefusal("QUOTE_CHANGED", "This draft has already created an order. Reconcile the original attempt.");
      const quote = await claimBizQuote({ token: request.quoteToken, binding: draftQuoteBinding(context, request.draft), purpose: "manual_order", operationId: operation.id, session });
      if (quote.expiresAt.getTime() <= Date.now()) creationRefusal("QUOTE_EXPIRED", "The quote expired. Review a new quote.");
      const current = await prepareManualOrder(context, request.draft, session);
      if (quote.snapshot.signature !== current.signature) creationRefusal("QUOTE_CHANGED", "Prices or options changed. Review a new quote.");
      if (request.recordPayment && !current.payment.canRecordPayment) creationRefusal("PAYMENT_RECORDING_NOT_ALLOWED", "This method cannot record a payment.", 403);
      // Lock live policy rows against concurrent edits without changing their public versions.
      const policyLock = await Settings.updateOne({ _id: current.settings._id, updatedAt: current.settings.updatedAt }, { $inc: { __v: 1 } }, { session, timestamps: false });
      if (!policyLock.matchedCount) creationRefusal("QUOTE_CHANGED", "Store policy changed.");
      for (const vendor of new Map(current.lines.map((line) => [String(line.owner._id), line.owner])).values()) {
        const locked = await Vendor.updateOne({ _id: vendor._id, updatedAt: vendor.updatedAt }, { $inc: { __v: 1 } }, { session, timestamps: false });
        if (!locked.matchedCount) creationRefusal("QUOTE_CHANGED", "Seller policy changed.");
      }
      if (current.location) {
        const locked = await InventoryLocation.updateOne({ _id: current.location._id, updatedAt: current.location.updatedAt }, { $inc: { __v: 1 } }, { session, timestamps: false });
        if (!locked.matchedCount) creationRefusal("QUOTE_CHANGED", "Location policy changed.");
      }
      for (const product of new Map(current.lines.map((line) => [line.productId, line.product])).values()) {
        const locked = await Product.updateOne({ $and: [{ _id: product._id, updatedAt: product.updatedAt }, productScopeFilter(context.scope)] }, { $inc: { __v: 1 } }, { session, timestamps: false });
        if (!locked.matchedCount) creationRefusal("QUOTE_CHANGED", "A product changed.");
      }
      for (const [index, line] of current.lines.entries()) {
        if (!line.tracksStock) continue;
        const stock = await applyBizStockEffect({ effectKey: operation.effectKey, leg: `line-${index}`, productId: line.productId,
          variantId: line.variantId, locationId: request.draft.locationId, quantity: -line.quantity,
          allowOversell: line.allowOversell, scopeFilter: productScopeFilter(context.scope), session });
        if (!stock.success) creationRefusal("INSUFFICIENT_STOCK", "Selected stock is no longer available.");
      }
      const groups = new Map<string, typeof current.lines>();
      for (const line of current.lines) {
        const id = String(line.owner._id); groups.set(id, [...(groups.get(id) || []), line]);
      }
      const subOrders = await buildVendorSubOrders(groups, {
        currency: current.options.currency, vendors: Promise.resolve(current.vendors),
        codCollectedByDefault: current.settings.shipping?.codCollectedBy,
        fallbackCommissionPercent: current.settings.orders?.commission?.vendorRate ?? DEFAULT_VENDOR_COMMISSION_RATE,
        getProductId: (line) => new Types.ObjectId(line.productId), getVariantId: (line) => line.variantId ? new Types.ObjectId(line.variantId) : undefined,
        getName: (line) => line.name, getSku: (line) => line.sku, getPrice: (line) => line.price,
        getCost: (line) => line.cost, getQuantity: (line) => line.quantity, getImage: (line) => line.image, status: "pending",
      });
      allocateSubOrderShipping(subOrders, { vendorShippingCosts: new Map(), orderShippingCost: current.totals.shippingCost, currency: current.options.currency });
      const paidAt = request.recordPayment ? new Date(placedAt) : undefined;
      const paymentStatus = paidAt ? "paid" : "pending";
      const savedSubs = subOrders.map((sub) => ({ ...sub, inventoryReserved: true, paymentStatus,
        ...(paidAt ? { paidAt, paymentCollectedBy: context.actorId } : {}),
        fulfillment: current.delivery.kind === "pickup" ? { method: "pickup", pickup: {
          vendorId: sub.vendorId, pickupLocationId: request.draft.locationId, pickupLocationName: current.location!.name,
          pickupAddress: current.location!.address, pickupArea: current.location!.pickupArea,
          instructions: current.location!.instructions, status: "scheduled" } }
          : { method: "delivery", ...(current.location ? { fulfillmentLocationId: current.location._id, fulfillmentLocationName: current.location.name } : {}) },
      }));
      const [order] = await Order.create([{
        _id: orderId, orderNumber, idempotencyKey: draftReceipt, bizOperationId: operation.id,
        bizQuoteHash: createHash("sha256").update(request.quoteToken).digest("hex"), currency: current.options.currency,
        customerId, ...(current.customer.guestEmail ? { guestEmail: current.customer.guestEmail } : {}),
        items: current.lines.map((line) => ({ productId: line.productId, variantId: line.variantId, vendorId: line.owner._id,
          name: line.name, sku: line.sku, quantity: line.quantity, price: line.price, cost: line.cost, image: line.image })),
        subOrders: savedSubs, shippingAddress: current.shippingAddress, billingAddress: current.billingAddress,
        paymentMethod: current.payment.id, paymentStatus, ...(current.payment.custody === "platform" ? { paymentCustody: "platform" } : {}),
        ...(paidAt ? { paidAt } : {}), ...current.totals, status: "pending", channel: "online", staffId: context.actorId,
        notes: request.draft.notes, createdAt: new Date(placedAt),
      }], { session });
      if (!await Order.exists({ $and: [{ _id: order._id }, orderScopeFilter(context.scope)] }).session(session)) {
        creationRefusal("CUSTOMER_NOT_ALLOWED", "The resulting order would be outside your assigned scope.", 403);
      }
      if (paidAt) {
        await PaymentTransaction.create([{
          orderId: order._id, orderNumber, ...(context.workspace.workspace === "vendor" ? { vendorId: context.workspace.vendor.id } : {}),
          bizOperationId: operation.id, bizOperationLeg: "manual-charge", type: "charge", status: "succeeded",
          provider: getPaymentProviderFromOrder({ _id: String(order._id), orderNumber, paymentMethod: order.paymentMethod }), paymentMethod: order.paymentMethod,
          currency: order.currency, grossAmount: order.total, netAmount: order.total, feeAmount: 0, refundedAmount: 0,
          metadata: { subtotal: order.subtotal, shippingCost: order.shippingCost, tax: order.tax, discount: order.discount,
            source: "biz-manual-order", channel: "online", custody: current.payment.custody, collectedBy: context.actorId,
            ...(request.recordPayment?.reference ? { reference: request.recordPayment.reference } : {}) }, createdAt: paidAt,
        }], { session });
      }
      await auditOrderPlaced(audit, order, { source: context.workspace.workspace === "vendor" ? "vendor" : "admin",
        total: order.total, currency: order.currency, itemCount: order.items.length, paymentMethod: order.paymentMethod });
      return order.toObject();
    });
  } catch (error) {
    // A validation callback error means runTransaction aborted ALL primary effects.
    // Commit/network uncertainty never enters this branch.
    if ((!operation.checkpoint?.primaryStarted || operation.checkpoint.primaryAborted) && error instanceof MobileApiError && [400, 403, 409].includes(error.status)) {
      throw new DefiniteOperationFailure({ status: error.status,
        code: error.status === 409 ? "CONFLICT" : "VALIDATION_ERROR", message: error.message, reason: error.options.reason });
    }
    throw error;
  }
}

/** Retryable derived effects; receipts/claims in their real services prevent duplication. */
export async function recoverManualOrderEffects(order: NonNullable<Awaited<ReturnType<typeof findManualOrderReceipt>>>, operation: BizOperationExecution) {
  const checkpoint = operation.checkpoint || {};
  const lines = order.items.map((item) => ({ productId: String(item.productId), variantId: item.variantId ? String(item.variantId) : undefined, quantity: item.quantity }));
  const productIds = [...new Set(lines.map((line) => line.productId))];
  // Cache/syndication work follows the commit; the established hourly repair
  // remains the fallback for these non-consequential derived updates.
  try {
    const products = await Product.find({ _id: { $in: productIds } }).select("_id slug stock variants._id variants.stock inventory shipping vendorId").lean();
    revalidateProductStock({ slugs: products.map((product) => product.slug),
      availabilityChanged: stockMovementChangesAvailability(lines, products, -1) });
  } catch (error) {
    console.error("Failed to invalidate storefront stock after a business order:", error);
  }
  await markForMetaCatalog(productIds);
  if (order.paymentStatus === "paid") {
    // Ledger rows and collection receipts have deterministic domain keys.
    await withStrictLedger(() => postOrderPaid(order._id));
    await awardOrderLoyaltyPoints(String(order._id));
    await refreshCustomerStatsForOrder(order);
  }
  if (!checkpoint.notificationsDone) {
    await notifyOrderCreatedParticipants(order, { requireOutbox: true });
    await operation.remember({ ...checkpoint, notificationsDone: true }, [{ kind: "order", id: String(order._id) }]);
  }
}
