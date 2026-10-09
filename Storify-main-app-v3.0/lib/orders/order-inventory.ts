import { Types } from "mongoose";
import { Order, ReturnRequest } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import {
  decrementInventory,
  restoreInventory,
  type InventoryAdjustmentLine,
  type InventoryAdjustmentOptions,
} from "@/lib/inventory/inventory";
import {
  resolveFulfillmentLocation,
  type FulfillmentCandidate,
} from "@/lib/locations/fulfillment-location";
import { DISPATCHED_ORDER_STATUSES } from "@/lib/orders/order-status-workflow";
import { RETURN_STATUS } from "@/lib/returns/returns";
import { heldReturnUnits } from "@/lib/returns/held-units";

type SubOrderItem = {
  productId: unknown;
  variantId?: unknown;
  quantity: number;
  /** What the unit cost, snapshotted at the sale — see `postRestockedUnits`. */
  cost?: number | null;
};

type SubOrderShape = {
  _id?: unknown;
  vendorId?: unknown;
  items?: SubOrderItem[];
  status?: string;
  inventoryReserved?: boolean;
  /** Committed pre-order evidence is restored by its own path, never here. */
  preorderAllocation?: { state?: string } | null;
  fulfillment?: {
    method?: string;
    pickup?: { pickupLocationId?: unknown };
    fulfillmentLocationId?: unknown;
  };
};

function itemsToInventoryLines(
  items: SubOrderItem[] | undefined,
): InventoryAdjustmentLine[] {
  return (items || [])
    .filter((item) => item.productId && Number(item.quantity) > 0)
    .map((item) => ({
      productId: String(
        (item.productId as { _id?: unknown })?._id || item.productId,
      ),
      variantId: item.variantId ? String(item.variantId) : undefined,
      quantity: Number(item.quantity),
    }));
}

/** One consignment's share of a restore. */
type RestockedConsignment = {
  subOrderId: unknown;
  /** Whose goods these are — the returns open on them are this vendor's. */
  vendorId?: unknown;
  lines: InventoryAdjustmentLine[];
  /** Whether any of its lines recorded a cost — the only ones the ledger needs. */
  costed: boolean;
};

function restockedConsignment(sub: SubOrderShape): RestockedConsignment {
  return {
    subOrderId: sub._id,
    vendorId: sub.vendorId,
    lines: itemsToInventoryLines(sub.items),
    costed: (sub.items || []).some((item) => typeof item.cost === "number"),
  };
}

/**
 * Tell the ledger which units are back on the shelf, so what they cost comes
 * back off cost of goods — see `restockCostPostings`. The sale moved that cost
 * out of stock; without this a cancelled order kept it as a loss and stock on
 * hand came up short by exactly the units sitting on the shelf.
 *
 * Only lines that recorded a cost, so a store that tracks none never pays for
 * the ledger read. Never fails the restore: the stock is back either way, and
 * the daily pass re-posts it from the order.
 */
function postRestockedUnits(orderId: string, restocked: RestockedConsignment[]) {
  const lines = restocked
    .filter((sub) => sub.costed)
    .flatMap((sub) =>
      sub.lines.map((line) => ({ subOrderId: sub.subOrderId, ...line })),
    );
  if (lines.length === 0) return;
  void import("@/lib/finance/post-events")
    .then(({ postRestockedCostSafely }) =>
      postRestockedCostSafely({ orderId, restocked: lines, eventKey: "restock" }),
    )
    .catch((error) =>
      console.error("Failed to post restocked cost of goods:", error),
    );
}

/**
 * Where restored units should go back to.
 *
 * A restore that lands somewhere other than where the sale took the units from
 * moves stock between branches without anyone asking — cancel an order twice on
 * a two-branch store and the whole balance migrates. So the branch is read back
 * off the sub-order: the collection counter for a pickup, the recorded dispatch
 * branch for a delivery, the register for a POS sale.
 *
 * `subOrder` is optional because the all-vendors claim spans sub-orders that may
 * name different branches, and one option object cannot express two. There it is
 * passed only when the claimed sub-orders agree.
 */
function getInventoryOpts(
  order: {
    channel?: string;
    posLocationId?: unknown;
  },
  subOrder?: SubOrderShape,
): InventoryAdjustmentOptions {
  if (order.channel === "pos" && order.posLocationId) {
    return { channel: "pos", locationId: String(order.posLocationId) };
  }

  const fulfillment = subOrder?.fulfillment;
  const locationId =
    fulfillment?.method === "pickup"
      ? fulfillment.pickup?.pickupLocationId
      : fulfillment?.fulfillmentLocationId;

  return locationId ? { locationId: String(locationId) } : {};
}

/**
 * Put a restock of a return's units back on the shelf.
 *
 * At the location whoever processed the return chose (R5b), and there alone.
 * With none chosen, grouped by the seller each line belongs to, so every group
 * goes back to its own consignment's branch — the counter of a POS sale, the
 * store a parcel was fulfilled or collected from. Restored with no options,
 * every return landed in the seller's first location, and a return taken at
 * one branch was counted as stock at another. Throws when a restore does, so
 * the caller can hand back its claim rather than record stock that never moved.
 */
export async function restoreReturnUnits(params: {
  order: {
    channel?: string;
    posLocationId?: unknown;
    subOrders?: SubOrderShape[] | null;
  } | null;
  lines: ReadonlyArray<InventoryAdjustmentLine & { vendorId?: string }>;
  locationId?: string | null;
}): Promise<void> {
  const stock = (lines: ReadonlyArray<InventoryAdjustmentLine>) =>
    lines
      .filter((line) => line.productId && line.quantity > 0)
      .map((line) => ({
        productId: String(line.productId),
        ...(line.variantId ? { variantId: String(line.variantId) } : {}),
        quantity: line.quantity,
      }));
  if (params.locationId) {
    const lines = stock(params.lines);
    if (lines.length > 0) {
      await restoreInventory(lines, {
        locationId: String(params.locationId),
        exactLocation: true,
      });
    }
    return;
  }
  const byVendor = new Map<string, InventoryAdjustmentLine[]>();
  for (const line of params.lines) {
    const vendorId = String(line.vendorId || "");
    if (!byVendor.has(vendorId)) byVendor.set(vendorId, []);
    byVendor.get(vendorId)!.push(line);
  }
  for (const [vendorId, vendorLines] of byVendor) {
    await restockUnitsToSoldBranch({
      order: params.order,
      vendorId,
      lines: stock(vendorLines),
    });
  }
}

/**
 * Put one seller's units back on the shelf their consignment sold them from —
 * the counter of a POS sale, the store a parcel was fulfilled or collected
 * from. Shared by a return's restock and by a held unit a merchant later puts
 * back on sale, so both land where the sale took them. Throws when the restore
 * does.
 */
export async function restockUnitsToSoldBranch(params: {
  order: {
    channel?: string;
    posLocationId?: unknown;
    subOrders?: SubOrderShape[] | null;
  } | null;
  vendorId: string;
  lines: InventoryAdjustmentLine[];
}): Promise<void> {
  if (params.lines.length === 0) return;
  const subOrder = (params.order?.subOrders || []).find(
    (sub) => String(sub?.vendorId || "") === params.vendorId,
  );
  await restoreInventory(
    params.lines,
    params.order ? getInventoryOpts(params.order, subOrder) : {},
  );
}

/** The branch `restockUnitsToSoldBranch` would put this seller's units on. */
export function soldBranchLocationId(
  order: {
    channel?: string;
    posLocationId?: unknown;
    subOrders?: SubOrderShape[] | null;
  } | null,
  vendorId: string,
): string | undefined {
  if (!order) return undefined;
  const subOrder = (order.subOrders || []).find(
    (sub) => String(sub?.vendorId || "") === vendorId,
  );
  return getInventoryOpts(order, subOrder).locationId;
}

/**
 * The inventory options an already-built order implies.
 *
 * For the payment finalisers, which decrement stock against an order that was
 * created earlier in the flow: the sub-order already names the counter the
 * shopper is collecting from, so the units come off that branch rather than off
 * whichever shelf happens to be fullest. Without this a shopper collecting from
 * the Gulshan counter had their units taken off the Uttara warehouse, and
 * neither branch's count described anything real.
 *
 * Answers `{}` for an order whose sub-orders disagree about the branch, or name
 * none — both mean "let the per-line rule decide".
 */
export function orderInventoryOpts(order: {
  channel?: string;
  posLocationId?: unknown;
  subOrders?: unknown;
}): InventoryAdjustmentOptions {
  const subOrders = Array.isArray(order.subOrders)
    ? (order.subOrders as SubOrderShape[])
    : [];
  return getInventoryOpts(order, sharedFulfillmentSubOrder(subOrders));
}

/** True when every claimed sub-order names the same branch. */
function sharedFulfillmentSubOrder(
  subOrders: SubOrderShape[],
): SubOrderShape | undefined {
  const branches = new Set(
    subOrders.map((sub) => {
      const fulfillment = sub.fulfillment;
      const id =
        fulfillment?.method === "pickup"
          ? fulfillment.pickup?.pickupLocationId
          : fulfillment?.fulfillmentLocationId;
      return id ? String(id) : "";
    }),
  );

  return branches.size === 1 ? subOrders[0] : undefined;
}

/**
 * Mark every sub-order on the order as having stock reserved, and record which
 * branch each delivery sub-order dispatches from.
 *
 * Both happen here because every order-creation path already calls this exactly
 * once, immediately after a successful decrement — twelve of them, across the
 * checkout route and every payment gateway's finaliser. Stamping the branch at
 * each of those instead would be twelve chances to forget one, and a sub-order
 * with no recorded source is indistinguishable from one placed before the field
 * existed.
 *
 * The stamp never fails the order. An order that exists with its stock taken
 * and no branch recorded is a paperwork gap a merchant can fix; an order that
 * failed to save because a location lookup timed out is a lost sale.
 */
export async function markOrderInventoryReserved(orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) return;
  // Never a consignment that was called off before the stock was taken. Its
  // goods were left on the shelf, and flagging it reserved anyway meant the
  // next cancel or refund "restored" units that had never left — stock
  // invented out of nothing.
  //
  // The branch stamp reads nothing the flag writes, so the two go together —
  // one after the other, they were round trips a shopper waited on.
  await Promise.all([
    Order.updateOne(
      { _id: orderId },
      { $set: { "subOrders.$[live].inventoryReserved": true } },
      { arrayFilters: [{ "live.status": { $ne: ORDER_STATUS.CANCELLED } }] },
    ),
    stampFulfillmentLocations(orderId).catch((err) =>
      console.error("Failed to record order fulfillment locations:", err),
    ),
  ]);
}

/**
 * Write each delivery sub-order's dispatch branch, from the vendor's configured
 * order.
 *
 * Pickup sub-orders are skipped: `fulfillment.pickup.pickupLocationId` already
 * names the counter the shopper chose, and overwriting that with a warehouse
 * would contradict what the confirmation email told them.
 *
 * A vendor with no configured locations gets nothing written, which is the same
 * state every order was in before this existed — location is simply not a
 * dimension of that merchant's stock.
 */
async function stampFulfillmentLocations(orderId: string): Promise<void> {
  const order = await Order.findById(orderId)
    .select("channel posLocationId subOrders.vendorId subOrders.fulfillment")
    .lean<{
      channel?: string;
      subOrders?: Array<{
        vendorId?: unknown;
        fulfillment?: { method?: string };
      }>;
    } | null>();
  if (!order?.subOrders?.length) return;

  // A POS sale already knows where it happened: it was rung up at a register
  // standing in one specific shop, recorded as `posLocationId`. Stamping the
  // merchant's *posting* preference over that would put "Ships from the
  // warehouse" on a walk-in sale made at the counter — and unlike the delivery
  // case there is no dispatch decision to report, because the goods left over
  // the counter as the sale was made.
  if (order.channel === "pos") return;

  // One lookup per distinct vendor, not per sub-order: a single-vendor order is
  // the overwhelming majority and must not pay for the marketplace case. The
  // vendors' lookups, and then their writes, go at once rather than in turn.
  const vendorIds = Array.from(
    new Set(
      order.subOrders
        .filter((sub) => sub.fulfillment?.method !== "pickup")
        .map((sub) => (sub.vendorId ? String(sub.vendorId) : ""))
        .filter(Boolean),
    ),
  );
  const resolved: Array<[string, FulfillmentCandidate | null]> = await Promise.all(
    vendorIds.map(
      async (vendorId) =>
        [vendorId, await resolveFulfillmentLocation(vendorId)] as [
          string,
          FulfillmentCandidate | null,
        ],
    ),
  );

  await Promise.all(
    resolved.map(([vendorId, location]) => {
      if (!location) return undefined;
      return Order.updateOne(
        { _id: orderId },
        {
          $set: {
            "subOrders.$[so].fulfillment.method": "delivery",
            // Cast here rather than leaving Mongoose to infer it through an
            // `$[so]` array filter. A miscast would throw into the catch above
            // and be logged, so the failure mode is a silently unstamped
            // order — the worst kind to find out about in production.
            "subOrders.$[so].fulfillment.fulfillmentLocationId":
              new Types.ObjectId(location.id),
            "subOrders.$[so].fulfillment.fulfillmentLocationName":
              location.name,
          },
        },
        {
          arrayFilters: [
            {
              "so.vendorId": new Types.ObjectId(vendorId),
              // Never touch a pickup sub-order, even if one was added between
              // the read above and this write.
              "so.fulfillment.method": { $ne: "pickup" },
            },
          ],
        },
      );
    }),
  );
}

/**
 * Atomically claim the right to restore inventory for a single sub-order.
 * Returns the items to restore (already in inventory-line shape) if this
 * caller won the claim, or null if the sub-order was already restored or
 * never reserved. Callers MUST call restoreInventory for the returned
 * items themselves; this helper only flips the flag.
 */
async function claimSubOrderRestore(params: {
  orderId: string;
  vendorId: string;
}): Promise<{
  lines: InventoryAdjustmentLine[];
  opts: InventoryAdjustmentOptions;
  consignment: RestockedConsignment;
} | null> {
  if (!Types.ObjectId.isValid(params.orderId)) return null;

  // Atomically flip the matching sub-order's reservation flag from
  // true -> false. Use arrayFilters so we only touch the one sub-order
  // that is still reserved for this vendor. A consignment holding committed
  // pre-order evidence is not this path's: its exact units are put back by
  // `restoreAllocatedConsignments`, and taking it here too would restore the
  // same units twice.
  const updated = await Order.findOneAndUpdate(
    {
      _id: params.orderId,
      subOrders: {
        $elemMatch: {
          vendorId: new Types.ObjectId(params.vendorId),
          inventoryReserved: true,
          "preorderAllocation.state": { $ne: "committed" },
        },
      },
    },
    { $set: { "subOrders.$[so].inventoryReserved": false } },
    {
      returnDocument: "before",
      arrayFilters: [
        {
          "so.vendorId": new Types.ObjectId(params.vendorId),
          "so.inventoryReserved": true,
          "so.preorderAllocation.state": { $ne: "committed" },
        },
      ],
    },
  );

  if (!updated) return null;

  const subOrders = (updated.subOrders || []) as SubOrderShape[];
  const sub = subOrders.find(
    (so) =>
      so.vendorId &&
      so.inventoryReserved === true &&
      so.preorderAllocation?.state !== "committed" &&
      String((so.vendorId as { _id?: unknown })?._id || so.vendorId) ===
        params.vendorId,
  );
  if (!sub) return null;

  const consignment = restockedConsignment(sub);
  return {
    lines: consignment.lines,
    opts: getInventoryOpts(
      updated as { channel?: string; posLocationId?: unknown },
      sub,
    ),
    consignment,
  };
}

interface RestoreClaimOptions {
  /**
   * Also reclaim consignments that have already shipped or been delivered.
   *
   * Off by default, and the default is the point: a cancellation that reached
   * a delivered sub-order used to hand its stock back, inventing units that
   * were sitting in the customer's hallway. Only a caller that KNOWS the goods
   * are physically returning — the admin's full-refund restock opt-in, which
   * is a return in all but name — may say otherwise.
   */
  includeDispatched?: boolean;
  /**
   * Consignments that must not be restocked whatever they read now — the ones
   * that had already shipped or been delivered before an override cancelled
   * them. The claim runs after that write, when they read `cancelled`, so the
   * dispatched rule above can no longer see them.
   */
  excludeSubOrderIds?: ReadonlyArray<unknown>;
}

/**
 * Whether a sub-order's reservation is ours to hand back.
 *
 * Shared by the Mongo `arrayFilters` and the JS pass over the pre-update
 * document below. They must agree exactly: the claim's safety rests on
 * restoring precisely the sub-orders the atomic flip won, and a JS filter one
 * element wider than the Mongo one would restock stock nobody claimed —
 * every time, not just under a race.
 */
function isClaimableSubOrder(
  sub: SubOrderShape,
  options?: RestoreClaimOptions,
): boolean {
  if (!sub.inventoryReserved) return false;
  // Restored by its evidence instead — see `restoreAllocatedConsignments`.
  if (sub.preorderAllocation?.state === "committed") return false;
  if (
    options?.excludeSubOrderIds?.some((id) => String(id) === String(sub._id))
  ) {
    return false;
  }
  if (options?.includeDispatched) return true;
  return !DISPATCHED_ORDER_STATUSES.includes(String(sub.status || ""));
}

/**
 * Atomically claim the right to restore inventory for ALL still-reserved
 * sub-orders on the given order. Returns the union of items to restore
 * across the claimed sub-orders. Used by full-cancel paths.
 *
 * Idempotent: if no sub-orders are currently reserved, returns an empty
 * lines array — no double-restore is possible.
 */
async function claimAllRemainingRestores(
  orderId: string,
  options?: RestoreClaimOptions,
): Promise<{
  lines: InventoryAdjustmentLine[];
  opts: InventoryAdjustmentOptions;
  /** The same units, per consignment. */
  consignments: RestockedConsignment[];
}> {
  if (!Types.ObjectId.isValid(orderId)) {
    return { lines: [], opts: {}, consignments: [] };
  }

  const claimFilter: Record<string, unknown> = {
    "so.inventoryReserved": true,
    // Committed pre-order evidence is restored exactly, by its own path.
    "so.preorderAllocation.state": { $ne: "committed" },
  };
  if (!options?.includeDispatched) {
    claimFilter["so.status"] = { $nin: DISPATCHED_ORDER_STATUSES };
  }
  const excluded = (options?.excludeSubOrderIds || [])
    .map(String)
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  if (excluded.length > 0) {
    claimFilter["so._id"] = { $nin: excluded };
  }

  // Atomically flip all reserved sub-orders to false in a single update.
  const updated = await Order.findOneAndUpdate(
    {
      _id: orderId,
      "subOrders.inventoryReserved": true,
    },
    { $set: { "subOrders.$[so].inventoryReserved": false } },
    {
      returnDocument: "before",
      arrayFilters: [claimFilter],
    },
  );

  if (!updated) return { lines: [], opts: {}, consignments: [] };

  const subOrders = (updated.subOrders || []) as SubOrderShape[];
  const claimed = subOrders.filter((sub) => isClaimableSubOrder(sub, options));
  const consignments = claimed.map(restockedConsignment);
  const lines = consignments.flatMap((consignment) => consignment.lines);

  return {
    lines,
    consignments,
    // Only when the claimed sub-orders all name the same branch. A marketplace
    // order spanning two vendors' warehouses cannot be restored to "the"
    // location, so it falls back to the per-line rule rather than picking one
    // vendor's branch and crediting the other vendor's units into it.
    opts: getInventoryOpts(
      updated as { channel?: string; posLocationId?: unknown },
      sharedFulfillmentSubOrder(claimed),
    ),
  };
}

/**
 * Convenience wrapper that claims and restores in one call.
 * Returns true if any inventory was actually restored.
 */
export async function restoreOrderInventory(
  orderId: string,
  options?: RestoreClaimOptions,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(orderId)) return false;
  const claimed = await claimAllRemainingRestores(orderId, options);
  // Consignments whose pre-order units were allocated carry evidence of
  // exactly what left which shelf, and are restored from it — see below.
  const excluded = new Set((options?.excludeSubOrderIds || []).map(String));
  const evidenceSubs = (await readCommittedEvidence(orderId)).filter(
    (sub) => !excluded.has(String(sub._id)),
  );
  // Everything these consignments sold is back on the shelf now, a return
  // still open on them included. Marked BEFORE their restocked units are read
  // below: a return restocks a step only while it is unmarked, and records
  // that step in the same write — so every step is either read here or
  // refused, never both missed and restocked twice.
  if (
    options?.includeDispatched &&
    (claimed.consignments.length > 0 || evidenceSubs.length > 0)
  ) {
    await markReturnsRestockedByOrder(orderId, [
      ...claimed.consignments,
      ...evidenceSubs.map((sub) => ({
        subOrderId: sub._id,
        vendorId: sub.vendorId,
        lines: [],
        costed: false,
      })),
    ]);
  }
  // Delivered goods only come back through a return, and a return may have
  // restocked its own units already. The order-wide restock used to put them
  // back a second time. Taken consignment by consignment, so the ledger is
  // told which seller's units actually came back.
  let alreadyBack = options?.includeDispatched
    ? new Map(await returnRestockedUnits(orderId))
    : new Map<string, number>();

  // Allocated pre-order units: exactly the evidence, to the branches they came
  // off, once — in a transaction where the deployment has them.
  let evidence = false;
  if (evidenceSubs.length > 0) {
    const outcome = await restoreEvidenceConsignments(orderId, {
      includeDispatched: options?.includeDispatched,
      excludeSubOrderIds: options?.excludeSubOrderIds,
      alreadyBack: alreadyBack.size > 0 ? alreadyBack : undefined,
    });
    evidence = outcome.restored;
    // What the evidence restore left of the returned units, so the same unit
    // is never taken off twice across the two paths.
    if (outcome.alreadyBack) alreadyBack = outcome.alreadyBack;
  }

  const consignments = claimed.consignments.map((consignment) => ({
    ...consignment,
    lines:
      alreadyBack.size > 0
        ? takeUnits(consignment.lines, alreadyBack)
        : consignment.lines,
  }));
  const lines = consignments.flatMap((consignment) => consignment.lines);
  if (lines.length > 0) {
    await restoreInventory(lines, claimed.opts);
    postRestockedUnits(orderId, consignments);
  }
  return lines.length > 0 || evidence;
}

/**
 * The consignments of this order holding committed pre-order evidence — the
 * ones `restoreAllocatedConsignments` restores and the claims above leave
 * alone. Empty when the order has none, which is every order but an allocated
 * pre-order, so those pay one indexed read and nothing else.
 */
async function readCommittedEvidence(orderId: string): Promise<SubOrderShape[]> {
  // Unit-test doubles of the model may not implement the read; an order
  // nobody can read has no evidence to restore from.
  if (typeof (Order as { findById?: unknown }).findById !== "function") return [];
  try {
    const order = await Order.findById(orderId)
      .select(
        "subOrders._id subOrders.vendorId subOrders.status subOrders.preorderAllocation.state subOrders.items.cost",
      )
      .lean<{ subOrders?: SubOrderShape[] } | null>();
    return (order?.subOrders || []).filter(
      (sub) => sub?.preorderAllocation?.state === "committed",
    );
  } catch (error) {
    console.error("Failed to read pre-order allocation evidence:", error);
    return [];
  }
}

/**
 * Restore the consignments of this order that hold committed pre-order
 * evidence, and tell the ledger which costed units came back. Never throws: a
 * cancellation that has already committed must not be reported as failed
 * because a restock did — the failure is logged and the evidence stays
 * committed, so nothing is lost and the next restore of the order (a retry, a
 * refund with restock, the lifecycle worker) puts it back.
 */
async function restoreEvidenceConsignments(
  orderId: string,
  options: {
    subOrderIds?: string[];
    includeDispatched?: boolean;
    excludeSubOrderIds?: ReadonlyArray<unknown>;
    alreadyBack?: Map<string, number>;
  },
): Promise<{ restored: boolean; alreadyBack?: Map<string, number> }> {
  try {
    const { restoreAllocatedConsignments } = await import(
      "@/lib/orders/preorder-allocation"
    );
    const result = await restoreAllocatedConsignments({
      orderId,
      subOrderIds: options.subOrderIds,
      mode: "cancelled",
      includeDispatched: options.includeDispatched,
      excludeSubOrderIds: options.excludeSubOrderIds,
      alreadyBack: options.alreadyBack,
    });
    const costed = new Set(
      (await readCommittedEvidenceCosts(orderId, result.restored)).map(String),
    );
    const restocked = result.restored.filter((entry) => entry.lines.length > 0);
    if (restocked.length > 0) {
      postRestockedUnits(
        orderId,
        restocked.map((entry) => ({
          subOrderId: entry.subOrderId,
          vendorId: entry.vendorId,
          lines: entry.lines,
          costed: costed.has(entry.subOrderId),
        })),
      );
    }
    return {
      restored: result.restored.length > 0,
      alreadyBack: result.alreadyBack,
    };
  } catch (error) {
    console.error("Failed to restore allocated pre-order stock:", error);
    return { restored: false };
  }
}

/** Which restored consignments recorded a unit cost — the ledger's question. */
async function readCommittedEvidenceCosts(
  orderId: string,
  restored: Array<{ subOrderId: string }>,
): Promise<string[]> {
  if (restored.length === 0) return [];
  const order = await Order.findById(orderId)
    .select("subOrders._id subOrders.items.cost")
    .lean<{ subOrders?: SubOrderShape[] } | null>();
  const wanted = new Set(restored.map((entry) => entry.subOrderId));
  return (order?.subOrders || [])
    .filter(
      (sub) =>
        wanted.has(String(sub._id)) &&
        (sub.items || []).some((item) => typeof item.cost === "number"),
    )
    .map((sub) => String(sub._id));
}

/**
 * Stamp the returns an order-wide restock has just covered.
 *
 * A full refund with "restock" ticked puts every unit of the claimed
 * consignments back — including goods a return was still waiting on. Nothing
 * told that return, so when its parcel arrived "Put back in stock" added the
 * same units a second time and took their cost off cost of goods twice. The
 * other order of events was already safe: an order restock leaves out what a
 * return put back first (`returnRestockedUnits`).
 */
async function markReturnsRestockedByOrder(
  orderId: string,
  consignments: RestockedConsignment[],
) {
  const vendorIds = consignments
    .map((consignment) => String(consignment.vendorId || ""))
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  if (vendorIds.length === 0) return;
  await ReturnRequest.updateMany(
    {
      orderId,
      inventoryRestored: { $ne: true },
      status: { $nin: [RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED] },
      vendorIds: { $in: vendorIds },
    },
    { $set: { inventoryRestored: true, restockedByOrderAt: new Date() } },
  ).catch((err) =>
    console.error("Failed to mark returns restocked by an order refund:", err),
  );
}

function unitKey(line: { productId: unknown; variantId?: unknown }): string {
  return `${String(line.productId)}:${line.variantId ? String(line.variantId) : ""}`;
}

/**
 * Units this order's returns have already accounted for: put back on sale —
 * every step of every return, including one still being restocked in parts —
 * or found unsellable when the parcel was counted. An unsellable unit is held
 * as "Unavailable" (or was since restocked or written off by the merchant) —
 * an order-wide restock that counted it again put a damaged unit on sale.
 */
async function returnRestockedUnits(orderId: string): Promise<Map<string, number>> {
  const returns = await ReturnRequest.find({
    orderId,
    $or: [
      { "restockedLines.0": { $exists: true } },
      { itemsCountedAt: { $exists: true } },
    ],
  })
    .select(
      "status restockedLines itemsCountedAt items.productId items.variantId items.quantityReceived items.condition",
    )
    .lean<
      Array<
        Parameters<typeof heldReturnUnits>[0] & {
          restockedLines?: InventoryAdjustmentLine[];
        }
      >
    >();
  const units = new Map<string, number>();
  const add = (line: { productId: unknown; variantId?: unknown }, quantity: number) => {
    const key = unitKey(line);
    units.set(key, (units.get(key) || 0) + Math.max(0, quantity));
  };
  for (const request of returns) {
    // Every recorded step went back on sale; a failed step is pulled again.
    for (const line of request.restockedLines || []) {
      add(line, Number(line.quantity || 0));
    }
    for (const line of heldReturnUnits(request)) add(line, line.received);
  }
  return units;
}

/**
 * `lines` less what `left` still holds, taking it out of `left` as it goes — so
 * the same units cannot be subtracted twice across several consignments.
 */
export function takeUnits(
  lines: InventoryAdjustmentLine[],
  left: Map<string, number>,
): InventoryAdjustmentLine[] {
  const out: InventoryAdjustmentLine[] = [];
  for (const line of lines) {
    const key = unitKey(line);
    const take = Math.min(line.quantity, left.get(key) || 0);
    if (take > 0) left.set(key, (left.get(key) || 0) - take);
    if (line.quantity - take > 0) out.push({ ...line, quantity: line.quantity - take });
  }
  return out;
}

/**
 * Take back the stock a cancellation gave away, for an order being reinstated.
 *
 * The mirror of {@link claimAllRemainingRestores}, and the reason an admin
 * override can un-cancel at all. A resurrected order is live again, so its
 * goods have to be held again — reinstating one without re-taking its stock
 * would promise the customer units the shop has since sold to somebody else.
 *
 * Claim first, decrement second, un-claim on failure. `decrementInventory` is
 * all-or-nothing and throws when a line cannot be covered, so a shop that has
 * since sold out gets a refusal and an order still safely cancelled, rather
 * than a reinstated order quietly standing on negative stock.
 *
 * Idempotent by the same flag as its counterpart: a sub-order already holding
 * its reservation is not claimed, so a repeated call takes nothing twice.
 * Returns the number of consignments re-reserved.
 */
export async function reserveCancelledOrderInventory(
  orderId: string,
): Promise<number> {
  if (!Types.ObjectId.isValid(orderId)) return 0;

  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, "subOrders.inventoryReserved": { $ne: true } },
    { $set: { "subOrders.$[so].inventoryReserved": true } },
    {
      returnDocument: "before",
      arrayFilters: [{ "so.inventoryReserved": { $ne: true } }],
    },
  );
  if (!claimed) return 0;

  const subOrders = (claimed.subOrders || []) as SubOrderShape[];
  const targets = subOrders.filter((sub) => sub.inventoryReserved !== true);
  const lines: InventoryAdjustmentLine[] = [];
  for (const sub of targets) {
    lines.push(...itemsToInventoryLines(sub.items));
  }
  if (lines.length === 0) return targets.length;

  try {
    await decrementInventory(
      lines,
      getInventoryOpts(
        claimed as { channel?: string; posLocationId?: unknown },
        sharedFulfillmentSubOrder(targets),
      ),
    );
  } catch (error) {
    // Give back exactly the consignments THIS call claimed — addressed by id,
    // not by "everything currently reserved", which would strip the
    // reservation from a sibling that was legitimately holding stock all
    // along. Without the rollback the order would be marked as holding stock
    // it never took, and a later cancel would "restore" units that were never
    // removed.
    const claimedIds = targets.map((sub) => sub._id).filter(Boolean);
    if (claimedIds.length > 0) {
      await Order.updateOne(
        { _id: orderId },
        { $set: { "subOrders.$[so].inventoryReserved": false } },
        { arrayFilters: [{ "so._id": { $in: claimedIds } }] },
      ).catch((rollbackErr) =>
        console.error("Failed to release re-reservation claim:", rollbackErr),
      );
    }
    throw error;
  }

  return targets.length;
}

/**
 * Convenience wrapper for the vendor partial-cancel case.
 */
export async function restoreSubOrderInventory(params: {
  orderId: string;
  vendorId: string;
}): Promise<boolean> {
  if (!Types.ObjectId.isValid(params.orderId)) return false;
  // This vendor's allocated pre-order units, from their evidence.
  const evidenceIds = (await readCommittedEvidence(params.orderId))
    .filter((sub) => String(sub.vendorId || "") === params.vendorId)
    .map((sub) => String(sub._id));
  const evidence =
    evidenceIds.length > 0
      ? (await restoreEvidenceConsignments(params.orderId, { subOrderIds: evidenceIds }))
          .restored
      : false;

  const claim = await claimSubOrderRestore(params);
  if (!claim || claim.lines.length === 0) return evidence;
  await restoreInventory(claim.lines, claim.opts);
  postRestockedUnits(params.orderId, [claim.consignment]);
  return true;
}
