/**
 * How far a split order's packages have got, counted package by package.
 *
 * The order's own status is the least advanced live consignment (see
 * `deriveOrderStatusFromSubOrders`), which is right for deciding what the order
 * may still do but wrong as the only thing a shopper reads: one parcel already
 * with the courier and another still being packed reads as "Pending". These
 * counts are what let a screen say "1 of 2 shipped" instead.
 *
 * Client-safe on purpose — both the public tracking page and the signed-in
 * order screen compute it from the consignments they were already sent.
 */

const PROCESSING_OR_LATER = ["processing", "shipped", "delivered"];
const SHIPPED_OR_LATER = ["shipped", "delivered"];

export interface ShipmentProgress {
  /** Live packages only; a cancelled consignment is not waiting to arrive. */
  total: number;
  processing: number;
  shipped: number;
  delivered: number;
}

type PartialShipmentState = "partially_shipped" | "partially_delivered";

/** Null when there is nothing to count: no split, or every package cancelled. */
export function summarizeShipments(
  shipments: Array<{ status?: string }> | undefined | null,
): ShipmentProgress | null {
  const live = (shipments ?? []).filter(
    (shipment) => shipment.status !== "cancelled",
  );
  if (live.length === 0) return null;

  const count = (statuses: string[]) =>
    live.filter((shipment) => statuses.includes(String(shipment.status))).length;

  return {
    total: live.length,
    processing: count(PROCESSING_OR_LATER),
    shipped: count(SHIPPED_OR_LATER),
    delivered: count(["delivered"]),
  };
}

/**
 * The in-between state the order status has no word for, or null when the
 * packages agree with each other and the order status already says it.
 */
export function partialShipmentState(
  progress: ShipmentProgress | null,
): PartialShipmentState | null {
  if (!progress || progress.total < 2) return null;
  if (progress.shipped > 0 && progress.shipped < progress.total) {
    return "partially_shipped";
  }
  if (
    progress.shipped === progress.total &&
    progress.delivered > 0 &&
    progress.delivered < progress.total
  ) {
    return "partially_delivered";
  }
  return null;
}
