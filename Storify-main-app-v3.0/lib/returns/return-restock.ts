import "server-only";

import { Types } from "mongoose";
import { Order, ReturnRequest } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { restoreReturnUnits } from "@/lib/orders/order-inventory";
import { listReturnLocations } from "@/lib/returns/return-destination";
import {
  RETURN_STATUS,
  returnGoodsBack,
  returnRestockEventKey,
  returnRestockPlan,
  type ReturnRestockStep,
} from "@/lib/returns/returns";

/**
 * Putting a return's goods back on the shelf, a step at a time (R5b, R5c).
 *
 * A return used to restock once: a one-time flag was claimed, every sellable
 * unit that had arrived went back, and a unit arriving later could never be
 * restocked at all. Now each line counts what it has put back
 * (`items[].quantityRestocked`), and a step adds only what arrived since —
 * never more, in all, than what came back sellable. Each step can go to a
 * location of the owner's choosing, and each is recorded in `restockedLines`
 * with where it went, when and by whom.
 *
 * Shared by the admin and seller routes, which each held a copy of the old
 * one-time restock.
 */

type RestockItem = {
  orderItemIndex?: number | null;
  productId?: unknown;
  variantId?: unknown;
  vendorId?: unknown;
  quantityRequested?: number | null;
  quantityApproved?: number | null;
  quantityReceived?: number | null;
  quantityRestocked?: number | null;
  condition?: string | null;
};

type RestockableReturn = {
  _id: unknown;
  orderId?: unknown;
  ownerType?: string | null;
  ownerVendorId?: unknown;
  vendorIds?: unknown[] | null;
  inventoryRestored?: boolean | null;
  itemsCountedAt?: unknown;
  receivedAt?: unknown;
  inspectedAt?: unknown;
  returnMethod?: unknown;
  items?: RestockItem[] | null;
};

type ReturnRestockOutcome =
  | {
      kind: "restocked";
      lines: ReturnRestockStep[];
      /** The step's id in `restockedLines`. */
      step: string;
      locationId?: string;
    }
  /** Everything that can go back already has. */
  | { kind: "nothing" }
  /** The return changed between the read and the claim; nothing moved. */
  | { kind: "changed" }
  /** The stock could not be moved; the claim was handed back to retry. */
  | { kind: "failed" };

/**
 * The location a restock was asked to go to, held to the return owner's own
 * — a seller's return never restocks into the store's shop, nor another
 * seller's.
 */
export async function assertRestockLocation(
  returnRequest: RestockableReturn,
  locationId: string | null | undefined,
): Promise<string | null> {
  const wanted = String(locationId || "").trim();
  if (!wanted) return null;
  const locations = await listReturnLocations(returnRequest);
  if (!locations.some((location) => location._id === wanted)) {
    throw new ValidationError(
      "Choose one of this return's own locations to put the items back in stock.",
    );
  }
  return wanted;
}

/**
 * The line as the claim reads it: a count, condition or approval changed
 * since the plan was made fails the claim rather than restocking a figure
 * that no longer holds.
 */
function lineUnchanged(item: RestockItem, counted: boolean): Record<string, unknown> {
  const restocked = Number(item.quantityRestocked || 0);
  return {
    orderItemIndex: item.orderItemIndex,
    quantityRestocked: restocked > 0 ? restocked : { $in: [0, null] },
    ...(counted
      ? {
          quantityReceived: Number(item.quantityReceived || 0),
          condition: item.condition ?? null,
        }
      : { quantityApproved: item.quantityApproved ?? null }),
  };
}

/**
 * Put back what the return can still restock, as one step.
 *
 * Claimed on the return first, line by line, in a single write that also
 * records the step — so two restocks sent together cannot both add the same
 * units, and an order-wide restock landing at the same moment either reads
 * this step or stops it (see `restoreOrderInventory`). The stock moves after
 * the claim; if it cannot, the claim is handed back.
 */
export async function restockReturnStep(params: {
  /** The return as this request left it — a count in the same call counts. */
  returnRequest: RestockableReturn;
  /** Checked with `assertRestockLocation`; absent, each line's own branch. */
  locationId?: string | null;
  actor: string;
}): Promise<ReturnRestockOutcome> {
  const { returnRequest } = params;
  // Nothing came back — kept by the shopper, or refunded before it arrived.
  if (!returnGoodsBack(returnRequest)) return { kind: "nothing" };
  const counted = Boolean(returnRequest.itemsCountedAt);
  const plan = returnRestockPlan(returnRequest.items, {
    itemsCounted: counted,
    inventoryRestored: returnRequest.inventoryRestored,
  });
  if (plan.length === 0) return { kind: "nothing" };

  const items = returnRequest.items || [];
  const step = new Types.ObjectId().toString();
  const at = new Date();
  const locationId = params.locationId ? String(params.locationId) : undefined;
  const increments: Record<string, number> = {};
  const arrayFilters: Array<Record<string, unknown>> = [];
  const unchanged: Array<Record<string, unknown>> = [];
  plan.forEach((line, index) => {
    const item = items.find(
      (candidate) => Number(candidate.orderItemIndex) === line.orderItemIndex,
    );
    if (!item) return;
    increments[`items.$[r${index}].quantityRestocked`] = line.quantity;
    arrayFilters.push({ [`r${index}.orderItemIndex`]: line.orderItemIndex });
    unchanged.push({ items: { $elemMatch: lineUnchanged(item, counted) } });
  });

  const claim = await ReturnRequest.findOneAndUpdate(
    {
      _id: returnRequest._id,
      inventoryRestored: { $ne: true },
      status: { $nin: [RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED] },
      itemsCountedAt: counted ? { $ne: null } : null,
      $and: unchanged,
    },
    {
      $inc: increments,
      $push: {
        restockedLines: {
          $each: plan.map((line) => ({
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            quantity: line.quantity,
            orderItemIndex: line.orderItemIndex,
            ...(locationId ? { locationId } : {}),
            step,
            at,
            by: params.actor,
          })),
        },
      },
    },
    { arrayFilters },
  )
    .select("_id")
    .lean();
  if (!claim) return { kind: "changed" };

  try {
    const order = await Order.findById(returnRequest.orderId)
      .select("channel posLocationId subOrders.vendorId subOrders.fulfillment")
      .lean();
    await restoreReturnUnits({
      order: order as Parameters<typeof restoreReturnUnits>[0]["order"],
      lines: plan,
      locationId,
    });
  } catch (error) {
    // Handed back, so it can be tried again. Kept, the units never reached
    // the shelf and a later restock of the whole order left them out.
    console.error("Failed to put a return's items back in stock:", error);
    const giveBack: Record<string, number> = {};
    for (const [path, quantity] of Object.entries(increments)) giveBack[path] = -quantity;
    await ReturnRequest.updateOne(
      { _id: returnRequest._id },
      { $inc: giveBack, $pull: { restockedLines: { step } } },
      { arrayFilters },
    ).catch((releaseError) =>
      console.error("Failed to hand back a return restock claim:", releaseError),
    );
    return { kind: "failed" };
  }

  // What these units cost comes back off cost of goods — the sale moved it out
  // of stock, and they are stock again. Keyed by the step, so a later step is
  // posted on its own and a replay of this one is not.
  const { postRestockedCostSafely } = await import("@/lib/finance/post-events");
  postRestockedCostSafely({
    orderId: returnRequest.orderId,
    restocked: plan.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
    })),
    eventKey: returnRestockEventKey(returnRequest._id, step),
  });

  return { kind: "restocked", lines: plan, step, locationId };
}
