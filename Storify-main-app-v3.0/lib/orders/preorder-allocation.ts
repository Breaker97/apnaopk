import { Types, type ClientSession } from "mongoose";
import { markForMetaCatalog } from "@/lib/meta-catalog/mark-later";
import { Order, Product } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import {
  PURCHASE_TYPE,
  preorderQuotaVariantId,
} from "@/lib/orders/preorders";
import {
  productAllowsOversell,
  productTracksStock,
} from "@/lib/products/stock-policy";
import { DISPATCHED_ORDER_STATUSES } from "@/lib/orders/order-status-workflow";
import {
  TransactionContendedError,
  TransactionOutcomeUnknownError,
  TransactionsUnavailableError,
  getTransactionSupport,
  runTransaction,
} from "@/lib/db-transaction";
import type { InventoryAdjustmentLine } from "@/lib/inventory/inventory";

/**
 * Taking a pre-order's received units off the shelf — once, exactly, and
 * provably.
 *
 * The old path cleared the consignment's reservation flag first and moved the
 * stock after it, and treated "no reservation flag left" as "already
 * allocated". A second request arriving between the two saw no flag and
 * released the order for fulfilment while the first was still about to fail
 * for want of stock: an order in the warehouse queue with nothing behind it.
 *
 * Now the eligibility check, every stock decrement, the reservation counter
 * and the evidence written on the order commit together in one transaction,
 * or not at all. The evidence (`subOrders[].preorderAllocation`) is the ONLY
 * thing that stands for "allocated": it names the operation, the exact units
 * and the branch each came off, so a cancellation puts back precisely what
 * was taken, to the shelf it came from, and only once. A missing reservation
 * flag proves nothing — it can mean released, cancelled, a crashed legacy
 * request or a bug — and is reported for a person to reconcile rather than
 * read as success.
 *
 * A deployment that cannot run transactions gets `unavailable`, never the old
 * unsafe path. Everything outside the database — cache refreshes, low-stock
 * alerts, waitlist invitations — runs after the commit and cannot turn an
 * allocation into a failure.
 */

export type AllocationSource =
  | "admin"
  | "vendor"
  | "auto"
  | "settlement"
  | "recovery"
  | "legacy";

/** One line that could not be covered, as a person would act on it. */
export type StockBlocker = {
  subOrderId: string;
  vendorId: string;
  productId: string;
  variantId?: string;
  requested: number;
  available: number;
};

export type AllocationOutcome =
  | {
      kind: "allocated" | "already_allocated";
      operationId: string;
      subOrderIds: string[];
    }
  | { kind: "in_progress"; retryAfterSeconds: number }
  | { kind: "insufficient_stock"; blockers: StockBlocker[] }
  | {
      kind: "not_eligible" | "reconciliation_required";
      reason: string;
      subOrderIds?: string[];
    }
  /** The deployment cannot allocate safely at all — see `db-transaction.ts`. */
  | { kind: "unavailable"; reason: string };

type AllocationFailure = Exclude<
  AllocationOutcome,
  { kind: "allocated" | "already_allocated" }
>;

/** How long a caller that lost a race should wait before asking again. */
export const ALLOCATION_RETRY_AFTER_SECONDS = 5;

/**
 * Thrown inside a transaction to abort it with a definite answer. Nothing the
 * transaction wrote survives it.
 */
export class AllocationAbort extends Error {
  readonly outcome: AllocationFailure;

  constructor(outcome: AllocationFailure) {
    super(`Allocation aborted: ${outcome.kind}`);
    this.name = "AllocationAbort";
    this.outcome = outcome;
  }
}

/** Reason codes a person can act on, shared by the screens and the report. */
export const ALLOCATION_REASONS = {
  orderNotFound: "order_not_found",
  orderCancelled: "order_cancelled",
  unknownConsignment: "unknown_consignment",
  cancelled: "consignment_cancelled",
  dispatched: "consignment_dispatched",
  notWaiting: "consignment_not_waiting",
  noPreorderLines: "no_preorder_lines",
  mixedConsignment: "mixed_consignment",
  legacyInventoryFlag: "legacy_inventory_flag",
  missingReservation: "missing_reservation_flag",
} as const;

type AllocationItem = {
  productId: unknown;
  variantId?: unknown;
  quantity: number;
  purchaseType?: string;
};

type AllocationLineEvidence = {
  productId: unknown;
  variantId?: unknown;
  quantity: number;
  stockTracked: boolean;
  parts?: Array<{ locationId: string; quantity: number }>;
  quotaOwner?: "product" | "variant";
  quotaReleased?: boolean;
};

export type AllocationSubOrder = {
  _id?: unknown;
  vendorId?: unknown;
  status?: string;
  items?: AllocationItem[] | null;
  inventoryReserved?: boolean;
  preorderReserved?: boolean;
  preorderAllocation?: {
    operationId?: string;
    state?: string;
    lines?: AllocationLineEvidence[] | null;
  } | null;
  fulfillment?: {
    method?: string;
    pickup?: { pickupLocationId?: unknown } | null;
    fulfillmentLocationId?: unknown;
  } | null;
};

type AllocationOrder = {
  _id: unknown;
  status?: string;
  subOrders?: AllocationSubOrder[] | null;
};

const id = (value: unknown) =>
  String((value as { _id?: unknown } | null)?._id ?? value ?? "");

function preorderItems(sub: AllocationSubOrder): AllocationItem[] {
  return (sub.items || []).filter(
    (item) =>
      item &&
      item.purchaseType === PURCHASE_TYPE.PREORDER &&
      Number(item.quantity) > 0,
  );
}

export type ConsignmentAllocationClass =
  | { state: "allocated"; operationId: string }
  | { state: "reserved" }
  | { state: "not_eligible"; reason: string }
  | { state: "ambiguous"; reason: string };

/**
 * What one consignment's pre-order stock is, judged from evidence alone.
 *
 * Pure, so the rule can be read and tested without a database, and shared by
 * the allocation itself, the screens and the migration report: the three must
 * never disagree about which consignments a person has to look at.
 */
export function classifyConsignmentAllocation(
  sub: AllocationSubOrder,
): ConsignmentAllocationClass {
  const status = String(sub.status || "");
  if (status === ORDER_STATUS.CANCELLED) {
    return { state: "not_eligible", reason: ALLOCATION_REASONS.cancelled };
  }
  if (sub.preorderAllocation?.state === "committed") {
    return {
      state: "allocated",
      operationId: String(sub.preorderAllocation.operationId || ""),
    };
  }
  if (DISPATCHED_ORDER_STATUSES.includes(status)) {
    return { state: "not_eligible", reason: ALLOCATION_REASONS.dispatched };
  }
  if (status !== ORDER_STATUS.PREORDERED) {
    return { state: "not_eligible", reason: ALLOCATION_REASONS.notWaiting };
  }
  const lines = preorderItems(sub);
  if (lines.length === 0) {
    return { state: "not_eligible", reason: ALLOCATION_REASONS.noPreorderLines };
  }
  const hasStandardLines = (sub.items || []).some(
    (item) => item && item.purchaseType !== PURCHASE_TYPE.PREORDER,
  );
  if (sub.inventoryReserved === true) {
    // Stock already moved for this consignment and nothing recorded what:
    // standard lines taken at checkout beside the pre-order ones, or an
    // allocation from before evidence existed. Either way an allocation now
    // could take the same units twice, and a restore could not tell which
    // units are which.
    return {
      state: "ambiguous",
      reason: hasStandardLines
        ? ALLOCATION_REASONS.mixedConsignment
        : ALLOCATION_REASONS.legacyInventoryFlag,
    };
  }
  if (sub.preorderReserved === true) return { state: "reserved" };
  return { state: "ambiguous", reason: ALLOCATION_REASONS.missingReservation };
}

/**
 * Where a line's units come from: the branches to draw on and how many each.
 *
 * Preference first (the counter a shopper collects from, the branch the
 * consignment was booked to, then the merchant's dispatch order), then the
 * fullest. One branch that covers the whole line is used on its own; failing
 * that the line is split across branches, and every part is recorded, so a
 * restore puts each unit back where it was taken from. A product that keeps no
 * per-location stock has no parts.
 *
 * Insufficient unless the product sells past zero, in which case the shortfall
 * lands on the first preference — the same rule an ordinary online sale
 * follows for "continue selling when out of stock".
 */
export function planAllocationParts(params: {
  locations: Array<{ locationId?: unknown; quantity?: number }>;
  quantity: number;
  preferred: string[];
  allowOversell: boolean;
}): {
  parts: Array<{ locationId: string; quantity: number }>;
  available: number;
  sufficient: boolean;
} {
  const quantity = params.quantity;
  const entries = params.locations
    .filter((entry) => entry && entry.locationId != null)
    .map((entry) => ({
      locationId: String(entry.locationId),
      quantity: Number(entry.quantity || 0),
    }));
  if (entries.length === 0) {
    return { parts: [], available: Number.POSITIVE_INFINITY, sufficient: true };
  }
  const available = entries.reduce(
    (sum, entry) => sum + Math.max(0, entry.quantity),
    0,
  );
  const preferenceRank = new Map<string, number>();
  params.preferred.forEach((locationId, index) => {
    if (!preferenceRank.has(locationId)) preferenceRank.set(locationId, index);
  });
  const ordered = [...entries].sort((a, b) => {
    const rankA = preferenceRank.get(a.locationId) ?? Number.MAX_SAFE_INTEGER;
    const rankB = preferenceRank.get(b.locationId) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return b.quantity - a.quantity;
  });

  const single = ordered.find((entry) => entry.quantity >= quantity);
  if (single) {
    return {
      parts: [{ locationId: single.locationId, quantity }],
      available,
      sufficient: true,
    };
  }

  const parts: Array<{ locationId: string; quantity: number }> = [];
  let remaining = quantity;
  for (const entry of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, entry.quantity));
    if (take <= 0) continue;
    parts.push({ locationId: entry.locationId, quantity: take });
    remaining -= take;
  }
  if (remaining > 0) {
    if (!params.allowOversell) return { parts: [], available, sufficient: false };
    const target = ordered[0];
    const existing = parts.find((part) => part.locationId === target.locationId);
    if (existing) existing.quantity += remaining;
    else parts.unshift({ locationId: target.locationId, quantity: remaining });
  }
  return { parts, available, sufficient: true };
}

type ProductStockDoc = {
  _id: unknown;
  stock?: number;
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean } | null;
  locationInventory?: Array<{ locationId?: unknown; quantity?: number }>;
  preorder?: { enabled?: boolean } | null;
  variants?: Array<{
    _id?: unknown;
    stock?: number;
    locationInventory?: Array<{ locationId?: unknown; quantity?: number }>;
    preorder?: { enabled?: boolean } | null;
  }>;
};

const PRODUCT_STOCK_FIELDS =
  "stock shipping.isPhysicalProduct inventory locationInventory preorder variants._id variants.stock variants.locationInventory variants.preorder";

/** The branch preferences of each consignment, read before any transaction. */
export async function loadAllocationPreferences(
  order: AllocationOrder,
): Promise<Map<string, string[]>> {
  const preferences = new Map<string, string[]>();
  const subs = order.subOrders || [];
  const vendorIds = Array.from(
    new Set(subs.map((sub) => id(sub.vendorId)).filter(Boolean)),
  );
  const ranked = new Map<string, string[]>();
  try {
    const { fulfillmentCandidatesForVendor } = await import(
      "@/lib/locations/fulfillment-location"
    );
    await Promise.all(
      vendorIds.map(async (vendorId) => {
        ranked.set(
          vendorId,
          (await fulfillmentCandidatesForVendor(vendorId)).map(
            (candidate) => candidate.id,
          ),
        );
      }),
    );
  } catch (error) {
    // A preference, never a precondition: without it the fullest branch wins.
    console.error("Failed to load pre-order dispatch preferences:", error);
  }
  for (const sub of subs) {
    const fulfillment = sub.fulfillment;
    const explicit =
      fulfillment?.method === "pickup"
        ? fulfillment.pickup?.pickupLocationId
        : fulfillment?.fulfillmentLocationId;
    const list = explicit ? [String(explicit)] : [];
    for (const locationId of ranked.get(id(sub.vendorId)) || []) {
      if (!list.includes(locationId)) list.push(locationId);
    }
    preferences.set(id(sub._id), list);
  }
  return preferences;
}

/** Test seam: pause or fail an allocation at a named point. */
export type AllocationHooks = {
  afterRead?: () => Promise<void> | void;
  afterOrderClaim?: () => Promise<void> | void;
  afterStock?: () => Promise<void> | void;
};

export type InSessionAllocation = {
  kind: "allocated" | "already_allocated";
  operationId: string;
  subOrderIds: string[];
  /** Units that left a shelf in this call — for the post-commit aftermath. */
  movedLines: InventoryAdjustmentLine[];
  /** Lines whose reservation place was freed — the waitlist's cue. */
  freedQuota: Array<{ productId: string; variantId?: string }>;
};

export function newAllocationOperationId(): string {
  return `alloc_${new Types.ObjectId().toHexString()}`;
}

function asObjectId(value: unknown): Types.ObjectId | unknown {
  const text = id(value);
  return Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : value;
}

/**
 * Allocate exactly `subOrderIds`, inside the caller's transaction.
 *
 * All or nothing: a consignment that is not eligible, ambiguous or short of
 * stock aborts the whole call with an {@link AllocationAbort}, and the
 * caller's transaction rolls back every write it made. Consignments already
 * holding committed evidence are left alone, so a repeat is
 * `already_allocated` only when every requested consignment is covered.
 *
 * The order document is written before any product, so a concurrent writer of
 * the same order — a cancellation, a second allocation — either waits for
 * this transaction or makes it abort and run again on fresh data. Reads and
 * writes are strictly sequential on the one session.
 */
export async function allocateConsignmentsInSession(params: {
  session: ClientSession;
  orderId: string;
  subOrderIds: string[];
  operationId: string;
  source: AllocationSource;
  now: Date;
  preferences?: Map<string, string[]>;
  hooks?: AllocationHooks;
}): Promise<InSessionAllocation> {
  const { session, operationId, now } = params;
  if (!Types.ObjectId.isValid(params.orderId)) {
    throw new AllocationAbort({
      kind: "not_eligible",
      reason: ALLOCATION_REASONS.orderNotFound,
    });
  }
  const order = (await Order.findById(params.orderId)
    .session(session)
    .select(
      "_id status subOrders._id subOrders.vendorId subOrders.status subOrders.items subOrders.inventoryReserved subOrders.preorderReserved subOrders.preorderAllocation subOrders.fulfillment",
    )
    .lean()) as AllocationOrder | null;
  if (!order) {
    throw new AllocationAbort({
      kind: "not_eligible",
      reason: ALLOCATION_REASONS.orderNotFound,
    });
  }
  if (order.status === ORDER_STATUS.CANCELLED) {
    throw new AllocationAbort({
      kind: "not_eligible",
      reason: ALLOCATION_REASONS.orderCancelled,
    });
  }

  const requested = Array.from(new Set(params.subOrderIds.map(String)));
  if (requested.length === 0) {
    throw new AllocationAbort({
      kind: "not_eligible",
      reason: ALLOCATION_REASONS.unknownConsignment,
    });
  }
  const subs = order.subOrders || [];
  const toAllocate: AllocationSubOrder[] = [];
  const covered: string[] = [];
  const notEligible: string[] = [];
  const ambiguous: string[] = [];
  let firstRefusal: string | null = null;
  let firstAmbiguity: string | null = null;
  for (const subId of requested) {
    const sub = subs.find((candidate) => id(candidate._id) === subId);
    if (!sub) {
      notEligible.push(subId);
      firstRefusal ??= ALLOCATION_REASONS.unknownConsignment;
      continue;
    }
    const verdict = classifyConsignmentAllocation(sub);
    if (verdict.state === "allocated") covered.push(subId);
    else if (verdict.state === "reserved") toAllocate.push(sub);
    else if (verdict.state === "not_eligible") {
      notEligible.push(subId);
      firstRefusal ??= verdict.reason;
    } else {
      ambiguous.push(subId);
      firstAmbiguity ??= verdict.reason;
    }
  }
  if (notEligible.length > 0) {
    throw new AllocationAbort({
      kind: "not_eligible",
      reason: firstRefusal || ALLOCATION_REASONS.notWaiting,
      subOrderIds: notEligible,
    });
  }
  if (ambiguous.length > 0) {
    throw new AllocationAbort({
      kind: "reconciliation_required",
      reason: firstAmbiguity || ALLOCATION_REASONS.missingReservation,
      subOrderIds: ambiguous,
    });
  }
  if (toAllocate.length === 0) {
    const evidence = subs.find((sub) => covered.includes(id(sub._id)))
      ?.preorderAllocation?.operationId;
    return {
      kind: "already_allocated",
      operationId: String(evidence || operationId),
      subOrderIds: requested,
      movedLines: [],
      freedQuota: [],
    };
  }

  // Every product the allocation touches, read once on the same snapshot.
  const productIds = Array.from(
    new Set(
      toAllocate.flatMap((sub) => preorderItems(sub).map((item) => id(item.productId))),
    ),
  ).filter((productId) => Types.ObjectId.isValid(productId));
  const products = (await Product.find({ _id: { $in: productIds } })
    .session(session)
    .select(PRODUCT_STOCK_FIELDS)
    .lean()) as ProductStockDoc[];
  const productById = new Map(products.map((product) => [id(product._id), product]));

  // Plan every line before writing anything: a shortfall anywhere is reported
  // whole, and nothing is moved for the lines that would have fitted.
  type PlannedLine = {
    sub: AllocationSubOrder;
    productId: string;
    variantId?: string;
    quantity: number;
    product: ProductStockDoc;
    tracked: boolean;
    guarded: boolean;
    parts: Array<{ locationId: string; quantity: number }>;
    quotaOwner: "product" | "variant";
  };
  const planned: PlannedLine[] = [];
  const blockers: StockBlocker[] = [];
  // Several lines (or consignments) can draw on one shelf; each plan sees
  // what the earlier ones in this call already took.
  const takenAt = new Map<string, number>();
  const takenTotal = new Map<string, number>();
  for (const sub of toAllocate) {
    const preferred = params.preferences?.get(id(sub._id)) || [];
    for (const item of preorderItems(sub)) {
      const productId = id(item.productId);
      const variantId = item.variantId ? id(item.variantId) : undefined;
      const quantity = Number(item.quantity);
      const product = productById.get(productId);
      const variant = variantId
        ? product?.variants?.find((candidate) => id(candidate._id) === variantId)
        : undefined;
      if (!product || (variantId && !variant)) {
        blockers.push({
          subOrderId: id(sub._id),
          vendorId: id(sub.vendorId),
          productId,
          variantId,
          requested: quantity,
          available: 0,
        });
        continue;
      }
      const tracked = productTracksStock(product);
      const allowOversell = productAllowsOversell(product);
      const quotaOwner =
        preorderQuotaVariantId(
          product as Parameters<typeof preorderQuotaVariantId>[0],
          variantId,
        ) !== undefined
          ? "variant"
          : "product";
      if (!tracked) {
        planned.push({
          sub,
          productId,
          variantId,
          quantity,
          product,
          tracked,
          guarded: false,
          parts: [],
          quotaOwner,
        });
        continue;
      }
      const stockKey = `${productId}:${variantId || ""}`;
      const locations = (variant ? variant.locationInventory : product.locationInventory) || [];
      const adjusted = locations.map((entry) => ({
        locationId: entry.locationId,
        quantity:
          Number(entry.quantity || 0) -
          (takenAt.get(`${stockKey}@${String(entry.locationId)}`) || 0),
      }));
      const aggregate =
        Number((variant ? variant.stock : product.stock) ?? 0) -
        (takenTotal.get(stockKey) || 0);
      const plan = planAllocationParts({
        locations: adjusted,
        quantity,
        preferred,
        allowOversell,
      });
      const aggregateShort = !allowOversell && aggregate < quantity;
      if (!plan.sufficient || aggregateShort) {
        blockers.push({
          subOrderId: id(sub._id),
          vendorId: id(sub.vendorId),
          productId,
          variantId,
          requested: quantity,
          available: Math.max(
            0,
            Math.min(
              aggregate,
              Number.isFinite(plan.available) ? plan.available : aggregate,
            ),
          ),
        });
        continue;
      }
      for (const part of plan.parts) {
        const key = `${stockKey}@${part.locationId}`;
        takenAt.set(key, (takenAt.get(key) || 0) + part.quantity);
      }
      takenTotal.set(stockKey, (takenTotal.get(stockKey) || 0) + quantity);
      planned.push({
        sub,
        productId,
        variantId,
        quantity,
        product,
        tracked,
        guarded: !allowOversell,
        parts: plan.parts,
        quotaOwner,
      });
    }
  }
  if (blockers.length > 0) {
    throw new AllocationAbort({ kind: "insufficient_stock", blockers });
  }
  await params.hooks?.afterRead?.();

  // The claim and the evidence, in one write on the order — first, so the
  // order's lock is held before any shelf moves.
  const set: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  const claimConditions: Record<string, unknown>[] = [];
  toAllocate.forEach((sub, index) => {
    const name = `alloc${index}`;
    const lines = planned
      .filter((line) => line.sub === sub)
      .map((line) => ({
        productId: asObjectId(line.productId),
        ...(line.variantId ? { variantId: asObjectId(line.variantId) } : {}),
        quantity: line.quantity,
        stockTracked: line.tracked,
        ...(line.parts.length > 0 ? { parts: line.parts } : {}),
        quotaOwner: line.quotaOwner,
        quotaReleased: true,
      }));
    set[`subOrders.$[${name}].preorderReserved`] = false;
    set[`subOrders.$[${name}].inventoryReserved`] = true;
    set[`subOrders.$[${name}].preorderAllocation`] = {
      operationId,
      state: "committed",
      source: params.source,
      committedAt: now,
      lines,
    };
    arrayFilters.push({ [`${name}._id`]: asObjectId(sub._id) });
    claimConditions.push({
      subOrders: {
        $elemMatch: {
          _id: asObjectId(sub._id),
          status: ORDER_STATUS.PREORDERED,
          preorderReserved: true,
          "preorderAllocation.state": { $ne: "committed" },
        },
      },
    });
  });
  const claim = await Order.updateOne(
    {
      _id: order._id,
      status: { $ne: ORDER_STATUS.CANCELLED },
      $and: claimConditions,
    },
    { $set: set },
    { session, arrayFilters },
  );
  if (claim.matchedCount !== 1) {
    // The snapshot said these consignments were waiting; the write says not.
    // Never guessed at — the caller retries on a fresh read.
    throw new TransactionContendedError("Allocate pre-order stock");
  }
  await params.hooks?.afterOrderClaim?.();

  const movedLines: InventoryAdjustmentLine[] = [];
  for (const line of planned) {
    if (!line.tracked) continue;
    await decrementLineInSession(session, line);
    movedLines.push({
      productId: line.productId,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      quantity: line.quantity,
    });
  }
  await params.hooks?.afterStock?.();

  // The places these units held on the reservation counter are free now: the
  // units themselves are off the shelf and committed to this order.
  const freedQuota: Array<{ productId: string; variantId?: string }> = [];
  for (const line of planned) {
    await adjustQuotaInSession(session, {
      productId: line.productId,
      variantId: line.quotaOwner === "variant" ? line.variantId : undefined,
      delta: -line.quantity,
    });
    freedQuota.push({ productId: line.productId, variantId: line.variantId });
  }

  return {
    kind: "allocated",
    operationId,
    subOrderIds: requested,
    movedLines,
    freedQuota,
  };
}

async function decrementLineInSession(
  session: ClientSession,
  line: {
    productId: string;
    variantId?: string;
    quantity: number;
    guarded: boolean;
    parts: Array<{ locationId: string; quantity: number }>;
    sub: AllocationSubOrder;
    product: ProductStockDoc;
  },
): Promise<void> {
  const conditions: Record<string, unknown>[] = [];
  const inc: Record<string, number> = { stock: -line.quantity };
  const arrayFilters: Record<string, unknown>[] = [];
  if (line.variantId) {
    const variantId = asObjectId(line.variantId);
    inc["variants.$[v].stock"] = -line.quantity;
    arrayFilters.push({ "v._id": variantId });
    conditions.push({
      variants: {
        $elemMatch: {
          _id: variantId,
          ...(line.guarded ? { stock: { $gte: line.quantity } } : {}),
        },
      },
    });
    line.parts.forEach((part, index) => {
      inc[`variants.$[v].locationInventory.$[li${index}].quantity`] = -part.quantity;
      arrayFilters.push({ [`li${index}.locationId`]: part.locationId });
      conditions.push({
        variants: {
          $elemMatch: {
            _id: variantId,
            locationInventory: {
              $elemMatch: {
                locationId: part.locationId,
                ...(line.guarded ? { quantity: { $gte: part.quantity } } : {}),
              },
            },
          },
        },
      });
    });
  } else {
    line.parts.forEach((part, index) => {
      inc[`locationInventory.$[li${index}].quantity`] = -part.quantity;
      arrayFilters.push({ [`li${index}.locationId`]: part.locationId });
      conditions.push({
        locationInventory: {
          $elemMatch: {
            locationId: part.locationId,
            ...(line.guarded ? { quantity: { $gte: part.quantity } } : {}),
          },
        },
      });
    });
  }
  const result = await Product.updateOne(
    {
      _id: asObjectId(line.productId),
      ...(line.guarded ? { stock: { $gte: line.quantity } } : {}),
      ...(conditions.length > 0 ? { $and: conditions } : {}),
    },
    { $inc: inc },
    { session, ...(arrayFilters.length > 0 ? { arrayFilters } : {}) },
  );
  if (result.matchedCount !== 1) {
    throw new AllocationAbort({
      kind: "insufficient_stock",
      blockers: [
        {
          subOrderId: id(line.sub._id),
          vendorId: id(line.sub.vendorId),
          productId: line.productId,
          variantId: line.variantId,
          requested: line.quantity,
          available: Math.max(
            0,
            Number(
              (line.variantId
                ? line.product.variants?.find((v) => id(v._id) === line.variantId)?.stock
                : line.product.stock) ?? 0,
            ),
          ),
        },
      ],
    });
  }
}

/**
 * Move a reservation counter by `delta` inside the caller's session — never
 * below zero. The variant's own counter when it has pre-order settings of its
 * own, the product's otherwise (`preorderQuotaVariantId`).
 */
async function adjustQuotaInSession(
  session: ClientSession | undefined,
  params: { productId: string; variantId?: string; delta: number },
): Promise<void> {
  const { productId, variantId, delta } = params;
  if (!delta) return;
  if (variantId) {
    const variantObjectId = asObjectId(variantId);
    await Product.updateOne(
      { _id: asObjectId(productId), "variants._id": variantObjectId },
      [
        {
          $set: {
            variants: {
              $map: {
                input: "$variants",
                as: "variant",
                in: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ["$$variant._id", variantObjectId] },
                        { $eq: [{ $type: "$$variant.preorder" }, "object"] },
                      ],
                    },
                    {
                      $mergeObjects: [
                        "$$variant",
                        {
                          preorder: {
                            $mergeObjects: [
                              "$$variant.preorder",
                              {
                                reservedQuantity: {
                                  $max: [
                                    0,
                                    {
                                      $add: [
                                        {
                                          $ifNull: [
                                            "$$variant.preorder.reservedQuantity",
                                            0,
                                          ],
                                        },
                                        delta,
                                      ],
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                    "$$variant",
                  ],
                },
              },
            },
          },
        },
      ],
      { session, updatePipeline: true },
    );
    return;
  }
  await Product.updateOne(
    { _id: asObjectId(productId), "preorder.enabled": { $exists: true } },
    [
      {
        $set: {
          "preorder.reservedQuantity": {
            $max: [
              0,
              { $add: [{ $ifNull: ["$preorder.reservedQuantity", 0] }, delta] },
            ],
          },
        },
      },
    ],
    { session, updatePipeline: true },
  );
}

/** Map anything an allocation can throw to its typed answer. */
export function allocationOutcomeFromError(error: unknown): AllocationFailure {
  if (error instanceof AllocationAbort) return error.outcome;
  if (error instanceof TransactionsUnavailableError) {
    return { kind: "unavailable", reason: error.message };
  }
  if (
    error instanceof TransactionContendedError ||
    error instanceof TransactionOutcomeUnknownError
  ) {
    return { kind: "in_progress", retryAfterSeconds: ALLOCATION_RETRY_AFTER_SECONDS };
  }
  throw error;
}

/**
 * The post-commit tail of an allocation: storefront caches, low-stock alerts
 * and the waitlist. Never fails the allocation it follows.
 */
export async function runAllocationAftermath(
  result: Pick<InSessionAllocation, "movedLines" | "freedQuota">,
): Promise<void> {
  try {
    if (result.movedLines.length > 0) {
      const { runStockMovementAftermath } = await import("@/lib/inventory/inventory");
      await runStockMovementAftermath(result.movedLines, -1);
    }
  } catch (error) {
    console.error("Failed to run the aftermath of a pre-order allocation:", error);
  }
  // Places given back can bring an item back to Meta (the moved stock above
  // tells it through the stock aftermath).
  if (result.freedQuota.length > 0) {
    await markForMetaCatalog(result.freedQuota.map((line) => line.productId));
  }
  if (result.freedQuota.length > 0) {
    // An invitation missed here is picked up by the daily waitlist sweep.
    import("@/lib/orders/preorder-waitlist")
      .then(({ notifyPreorderWaitlistsForLines }) =>
        notifyPreorderWaitlistsForLines(result.freedQuota),
      )
      .catch((error) =>
        console.error("Failed to invite the pre-order waitlist:", error),
      );
  }
}

/**
 * Allocate exactly these consignments in a transaction of their own.
 *
 * For callers that do nothing else in the same unit of work. Preparing a
 * balance request or releasing an order for fulfilment calls
 * {@link allocateConsignmentsInSession} inside its own transaction instead, so
 * the allocation and the state it justifies commit together.
 */
export async function allocatePreorderConsignments(params: {
  orderId: string;
  subOrderIds: string[];
  source: AllocationSource;
  operationId?: string;
  now?: Date;
  hooks?: AllocationHooks;
}): Promise<AllocationOutcome> {
  const operationId = params.operationId || newAllocationOperationId();
  const now = params.now || new Date();
  try {
    const order = Types.ObjectId.isValid(params.orderId)
      ? ((await Order.findById(params.orderId)
          .select("_id status subOrders._id subOrders.vendorId subOrders.fulfillment")
          .lean()) as AllocationOrder | null)
      : null;
    const preferences = order ? await loadAllocationPreferences(order) : new Map();
    const result = await runTransaction("Allocate pre-order stock", (session) =>
      allocateConsignmentsInSession({
        session,
        orderId: params.orderId,
        subOrderIds: params.subOrderIds,
        operationId,
        source: params.source,
        now,
        preferences,
        hooks: params.hooks,
      }),
    );
    await runAllocationAftermath(result);
    return {
      kind: result.kind,
      operationId: result.operationId,
      subOrderIds: result.subOrderIds,
    };
  } catch (error) {
    return allocationOutcomeFromError(error);
  }
}

// ---------------------------------------------------------------------------
// Restoration
// ---------------------------------------------------------------------------

export type RestoredConsignment = {
  subOrderId: string;
  vendorId: string;
  lines: InventoryAdjustmentLine[];
};

export type RestoreAllocationsResult = {
  restored: RestoredConsignment[];
  /** Lines whose reservation place was taken back (unallocate only). */
  requoted: Array<{ productId: string; variantId?: string }>;
};

/**
 * Put back the units committed evidence says were taken — exactly those, to
 * the branches they came off, once.
 *
 * `cancelled` puts them back on sale: the shopper is not getting them. Their
 * reservation place stays released — it was given up when the units were
 * allocated, and the order is leaving.
 *
 * `unallocated` returns the consignment to the state it was in before it was
 * prepared: units back on the shelf AND its place back on the reservation
 * counter, flagged reserved again, so the next preparation allocates it afresh.
 * That is the delay/withdraw path, where the shopper is still waiting.
 *
 * The flip from `committed` to `restored` is the claim, written first and on
 * the same session as every increment: inside a transaction they commit
 * together; on a deployment without one the claim still happens once, and a
 * crash between the two loses the increment rather than doubling it.
 */
export async function restoreAllocationsInSession(params: {
  session?: ClientSession;
  orderId: string;
  /** Omitted: every consignment holding committed evidence. */
  subOrderIds?: string[];
  mode: "cancelled" | "unallocated";
  operationId: string;
  now: Date;
  /** Cancel mode only: also consignments that shipped (a full-refund restock). */
  includeDispatched?: boolean;
  /** Cancel mode only: consignments never to be restocked. */
  excludeSubOrderIds?: ReadonlyArray<unknown>;
  /**
   * Units a return already put back, which an order-wide restock leaves out —
   * see `returnRestockedUnits` in `order-inventory.ts`. Consumed as used.
   */
  alreadyBack?: Map<string, number>;
}): Promise<RestoreAllocationsResult> {
  const { session } = params;
  if (!Types.ObjectId.isValid(params.orderId)) return { restored: [], requoted: [] };
  const query = Order.findById(params.orderId).select(
    "_id status subOrders._id subOrders.vendorId subOrders.status subOrders.preorderAllocation",
  );
  if (session) query.session(session);
  const order = (await query.lean()) as AllocationOrder | null;
  if (!order) return { restored: [], requoted: [] };

  const wanted = params.subOrderIds ? new Set(params.subOrderIds.map(String)) : null;
  const excluded = new Set((params.excludeSubOrderIds || []).map((value) => id(value)));
  const targets = (order.subOrders || []).filter((sub) => {
    if (sub.preorderAllocation?.state !== "committed") return false;
    if (wanted && !wanted.has(id(sub._id))) return false;
    if (excluded.has(id(sub._id))) return false;
    const dispatched = DISPATCHED_ORDER_STATUSES.includes(String(sub.status || ""));
    if (params.mode === "unallocated") return !dispatched;
    return !dispatched || params.includeDispatched === true;
  });
  if (targets.length === 0) return { restored: [], requoted: [] };

  const set: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  const conditions: Record<string, unknown>[] = [];
  targets.forEach((sub, index) => {
    const name = `rest${index}`;
    set[`subOrders.$[${name}].preorderAllocation.state`] = "restored";
    set[`subOrders.$[${name}].preorderAllocation.restoredAt`] = params.now;
    set[`subOrders.$[${name}].preorderAllocation.restoreReason`] = params.mode;
    set[`subOrders.$[${name}].preorderAllocation.restoreOperationId`] =
      params.operationId;
    set[`subOrders.$[${name}].inventoryReserved`] = false;
    if (params.mode === "unallocated") {
      set[`subOrders.$[${name}].preorderReserved`] = true;
    }
    arrayFilters.push({
      [`${name}._id`]: asObjectId(sub._id),
      [`${name}.preorderAllocation.state`]: "committed",
    });
    conditions.push({
      subOrders: {
        $elemMatch: {
          _id: asObjectId(sub._id),
          "preorderAllocation.state": "committed",
        },
      },
    });
  });
  const claim = await Order.updateOne(
    { _id: order._id, $and: conditions },
    { $set: set },
    { session, arrayFilters },
  );
  if (claim.matchedCount !== 1) {
    // Someone restored (part of) it first. Inside a transaction this cannot
    // happen without a write conflict; without one it is the race lost, and
    // the winner restores.
    if (session) throw new TransactionContendedError("Restore pre-order stock");
    return { restored: [], requoted: [] };
  }

  const restored: RestoredConsignment[] = [];
  const requoted: Array<{ productId: string; variantId?: string }> = [];
  for (const sub of targets) {
    const lines: InventoryAdjustmentLine[] = [];
    for (const line of sub.preorderAllocation?.lines || []) {
      const productId = id(line.productId);
      const variantId = line.variantId ? id(line.variantId) : undefined;
      let quantity = Number(line.quantity || 0);
      if (!(quantity > 0)) continue;
      if (params.mode === "unallocated" && line.quotaReleased) {
        await adjustQuotaInSession(session, {
          productId,
          variantId: line.quotaOwner === "variant" ? variantId : undefined,
          delta: quantity,
        });
        requoted.push({ productId, ...(variantId ? { variantId } : {}) });
      }
      if (!line.stockTracked) continue;
      // A return already put some of these back on the shelf.
      let parts = (line.parts || []).map((part) => ({ ...part }));
      if (params.alreadyBack) {
        const key = `${productId}:${variantId || ""}`;
        const back = Math.min(quantity, params.alreadyBack.get(key) || 0);
        if (back > 0) {
          params.alreadyBack.set(key, (params.alreadyBack.get(key) || 0) - back);
          quantity -= back;
          let toDrop = back;
          for (let index = parts.length - 1; index >= 0 && toDrop > 0; index -= 1) {
            const drop = Math.min(toDrop, parts[index].quantity);
            parts[index].quantity -= drop;
            toDrop -= drop;
          }
          parts = parts.filter((part) => part.quantity > 0);
        }
      }
      if (!(quantity > 0)) continue;
      await incrementLineInSession(session, { productId, variantId, quantity, parts });
      lines.push({ productId, ...(variantId ? { variantId } : {}), quantity });
    }
    restored.push({ subOrderId: id(sub._id), vendorId: id(sub.vendorId), lines });
  }
  return { restored, requoted };
}

async function incrementLineInSession(
  session: ClientSession | undefined,
  line: {
    productId: string;
    variantId?: string;
    quantity: number;
    parts: Array<{ locationId: string; quantity: number }>;
  },
): Promise<void> {
  const productId = asObjectId(line.productId);
  const variantId = line.variantId ? asObjectId(line.variantId) : undefined;
  // A branch removed since the units left gets its entry back first, so the
  // units return to the shelf they came off rather than to the aggregate only.
  for (const part of line.parts) {
    if (variantId) {
      await Product.updateOne(
        {
          _id: productId,
          variants: {
            $elemMatch: {
              _id: variantId,
              "locationInventory.locationId": { $ne: part.locationId },
            },
          },
        },
        {
          $push: {
            "variants.$[v].locationInventory": {
              locationId: part.locationId,
              quantity: 0,
            },
          },
        },
        { session, arrayFilters: [{ "v._id": variantId }] },
      );
    } else {
      await Product.updateOne(
        { _id: productId, "locationInventory.locationId": { $ne: part.locationId } },
        { $push: { locationInventory: { locationId: part.locationId, quantity: 0 } } },
        { session },
      );
    }
  }
  const inc: Record<string, number> = { stock: line.quantity };
  const arrayFilters: Record<string, unknown>[] = [];
  if (variantId) {
    inc["variants.$[v].stock"] = line.quantity;
    arrayFilters.push({ "v._id": variantId });
    line.parts.forEach((part, index) => {
      inc[`variants.$[v].locationInventory.$[li${index}].quantity`] = part.quantity;
      arrayFilters.push({ [`li${index}.locationId`]: part.locationId });
    });
  } else {
    line.parts.forEach((part, index) => {
      inc[`locationInventory.$[li${index}].quantity`] = part.quantity;
      arrayFilters.push({ [`li${index}.locationId`]: part.locationId });
    });
  }
  await Product.updateOne(
    variantId ? { _id: productId, "variants._id": variantId } : { _id: productId },
    { $inc: inc },
    { session, ...(arrayFilters.length > 0 ? { arrayFilters } : {}) },
  );
}

/**
 * Restore committed allocations in a transaction of their own — or, on a
 * deployment that cannot run one, claim-first without it (see
 * {@link restoreAllocationsInSession}). Evidence only exists where allocation
 * ran, which needs transactions, so the second branch is for a database that
 * has since lost its replica set; failing closed there would strand the units
 * of a cancelled order on nobody's shelf.
 */
export async function restoreAllocatedConsignments(params: {
  orderId: string;
  subOrderIds?: string[];
  mode: "cancelled" | "unallocated";
  operationId?: string;
  now?: Date;
  includeDispatched?: boolean;
  excludeSubOrderIds?: ReadonlyArray<unknown>;
  alreadyBack?: Map<string, number>;
}): Promise<
  RestoreAllocationsResult & {
    transactional: boolean;
    /** What is left of `alreadyBack` after this restore took its share. */
    alreadyBack?: Map<string, number>;
  }
> {
  const operationId = params.operationId || `restore_${new Types.ObjectId().toHexString()}`;
  const now = params.now || new Date();
  const support = await getTransactionSupport();
  let remaining: Map<string, number> | undefined;
  const run = (session?: ClientSession) => {
    // A retried transaction must start from the same counts.
    remaining = params.alreadyBack ? new Map(params.alreadyBack) : undefined;
    return restoreAllocationsInSession({
      session,
      orderId: params.orderId,
      subOrderIds: params.subOrderIds,
      mode: params.mode,
      operationId,
      now,
      includeDispatched: params.includeDispatched,
      excludeSubOrderIds: params.excludeSubOrderIds,
      alreadyBack: remaining,
    });
  };
  const result = support.supported
    ? await runTransaction("Restore pre-order stock", (session) => run(session))
    : await run(undefined);
  const moved = result.restored.flatMap((entry) => entry.lines);
  if (moved.length > 0) {
    const { runStockMovementAftermath } = await import("@/lib/inventory/inventory");
    await runStockMovementAftermath(moved, 1);
  }
  if (result.requoted.length > 0) {
    await markForMetaCatalog(result.requoted.map((line) => line.productId));
  }
  return { ...result, transactional: support.supported, alreadyBack: remaining };
}

// ---------------------------------------------------------------------------
// Reservation places and legacy stock, for cancellation inside a transaction
// ---------------------------------------------------------------------------

/**
 * Give these consignments' reservation places back to their counters, once —
 * the claim on `preorderReserved` is written first on the same session as the
 * counters, so a cancellation retried after a crash frees nothing twice.
 * Item statuses are not touched: the caller writes why they ended.
 */
export async function releaseConsignmentQuotaInSession(params: {
  session?: ClientSession;
  orderId: string;
  subOrderIds: string[];
}): Promise<Array<{ productId: string; variantId?: string }>> {
  const { session } = params;
  const query = Order.findById(params.orderId).select(
    "_id subOrders._id subOrders.preorderReserved subOrders.items",
  );
  if (session) query.session(session);
  const order = (await query.lean()) as AllocationOrder | null;
  if (!order) return [];
  const wanted = new Set(params.subOrderIds.map(String));
  const targets = (order.subOrders || []).filter(
    (sub) => wanted.has(id(sub._id)) && sub.preorderReserved === true,
  );
  if (targets.length === 0) return [];

  const set: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  const conditions: Record<string, unknown>[] = [];
  targets.forEach((sub, index) => {
    set[`subOrders.$[quota${index}].preorderReserved`] = false;
    arrayFilters.push({
      [`quota${index}._id`]: asObjectId(sub._id),
      [`quota${index}.preorderReserved`]: true,
    });
    conditions.push({
      subOrders: { $elemMatch: { _id: asObjectId(sub._id), preorderReserved: true } },
    });
  });
  const claim = await Order.updateOne(
    { _id: order._id, $and: conditions },
    { $set: set },
    { session, arrayFilters },
  );
  if (claim.matchedCount !== 1) {
    if (session) throw new TransactionContendedError("Release pre-order places");
    return [];
  }

  const lines = targets.flatMap((sub) => preorderItems(sub));
  const productIds = Array.from(new Set(lines.map((line) => id(line.productId))));
  const productQuery = Product.find({ _id: { $in: productIds } }).select(
    "preorder variants._id variants.preorder",
  );
  if (session) productQuery.session(session);
  const products = (await productQuery.lean()) as ProductStockDoc[];
  const byId = new Map(products.map((product) => [id(product._id), product]));
  const freed: Array<{ productId: string; variantId?: string }> = [];
  for (const line of lines) {
    const productId = id(line.productId);
    const variantId = line.variantId ? id(line.variantId) : undefined;
    const product = byId.get(productId);
    if (!product) continue;
    const quotaVariant = preorderQuotaVariantId(
      product as Parameters<typeof preorderQuotaVariantId>[0],
      variantId,
    );
    await adjustQuotaInSession(session, {
      productId,
      variantId: quotaVariant,
      delta: -Number(line.quantity),
    });
    freed.push({ productId, ...(variantId ? { variantId } : {}) });
  }

  // The order-level flag follows its consignments.
  await Order.updateOne(
    { _id: order._id, "subOrders.preorderReserved": { $ne: true } },
    { $set: { preorderReserved: false } },
    { session },
  );
  return freed;
}

/**
 * Put back stock an older flow took for a waiting consignment without
 * recording what — `inventoryReserved` with no evidence. Its lines go back to
 * the branch the consignment names (else the product's first), as the legacy
 * restore always did; claim first, on the same session.
 */
export async function restoreLegacyConsignmentsInSession(params: {
  session?: ClientSession;
  orderId: string;
  subOrderIds: string[];
}): Promise<RestoredConsignment[]> {
  const { session } = params;
  const query = Order.findById(params.orderId).select(
    "_id subOrders._id subOrders.vendorId subOrders.status subOrders.items subOrders.inventoryReserved subOrders.preorderAllocation subOrders.fulfillment",
  );
  if (session) query.session(session);
  const order = (await query.lean()) as AllocationOrder | null;
  if (!order) return [];
  const wanted = new Set(params.subOrderIds.map(String));
  const targets = (order.subOrders || []).filter(
    (sub) =>
      wanted.has(id(sub._id)) &&
      sub.inventoryReserved === true &&
      sub.preorderAllocation?.state !== "committed" &&
      !DISPATCHED_ORDER_STATUSES.includes(String(sub.status || "")),
  );
  if (targets.length === 0) return [];

  const set: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  const conditions: Record<string, unknown>[] = [];
  targets.forEach((sub, index) => {
    set[`subOrders.$[legacy${index}].inventoryReserved`] = false;
    arrayFilters.push({
      [`legacy${index}._id`]: asObjectId(sub._id),
      [`legacy${index}.inventoryReserved`]: true,
    });
    conditions.push({
      subOrders: { $elemMatch: { _id: asObjectId(sub._id), inventoryReserved: true } },
    });
  });
  const claim = await Order.updateOne(
    { _id: order._id, $and: conditions },
    { $set: set },
    { session, arrayFilters },
  );
  if (claim.matchedCount !== 1) {
    if (session) throw new TransactionContendedError("Restore legacy pre-order stock");
    return [];
  }

  const productIds = Array.from(
    new Set(targets.flatMap((sub) => (sub.items || []).map((item) => id(item.productId)))),
  );
  const productQuery = Product.find({ _id: { $in: productIds } }).select(PRODUCT_STOCK_FIELDS);
  if (session) productQuery.session(session);
  const products = (await productQuery.lean()) as ProductStockDoc[];
  const byId = new Map(products.map((product) => [id(product._id), product]));
  const restored: RestoredConsignment[] = [];
  for (const sub of targets) {
    const fulfillment = sub.fulfillment;
    const explicit =
      fulfillment?.method === "pickup"
        ? fulfillment.pickup?.pickupLocationId
        : fulfillment?.fulfillmentLocationId;
    const lines: InventoryAdjustmentLine[] = [];
    for (const item of sub.items || []) {
      const quantity = Number(item?.quantity || 0);
      if (!(quantity > 0)) continue;
      const productId = id(item.productId);
      const variantId = item.variantId ? id(item.variantId) : undefined;
      const product = byId.get(productId);
      if (!product || !productTracksStock(product)) continue;
      const variant = variantId
        ? product.variants?.find((candidate) => id(candidate._id) === variantId)
        : undefined;
      const entries = (variant ? variant.locationInventory : product.locationInventory) || [];
      const target =
        entries.find((entry) => explicit && String(entry.locationId) === String(explicit)) ||
        entries[0];
      await incrementLineInSession(session, {
        productId,
        variantId,
        quantity,
        parts: target ? [{ locationId: String(target.locationId), quantity }] : [],
      });
      lines.push({ productId, ...(variantId ? { variantId } : {}), quantity });
    }
    restored.push({ subOrderId: id(sub._id), vendorId: id(sub.vendorId), lines });
  }
  return restored;
}
