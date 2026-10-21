import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Product, Order } from "@/models";
import { InventoryMovement } from "@/models/inventory-movement.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { financeQuery, financeSession, financeTransaction } from "@/lib/finance/transaction";
import { finishFinanceOperation } from "@/lib/finance/operations";
import { processSingleton } from "@/lib/process-singleton";
const sourceTransition = processSingleton("inventory:source-transition", () => new AsyncLocalStorage<boolean>());
export const financialSourceTransitionActive = () => sourceTransition.getStore() === true;

/** Legacy stock keeps its existing lifecycle until the separately scheduled migration. */
export async function withFinancialStockTransaction<T>(ids: string[], sourceId: string, work: () => Promise<T>): Promise<T> {
  if (financialSourceTransitionActive() || financeSession() || typeof Product.exists !== "function") return sourceTransition.run(true, work);
  const active = await Product.exists({ _id: { $in: ids }, inventoryFinanceGeneration: 1 });
  if (!active) return sourceTransition.run(true, work);
  const value = await financeTransaction("Inventory source transition", () => sourceTransition.run(true, work));
  const movements = await InventoryMovement.find({ "source.id": sourceId }).select("_id").lean();
  const operations = await FinanceOperation.find({ state: "pending", sourceId: { $in: movements.map((m) => String(m._id)) } }).select("_id").lean();
  for (const op of operations) await finishFinanceOperation(op._id);
  return value;
}
export async function withFinancialOrderTransaction<T>(orderId: string, work: () => Promise<T>): Promise<T> {
  if (financialSourceTransitionActive() || financeSession() || typeof Order.findById !== "function") return sourceTransition.run(true, work);
  const order = await financeQuery(Order.findById(orderId)).select("items.productId items.inventoryFinanceGeneration").lean();
  if (!(order?.items ?? []).some((item: { inventoryFinanceGeneration?: number }) => item.inventoryFinanceGeneration === 1)) return sourceTransition.run(true, work);
  return withFinancialStockTransaction((order.items ?? []).map((item: { productId: unknown }) => String(item.productId)), orderId, work);
}
