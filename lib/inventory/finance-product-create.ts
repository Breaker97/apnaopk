import "server-only";
import type { HydratedDocument } from "mongoose";
import type { IProduct } from "@/types";
import { Product } from "@/models/product.model";
import { InventoryPosition } from "@/models/inventory-position.model";
import { runFinanceOperation } from "@/lib/finance/operations";
import { financeQuery, financeSession } from "@/lib/finance/transaction";
import { ApiError } from "@/lib/api/errors";
import { getDefaultVendorIds } from "@/lib/finance/post-events";
import { financialStockRows, physicalFinancialProduct } from "./finance-catalog";
import { receiveFinancialInventory } from "./finance-actions";
import { withInventoryWrite } from "./finance-context";

export interface InitialStockReceipt { payment: "paid" | "unpaid" | "already_recorded"; paidFrom?: "bank" | "cash" | "gateway"; paymentDate?: string; expenseId?: string; expenseRevision?: number; note?: string; }
/** One durable create request owns every initial received row and funding link. */
export async function createProductWithReceivedStock(product: HydratedDocument<IProduct>, receipt: InitialStockReceipt, actorId: string, requestKey: string, fingerprint: unknown) {
  if (!(await getDefaultVendorIds()).has(String(product.vendorId)) || !physicalFinancialProduct(product.toObject())) throw new ApiError("Funded initial stock is for own-store tracked physical products.", 400, "INVENTORY_OWNER_MISMATCH");
  const rows = financialStockRows(product.toObject());
  if (rows.some((r) => r.quantity < 0 || !Number.isSafeInteger(r.quantity) || (r.quantity && r.unitCost === null))) throw new ApiError("Initial received stock needs whole quantities and recorded fixed costs.", 400, "RECEIPT_COST_REQUIRED");
  return runFinanceOperation({ action: "inventory:product-create", actorId, requestKey, fingerprint, work: async () => {
    product.isNew = true;
    product.stock = 0;
    for (const location of product.locationInventory ?? []) location.quantity = 0;
    for (const variant of product.variants ?? []) { variant.stock = 0; for (const location of variant.locationInventory ?? []) location.quantity = 0; }
    await withInventoryWrite({ reason: "opening", sourceKind: "product", sourceId: String(product._id), actorId, channel: "web" }, () => product.save({ session: financeSession() }));
    const operationIds: string[] = [];
    for (const [index, row] of rows.entries()) if (row.quantity) {
      const position = await financeQuery(InventoryPosition.findOne({ productId: product._id, variantId: row.variantId, locationId: row.locationId }));
      if (!position) throw new ApiError("Opening position was not initialized.", 409, "INVENTORY_NOT_INITIALIZED");
      const result = await receiveFinancialInventory({ ...receipt, note: receipt.note ?? "Initial stock received", productId: String(product._id), ...(row.variantId ? { variantId: row.variantId } : {}), ...(row.locationId ? { locationId: row.locationId } : {}), quantity: row.quantity, actualUnitPrice: row.unitCost!, expectedVersion: position.version }, actorId, `${requestKey}:${index}`);
      if ("operationId" in result) operationIds.push(result.operationId);
    }
    const saved = await financeQuery(Product.findById(product._id)).lean();
    return { result: { product: saved, operationIds }, postings: [], sourceId: String(product._id), vendorId: String(product.vendorId) };
  } });
}

/** Opening creation has the same durable response contract as received stock. */
export async function createProductWithOpeningStock(product: HydratedDocument<IProduct>, actorId: string, requestKey: string, fingerprint: unknown) {
  return runFinanceOperation({ action: "inventory:product-create", actorId, requestKey, fingerprint, work: async () => {
    product.isNew = true;
    await withInventoryWrite({ reason: "opening", sourceKind: "product", sourceId: String(product._id), actorId, channel: "web" }, () => product.save({ session: financeSession() }));
    const { InventoryMovement } = await import("@/models/inventory-movement.model");
    const { FinanceOperation } = await import("@/models/finance-operation.model");
    const movements = await financeQuery(InventoryMovement.find({ productId: product._id }).select("_id")).lean();
    const children = await financeQuery(FinanceOperation.find({ action: "inventory:movement", sourceId: { $in: movements.map((m) => String(m._id)) } }).select("_id")).lean();
    return { result: { product: product.toObject(), operationIds: children.map((op) => String(op._id)) }, postings: [], sourceId: String(product._id), vendorId: String(product.vendorId) };
  } });
}
