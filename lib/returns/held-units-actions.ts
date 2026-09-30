import "server-only";

import { Types } from "mongoose";
import { Order, ReturnRequest } from "@/models";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { RETURN_STATUS, UNSELLABLE_RETURN_CONDITIONS } from "@/lib/returns/returns";
import {
  HELD_UNIT_ACTIONS,
  heldReturnUnits,
  heldRestockEventKey,
  heldUnitRefusal,
  type HeldReturnSource,
  type HeldUnitAction,
  type HeldUnitEntry,
} from "@/lib/returns/held-units";
import {
  restockUnitsToSoldBranch,
  soldBranchLocationId,
} from "@/lib/orders/order-inventory";

/**
 * The inventory's "Unavailable" figure, opened up: which returns hold the
 * units, and the merchant's two ways of settling them. The rule itself lives in
 * `lib/returns/held-units.ts`; this is its database half.
 */

type HeldReturnDoc = HeldReturnSource & {
  _id: unknown;
  returnNumber?: string;
  orderId?: unknown;
  orderNumber?: string;
};

const HELD_RETURN_SELECT =
  "returnNumber orderId orderNumber status itemsCountedAt items.productId items.variantId items.vendorId items.quantityReceived items.condition unsellableDispositions";

/** At most this many returns list for one row; older ones stay on their returns. */
const HELD_ENTRY_LIMIT = 200;

function requireObjectId(value: unknown, field: string): string {
  const id = String(value || "");
  if (!Types.ObjectId.isValid(id)) {
    throw new ValidationError({ [field]: [`${field} is invalid`] });
  }
  return id;
}

/**
 * Every return still holding unsellable units of one inventory row, newest
 * count first. `vendorId` narrows to that seller's lines — a vendor sees its own
 * goods only, even on a return that also carries another seller's.
 */
export async function listHeldReturnUnits(params: {
  productId: unknown;
  variantId?: unknown;
  vendorId?: string;
}): Promise<HeldUnitEntry[]> {
  const productId = requireObjectId(params.productId, "productId");
  const variantId = params.variantId
    ? requireObjectId(params.variantId, "variantId")
    : undefined;

  const requests = await ReturnRequest.find({
    itemsCountedAt: { $exists: true },
    status: { $nin: [RETURN_STATUS.REJECTED, RETURN_STATUS.CANCELLED] },
    items: {
      $elemMatch: {
        productId,
        variantId: variantId ?? null,
        condition: { $in: UNSELLABLE_RETURN_CONDITIONS },
        ...(params.vendorId ? { vendorId: params.vendorId } : {}),
      },
    },
  })
    .select(HELD_RETURN_SELECT)
    .sort({ itemsCountedAt: -1 })
    .limit(HELD_ENTRY_LIMIT)
    .lean<HeldReturnDoc[]>();

  return requests.flatMap((request) =>
    heldReturnUnits(request)
      .filter(
        (line) =>
          line.held > 0 &&
          line.productId === productId &&
          (line.variantId || "") === (variantId || "") &&
          (!params.vendorId || line.vendorId === params.vendorId),
      )
      .map((line) => ({
        returnId: String(request._id),
        returnNumber: String(request.returnNumber || ""),
        orderId: String(request.orderId || ""),
        orderNumber: String(request.orderNumber || ""),
        itemIndex: line.itemIndex,
        condition: line.condition,
        received: line.received,
        held: line.held,
        countedAt: request.itemsCountedAt
          ? new Date(request.itemsCountedAt).toISOString()
          : null,
      })),
  );
}

const REFUSAL_MESSAGES = {
  not_held: "These units are no longer held — reload to see what is left.",
  invalid_quantity: "Choose how many units, at least one.",
  too_many: "That is more units than this return still holds.",
} as const;

type HeldUnitResolution = {
  held: number;
  productId: string;
  variantId?: string;
  returnNumber: string;
  orderNumber: string;
};

/**
 * Settle `quantity` of one held line: back on sale, or written off.
 *
 * The decision is appended to the return only if nobody appended another since
 * this call read it — two people settling the same units at once cannot move
 * more than the count found. A unit put back on sale goes to the branch its sale
 * took it from, and its cost comes back off cost of goods, as a return's
 * restock does; a written-off unit moves nothing and posts nothing, its cost
 * being the loss it is. A restore that fails takes the decision back out, so the
 * units stay held and can be tried again.
 *
 * `vendorId` scopes the call to that seller's lines; `allowedLocationIds`, when
 * set, refuses a restock onto a branch outside a staff member's assignment; and
 * `assertProduct` runs on the line's product before anything is written, for a
 * caller whose reach is narrower than the return's.
 */
export async function resolveHeldReturnUnits(params: {
  returnId: unknown;
  itemIndex: unknown;
  quantity: unknown;
  action: unknown;
  actorId?: string;
  vendorId?: string;
  allowedLocationIds?: ReadonlyArray<string>;
  assertProduct?: (productId: string) => Promise<void>;
}): Promise<HeldUnitResolution> {
  const returnId = requireObjectId(params.returnId, "returnId");
  const itemIndex = Number(params.itemIndex);
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    throw new ValidationError({ itemIndex: ["itemIndex is invalid"] });
  }
  const action = String(params.action || "") as HeldUnitAction;
  if (!HELD_UNIT_ACTIONS.includes(action)) {
    throw new ValidationError({ action: ["Choose restocked or written_off"] });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const request = await ReturnRequest.findById(returnId)
      .select(HELD_RETURN_SELECT)
      .lean<HeldReturnDoc | null>();
    if (!request) throw new NotFoundError("Return");

    const line = heldReturnUnits(request).find(
      (candidate) => candidate.itemIndex === itemIndex,
    );
    if (params.vendorId && line?.vendorId !== params.vendorId) {
      throw new NotFoundError("Return");
    }
    const refusal = heldUnitRefusal(line, params.quantity);
    if (refusal || !line) {
      throw new ValidationError(REFUSAL_MESSAGES[refusal ?? "not_held"]);
    }
    const quantity = Number(params.quantity);
    await params.assertProduct?.(line.productId);

    const order =
      action === "restocked"
        ? await Order.findById(request.orderId)
            .select("channel posLocationId subOrders.vendorId subOrders.fulfillment")
            .lean<Parameters<typeof restockUnitsToSoldBranch>[0]["order"]>()
        : null;
    if (action === "restocked" && params.allowedLocationIds?.length) {
      const branch = soldBranchLocationId(order, line.vendorId || "");
      if (branch && !params.allowedLocationIds.includes(branch)) {
        throw new AuthorizationError(
          "These units go back to a location outside your assignment.",
        );
      }
    }

    const dispositionId = new Types.ObjectId();
    const decided = (request.unsellableDispositions || []).length;
    const appended = await ReturnRequest.updateOne(
      {
        _id: returnId,
        $expr: {
          $eq: [{ $size: { $ifNull: ["$unsellableDispositions", []] } }, decided],
        },
      },
      {
        $push: {
          unsellableDispositions: {
            _id: dispositionId,
            itemIndex,
            productId: new Types.ObjectId(line.productId),
            ...(line.variantId
              ? { variantId: new Types.ObjectId(line.variantId) }
              : {}),
            quantity,
            action,
            at: new Date(),
            ...(params.actorId && Types.ObjectId.isValid(params.actorId)
              ? { by: new Types.ObjectId(params.actorId) }
              : {}),
          },
        },
      },
    );
    // Somebody decided on this return in between: read it again.
    if (appended.modifiedCount !== 1) continue;

    const units = {
      productId: line.productId,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      quantity,
    };
    if (action === "restocked") {
      try {
        await restockUnitsToSoldBranch({
          order,
          vendorId: line.vendorId || "",
          lines: [units],
        });
      } catch (error) {
        await ReturnRequest.updateOne(
          { _id: returnId },
          { $pull: { unsellableDispositions: { _id: dispositionId } } },
        ).catch((pullError) =>
          console.error("Failed to take back a held-unit restock:", pullError),
        );
        throw error;
      }
      const { postRestockedCostSafely } = await import("@/lib/finance/post-events");
      postRestockedCostSafely({
        orderId: request.orderId,
        restocked: [units],
        eventKey: heldRestockEventKey(returnId, dispositionId),
      });
    }

    return {
      held: line.held - quantity,
      productId: line.productId,
      ...(line.variantId ? { variantId: line.variantId } : {}),
      returnNumber: String(request.returnNumber || ""),
      orderNumber: String(request.orderNumber || ""),
    };
  }

  throw new ConflictError(
    "These units changed while you were deciding. Reload and try again.",
  );
}
