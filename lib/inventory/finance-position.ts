import type { InventoryPositionRecord } from "@/models/inventory-position.model";
import { inventoryCost, inventoryMoney, inventoryQuantity, InventoryRuleError } from "./finance-rules";

export function inventoryPositionKey(input: {
  ownerId: string; productId: string; variantId?: string | null; locationId?: string | null; currency: string;
}): string {
  for (const value of [input.ownerId, input.productId, input.variantId, input.locationId]) {
    if (value != null && !/^[a-f\d]{24}$/i.test(value)) throw new InventoryRuleError("INVALID_POSITION", "Inventory scope contains an invalid identifier.");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new InventoryRuleError("INVALID_CURRENCY", "Choose a three-letter book currency.");
  return [input.ownerId, input.productId, input.variantId || "main", input.locationId || "unassigned", input.currency].join(":").toLowerCase();
}

export interface InventoryPositionChange {
  quantityDelta: number;
  valueDelta: number;
  state?: "availableOwned" | "reservedUncosted" | "unavailableOwned" | "inTransitOwned";
  newUnitCost?: number;
  newCostVersion?: number;
  stateDeltas?: Partial<Record<"availableOwned" | "reservedUncosted" | "unavailableOwned" | "inTransitOwned", number>>;
  missingCostQuantity?: number;
}

/** Transaction service and dry-run use the same state validation. */
export function changedInventoryPosition(
  before: Pick<InventoryPositionRecord, "quantity" | "carryingValue" | "currency" | "unitCost" | "costVersion" | "version" | "availableOwned" | "reservedUncosted" | "unavailableOwned" | "inTransitOwned">,
  change: InventoryPositionChange,
) {
  if (!Number.isSafeInteger(change.quantityDelta) || !Number.isFinite(change.valueDelta)) throw new InventoryRuleError("INVALID_CHANGE", "Invalid inventory position change.");
  if (change.newCostVersion !== undefined && (!Number.isSafeInteger(change.newCostVersion) || change.newCostVersion < before.costVersion)) throw new InventoryRuleError("INVALID_COST_VERSION", "Cost versions must advance monotonically.");
  const quantity = inventoryQuantity(before.quantity + change.quantityDelta);
  const roundedDelta = inventoryMoney(Math.abs(change.valueDelta), before.currency) * Math.sign(change.valueDelta);
  const rawValue = before.carryingValue + roundedDelta;
  if (rawValue < -1e-9) throw new InventoryRuleError("INSUFFICIENT_INVENTORY_VALUE", "This action removes more value than the position carries.");
  const carryingValue = inventoryMoney(Math.max(0, rawValue), before.currency);
  if (quantity === 0 && carryingValue !== 0) throw new InventoryRuleError("STRANDED_INVENTORY_VALUE", "The final unit must consume the remaining inventory value.");
  const state = change.state ?? "availableOwned";
  const states = {
    availableOwned: before.availableOwned, reservedUncosted: before.reservedUncosted,
    unavailableOwned: before.unavailableOwned, inTransitOwned: before.inTransitOwned,
  };
  if (change.stateDeltas) {
    for (const key of Object.keys(states) as Array<keyof typeof states>) states[key] = inventoryQuantity(states[key] + (change.stateDeltas[key] ?? 0));
  } else states[state] = inventoryQuantity(states[state] + change.quantityDelta);
  if (Object.values(states).reduce((sum, value) => sum + value, 0) !== quantity) throw new InventoryRuleError("STATE_TOTAL_MISMATCH", "Financial states must add up to the owned quantity.");
  if (change.newUnitCost !== undefined && inventoryCost(change.newUnitCost) === null) throw new InventoryRuleError("COST_MISSING", "Use a finite recorded cost.");
  if (carryingValue > 0 && inventoryCost(change.newUnitCost ?? before.unitCost) === null) throw new InventoryRuleError("COST_MISSING", "A valued inventory position needs a recorded cost.");
  return {
    ...states, quantity, carryingValue,
    unitCost: change.newUnitCost ?? before.unitCost,
    costVersion: change.newCostVersion ?? before.costVersion + (change.newUnitCost !== undefined ? 1 : 0),
    version: before.version + 1,
    ...(change.missingCostQuantity !== undefined ? { missingCostQuantity: inventoryQuantity(change.missingCostQuantity) } : {}),
  };
}
