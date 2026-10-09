import "server-only";

import { Shipment } from "@/models";

/**
 * Give back the labels bought for goods that are no longer going anywhere.
 *
 * A carrier label is paid for the moment it is bought, and until this existed
 * cancelling an order — or one seller's consignment of it — left that label
 * live: the store had paid for a parcel nobody would ever hand over, the cost
 * stayed on the books, and the carrier could still collect and bill for it.
 *
 * Only a label that was bought and never used is voided. A parcel already with
 * the carrier cannot be taken back by us, and a delivered one is history; both
 * are left alone rather than sent to a carrier that would refuse them. What
 * the void does to the books — the cost reversed if the carrier refunds it,
 * the delivery charge handed back to the vendor — is `voidShipmentLabel`'s
 * business, the same as when an admin voids one by hand.
 *
 * Reported, never thrown: a cancellation that has already refunded the shopper
 * must not fail because a carrier was unreachable.
 */
export async function voidLabelsForCancellation(params: {
  orderId: unknown;
  /** Limit it to one consignment's parcels; omitted means the whole order. */
  subOrderId?: unknown;
}): Promise<{ voided: number; refunded: number; failed: number }> {
  const shipments = await Shipment.find({
    orderId: params.orderId,
    ...(params.subOrderId ? { subOrderId: params.subOrderId } : {}),
    provider: { $type: "string" },
    "purchase.state": "purchased",
    // Bought, not yet handed over. See above.
    status: "label_ready",
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  if (shipments.length === 0) return { voided: 0, refunded: 0, failed: 0 };

  const { voidShipmentLabel } = await import("@/lib/shipping/carriers/fulfillment");
  let voided = 0;
  let refunded = 0;
  let failed = 0;
  for (const shipment of shipments) {
    try {
      const result = await voidShipmentLabel({ shipmentId: String(shipment._id) });
      voided += 1;
      if (result.refunded) refunded += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "Failed to void the label of a cancelled parcel:",
        String(shipment._id),
        error,
      );
    }
  }
  return { voided, refunded, failed };
}
