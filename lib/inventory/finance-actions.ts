import "server-only";
import { Types } from "mongoose";
import { Product } from "@/models/product.model";
import { Expense } from "@/models/expense.model";
import { InventoryPosition } from "@/models/inventory-position.model";
import { InventoryFundingAllocation } from "@/models/inventory-allocation.model";
import { InventoryLocation } from "@/models/inventory-location.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { getDefaultVendorIds } from "@/lib/finance/post-events";
import { expensePostings } from "@/lib/finance/postings";
import { financeQuery, financeSession, financeTransaction } from "@/lib/finance/transaction";
import { finishFinanceOperation, replayFinanceRequest } from "@/lib/finance/operations";
import { ApiError, NotFoundError } from "@/lib/api/errors";
import { EXPENSE_CATEGORY } from "@/lib/finance/expense-categories";
import { applyStockChangeAtomic } from "./inventory";
import { runInventoryMutation, type InventoryScope } from "./finance-service";
import { inventoryPositionKey } from "./finance-position";
import { protectedPhysicalStates } from "./finance-physical-states";
import { withInventoryWrite } from "./finance-context";
import { financialStockRows, type FinancialProduct } from "./finance-catalog";
import { inventoryAdjustmentDelta, inventoryCost, inventoryLineValue, inventoryMoney, inventoryProportionalAmount, inventoryValuePostings, receiptVariancePostings } from "./finance-rules";

export interface InventoryActionTarget { productId: string; variantId?: string; locationId?: string; expectedVersion: number; }
export async function loadFinancialTarget(target: Omit<InventoryActionTarget, "expectedVersion">, productFilter: Record<string, unknown> = {}, locationIds?: ReadonlySet<string>) {
  const product = await financeQuery(Product.findOne({ $and: [{ _id: target.productId }, productFilter] })).lean<FinancialProduct | null>();
  if (!product) throw new NotFoundError("Product");
  if (!(await getDefaultVendorIds()).has(String(product.vendorId))) throw new ApiError("Only own-store inventory belongs to this book.", 403, "INVENTORY_OWNER_MISMATCH");
  if (product.inventoryFinanceGeneration !== 1) throw new ApiError("This product requires stock/ledger balance migration before using synchronized actions.", 409, "INVENTORY_MIGRATION_REQUIRED");
  if (product.inventory?.tracked === false || product.shipping?.isPhysicalProduct === false) throw new ApiError("This product does not track physical inventory.", 409, "UNTRACKED");
  if (target.locationId) {
    if (locationIds && !locationIds.has(target.locationId)) throw new ApiError("Location is outside your assignment.", 403, "LOCATION_OUT_OF_SCOPE");
    if (!await financeQuery(InventoryLocation.exists({ _id: target.locationId, vendorId: product.vendorId }))) throw new ApiError("Location does not belong to this store.", 403, "LOCATION_NOT_ALLOWED");
  }
  const rows = financialStockRows(product);
  const row = rows.find((r) => r.variantId === (target.variantId ?? null) && r.locationId === (target.locationId ?? null));
  if (!row) throw new ApiError("Choose an existing SKU and its stock location.", 400, "INVENTORY_TARGET_REQUIRED");
  const scope: InventoryScope = { ownerId: String(product.vendorId), productId: String(product._id), variantId: row.variantId, locationId: row.locationId, currency: product.inventoryFinanceCurrency! };
  const position = await financeQuery(InventoryPosition.findOne({ key: inventoryPositionKey(scope) }));
  if (!position) throw new ApiError("Financial inventory is not initialized.", 409, "INVENTORY_NOT_INITIALIZED");
  return { product, row, scope, position };
}
const dateForManual = (date?: string) => {
  const now = new Date();
  const at = date ? new Date(date) : now;
  if (!Number.isFinite(at.getTime()) || Math.abs(at.getTime() - now.getTime()) > 5 * 60_000) throw new ApiError("Manual physical inventory changes must use the current date.", 400, "BACKDATED_INVENTORY_NOT_ALLOWED");
  return at;
};

export async function adjustFinancialInventory(input: InventoryActionTarget & {
  mode: "set" | "adjust"; value: number; field: "available" | "on_hand";
  reason: "count" | "correction" | "damaged" | "theft_loss" | "promotion_donation";
  disposition?: "write_off" | "hold" | "release_hold" | "write_off_held"; note: string; preview?: boolean;
}, actorId: string, requestKey: string, access: { productFilter?: Record<string, unknown>; locationIds?: ReadonlySet<string> } = {}): Promise<Awaited<ReturnType<typeof runInventoryMutation>> | { delta: number; currency: string; version: number; bookValue: number; valueDelta: number; committed: number; unavailable: number; costStatus: string }> {
  if (!input.preview && !financeSession()) {
    const result = await financeTransaction("Inventory count", () => adjustFinancialInventory(input, actorId, requestKey, access));
    if ("operationId" in result) return { ...result, bookkeepingState: await finishFinanceOperation(result.operationId) ? "complete" as const : "pending" as const };
    return result;
  }
  const { product, row, scope, position } = await loadFinancialTarget(input, access.productFilter, access.locationIds);
  const states = input.field === "on_hand" ? await protectedPhysicalStates(scope, position.unavailableOwned) : { committed: 0, unavailable: 0 };
  const writeOffHeld = input.disposition === "write_off_held";
  if (input.disposition && input.reason !== "damaged") throw new ApiError("Damage disposition requires the damaged reason.", 400, "INVALID_DISPOSITION");
  if (writeOffHeld && (input.mode !== "adjust" || input.field !== "available" || input.value >= 0 || -input.value > position.unavailableOwned)) throw new ApiError("Specify a negative adjustment within the owned held quantity.", 400, "INVALID_HOLD_QUANTITY");
  const delta = writeOffHeld ? input.value : inventoryAdjustmentDelta({ mode: input.mode, value: input.value, available: row.quantity, ...states, field: input.field });
  const hold = input.disposition === "hold";
  const releaseHold = input.disposition === "release_hold";
  if ((hold && delta >= 0) || (releaseHold && delta <= 0)) throw new ApiError("Hold removes Available; release hold adds Available.", 400, "INVALID_HOLD_QUANTITY");
  const valueDelta = hold || releaseHold ? 0 : delta < 0
    ? -inventoryProportionalAmount({ totalAmount: position.carryingValue, totalQuantity: position.quantity, alreadyAllocated: 0, quantity: -delta, currency: scope.currency })
    : inventoryLineValue(delta, row.unitCost, scope.currency);
  if (input.preview) return { delta, currency: scope.currency, version: position.version, bookValue: position.carryingValue, valueDelta, ...states, costStatus: row.unitCost === null ? "cost_missing" : "recorded" };
  if (position.missingCostQuantity && !hold && !releaseHold) throw new ApiError("Classify missing-cost stock before a financial adjustment.", 409, "COST_CLASSIFICATION_REQUIRED");
  return runInventoryMutation({
    scope, actorId, requestKey, fingerprint: input, expectedVersion: input.expectedVersion, reason: input.reason,
    occurredAt: dateForManual(), productName: product.name ?? product.title ?? "Product", variantName: row.variantName, sku: row.sku, channel: "web", note: input.note,
    generatedDate: true,
    physicalQuantityDelta: writeOffHeld ? 0 : delta,
    source: { kind: "manual_stock", id: requestKey },
    plan: (_, event) => ({ change: hold || releaseHold
      ? { quantityDelta: 0, valueDelta: 0, stateDeltas: { availableOwned: delta, unavailableOwned: -delta } }
      : { quantityDelta: delta, valueDelta, ...(writeOffHeld ? { state: "unavailableOwned" as const } : {}) }, postings: inventoryValuePostings(event, valueDelta) }),
    changeStock: async () => {
      if (writeOffHeld) return;
      await withInventoryWrite({ reason: input.reason, sourceKind: "manual_stock", sourceId: requestKey, skipCapture: true }, async () => {
        const changed = await applyStockChangeAtomic({ productId: input.productId, variantId: input.variantId, locationId: input.locationId, quantity: delta, adjustment: true, session: financeSession() });
        if (!changed.success) throw new ApiError(changed.error ?? "Stock changed.", 409, "STOCK_CHANGE_FAILED");
      });
    },
  });
}

export async function receiveFinancialInventory(input: InventoryActionTarget & {
  quantity: number; actualUnitPrice: number; payment: "paid" | "unpaid" | "already_recorded";
  paidFrom?: "bank" | "cash" | "gateway"; paymentDate?: string; expenseId?: string; expenseRevision?: number; note: string; preview?: boolean;
}, actorId: string, requestKey: string) {
  // Resolve committed responses before reloading mutable quantity, expense or cost.
  const replay = await replayFinanceRequest<{ stockOperationId: string; operationIds: string[] }>({ action: "inventory:receipt", actorId, requestKey, fingerprint: () => input });
  if (replay) { let complete = replay.bookkeepingState === "complete"; for (const id of replay.data.operationIds) complete = (await finishFinanceOperation(id)) && complete; return { ...replay, bookkeepingState: complete ? "complete" as const : "pending" as const }; }
  const target = await loadFinancialTarget(input);
  const carried = inventoryLineValue(input.quantity, target.row.unitCost, target.scope.currency);
  const actual = inventoryLineValue(input.quantity, input.actualUnitPrice, target.scope.currency);
  if (input.preview) return { delta: input.quantity, valueDelta: carried, purchaseAmount: actual, variance: actual - carried, currency: target.scope.currency, version: target.position.version };
  if (input.payment === "paid" && !input.paidFrom) throw new ApiError("Choose the account the stock was paid from.", 400, "PAYMENT_ACCOUNT_REQUIRED");
  if (input.payment === "already_recorded" && !input.expenseId) throw new ApiError("Select an existing stock purchase expense.", 400, "EXPENSE_REQUIRED");
  const { runFinanceOperation } = await import("@/lib/finance/operations");
  const occurredAt = dateForManual();
  return runFinanceOperation({ action: "inventory:receipt", actorId, requestKey, fingerprint: input, work: async () => {
    const { product, row, scope, position } = await loadFinancialTarget(input);
    if (position.version !== input.expectedVersion) throw new ApiError("Inventory changed; reload this receipt.", 409, "STALE_INVENTORY_VERSION");
    let expense;
    let funding = [] as ReturnType<typeof expensePostings>;
    let earlierFunding = [] as ReturnType<typeof expensePostings>;
    if (input.payment === "already_recorded") {
      expense = await financeQuery(Expense.findOne({ _id: input.expenseId, book: "own", scope: "platform", category: EXPENSE_CATEGORY.INVENTORY_PURCHASE, debitAccount: "inventory", currency: scope.currency }));
      if (!expense || (expense.vendorId && String(expense.vendorId) !== scope.ownerId) || expense.revision !== input.expenseRevision) throw new ApiError("Choose the current own-store stock purchase revision in this currency.", 409, "EXPENSE_FUNDING_MISMATCH");
      // The expense row serializes every claimant, even claimants for different SKUs.
      await financeQuery(Expense.updateOne({ _id: expense._id, revision: expense.revision }, { $inc: { version: 1 } }));
      const allocated = await financeQuery(InventoryFundingAllocation.find({ expenseId: expense._id }));
      const used = inventoryMoney(allocated.reduce((sum, a) => sum + a.amount, 0), scope.currency);
      if (actual > inventoryMoney(Math.max(0, expense.amount - used), scope.currency)) throw new ApiError("Receipt exceeds this expense's remaining funding.", 409, "EXPENSE_ALLOCATION_EXCEEDED");
      const expected = expensePostings(expense)[0];
      if (expected) {
        const posted = await financeQuery(LedgerEntry.findOne({ key: expected.key }));
        const pending = await financeQuery(FinanceOperation.findOne({ state: { $in: ["pending", "complete"] }, "postings.key": expected.key }));
        const matches = (row: typeof expected) => row.key === expected.key && row.book === expected.book && row.debit === expected.debit && row.credit === expected.credit && row.amount === expected.amount && row.currency === expected.currency && String(row.vendorId ?? "") === String(expected.vendorId ?? "") && row.source.kind === expected.source.kind && String(row.source.id) === String(expected.source.id);
        if (posted ? !matches(posted as typeof expected) : !(pending?.postings as typeof funding | undefined)?.some(matches)) throw new ApiError("Verify the original expense funding posting before allocating it.", 409, "FUNDING_POSTING_MISSING");
      }
    } else {
      const paymentDate = input.paymentDate ? new Date(input.paymentDate) : occurredAt;
      if (!Number.isFinite(paymentDate.getTime()) || paymentDate > occurredAt) throw new ApiError("Payment date must be valid and not in the future.", 400, "INVALID_PAYMENT_DATE");
      const prepaid = input.payment === "paid" && paymentDate.getTime() !== occurredAt.getTime();
      [expense] = await Expense.create([{
        _id: new Types.ObjectId(), date: prepaid ? paymentDate : occurredAt, book: "own", category: EXPENSE_CATEGORY.INVENTORY_PURCHASE,
        debitAccount: "inventory", amount: actual, currency: scope.currency, description: `Stock received: ${product.name ?? product.title}`,
        paidFrom: input.payment === "unpaid" ? "unpaid" : input.paidFrom,
        vendorId: scope.ownerId, scope: "platform", createdBy: actorId, note: input.note,
      }], { session: financeSession() });
      funding = expensePostings(expense);
      if (prepaid) { earlierFunding = funding; funding = []; }
    }
    const stockOp = await runInventoryMutation({
      scope, actorId, requestKey: `${requestKey}:stock`, fingerprint: input, expectedVersion: input.expectedVersion, reason: "received",
      occurredAt, productName: product.name ?? product.title ?? "Product", variantName: row.variantName, sku: row.sku, channel: "web", note: input.note,
      generatedDate: true,
      expenseId: String(expense._id), fundingAdopted: input.payment === "already_recorded" || earlierFunding.length ? actual : 0,
      paymentDisposition: input.payment,
      source: { kind: "receipt", id: requestKey },
      plan: (_, event) => ({ change: { quantityDelta: input.quantity, valueDelta: carried }, postings: [...funding, ...receiptVariancePostings(event, carried, actual)] }),
      changeStock: async () => withInventoryWrite({ reason: "received", sourceKind: "receipt", sourceId: requestKey, skipCapture: true }, async () => {
        const changed = await applyStockChangeAtomic({ productId: input.productId, variantId: input.variantId, locationId: input.locationId, quantity: input.quantity, adjustment: true, session: financeSession() });
        if (!changed.success) throw new ApiError(changed.error ?? "Stock changed.", 409, "STOCK_CHANGE_FAILED");
      }),
      afterMovement: async (movementId) => { await InventoryFundingAllocation.create([{
        key: `${requestKey}:${movementId}`, ownerId: scope.ownerId, expenseId: expense!._id, expenseRevision: expense!.revision,
        movementId, currency: scope.currency, amount: actual, fundingKey: expensePostings(expense!)[0]?.key ?? `zero:${expense!._id}`,
      }], { session: financeSession() }); },
    });
    const { allocateUnbackedInventory } = await import("./finance-sales");
    const allocationOps = await allocateUnbackedInventory(scope, stockOp.data.movementId, input.quantity);
    // Outer response key replays before current stock or funding is read. The inner intent is durable too.
    return { result: { ...stockOp.data, expenseId: String(expense._id), stockOperationId: stockOp.operationId, operationIds: [stockOp.operationId, ...allocationOps] }, postings: earlierFunding, sourceId: stockOp.data.movementId, vendorId: scope.ownerId };
  } }).then(async (result) => {
    let complete = result.bookkeepingState === "complete";
    for (const id of result.data.operationIds) complete = (await finishFinanceOperation(id)) && complete;
    return { ...result, bookkeepingState: complete ? "complete" as const : "pending" as const };
  });
}

export async function revalueFinancialInventory(input: {
  productId: string; variantId?: string; newUnitCost: number;
  expectedVersions: Record<string, number>; productVersion: string; note: string; preview?: boolean; costEstablishment?: "opening";
}, actorId: string, requestKey: string) {
  const replay = await replayFinanceRequest<{ operationIds: string[] }>({ action: "inventory:revaluation", actorId, requestKey, fingerprint: () => input });
  if (replay) {
    let complete = replay.bookkeepingState === "complete";
    for (const id of replay.data.operationIds) complete = (await finishFinanceOperation(id)) && complete;
    return { ...replay, bookkeepingState: complete ? "complete" as const : "pending" as const };
  }
  const product = await financeQuery(Product.findById(input.productId)).lean<FinancialProduct & { updatedAt: Date } | null>();
  if (!product) throw new NotFoundError("Product");
  if (product.inventoryFinanceGeneration !== 1 || !(await getDefaultVendorIds()).has(String(product.vendorId))) throw new ApiError("Reconcile the inventory baseline before changing its financial valuation.", 409, "INVENTORY_MIGRATION_REQUIRED");
  const explicit = new Set((product.variants ?? []).filter((v) => inventoryCost(v.cost) !== null).map((v) => String(v._id)));
  const positions = await financeQuery(InventoryPosition.find({ productId: input.productId, ...(input.variantId ? { variantId: input.variantId } : { variantId: { $nin: [...explicit] } }) }));
  const preview = positions.map((p) => ({ key: p.key, version: p.version, quantity: p.quantity, oldValue: p.carryingValue, newValue: inventoryLineValue(p.quantity, input.newUnitCost, p.currency), currency: p.currency }));
  if (input.preview) return { positions: preview, productVersion: product.updatedAt.toISOString(), basis: "fixed_cost" };
  const { runFinanceOperation } = await import("@/lib/finance/operations");
  const result = await runFinanceOperation({ action: "inventory:revaluation", actorId, requestKey, fingerprint: input, work: async () => {
    const current = await financeQuery(Product.findById(input.productId)).lean<FinancialProduct & { updatedAt: Date } | null>();
    if (!current || current.updatedAt.toISOString() !== input.productVersion) throw new ApiError("Product changed; refresh the valuation preview.", 409, "STALE_PRODUCT_VERSION");
    const fresh = await financeQuery(InventoryPosition.find({ productId: input.productId, ...(input.variantId ? { variantId: input.variantId } : { variantId: { $nin: [...explicit] } }) }));
    if (fresh.length !== Object.keys(input.expectedVersions).length || fresh.some((p) => input.expectedVersions[p.key] !== p.version)) throw new ApiError("Stock changed; refresh the valuation preview.", 409, "STALE_INVENTORY_VERSION");
    if (fresh.some((p) => p.missingCostQuantity) && (input.costEstablishment !== "opening" || fresh.some((p) => p.missingCostQuantity && p.missingCostQuantity !== p.quantity))) throw new ApiError("Classify missing-cost stock before revaluation.", 409, "COST_CLASSIFICATION_REQUIRED");
    const { InventoryMovement } = await import("@/models/inventory-movement.model");
    await withInventoryWrite({ reason: "cost_revaluation", sourceKind: "valuation_change", sourceId: requestKey, requestKey, actorId, note: input.note, channel: "web", costChangeConfirmed: true, costEstablishment: input.costEstablishment }, async () => {
      const filter = { _id: input.productId, ...(input.variantId ? { "variants._id": input.variantId } : {}) };
      const changed = await financeQuery(Product.updateOne(filter, { $set: { [input.variantId ? "variants.$.cost" : "cost"]: input.newUnitCost } }));
      if (changed.matchedCount !== 1) throw new ApiError("Choose an existing SKU.", 400, "UNKNOWN_VARIANT");
    });
    const movements = await financeQuery(InventoryMovement.find({ "source.kind": "valuation_change", "source.id": requestKey }));
    const operations = await financeQuery(FinanceOperation.find({ action: "inventory:movement", sourceId: { $in: movements.map((m) => String(m._id)) } }));
    return { result: { operationIds: operations.map((op) => String(op._id)), positions: preview }, postings: [], vendorId: String(product.vendorId) };
  } });
  let complete = result.bookkeepingState === "complete";
  for (const id of result.data.operationIds) complete = (await finishFinanceOperation(id)) && complete;
  return { ...result, bookkeepingState: complete ? "complete" as const : "pending" as const };
}
