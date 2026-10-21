/**
 * Who said a consignment reached the shopper.
 *
 * A seller is paid once their parcel is delivered and the return window has
 * passed, and the window counts from the delivery. When the only evidence of
 * that delivery is the seller's own click, the payout clock starts on their
 * word — so the word is recorded, and a parcel a carrier is tracking is left
 * for the carrier to call.
 *
 * Absent on consignments delivered before this was recorded: nobody knows.
 */
export const DELIVERY_ATTESTED_BY = {
  /** A carrier scan reported it delivered. */
  CARRIER: "carrier",
  /** The seller marked it delivered themselves. */
  VENDOR: "vendor",
  /** Store staff marked it delivered. */
  ADMIN: "admin",
  /** Handed over at a till — a POS sale paid in full. */
  COUNTER: "counter",
} as const;

export type DeliveryAttestedBy =
  (typeof DELIVERY_ATTESTED_BY)[keyof typeof DELIVERY_ATTESTED_BY];

export const DELIVERY_ATTESTED_BY_VALUES = Object.values(DELIVERY_ATTESTED_BY);

/**
 * Shipment states in which a carrier is carrying the parcel and will report
 * its delivery itself.
 */
export const CARRIER_TRACKED_SHIPMENT_STATUSES = [
  "label_ready",
  "shipped",
  "in_transit",
] as const;

/** Mongo filter for a live carrier-tracked shipment on one consignment. */
export function liveCarrierShipmentFilter(params: {
  orderId: unknown;
  subOrderId: unknown;
}): Record<string, unknown> {
  return {
    orderId: params.orderId,
    subOrderId: params.subOrderId,
    source: "carrier_api",
    status: { $in: [...CARRIER_TRACKED_SHIPMENT_STATUSES] },
  };
}

export const CARRIER_DELIVERS_MESSAGE =
  "A carrier is tracking this parcel, so it is marked delivered when the carrier reports the delivery.";
