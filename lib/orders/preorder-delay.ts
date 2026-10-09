import { Types } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { PREORDER_ITEM_STATUS, PURCHASE_TYPE } from "@/lib/orders/preorders";
import { collectionScope, isActiveCollection } from "@/lib/orders/preorder-scope";
import {
  getTransactionSupport,
  runTransaction,
  TransactionContendedError,
  TransactionOutcomeUnknownError,
  TransactionsUnavailableError,
} from "@/lib/db-transaction";

/**
 * Moving a pre-order's release date by hand — the store's or a seller's.
 *
 * Only consignments still waiting on their goods move (a released, shipped or
 * cancelled one keeps what it was told), and declaring a new date withdraws
 * any "goods available" those consignments carried: the goods are not ready
 * after all. If the balance had already been requested for them, the request
 * is taken back in the same transaction — its stock returned to the shelf and
 * its places to the reservation counter, its notice and any scheduled charge
 * void (`resetPreparedCollectionInSession`) — and the order waits again. A new
 * request, with a new notice, follows when every consignment is ready again.
 * Money already paid stays paid; a date change never asks for it again.
 */

type DelayOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  status?: string;
  preorderStatus?: string;
  preorderReleaseDate?: Date | null;
  preorderOriginalReleaseDate?: Date | null;
  preorderCollection?: { cycleId?: string; state?: string } | null;
  preorderRelease?: { state?: string } | null;
  items?: Array<{ vendorId?: unknown; purchaseType?: string; preorderReleaseDate?: Date | null }>;
  subOrders?: Array<{
    _id: Types.ObjectId;
    vendorId?: unknown;
    status?: string;
    preorderReadiness?: { declaredAt?: Date | null } | null;
    items?: Array<{ purchaseType?: string; quantity?: number; preorderReleaseDate?: Date | null }>;
  }>;
};

export type DelayOutcome =
  | {
      kind: "delayed";
      reset: boolean;
      previousReleaseDate?: Date;
      orderReleaseDate?: Date;
    }
  | { kind: "refused"; reason: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "in_progress" };

const DELAYABLE: string[] = [
  PREORDER_ITEM_STATUS.RESERVED,
  PREORDER_ITEM_STATUS.DELAYED,
  PREORDER_ITEM_STATUS.PAYMENT_DUE,
  PREORDER_ITEM_STATUS.PARTIALLY_READY,
];

const id = (value: unknown) =>
  String((value as { _id?: unknown } | null)?._id ?? value ?? "");

function latest(dates: Array<Date | null | undefined>): Date | undefined {
  let max: number | undefined;
  for (const value of dates) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) continue;
    if (max === undefined || time > max) max = time;
  }
  return max === undefined ? undefined : new Date(max);
}

export async function delayPreorder(params: {
  orderId: string;
  releaseDate: Date;
  reason?: string;
  actor: string;
  /** A seller moves only their own consignment. */
  vendorId?: string;
  scopeFilter?: Record<string, unknown>;
  /** Tell the shopper (default). */
  notify?: boolean;
  now?: Date;
}): Promise<DelayOutcome> {
  const now = params.now || new Date();
  if (!Types.ObjectId.isValid(params.orderId)) return { kind: "refused", reason: "order_missing" };
  const order = (await Order.findOne({ ...(params.scopeFilter || {}), _id: params.orderId })
    .select(
      "_id orderNumber customerId guestEmail status preorderStatus preorderReleaseDate preorderOriginalReleaseDate preorderCollection preorderRelease items.vendorId items.purchaseType items.preorderReleaseDate subOrders._id subOrders.vendorId subOrders.status subOrders.preorderReadiness subOrders.items.purchaseType subOrders.items.quantity subOrders.items.preorderReleaseDate",
    )
    .lean()) as DelayOrder | null;
  if (!order) return { kind: "refused", reason: "order_missing" };
  if (order.status === ORDER_STATUS.CANCELLED) return { kind: "refused", reason: "order_cancelled" };
  if (!DELAYABLE.includes(String(order.preorderStatus || ""))) {
    return { kind: "refused", reason: "consignment_not_waiting" };
  }
  const waiting = collectionScope(order);
  const targets = params.vendorId
    ? waiting.filter((sub) => id(sub.vendorId) === params.vendorId)
    : waiting;
  if (targets.length === 0) return { kind: "refused", reason: "consignment_not_waiting" };

  const targetIds = new Set(targets.map((sub) => id(sub._id)));
  const targetVendors = targets.map((sub) => sub.vendorId);
  // What the shopper is told moved: the order's own date, or for a seller
  // their own lines' — a split order's later sibling would otherwise read as
  // "changed from 1 Nov to 1 Nov".
  const previous = params.vendorId
    ? latest(targets.flatMap((sub) => (sub.items || []).map((item) => item.preorderReleaseDate)))
    : order.preorderReleaseDate || undefined;
  // The order waits for its latest waiting line.
  const orderDate = latest([
    params.releaseDate,
    ...waiting
      .filter((sub) => !targetIds.has(id(sub._id)))
      .flatMap((sub) =>
        (sub.items || [])
          .filter((item) => item.purchaseType === PURCHASE_TYPE.PREORDER)
          .map((item) => item.preorderReleaseDate),
      ),
  ]);

  const set: Record<string, unknown> = {
    preorderStatus: PREORDER_ITEM_STATUS.DELAYED,
    preorderReleaseDate: orderDate,
    preorderOriginalReleaseDate:
      order.preorderOriginalReleaseDate || order.preorderReleaseDate || params.releaseDate,
    preorderDelayReason: params.reason,
    preorderReleaseDateUpdatedAt: now,
    preorderCustomerNotifiedAt: now,
    statusChangedBy: params.actor,
    "items.$[movedLine].preorderReleaseDate": params.releaseDate,
    "items.$[movedLine].preorderStatus": PREORDER_ITEM_STATUS.DELAYED,
  };
  const unset: Record<string, ""> = { preorderBalanceRemindersSent: "" };
  const arrayFilters: Record<string, unknown>[] = [
    {
      "movedLine.purchaseType": PURCHASE_TYPE.PREORDER,
      "movedLine.vendorId": { $in: targetVendors },
    },
    { "movedPreorderLine.purchaseType": PURCHASE_TYPE.PREORDER },
  ];
  targets.forEach((sub, index) => {
    set[`subOrders.$[moved${index}].items.$[movedPreorderLine].preorderReleaseDate`] =
      params.releaseDate;
    set[`subOrders.$[moved${index}].items.$[movedPreorderLine].preorderStatus`] =
      PREORDER_ITEM_STATUS.DELAYED;
    if (sub.preorderReadiness) unset[`subOrders.$[moved${index}].preorderReadiness`] = "";
    arrayFilters.push({
      [`moved${index}._id`]: sub._id,
      [`moved${index}.status`]: ORDER_STATUS.PREORDERED,
    });
  });
  if (
    order.preorderRelease?.state === "requested" ||
    order.preorderRelease?.state === "waiting"
  ) {
    set["preorderRelease.state"] = "superseded";
    set["preorderRelease.reason"] = "date_changed";
  }
  const readinessCleared = Object.keys(unset).some((key) => key.endsWith("preorderReadiness"));
  const filter = {
    _id: order._id,
    status: { $ne: ORDER_STATUS.CANCELLED },
    preorderStatus: order.preorderStatus,
  };

  let reset = false;
  if (isActiveCollection(order.preorderCollection)) {
    const support = await getTransactionSupport();
    if (!support.supported) {
      return { kind: "unavailable", reason: support.reason || "Transactions are unavailable" };
    }
    try {
      reset = await runTransaction("Delay pre-order", async (session) => {
        const { resetPreparedCollectionInSession } = await import(
          "@/lib/orders/preorder-collection"
        );
        const result = await resetPreparedCollectionInSession({
          session,
          orderId: params.orderId,
          reason: "date_changed",
          now,
        });
        // The reset cleared the readiness of the whole request already.
        const ownUnset = { ...unset };
        for (const key of Object.keys(ownUnset)) {
          if (key.endsWith("preorderReadiness")) delete ownUnset[key];
        }
        const written = await Order.updateOne(
          filter,
          { $set: set, $unset: ownUnset },
          { session, arrayFilters },
        );
        if (written.matchedCount !== 1) throw new TransactionContendedError("Delay pre-order");
        return result.reset;
      });
    } catch (error) {
      if (error instanceof TransactionsUnavailableError) {
        return { kind: "unavailable", reason: error.message };
      }
      if (
        error instanceof TransactionContendedError ||
        error instanceof TransactionOutcomeUnknownError
      ) {
        return { kind: "in_progress" };
      }
      throw error;
    }
  } else {
    const written = await Order.updateOne(
      filter,
      {
        $set: set,
        $unset: unset,
        ...(readinessCleared ? { $inc: { preorderReadinessRevision: 1 } } : {}),
      },
      { arrayFilters },
    );
    if (written.matchedCount !== 1) return { kind: "refused", reason: "changed" };
  }

  if (params.notify !== false) {
    const { notifyPreorderCustomerUpdate } = await import("@/lib/notifications/notifications");
    await notifyPreorderCustomerUpdate(
      String(order.customerId),
      order.orderNumber,
      "delayed",
      String(order._id),
      {
        releaseDate: params.releaseDate,
        previousReleaseDate: previous,
        reason: params.reason,
        guestEmail: order.guestEmail,
      },
    ).catch((error) => console.error("Failed to notify a pre-order delay:", error));
  }
  return { kind: "delayed", reset, previousReleaseDate: previous, orderReleaseDate: orderDate };
}
