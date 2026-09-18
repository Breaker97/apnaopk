import { Types } from "mongoose";
import { Order } from "@/models";
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

type SubOrderItem = {
  productId: unknown;
  variantId?: unknown;
  quantity: number;
};

type SubOrderShape = {
  _id?: unknown;
  vendorId?: unknown;
  items?: SubOrderItem[];
  status?: string;
  inventoryReserved?: boolean;
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
  await Order.updateOne(
    { _id: orderId },
    { $set: { "subOrders.$[live].inventoryReserved": true } },
    { arrayFilters: [{ "live.status": { $ne: ORDER_STATUS.CANCELLED } }] },
  );

  await stampFulfillmentLocations(orderId).catch((err) =>
    console.error("Failed to record order fulfillment locations:", err),
  );
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
  // the overwhelming majority and must not pay for the marketplace case.
  const resolved = new Map<string, FulfillmentCandidate | null>();

  for (const sub of order.subOrders) {
    if (sub.fulfillment?.method === "pickup") continue;

    const vendorId = sub.vendorId ? String(sub.vendorId) : "";
    if (!vendorId) continue;

    if (!resolved.has(vendorId)) {
      resolved.set(vendorId, await resolveFulfillmentLocation(vendorId));
    }
    const location = resolved.get(vendorId);
    if (!location) continue;

    await Order.updateOne(
      { _id: orderId },
      {
        $set: {
          "subOrders.$[so].fulfillment.method": "delivery",
          // Cast here rather than leaving Mongoose to infer it through an
          // `$[so]` array filter. A miscast would throw into the catch above
          // and be logged, so the failure mode is a silently unstamped order —
          // the worst kind to find out about in production.
          "subOrders.$[so].fulfillment.fulfillmentLocationId":
            new Types.ObjectId(location.id),
          "subOrders.$[so].fulfillment.fulfillmentLocationName": location.name,
        },
      },
      {
        arrayFilters: [
          {
            "so.vendorId": new Types.ObjectId(vendorId),
            // Never touch a pickup sub-order, even if one was added between the
            // read above and this write.
            "so.fulfillment.method": { $ne: "pickup" },
          },
        ],
      },
    );
  }
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
} | null> {
  if (!Types.ObjectId.isValid(params.orderId)) return null;

  // Atomically flip the matching sub-order's reservation flag from
  // true -> false. Use arrayFilters so we only touch the one sub-order
  // that is still reserved for this vendor.
  const updated = await Order.findOneAndUpdate(
    {
      _id: params.orderId,
      subOrders: {
        $elemMatch: {
          vendorId: new Types.ObjectId(params.vendorId),
          inventoryReserved: true,
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
        },
      ],
    },
  );

  if (!updated) return null;

  const subOrders = (updated.subOrders || []) as SubOrderShape[];
  const sub = subOrders.find(
    (so) =>
      so.vendorId &&
      String((so.vendorId as { _id?: unknown })?._id || so.vendorId) ===
        params.vendorId,
  );
  if (!sub) return null;

  return {
    lines: itemsToInventoryLines(sub.items),
    opts: getInventoryOpts(
      updated as { channel?: string; posLocationId?: unknown },
      sub,
    ),
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
}> {
  if (!Types.ObjectId.isValid(orderId)) {
    return { lines: [], opts: {} };
  }

  const claimFilter: Record<string, unknown> = { "so.inventoryReserved": true };
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

  if (!updated) return { lines: [], opts: {} };

  const subOrders = (updated.subOrders || []) as SubOrderShape[];
  const claimed = subOrders.filter((sub) => isClaimableSubOrder(sub, options));
  const lines: InventoryAdjustmentLine[] = [];
  for (const sub of claimed) {
    lines.push(...itemsToInventoryLines(sub.items));
  }

  return {
    lines,
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
  const { lines, opts } = await claimAllRemainingRestores(orderId, options);
  if (lines.length === 0) return false;
  await restoreInventory(lines, opts);
  return true;
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
  const claim = await claimSubOrderRestore(params);
  if (!claim || claim.lines.length === 0) return false;
  await restoreInventory(claim.lines, claim.opts);
  return true;
}
