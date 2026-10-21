import * as z from "zod";
const id = z.string().regex(/^[a-f\d]{24}$/i);
const money = z.number().finite().nonnegative();
const target = { productId: id, variantId: id.optional(), locationId: id.optional(), expectedVersion: z.number().int().nonnegative() };
export const InventoryAdjustmentRequest = z.object({
  ...target, mode: z.enum(["set", "adjust"]), value: z.number().int().min(-1_000_000).max(1_000_000),
  field: z.enum(["available", "on_hand"]).default("available"),
  reason: z.enum(["count", "correction", "damaged", "theft_loss", "promotion_donation"]),
  disposition: z.enum(["write_off", "hold", "release_hold", "write_off_held"]).optional(),
  note: z.string().trim().min(1).max(500), preview: z.boolean().optional(),
});
export const InventoryReceiptRequest = z.object({
  ...target, quantity: z.number().int().min(1).max(1_000_000), actualUnitPrice: money,
  payment: z.enum(["paid", "unpaid", "already_recorded"]), paidFrom: z.enum(["bank", "cash", "gateway"]).optional(),
  paymentDate: z.iso.datetime().optional(), expenseId: id.optional(), expenseRevision: z.number().int().nonnegative().optional(),
  note: z.string().trim().max(500).default(""), preview: z.boolean().optional(),
}).superRefine((input, context) => {
  if (input.payment === "paid" && !input.paidFrom) context.addIssue({ code: "custom", path: ["paidFrom"], message: "Choose the recorded payment account." });
  if (input.payment === "already_recorded" && (!input.expenseId || input.expenseRevision == null)) context.addIssue({ code: "custom", path: ["expenseId"], message: "Select the existing expense revision." });
});
export const InventoryRevaluationRequest = z.object({
  productId: id, variantId: id.optional(), newUnitCost: money,
  expectedVersions: z.record(z.string(), z.number().int().nonnegative()).default({}), productVersion: z.string().default(""),
  note: z.string().trim().min(1).max(500), preview: z.boolean().optional(),
  costEstablishment: z.enum(["opening"]).optional(),
});

/** Own-store financial inventory. No supplier or purchase-order fields. */
export const InventoryFinanceQuery = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/), asOf: z.iso.datetime().optional(),
  productId: id.optional(), variantId: id.optional(), locationId: id.optional(),
  from: z.iso.datetime().optional(), actorId: z.string().max(200).optional(),
  reason: z.enum(["opening", "received", "count", "correction", "damaged", "theft_loss", "promotion_donation", "reserve", "release", "sale_costed", "return_restock", "transfer", "return_received", "cost_revaluation"]).optional(),
  state: z.enum(["owned_available", "owned_reserved_uncosted", "owned_unavailable", "owned_in_transit", "sale_costed", "returned_unvalued", "written_off"]).optional(), payment: z.enum(["paid", "unpaid", "already_recorded"]).optional(),
  before: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const InventoryFinanceOperation = z.object({
  operationId: z.string(), bookkeepingState: z.enum(["complete", "pending"]),
  data: z.object({ movementId: z.string().optional(), positionKey: z.string().optional(), quantityAfter: z.number().optional(), bookValueAfter: z.number().optional(), version: z.number().optional(), currency: z.string().optional(), accountingAt: z.string().optional(), expenseId: z.string().optional(), operationIds: z.array(z.string()).optional() }),
});
export const InventoryFinancePreview = z.object({
  delta: z.number().optional(), valueDelta: z.number().optional(), purchaseAmount: z.number().optional(), variance: z.number().optional(), currency: z.string().optional(), version: z.number().optional(),
  productVersion: z.string().optional(), basis: z.string().optional(),
  positions: z.array(z.object({ key: z.string(), version: z.number(), quantity: z.number(), oldValue: z.number(), newValue: z.number(), currency: z.string() })).optional(),
});
export const InventoryFinanceMutation = z.union([InventoryFinanceOperation, InventoryFinancePreview]);
export const InventoryFinanceValuation = z.object({
  status: z.string(), asOf: z.string(), physicalAsOf: z.string(), basis: z.string(), currency: z.string(),
  bookValue: z.number(), postedValue: z.number(), pendingEffect: z.number(), unexplainedDifference: z.number(),
  positionsAsOf: z.string(), historicalAvailableValue: z.number(), negativeAvailableQuantity: z.number(), ownedBookValue: z.number(),
  saleCoverage: z.object({ deferredQuantity: z.number(), missingCostQuantity: z.number(), costedQuantity: z.number(), costSourceQuantity: z.number(), currencyIssueQuantity: z.number(), sources: z.array(z.object({ orderId: z.string(), lineId: z.string(), productName: z.string(), quantity: z.number(), estimate: z.number().optional(), currency: z.string() })) }),
  availableValue: z.number(), availableQuantity: z.number(), fundingAwaitingAllocation: z.number(),
  missingCostQuantity: z.number(), deferredCostQuantity: z.number(), transitQuantity: z.number(), legacyProducts: z.number(),
  positions: z.array(z.object({ key: z.string(), productId: z.string(), productName: z.string(), variantId: z.string().optional(), locationId: z.string().optional(), version: z.number(), quantity: z.number(), availableOwned: z.number(), reservedUncosted: z.number(), unavailableOwned: z.number(), inTransitOwned: z.number(), carryingValue: z.number(), unitCost: z.number().optional(), currency: z.string() })),
  issues: z.array(z.object({ operationId: z.string(), fingerprint: z.string(), state: z.string(), error: z.string().optional() })),
});
export const InventoryFinanceHistory = z.object({
  items: z.array(z.object({ _id: z.string(), productId: z.string(), productName: z.string(), variantId: z.string().optional(), locationId: z.string().optional(), reason: z.string(), quantityBefore: z.number(), quantityDelta: z.number(), physicalQuantityDelta: z.number(), physicalUnavailableDelta: z.number(), financialState: z.string().optional(), bookkeepingState: z.string(), paymentDisposition: z.string().optional(), positionKey: z.string(), source: z.object({ kind: z.string(), id: z.string(), lineId: z.string().optional(), reference: z.string().optional() }), quantityAfter: z.number(), valueBefore: z.number(), valueDelta: z.number(), valueAfter: z.number(), currency: z.string(), occurredAt: z.string(), accountingAt: z.string(), actorId: z.string(), note: z.string().optional() })),
  nextCursor: z.string().optional(),
});
export const InventoryPostingRepairRequest = z.object({ operationId: id, fingerprint: z.string().length(64) });
export const InventoryPostingRepair = z.object({ operationId: z.string(), bookkeepingState: z.enum(["complete", "pending"]) });
export const InventoryCostSourceRequest = z.object({ orderId: id, lineId: z.string().min(1).max(200), expenseId: id, expenseRevision: z.number().int().nonnegative(), quantity: z.number().int().positive(), amount: money });
export const InventoryCostSourceResult = z.object({ operationId: z.string(), bookkeepingState: z.enum(["complete", "pending"]), data: z.object({ allocationId: z.string(), quantity: z.number(), amount: z.number(), currency: z.string() }) });
export const InventoryReceiptCorrectionRequest = z.object({ movementId: id, expectedVersion: z.number().int().nonnegative(), note: z.string().trim().min(1).max(500), preview: z.boolean().optional() });
