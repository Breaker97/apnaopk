import "server-only";
import { InventoryMovement } from "@/models/inventory-movement.model";
import { InventoryPosition } from "@/models/inventory-position.model";
import { InventoryFundingAllocation } from "@/models/inventory-allocation.model";
import { Expense } from "@/models/expense.model";
import { LedgerEntry } from "@/models/ledger-entry.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { financeQuery, financeSession } from "@/lib/finance/transaction";
import { runFinanceOperation } from "@/lib/finance/operations";
import { ApiError } from "@/lib/api/errors";
import { runInventoryMutation } from "./finance-service";
import { withInventoryWrite } from "./finance-context";
import { applyStockChangeAtomic } from "./inventory";
import type { LedgerPosting } from "@/lib/finance/ledger";

/** Full reversal of an untouched receipt; consumed stock needs a reviewed correction. */
export async function correctUnusedReceipt(input: { movementId: string; expectedVersion: number; note: string; preview?: boolean }, actorId: string, requestKey: string) {
  const inspect = async () => {
    const original = await financeQuery(InventoryMovement.findById(input.movementId)).lean();
    if (!original || original.reason !== "received") throw new ApiError("Select an original stock receipt.", 400, "RECEIPT_REQUIRED");
    const position = await financeQuery(InventoryPosition.findOne({ key: original.positionKey }));
    if (!position || position.version !== input.expectedVersion || String(position.lastMovementId) !== String(original._id)) throw new ApiError("This receipt's stock has changed. Sold, transferred, revalued or consumed receipts require a classified correction plan.", 409, "RECEIPT_ALREADY_CONSUMED");
    const funding = await financeQuery(InventoryFundingAllocation.findOne({ movementId: original._id }));
    const expense = original.expenseId ? await financeQuery(Expense.findById(original.expenseId)) : null;
    if (!funding || !expense || expense.revision !== funding.expenseRevision) throw new ApiError("Original receipt funding evidence changed.", 409, "RECEIPT_FUNDING_CHANGED");
    if (original.paymentDisposition !== "already_recorded" && expense.settlement) throw new ApiError("Undo the separate bill settlement before reversing this receipt.", 409, "RECEIPT_SETTLEMENT_EXISTS");
    if (original.paymentDisposition !== "already_recorded") {
      const claims = await financeQuery(InventoryFundingAllocation.find({ expenseId: expense._id }));
      if (claims.some((claim) => String(claim._id) !== String(funding._id))) throw new ApiError("This bill has additional receipt allocations; review them before reversing it.", 409, "RECEIPT_SHARED_FUNDING");
    }
    let postings = original.postings as LedgerPosting[];
    if (original.paymentDisposition !== "already_recorded" && original.fundingAdopted) {
      const posted = await financeQuery(LedgerEntry.findOne({ key: funding.fundingKey })).lean();
      const pending = await financeQuery(FinanceOperation.findOne({ "postings.key": funding.fundingKey })).lean();
      const evidenced = posted ?? (pending?.postings as LedgerPosting[] | undefined)?.find((p) => p.key === funding.fundingKey);
      if (!evidenced) throw new ApiError("Original prepayment funding evidence is missing.", 409, "RECEIPT_FUNDING_CHANGED");
      postings = [...postings, evidenced as LedgerPosting];
    }
    return { original, position, funding, expense, postings };
  };
  if (input.preview) {
    const { original, funding } = await inspect();
    return { delta: -original.quantityDelta, valueDelta: -original.valueDelta, purchaseAmount: funding.amount, currency: original.currency, version: input.expectedVersion };
  }
  return runFinanceOperation({ action: "inventory:receipt-correction", actorId, requestKey, fingerprint: input, work: async () => {
    const { original, position, funding, expense, postings } = await inspect();
    await financeQuery(Expense.updateOne({ _id: expense._id, revision: expense.revision }, { $inc: { version: 1 } }));
    const result = await runInventoryMutation({
      scope: { ownerId: String(original.ownerId), productId: String(original.productId), variantId: original.variantId ? String(original.variantId) : null, locationId: original.locationId ? String(original.locationId) : null, currency: original.currency },
      actorId, requestKey: `${requestKey}:stock`, fingerprint: input, expectedVersion: position.version, reason: "correction", occurredAt: new Date(), generatedDate: true,
      channel: "web", productName: original.productName, variantName: original.variantName, sku: original.sku, note: input.note,
      source: { kind: "receipt_correction", id: String(original._id) }, reversesMovementId: String(original._id), expenseId: String(expense._id), fundingAdopted: original.paymentDisposition === "already_recorded" ? -funding.amount : 0,
      plan: (_, event) => ({ change: { quantityDelta: -original.quantityDelta, valueDelta: -original.valueDelta }, postings: postings.map((p, index) => ({ ...p, key: `inventory_movement:${event.id}:reverse:${index}`, date: event.date, debit: p.credit, credit: p.debit })) }),
      changeStock: async () => withInventoryWrite({ reason: "correction", sourceKind: "receipt_correction", sourceId: String(original._id), skipCapture: true }, async () => {
        const changed = await applyStockChangeAtomic({ productId: String(original.productId), variantId: original.variantId ? String(original.variantId) : undefined, locationId: original.locationId ? String(original.locationId) : undefined, quantity: -original.quantityDelta, adjustment: true, session: financeSession() });
        if (!changed.success) throw new ApiError(changed.error ?? "Stock changed.", 409, "STOCK_CHANGE_FAILED");
      }),
      afterMovement: async (movementId) => {
        await InventoryFundingAllocation.create([{ key: `receipt-reversal:${funding._id}`, ownerId: original.ownerId, expenseId: expense._id, expenseRevision: funding.expenseRevision, movementId, currency: original.currency, amount: -funding.amount, fundingKey: funding.fundingKey, reversesAllocationId: funding._id }], { session: financeSession() });
        if (original.paymentDisposition !== "already_recorded") await financeQuery(Expense.deleteOne({ _id: expense._id, revision: expense.revision }));
      },
    });
    return { result: { ...result.data, operationIds: [result.operationId] }, postings: [], sourceId: result.data.movementId, vendorId: original.ownerId };
  } });
}
