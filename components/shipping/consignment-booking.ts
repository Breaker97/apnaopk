import { isPurchaseClaimStale } from "@/lib/shipping/carrier-config";

/**
 * Which of an order's consignments may still be handed to a courier.
 *
 * Pulled out of the Shipments panel because it is the decision that puts a
 * money-spending button on the screen, and it used to be asked of the *order*:
 * one seller's label hid "Send to courier" from every other seller's parcel,
 * which on a split order is most of the order. A parcel maps to a consignment,
 * so the question does too.
 */

export interface BookableConsignment {
  id: string;
  label: string;
  /** False for a collected-in-store, cancelled or digital consignment. */
  shippable: boolean;
}

interface BookingShipment {
  /** Absent on rows written before parcels carried a consignment id. */
  subOrderId?: string;
  purchase?: { state?: string; startedAt?: string | Date };
}

/**
 * One label per parcel, so a consignment with a live booking is not offered
 * another.
 *
 * A `purchasing` claim counts only while it is fresh. An abandoned one is not a
 * purchase in progress, and hiding the button for it took away the only manual
 * way out of a parcel whose worker had died. A voided label clears the booking
 * entirely, which is the whole point of voiding.
 */
export function isConsignmentBooked(shipment: BookingShipment): boolean {
  return (
    shipment.purchase?.state === "purchased" ||
    (shipment.purchase?.state === "purchasing" &&
      !isPurchaseClaimStale(shipment.purchase))
  );
}

export function openConsignments(params: {
  consignments: BookableConsignment[];
  shipments: BookingShipment[];
}): BookableConsignment[] {
  // A booked row that names no consignment can only be the one consignment
  // there is. Anywhere else it names nothing, and blocking every parcel on it
  // would be the order-wide answer this exists to replace.
  const sole =
    params.consignments.length === 1 ? params.consignments[0]!.id : undefined;

  const booked = new Set(
    params.shipments
      .filter(isConsignmentBooked)
      .map((shipment) =>
        shipment.subOrderId ? String(shipment.subOrderId) : sole,
      )
      .filter((id): id is string => Boolean(id)),
  );

  return params.consignments.filter(
    (consignment) => consignment.shippable && !booked.has(consignment.id),
  );
}
