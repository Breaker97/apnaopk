import { financeQuery, financeSession } from "./transaction";
import "server-only";
import { Types } from "mongoose";
import { CollectionReceipt } from "@/models/collection-receipt.model";
import { Order } from "@/models/order.model";
import { quantizeToCurrency } from "@/lib/intl/money";
import { orderCreditCounted } from "@/lib/store-credit/order-credit";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { decomposeOrder, isConsignmentCollected, type PostingOrder } from "./postings";

type CollectionOrder = PostingOrder & { preorderPaymentMode?: string; preorderBalancePaidAmount?: number; preorderBalancePaymentIntentId?: string };
export function collectionReceipts(order: CollectionOrder) {
  const currency = String(order.currency || "USD").toUpperCase();
  const q = (amount: number) => quantizeToCurrency(Math.max(0, amount), currency);
  const firstAt = order.paidAt ?? order.createdAt;
  const base = { orderId: new Types.ObjectId(String(order._id)), currency, reference: order.orderNumber, quality: order.paidAt ? "recorded" : "legacy-estimate" };
  const receipts: Array<typeof base & { key: string; purpose: string; amount: number; collectedAt: Date; method: string; custodian: string; consignmentId?: unknown; vendorId?: unknown }> = [];
  const balance = order.preorderBalancePaidAt ? Number(order.preorderBalancePaidAmount ?? order.preorderOutstandingAmount ?? 0) : 0;
  const checkout = q(Number(order.total || 0) - Number(order.preorderOutstandingAmount || 0) - orderCreditCounted(order));
  const paid = ["paid", "partially_paid", "partially_refunded", "refunded"].includes(order.paymentStatus || "");
  if (order.paymentMethod === "cod") {
    const split = decomposeOrder(order);
    for (const [index, sub] of (order.subOrders || []).entries()) {
      if (!isConsignmentCollected(order, sub)) continue;
      const share = split?.shares[index];
      const at = sub.paidAt ?? firstAt;
      if (!share || !at) continue;
      receipts.push({ ...base, key: `collection:${order._id}:cod:${sub._id}`, consignmentId: sub._id, vendorId: sub.vendorId, purpose: "cod", amount: q(share.merchandise + share.shipping + share.tax + share.duty - share.storeCredit), method: "cod", custodian: isPlatformSettled(order, sub) ? "platform" : "vendor", collectedAt: new Date(at), quality: sub.paidAt ? "recorded" : "legacy-estimate" });
    }
  } else if (paid && firstAt && checkout > 0 && order.preorderPaymentMode !== "pay_later") {
    receipts.push({ ...base, key: `collection:${order._id}:checkout`, purpose: order.preorderOutstandingAmount ? "deposit" : ["cash", "manual", "manual_pending"].includes(order.paymentMethod || "") ? "offline" : "checkout", amount: checkout, method: order.paymentMethod || "manual", custodian: isPlatformSettled(order) ? "platform" : "vendor", collectedAt: new Date(firstAt) });
  }
  if (balance > 0 && order.preorderBalancePaidAt) receipts.push({ ...base, key: `collection:${order._id}:balance`, purpose: "balance", amount: q(balance), method: order.preorderBalancePaidFrom && order.preorderBalancePaidFrom !== "gateway" ? order.preorderBalancePaidFrom : order.paymentMethod || "manual", custodian: "platform", collectedAt: new Date(order.preorderBalancePaidAt), reference: order.preorderBalancePaymentIntentId || order.orderNumber, quality: order.preorderBalancePaidAmount === undefined ? "legacy-estimate" : "recorded" });
  return receipts.filter((receipt) => receipt.amount > 0);
}

export async function recordOrderCollections(id: unknown) {
  const order = await financeQuery(Order.findById(id)).lean();
  if (!order) return;
  const receipts = collectionReceipts(order as CollectionOrder);
  if (receipts.length) await CollectionReceipt.bulkWrite(receipts.map((receipt) => ({ updateOne: { filter: { key: receipt.key }, update: { $setOnInsert: receipt }, upsert: true } })), { session: financeSession() });
}

/** Canonical captures, with explicitly estimated fallback for pre-migration orders. */
export async function collectionTotals(period: { from: Date; to: Date }, currency: string) {
  const buckets = new Map<string, { _id: string; count: number; total: number }>();
  const rows = await CollectionReceipt.aggregate<{ _id: string; count: number; total: number }>([
    { $match: { currency, collectedAt: { $gte: period.from, $lte: period.to } } },
    { $group: { _id: "$method", count: { $sum: 1 }, total: { $sum: "$amount" } } },
  ]);
  for (const row of rows) buckets.set(row._id, row);
  let estimatedReceipts = 0;
  let cursor: unknown;
  for (;;) {
    const legacy = await Order.find({ ...(cursor ? { _id: { $gt: cursor } } : {}), $and: [
      { $or: [{ currency }, { currency: { $exists: false } }, { currency: null }, { currency: "" }] },
      { $or: [{ paidAt: { $gte: period.from, $lte: period.to } }, { preorderBalancePaidAt: { $gte: period.from, $lte: period.to } }, { "subOrders.paidAt": { $gte: period.from, $lte: period.to } }, { paidAt: null, createdAt: { $gte: period.from, $lte: period.to } }] },
    ] }).sort({ _id: 1 }).limit(500).lean();
    if (!legacy.length) break;
    const persisted = await CollectionReceipt.find({ orderId: { $in: legacy.map((order) => order._id) } }).select("key").lean();
    const keys = new Set(persisted.map((receipt) => receipt.key));
    for (const order of legacy) for (const receipt of collectionReceipts({ ...order, currency: order.currency || currency } as CollectionOrder)) {
      if (keys.has(receipt.key) || receipt.collectedAt < period.from || receipt.collectedAt > period.to) continue;
      estimatedReceipts++;
      const bucket = buckets.get(receipt.method) || { _id: receipt.method, count: 0, total: 0 };
      bucket.count++; bucket.total += receipt.amount; buckets.set(receipt.method, bucket);
    }
    cursor = legacy.at(-1)!._id;
  }
  const paymentMethods = [...buckets.values()].map((row) => ({ ...row, total: quantizeToCurrency(row.total, currency) }));
  return { paidRevenue: quantizeToCurrency(paymentMethods.reduce((sum, row) => sum + row.total, 0), currency), paymentMethods, estimatedReceipts };
}
