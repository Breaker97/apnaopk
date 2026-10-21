import { InventoryReceiptCorrectionRequest } from "@/contracts/mobile/biz/v1/inventory-finance";
import { correctUnusedReceipt } from "@/lib/inventory/finance-receipt-corrections";
import { InventoryCostSourceRequest, InventoryCostSourceResult } from "@/contracts/mobile/biz/v1/inventory-finance";
import { linkNonphysicalCost } from "@/lib/inventory/finance-cost-sources";
import { createHash } from "node:crypto";
import { InventoryAdjustmentRequest, InventoryReceiptRequest, InventoryRevaluationRequest, InventoryFinanceQuery, InventoryFinanceMutation, InventoryFinanceValuation, InventoryFinanceHistory, InventoryPostingRepairRequest, InventoryPostingRepair } from "@/contracts/mobile/biz/v1/inventory-finance";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { productScopeFilter, staffLocationIds } from "@/lib/api-core/biz/scope";
import { defineBizRoute } from "@/lib/api-core/registry";
import { idempotencyScope } from "@/lib/api-core/pipeline";
import { MobileApiError } from "@/lib/api-core/errors";
import { adjustFinancialInventory, receiveFinancialInventory, revalueFinancialInventory } from "@/lib/inventory/finance-actions";
import { inventoryValuationReport, inventoryMovementHistory } from "@/lib/inventory/finance-reports";
import { retryInventoryPosting } from "@/lib/inventory/finance-recovery";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import type { ApiError } from "@/lib/api/errors";

// Mobile IDs are scoped to the operator AND device, matching the pipeline's receipt.
const key = (value: string) => createHash("sha256").update(value).digest("hex");
async function mutation<T>(work: () => Promise<T>, preview?: boolean) {
  try { const result = await work(); if (!preview) revalidateProductContent(); return result; }
  catch (error) { if ((error as ApiError).code === "REQUEST_KEY_CONFLICT") throw new MobileApiError(422, "IDEMPOTENCY_KEY_REUSED", "This key was used for a different inventory change."); throw error; }
}
// Mobile's shared contract omits null fields; Dates are transmitted as ISO strings.
function wire<T>(value: T): T { return JSON.parse(JSON.stringify(value, (_, item) => item === null ? undefined : item)) as T; }
export const inventoryReceiptRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:write", preset: "moderate" }, demo: "default", idempotency: "required", ...BIZ_ACCESS.FINANCE_INVENTORY_WRITE, id: "inventory.receipts", method: "POST", path: "/inventory/receipts", input: InventoryReceiptRequest, output: InventoryFinanceMutation,
  handler: async ({ input, session, client }) => mutation(() => receiveFinancialInventory(input, session.user.id, key(`${idempotencyScope(session, client)}:${client.idempotencyKey}`)), input.preview),
});
export const inventoryAdjustmentRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:write", preset: "moderate" }, demo: "default", idempotency: "required", ...BIZ_ACCESS.COUNT_OWN_INVENTORY, id: "inventory.adjustments", method: "POST", path: "/inventory/adjustments", input: InventoryAdjustmentRequest, output: InventoryFinanceMutation,
  handler: async ({ input, scope, session, client }) => mutation(() => adjustFinancialInventory(input, session.user.id, key(`${idempotencyScope(session, client)}:${client.idempotencyKey}`), { productFilter: productScopeFilter(scope), ...(staffLocationIds(scope).length ? { locationIds: new Set(staffLocationIds(scope)) } : {}) }), input.preview),
});
export const inventoryRevaluationRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:write", preset: "moderate" }, demo: "default", idempotency: "required", ...BIZ_ACCESS.FINANCE_INVENTORY_WRITE, id: "inventory.valuation-changes", method: "POST", path: "/inventory/valuation-changes", input: InventoryRevaluationRequest, output: InventoryFinanceMutation,
  handler: async ({ input, session, client }) => mutation(() => revalueFinancialInventory(input, session.user.id, key(`${idempotencyScope(session, client)}:${client.idempotencyKey}`)), input.preview),
});
export const inventoryValuationRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:read", preset: "lenient" }, ...BIZ_ACCESS.VIEW_OWN_INVENTORY, id: "inventory.valuation", method: "GET", path: "/inventory/valuation", input: InventoryFinanceQuery, output: InventoryFinanceValuation,
  handler: async ({ input, scope }) => InventoryFinanceValuation.parse(wire(await inventoryValuationReport({ ...input, ...(input.from ? { from: new Date(input.from) } : { from: undefined }), asOf: input.asOf ? new Date(input.asOf) : new Date(), productFilter: productScopeFilter(scope), locationIds: staffLocationIds(scope) }))),
});
export const inventoryMovementsRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:read", preset: "lenient" }, ...BIZ_ACCESS.VIEW_OWN_INVENTORY, id: "inventory.movements", method: "GET", path: "/inventory/movements", input: InventoryFinanceQuery, output: InventoryFinanceHistory,
  handler: async ({ input, scope }) => InventoryFinanceHistory.parse(wire(await inventoryMovementHistory({ ...input, ...(input.from ? { from: new Date(input.from) } : { from: undefined }), asOf: input.asOf ? new Date(input.asOf) : new Date(), productFilter: productScopeFilter(scope), locationIds: staffLocationIds(scope) }))),
});
export const inventoryReconciliationRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:read", preset: "lenient" }, ...BIZ_ACCESS.FINANCE_INVENTORY, id: "finance.inventory-reconciliation", method: "GET", path: "/finance/inventory-reconciliation", input: InventoryFinanceQuery, output: InventoryFinanceValuation,
  handler: async ({ input }) => InventoryFinanceValuation.parse(wire(await inventoryValuationReport({ ...input, ...(input.from ? { from: new Date(input.from) } : { from: undefined }), asOf: input.asOf ? new Date(input.asOf) : new Date() }))),
});
export const inventoryRepairRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:write", preset: "moderate" }, demo: "default", idempotency: "required", ...BIZ_ACCESS.FINANCE_INVENTORY_WRITE, id: "finance.inventory-reconciliation.repairs", method: "POST", path: "/finance/inventory-reconciliation/repairs", input: InventoryPostingRepairRequest, output: InventoryPostingRepair,
  handler: async ({ input }) => retryInventoryPosting(input),
});
export const inventoryCostSourceRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:write", preset: "moderate" }, demo: "default", idempotency: "required", ...BIZ_ACCESS.FINANCE_INVENTORY_WRITE, id: "inventory.cost-sources", method: "POST", path: "/inventory/cost-sources", input: InventoryCostSourceRequest, output: InventoryCostSourceResult,
  handler: async ({ input, session, client }) => mutation(() => linkNonphysicalCost(input, session.user.id, key(`${idempotencyScope(session, client)}:${client.idempotencyKey}`))),
});
export const inventoryReceiptCorrectionRoute = defineBizRoute({
  auth: "user", cache: { kind: "private" }, rateLimit: { bucket: "biz:inventory:finance:write", preset: "moderate" }, demo: "default", idempotency: "required", ...BIZ_ACCESS.FINANCE_INVENTORY_WRITE, id: "inventory.receipt-corrections", method: "POST", path: "/inventory/receipt-corrections", input: InventoryReceiptCorrectionRequest, output: InventoryFinanceMutation,
  handler: async ({ input, session, client }) => mutation(() => correctUnusedReceipt(input, session.user.id, key(`${idempotencyScope(session, client)}:${client.idempotencyKey}`)), input.preview),
});
export const inventoryFinanceRoutes = [inventoryReceiptCorrectionRoute, inventoryCostSourceRoute, inventoryReceiptRoute, inventoryAdjustmentRoute, inventoryRevaluationRoute, inventoryValuationRoute, inventoryMovementsRoute, inventoryReconciliationRoute, inventoryRepairRoute];
