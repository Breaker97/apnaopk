import "server-only";
import { InventoryReservation } from "@/models/inventory-reservation.model";
import { InventorySaleAllocation } from "@/models/inventory-allocation.model";
import { CheckoutAttempt } from "@/models/checkout-attempt.model";
import { Order } from "@/models/order.model";
import { ReturnRequest } from "@/models/return-request.model";
import { financeQuery } from "@/lib/finance/transaction";
import { physicalReturnRows, type PhysicalReturn } from "./finance-return-states";
import { soldBranchLocationId } from "@/lib/orders/order-inventory";
import type { InventoryScope } from "./finance-service";
import { inventoryPositionKey } from "./finance-position";

/** A paid unit may still be physically committed after its asset was costed. */
export async function protectedPhysicalStates(scope: InventoryScope, heldOwned: number) {
  const reservations = await financeQuery(InventoryReservation.find({ positionKey: inventoryPositionKey(scope) })).lean();
  const grouped = new Map<string, { sourceKind: string; sourceId: string; positionKey: string; quantity: number; releasedQuantity: number }>();
  for (const row of reservations) {
    const key = `${row.sourceKind}:${row.sourceId}`;
    const previous = grouped.get(key);
    grouped.set(key, { sourceKind: row.sourceKind, sourceId: row.sourceId, positionKey: row.positionKey, quantity: row.quantity + (previous?.quantity ?? 0), releasedQuantity: row.releasedQuantity + (previous?.releasedQuantity ?? 0) });
  }
  let committed = 0;
  for (const reservation of grouped.values()) {
    if (!["order", "order_reservation", "checkout_attempt"].includes(reservation.sourceKind)) continue;
    if (reservation.quantity <= reservation.releasedQuantity) continue;
    const order = await financeQuery(Order.findOne({ $or: [
      ...(reservation.sourceKind === "order" ? [{ _id: reservation.sourceId }] : []),
      ...(reservation.sourceKind === "order_reservation" ? [{ inventoryReservationSourceId: reservation.sourceId }] : []),
      ...(reservation.sourceKind === "checkout_attempt" ? [{ checkoutAttemptId: reservation.sourceId }] : []),
    ] })).lean();
    if (order) {
      const sub = order.subOrders?.find((s: { vendorId: unknown }) => String(s.vendorId) === scope.ownerId);
      if (!sub?.inventoryReserved || ["shipped", "delivered", "cancelled"].includes(sub.status)) continue;
      const allocations = await financeQuery(InventorySaleAllocation.find({ orderId: order._id, positionKey: reservation.positionKey })).lean();
      const restored = allocations.reduce((sum, a) => sum + a.restoredQuantity, 0);
      committed += Math.max(0, reservation.quantity - reservation.releasedQuantity - restored);
    } else if (reservation.sourceKind === "checkout_attempt") {
      const attempt = await financeQuery(CheckoutAttempt.findById(reservation.sourceId)).select("stockHold.releasedAt").lean();
      if (attempt?.stockHold && !attempt.stockHold.releasedAt) committed += reservation.quantity - reservation.releasedQuantity;
    }
  }
  const returns = await financeQuery(ReturnRequest.find({ "items.productId": scope.productId, itemsCountedAt: { $ne: null }, status: { $nin: ["rejected", "cancelled"] } })).lean();
  let unavailable = heldOwned;
  for (const request of returns) {
    const lines = physicalReturnRows(request as unknown as PhysicalReturn).filter((line) => line.productId === scope.productId && (line.variantId ?? null) === (scope.variantId ?? null));
    if (!lines.length) continue;
    const order = await financeQuery(Order.findById(request.orderId)).lean();
    const location = request.returnTo?.locationId ? String(request.returnTo.locationId) : soldBranchLocationId(order, scope.ownerId) ?? null;
    if (location === (scope.locationId ?? null)) unavailable += lines.reduce((sum, line) => sum + line.quantity, 0);
  }
  return { committed, unavailable };
}
