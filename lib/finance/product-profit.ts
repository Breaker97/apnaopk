import { completedInventoryPostingEvidence } from "./inventory-posting-evidence";
import "server-only";
import { Types } from "mongoose";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { Order } from "@/models/order.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { ReturnRequest } from "@/models/return-request.model";
import { InventorySaleAllocation } from "@/models/inventory-allocation.model";
import { InventoryMovement } from "@/models/inventory-movement.model";
import { InventoryCostSource } from "@/models/inventory-cost-source.model";
import { quantizeToCurrency } from "@/lib/intl/money";
import type { OrderItem } from "@/types";
import type { ReturnRequestItem } from "@/models/return-request.model";
import type { FinancePeriod } from "./reports";

export interface ProductProfit {
  currency: string;
  netSalesWithCost: number;
  netSalesWithoutCost: number;
  productCostOfGoods: number;
  grossProfit: number;
  deferredQuantity: number;
  unattributedRefunds: number;
  basis: "original_order_cost";
}

/** Split posted product money by original lines; never use today's catalog cost. */
export async function getProductProfit(period: FinancePeriod): Promise<ProductProfit[]> {
  const rows = await LedgerEntry.aggregate<{ _id: { currency: string; vendorId: unknown; kind: string; sourceId: unknown }; sales: number; refunds: number; costs: number }>([
    { $match: { book: "own", date: { $gte: period.from, $lte: period.to }, $or: [{ credit: "product_revenue" }, { debit: "product_revenue" }, { debit: "refunds" }, { credit: "refunds" }, { debit: "cost_of_goods" }, { credit: "cost_of_goods" }] } },
    { $group: { _id: { currency: "$currency", vendorId: "$vendorId", kind: "$source.kind", sourceId: "$source.id" }, sales: { $sum: { $subtract: [{ $cond: [{ $eq: ["$credit", "product_revenue"] }, "$amount", 0] }, { $cond: [{ $eq: ["$debit", "product_revenue"] }, "$amount", 0] }] } }, refunds: { $sum: { $subtract: [{ $cond: [{ $eq: ["$debit", "refunds"] }, "$amount", 0] }, { $cond: [{ $eq: ["$credit", "refunds"] }, "$amount", 0] }] } }, costs: { $sum: { $subtract: [{ $cond: [{ $eq: ["$debit", "cost_of_goods"] }, "$amount", 0] }, { $cond: [{ $eq: ["$credit", "cost_of_goods"] }, "$amount", 0] }] } } } },
  ]);
  const totals = new Map<string, ProductProfit>();
  const ensure = (currency: string) => {
    let result = totals.get(currency);
    if (!result) { result = { currency, netSalesWithCost: 0, netSalesWithoutCost: 0, productCostOfGoods: 0, grossProfit: 0, deferredQuantity: 0, unattributedRefunds: 0, basis: "original_order_cost" }; totals.set(currency, result); }
    return result;
  };
  // Bounded source batches keep $in queries and retained order documents small.
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const sourceIds = batch.map((r) => r._id.sourceId).filter((id) => Types.ObjectId.isValid(String(id)));
    const transactions = await PaymentTransaction.find({ _id: { $in: sourceIds } }).select("orderId metadata").lean();
    const orderIds = [...sourceIds, ...transactions.map((t) => t.orderId).filter(Boolean)];
    const [orders, returns, allocations, sources] = await Promise.all([
      Order.find({ _id: { $in: orderIds } }).select("items subOrders.vendorId subOrders.items").lean(),
      ReturnRequest.find({ "actualRefund.paymentTransactionId": { $in: sourceIds } }).select("actualRefund items.orderItemIndex items.quantityApproved items.quantityRequested").lean(),
      InventorySaleAllocation.aggregate<{ _id: { orderId: unknown; lineId: string }; quantity: number }>([
        { $match: { orderId: { $in: orderIds } } }, { $unwind: "$segments" },
        ...completedInventoryPostingEvidence("$segments.movementId"),
        { $lookup: { from: InventoryMovement.collection.name, localField: "segments.movementId", foreignField: "_id", as: "movement" } },
        { $match: { "movement.accountingAt": { $lte: period.to } } },
        { $group: { _id: { orderId: "$orderId", lineId: "$lineId" }, quantity: { $sum: "$segments.quantity" } } },
      ]),
      InventoryCostSource.aggregate<{ orderId: unknown; lineId: string; quantity: number }>([{ $match: { orderId: { $in: orderIds }, accountingAt: { $lte: period.to } } }, ...completedInventoryPostingEvidence("$_id")]),
    ]);
    const recognized = new Map<string, number>();
    for (const a of allocations) recognized.set(`${a._id.orderId}:${a._id.lineId}`, a.quantity);
    for (const s of sources) { const key = `${s.orderId}:${s.lineId}`; recognized.set(key, (recognized.get(key) ?? 0) + s.quantity); }
    for (const row of batch) {
      const result = ensure(row._id.currency); result.productCostOfGoods += row.costs;
      if (!row.sales && !row.refunds) continue;
      const transaction = transactions.find((t) => String(t._id) === String(row._id.sourceId));
      const order = orders.find((o) => String(o._id) === String(transaction?.orderId ?? row._id.sourceId));
      const sub = order?.subOrders?.find((s: { vendorId: unknown }) => String(s.vendorId) === String(row._id.vendorId));
      const returned = returns.find((r) => String(r.actualRefund?.paymentTransactionId) === String(row._id.sourceId));
      const frozen = transaction?.metadata?.inventoryRefundLines as Array<{ lineId: string; quantity: number }> | undefined;
      const refundedLines: Array<{ lineId: string | undefined; quantity: number }> | undefined = frozen?.length ? frozen : returned?.items?.map((item: ReturnRequestItem) => ({ lineId: order?.items?.[item.orderItemIndex]?.inventoryLineId, quantity: item.quantityApproved ?? item.quantityRequested }));
      let all = 0, costed = 0;
      for (const item of (sub?.items ?? []) as OrderItem[]) {
        const quantity = row.refunds && refundedLines ? refundedLines.filter((line) => line.lineId === item.inventoryLineId).reduce((sum, line) => sum + line.quantity, 0) : item.quantity;
        const value = Math.max(0, item.price) * Math.max(0, quantity);
        const known = item.cost != null && Number.isFinite(item.cost) && item.cost >= 0;
        const share = item.inventoryFinanceGeneration ? Math.min(1, (recognized.get(`${order!._id}:${item.inventoryLineId}`) ?? 0) / Math.max(1, item.quantity)) : known ? 1 : 0;
        all += value; costed += value * share;
        if (row.sales && item.inventoryFinanceGeneration === 1 && known) result.deferredQuantity += Math.max(0, item.quantity - (recognized.get(`${order!._id}:${item.inventoryLineId}`) ?? 0));
      }
      const share = all ? costed / all : 0;
      result.netSalesWithCost += (row.sales - row.refunds) * share;
      result.netSalesWithoutCost += (row.sales - row.refunds) * (1 - share);
      if (row.refunds && !order) result.unattributedRefunds += row.refunds;
    }
  }
  return [...totals.values()].map((r) => ({ ...r, netSalesWithCost: quantizeToCurrency(r.netSalesWithCost, r.currency), netSalesWithoutCost: quantizeToCurrency(r.netSalesWithoutCost, r.currency), productCostOfGoods: quantizeToCurrency(r.productCostOfGoods, r.currency), grossProfit: quantizeToCurrency(r.netSalesWithCost - r.productCostOfGoods, r.currency) }));
}
