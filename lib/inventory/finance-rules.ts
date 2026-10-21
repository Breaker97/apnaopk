/** Pure inventory accounting rules. No database reads or current catalog costs. */
import { LEDGER_ACCOUNT, LEDGER_BOOK, type LedgerAccount } from "@/lib/finance/accounts";
import { currencyPriceScale, quantizeToCurrency } from "@/lib/intl/money";
import type { LedgerPosting } from "@/lib/finance/ledger";

export const INVENTORY_REASONS = [
  "opening", "received", "count", "correction", "damaged", "theft_loss",
  "promotion_donation", "reserve", "release", "sale_costed", "return_restock",
  "transfer", "return_received", "cost_revaluation", "historical_reconciliation",
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

export interface InventoryEventIdentity {
  id: string;
  date: Date;
  currency: string;
  ownerId: string;
  reference?: string;
  note?: string;
}

export class InventoryRuleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "InventoryRuleError";
  }
}

function fail(code: string, message: string): never {
  throw new InventoryRuleError(code, message);
}

export function inventoryQuantity(value: number, allowZero = true): number {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    fail("INVALID_QUANTITY", "Quantity must be a non-negative safe integer.");
  }
  return value;
}

/** Unlike Number(null), missing cost never becomes a recorded zero. */
export function inventoryCost(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function inventoryMoney(value: number, currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) fail("INVALID_CURRENCY", "Choose a three-letter book currency.");
  if (!Number.isFinite(value) || value < 0) fail("INVALID_AMOUNT", "Amount must be finite and non-negative.");
  const amount = quantizeToCurrency(value, currency);
  // Round binary representation noise before testing the supported integer scale.
  if (!Number.isSafeInteger(Math.round(amount * 10 ** currencyPriceScale(currency)))) fail("AMOUNT_TOO_LARGE", "Amount exceeds the supported precision.");
  return amount;
}

function units(amount: number, currency: string): number {
  return Math.round(inventoryMoney(amount, currency) * 10 ** currencyPriceScale(currency));
}

function fromUnits(amount: number, currency: string): number {
  return amount / 10 ** currencyPriceScale(currency);
}

export function inventoryLineValue(quantity: number, cost: unknown, currency: string): number {
  inventoryQuantity(quantity);
  const recorded = inventoryCost(cost);
  if (recorded === null) fail("COST_MISSING", "Record a unit cost, including an explicit zero if applicable.");
  return inventoryMoney(quantity * recorded, currency);
}

function posting(
  event: InventoryEventIdentity,
  role: string,
  debit: LedgerAccount,
  credit: LedgerAccount,
  amount: number,
): LedgerPosting[] {
  if (!/^[a-f\d]{24}$/i.test(event.id) || !/^[a-f\d]{24}$/i.test(event.ownerId) || !(event.date instanceof Date) || !Number.isFinite(event.date.getTime())) {
    fail("INVALID_EVENT", "A stable event ID, owner and date are required.");
  }
  const value = inventoryMoney(amount, event.currency);
  if (value === 0) return [];
  if (debit === credit) fail("INVALID_POSTING", "A posting must name two different accounts.");
  return [{
    date: new Date(event.date), book: LEDGER_BOOK.OWN, debit, credit,
    amount: value, currency: event.currency, vendorId: event.ownerId.toLowerCase(),
    source: { kind: "inventory_movement", id: event.id.toLowerCase(), ref: event.reference ?? null },
    key: `inventory_movement:${event.id}:${role}`.toLowerCase(), note: event.note ?? null,
  }];
}

/** Positive inventory value changes increase assets, with the named counterpart. */
export function inventoryValuePostings(
  event: InventoryEventIdentity,
  delta: number,
  counterpart: LedgerAccount = LEDGER_ACCOUNT.INVENTORY_ADJUSTMENTS,
  role = "value",
): LedgerPosting[] {
  if (!Number.isFinite(delta)) fail("INVALID_AMOUNT", "Value change must be finite.");
  return delta >= 0
    ? posting(event, role, LEDGER_ACCOUNT.INVENTORY, counterpart, delta)
    : posting(event, role, counterpart, LEDGER_ACCOUNT.INVENTORY, -delta);
}

export function openingInventoryPostings(event: InventoryEventIdentity, quantity: number, cost: unknown) {
  return inventoryValuePostings(event, inventoryLineValue(quantity, cost, event.currency), LEDGER_ACCOUNT.OPENING_INVENTORY_EQUITY, "opening");
}

/** Funding belongs to the linked expense; this posts ONLY the fixed-cost difference. */
export function receiptVariancePostings(event: InventoryEventIdentity, carryingValue: number, recordedPurchaseValue: number) {
  const difference = units(carryingValue, event.currency) - units(recordedPurchaseValue, event.currency);
  return inventoryValuePostings(event, fromUnits(difference, event.currency), LEDGER_ACCOUNT.INVENTORY_ADJUSTMENTS, "purchase-variance");
}

/** COGS stays at the order snapshot; stock is removed at its carried amount. */
export function inventorySalePostings(event: InventoryEventIdentity, carryingValue: number, costOfGoods: number): LedgerPosting[] {
  const carried = units(carryingValue, event.currency);
  const costed = units(costOfGoods, event.currency);
  const common = Math.min(carried, costed);
  return [
    ...posting(event, "cogs", LEDGER_ACCOUNT.COST_OF_GOODS, LEDGER_ACCOUNT.INVENTORY, fromUnits(common, event.currency)),
    ...(costed > carried
      ? posting(event, "cogs-variance", LEDGER_ACCOUNT.COST_OF_GOODS, LEDGER_ACCOUNT.INVENTORY_ADJUSTMENTS, fromUnits(costed - carried, event.currency))
      : posting(event, "stock-variance", LEDGER_ACCOUNT.INVENTORY_ADJUSTMENTS, LEDGER_ACCOUNT.INVENTORY, fromUnits(carried - costed, event.currency))),
  ];
}

/** Allocate by cumulative share, so the final unit consumes every recorded minor unit. */
export function inventoryProportionalAmount(input: {
  totalAmount: number; totalQuantity: number; alreadyAllocated: number; quantity: number; currency: string;
}): number {
  const { totalQuantity, alreadyAllocated, quantity, currency } = input;
  inventoryQuantity(totalQuantity, false);
  inventoryQuantity(alreadyAllocated);
  inventoryQuantity(quantity);
  if (alreadyAllocated > totalQuantity || quantity > totalQuantity - alreadyAllocated) {
    fail("QUANTITY_EXCEEDED", "This action exceeds the original quantity remaining.");
  }
  const total = units(input.totalAmount, currency);
  // BigInt prevents multiplication overflowing before the division rounds it back down.
  const two = BigInt(2);
  const share = (q: number) => Number((BigInt(total) * BigInt(q) * two + BigInt(totalQuantity)) / (BigInt(totalQuantity) * two));
  return fromUnits(share(alreadyAllocated + quantity) - share(alreadyAllocated), currency);
}

/** A restock reverses the original valuation, then explicitly prices the returned asset. */
export function inventoryRestockPostings(event: InventoryEventIdentity, input: {
  originalQuantity: number;
  originalCarryingValue: number;
  originalCostOfGoods: number;
  alreadyRestocked: number;
  quantity: number;
  currentUnitCost: unknown;
}): { postings: LedgerPosting[]; originalCarryingValue: number; costOfGoodsReversed: number; carryingValue: number } {
  const proportional = (amount: number) => inventoryProportionalAmount({
    totalAmount: amount, totalQuantity: input.originalQuantity,
    alreadyAllocated: input.alreadyRestocked, quantity: input.quantity, currency: event.currency,
  });
  const originalCarryingValue = proportional(input.originalCarryingValue);
  const costOfGoodsReversed = proportional(input.originalCostOfGoods);
  const carryingValue = inventoryLineValue(input.quantity, input.currentUnitCost, event.currency);
  const original = inventorySalePostings(event, originalCarryingValue, costOfGoodsReversed);
  return {
    originalCarryingValue, costOfGoodsReversed, carryingValue,
    postings: [
      ...original.map((row) => ({ ...row, debit: row.credit, credit: row.debit, key: `${row.key}:restock` })),
      ...inventoryValuePostings(event, fromUnits(units(carryingValue, event.currency) - units(originalCarryingValue, event.currency), event.currency), LEDGER_ACCOUNT.INVENTORY_ADJUSTMENTS, "return-revaluation"),
    ],
  };
}

export function inventoryRevaluationPostings(event: InventoryEventIdentity, quantity: number, oldCarryingValue: number, newUnitCost: unknown) {
  const next = inventoryLineValue(quantity, newUnitCost, event.currency);
  return {
    carryingValue: next,
    postings: inventoryValuePostings(event, fromUnits(units(next, event.currency) - units(oldCarryingValue, event.currency), event.currency), LEDGER_ACCOUNT.INVENTORY_ADJUSTMENTS, "revaluation"),
  };
}

/** Preview used by both the UI and the committing transaction. */
export function inventoryAdjustmentDelta(input: {
  mode: "set" | "adjust"; value: number; available: number;
  committed?: number; unavailable?: number; field?: "available" | "on_hand";
}): number {
  const { value, available, mode } = input;
  if (mode !== "set" && mode !== "adjust") fail("INVALID_ADJUSTMENT_MODE", "Choose Set to or Adjust by.");
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(available)) fail("INVALID_QUANTITY", "Use whole-unit quantities.");
  const protectedUnits = inventoryQuantity(input.committed ?? 0) + inventoryQuantity(input.unavailable ?? 0);
  const delta = mode === "adjust" ? value : value - (input.field === "on_hand" ? protectedUnits : 0) - available;
  if (!Number.isSafeInteger(delta) || available + delta < 0) {
    fail("PROTECTED_STOCK", "The count cannot remove reserved or held units, or make available stock negative.");
  }
  return delta;
}

export function inventoryCogsEligible(input: { saleRecognized: boolean; allocatedQuantity: number; alreadyCostedQuantity: number }) {
  inventoryQuantity(input.allocatedQuantity);
  inventoryQuantity(input.alreadyCostedQuantity);
  if (input.alreadyCostedQuantity > input.allocatedQuantity) fail("INVALID_ALLOCATION", "Costed quantity exceeds allocated stock.");
  return input.saleRecognized ? input.allocatedQuantity - input.alreadyCostedQuantity : 0;
}

export function inventoryLedgerEffect(postings: ReadonlyArray<LedgerPosting>, currency: string): number {
  inventoryMoney(0, currency);
  let effect = BigInt(0);
  for (const row of postings) {
    if (row.currency !== currency) fail("CURRENCY_MISMATCH", "Inventory postings cannot mix currencies.");
    const amount = units(row.amount, currency);
    if (row.debit === LEDGER_ACCOUNT.INVENTORY) effect += BigInt(amount);
    if (row.credit === LEDGER_ACCOUNT.INVENTORY) effect -= BigInt(amount);
  }
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (effect > limit || effect < -limit) fail("AMOUNT_TOO_LARGE", "Inventory total exceeds supported precision.");
  return fromUnits(Number(effect), currency);
}

export function inventoryReconciliation(input: {
  currency: string; bookValue: number; postedValue: number; pendingEffect: number;
  missingCostQuantity: number; deferredCostQuantity: number; pendingOperations: number; conflicts: number;
}) {
  inventoryMoney(0, input.currency);
  const factor = 10 ** currencyPriceScale(input.currency);
  for (const key of ["missingCostQuantity", "deferredCostQuantity", "pendingOperations", "conflicts"] as const) inventoryQuantity(input[key]);
  const signed = (amount: number) => {
    if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * factor))) fail("INVALID_AMOUNT", "Invalid reconciliation amount.");
    return Math.round(amount * factor);
  };
  const expected = signed(input.postedValue) + signed(input.pendingEffect);
  const difference = signed(input.bookValue) - expected;
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(difference)) fail("AMOUNT_TOO_LARGE", "Reconciliation total exceeds supported precision.");
  const status = input.conflicts || input.bookValue < 0 || difference !== 0 ? "needs_review"
    : input.missingCostQuantity ? "cost_missing"
      : input.deferredCostQuantity ? "cost_deferred"
        : input.pendingOperations ? "posting_pending" : "synced";
  return { ...input, expectedLedgerValue: expected / factor, unexplainedDifference: difference / factor, status };
}
