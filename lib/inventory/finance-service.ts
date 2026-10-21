import "server-only";
import { Types } from "mongoose";
import { InventoryPosition, type InventoryPositionRecord } from "@/models/inventory-position.model";
import { InventoryMovement } from "@/models/inventory-movement.model";
import { financialFingerprint, prepareFinancePostings, runFinanceOperation } from "@/lib/finance/operations";
import { financeQuery, financeSession } from "@/lib/finance/transaction";
import { ApiError } from "@/lib/api/errors";
import type { LedgerPosting } from "@/lib/finance/ledger";
import { changedInventoryPosition, inventoryPositionKey, type InventoryPositionChange } from "./finance-position";
import { inventoryLedgerEffect, inventoryMoney, type InventoryEventIdentity, type InventoryReason } from "./finance-rules";

export interface InventoryScope {
  ownerId: string;
  productId: string;
  variantId?: string | null;
  locationId?: string | null;
  currency: string;
}

export interface InventoryMutation {
  scope: InventoryScope;
  actorId: string;
  requestKey: string;
  /** Canonical client request, excluding generated IDs and clocks. */
  fingerprint: unknown;
  expectedVersion: number;
  allowInitialize?: boolean;
  reason: InventoryReason;
  occurredAt: Date;
  /** Server-generated clock is evidence, not part of the client's retry payload. */
  generatedDate?: boolean;
  productName: string;
  variantName?: string | null;
  sku?: string;
  note?: string;
  channel: "web" | "mobile" | "system" | "migration";
  source: { kind: string; id: string; lineId?: string; reference?: string };
  /** Trusted server rule. Public APIs never accept postings or account names. */
  plan: (before: InventoryPositionRecord, event: InventoryEventIdentity) => {
    change: InventoryPositionChange;
    postings: LedgerPosting[];
  };
  /** Scoped operational mutation; throwing aborts position, event and outbox too. */
  changeStock?: (before: InventoryPositionRecord) => Promise<void>;
  afterMovement?: (movementId: string, before: InventoryPositionRecord) => Promise<void>;
  expenseId?: string;
  /** Funding already carried in the unallocated monetary inventory bucket. */
  fundingAdopted?: number;
  paymentDisposition?: "paid" | "unpaid" | "already_recorded";
  physicalQuantityDelta?: number;
  physicalUnavailableDelta?: number;
  financialState?: "owned_available" | "owned_reserved_uncosted" | "owned_unavailable" | "owned_in_transit" | "sale_costed" | "returned_unvalued" | "written_off";
  reversesMovementId?: string;
}

/**
 * Transactional primitive for a single financial position. Activation/cutover and
 * SKU-wide revaluation orchestrators must scope their calls before reaching it.
 */
export async function runInventoryMutation(input: InventoryMutation) {
  const positionKey = inventoryPositionKey(input.scope);
  const scope = {
    ...input.scope, ownerId: input.scope.ownerId.toLowerCase(), productId: input.scope.productId.toLowerCase(),
    variantId: input.scope.variantId?.toLowerCase() || null, locationId: input.scope.locationId?.toLowerCase() || null,
  };
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw new ApiError("Supply the current inventory version.", 400, "INVALID_INVENTORY_VERSION");
  if (!input.requestKey || !input.actorId || !input.productName || !Number.isFinite(input.occurredAt.getTime())) throw new ApiError("A request key, actor, product and date are required.", 400, "INVALID_INVENTORY_EVENT");
  if ([input.physicalQuantityDelta, input.physicalUnavailableDelta].some((q) => q !== undefined && !Number.isSafeInteger(q))) throw new ApiError("Physical quantity changes must be whole numbers.", 400, "INVALID_QUANTITY");
  // Bind the fingerprint to scope, source and action; a retry cannot move another SKU.
  const fingerprint = {
    scope, reason: input.reason, source: input.source,
    expectedVersion: input.expectedVersion, occurredAt: input.generatedDate ? undefined : input.occurredAt,
    request: input.fingerprint,
  };
  const movementId = new Types.ObjectId();
  const action = "inventory:movement";
  const result = await runFinanceOperation({
    action, actorId: input.actorId, requestKey: input.requestKey, fingerprint,
    work: async () => {
      let position = await financeQuery(InventoryPosition.findOne({ key: positionKey }));
      if (!position) {
        if (!input.allowInitialize || input.expectedVersion !== 0) throw new ApiError("Reconcile opening inventory before changing its book value.", 409, "INVENTORY_NOT_INITIALIZED");
        position = new InventoryPosition({
          key: positionKey, ...scope, quantity: 0, carryingValue: 0,
          availableOwned: 0, reservedUncosted: 0, unavailableOwned: 0, inTransitOwned: 0,
        });
      }
      if (position.version !== input.expectedVersion) throw new ApiError("Inventory changed. Reload before saving this adjustment.", 409, "STALE_INVENTORY_VERSION");
      const before = position.toObject();
      const event: InventoryEventIdentity = {
        id: String(movementId), date: input.occurredAt, currency: scope.currency,
        ownerId: scope.ownerId, reference: input.source.reference, note: input.note,
      };
      const { change, postings: rawPostings } = input.plan(before, event);
      if (change.newUnitCost !== undefined && change.newCostVersion === undefined) {
        const peer = await financeQuery(InventoryPosition.findOne({ ownerId: scope.ownerId, productId: scope.productId, variantId: scope.variantId, currency: scope.currency, key: { $ne: positionKey } }).sort({ costVersion: -1 })).lean();
        change.newCostVersion = peer?.unitCost === change.newUnitCost ? Math.max(peer.costVersion, before.costVersion + (before.unitCost === change.newUnitCost ? 0 : 1)) : before.costVersion + 1;
      }
      const after = changedInventoryPosition(before, change);
      const postings = await prepareFinancePostings(rawPostings);
      const expectedDelta = Math.sign(after.carryingValue - before.carryingValue) * inventoryMoney(Math.abs(after.carryingValue - before.carryingValue), scope.currency);
      if (inventoryLedgerEffect(postings, scope.currency) !== expectedDelta - (input.fundingAdopted ?? 0)) throw new ApiError("The posting plan does not match the inventory value change.", 409, "INVENTORY_POSTING_MISMATCH");
      for (const row of postings) {
        if (!row.key || row.debit === row.credit || !Number.isFinite(row.amount) || row.amount <= 0) throw new ApiError("Inventory posting legs must be positive and name different accounts.", 409, "INVALID_INVENTORY_POSTING");
        if (row.book !== "own" || String(row.vendorId) !== scope.ownerId) throw new ApiError("Stock postings belong to the selected own-store book.", 409, "INVENTORY_POSTING_SCOPE_MISMATCH");
      }
      if (new Set(postings.map((row) => row.key)).size !== postings.length) throw new ApiError("Posting keys within a movement must be unique.", 409, "INVENTORY_POSTING_KEY_CONFLICT");
      if (postings.length && postings.some((row) => row.date.getTime() !== postings[0].date.getTime())) throw new ApiError("One movement cannot have multiple accounting dates.", 409, "INVENTORY_POSTING_DATE_MISMATCH");
      // Dates are resolved even for explicit zero-valued events.
      const accountingAt = postings[0]?.date ?? (await prepareFinancePostings([{
        date: input.occurredAt, book: "own", debit: "inventory", credit: "inventory_adjustments",
        amount: 0, currency: scope.currency, vendorId: scope.ownerId,
        key: `inventory_movement:${movementId}:date`, source: { kind: "inventory_movement", id: String(movementId) },
      }]))[0].date;

      if (input.changeStock) await input.changeStock(before);
      Object.assign(position, after, { lastMovementId: movementId });
      await position.save({ session: financeSession() });
      const { Product } = await import("@/models/product.model");
      const { financialStockRows } = await import("./finance-catalog");
      const product = await financeQuery(Product.findById(scope.productId)).lean();
      const physicalAvailableAfter = product ? financialStockRows(product).find((r) => r.variantId === scope.variantId && r.locationId === scope.locationId)?.quantity ?? null : null;
      await InventoryMovement.create([{
        _id: movementId, key: `${input.actorId}:${action}:${input.requestKey}`,
        fingerprint: financialFingerprint(fingerprint), ...scope,
        positionKey, productName: input.productName, variantName: input.variantName ?? null,
        sku: input.sku ?? "", reason: input.reason,
        quantityBefore: before.quantity, quantityDelta: change.quantityDelta, quantityAfter: after.quantity,
        physicalQuantityDelta: input.physicalQuantityDelta ?? change.quantityDelta,
        physicalAvailableAfter, physicalUnavailableDelta: input.physicalUnavailableDelta ?? 0, financialState: input.financialState ?? (input.reason === "reserve" ? "owned_reserved_uncosted" : input.reason === "transfer" ? "owned_in_transit" : change.stateDeltas?.unavailableOwned && change.stateDeltas.unavailableOwned > 0 ? "owned_unavailable" : change.quantityDelta < 0 ? "written_off" : "owned_available"),
        valueBefore: before.carryingValue, valueDelta: expectedDelta, valueAfter: after.carryingValue,
        unitCost: after.unitCost, costVersion: after.costVersion,
        statesAfter: { availableOwned: after.availableOwned, reservedUncosted: after.reservedUncosted, unavailableOwned: after.unavailableOwned, inTransitOwned: after.inTransitOwned },
        missingCostQuantityAfter: after.missingCostQuantity ?? position.missingCostQuantity,
        occurredAt: input.occurredAt, accountingAt, actorId: input.actorId, channel: input.channel,
        source: input.source, expenseId: input.expenseId, fundingAdopted: input.fundingAdopted ?? 0, paymentDisposition: input.paymentDisposition, reversesMovementId: input.reversesMovementId, note: input.note ?? null, postings, generation: 1,
      }], { session: financeSession() });
      await input.afterMovement?.(String(movementId), before);
      return {
        sourceId: movementId, vendorId: scope.ownerId, postings,
        result: {
          movementId: String(movementId), positionKey, quantityBefore: before.quantity,
          quantityAfter: after.quantity, bookValueBefore: before.carryingValue,
          bookValueAfter: after.carryingValue, version: after.version,
          currency: scope.currency, accountingAt: accountingAt.toISOString(),
        },
      };
    },
  });
  return result;
}
