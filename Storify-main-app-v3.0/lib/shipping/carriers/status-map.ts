import type { ShipmentStatus } from "@/models/shipment.model";
import type { NormalizedTrackingStatus } from "./types";

/**
 * Carrier vocabulary → ours.
 *
 * Every provider invents its own status list, and several of them (returns,
 * failed delivery attempts) have no equivalent in `Shipment.status`, which is
 * consumed by the label route and both order screens. Rather than widen that
 * enum and audit every reader, a status with no home is recorded in the event
 * log and the `exception` field, and the parcel keeps the status it had.
 */

const SHIPPO_STATUS: Record<string, NormalizedTrackingStatus> = {
  UNKNOWN: "unknown",
  PRE_TRANSIT: "pre_transit",
  TRANSIT: "in_transit",
  DELIVERED: "delivered",
  RETURNED: "returned",
  FAILURE: "failure",
};

export function normalizeShippoStatus(
  status: string | undefined | null,
  substatusCode?: string | null,
): NormalizedTrackingStatus {
  const normalized = SHIPPO_STATUS[String(status || "").toUpperCase()];
  if (normalized === "in_transit" && substatusCode) {
    // Shippo folds out-for-delivery into TRANSIT and only distinguishes it in
    // the substatus, which is exactly the event a customer cares most about.
    if (String(substatusCode).toLowerCase().includes("out_for_delivery")) {
      return "out_for_delivery";
    }
  }
  return normalized ?? "unknown";
}

/**
 * Shiprocket reports a free-text status alongside a numeric code. The text is
 * matched because the code list is undocumented and has changed between
 * accounts; matching is substring-based and order-sensitive, so the more
 * specific phrases are tested first.
 */
const SHIPROCKET_STATUS_PATTERNS: Array<[RegExp, NormalizedTrackingStatus]> = [
  [/out\s*for\s*delivery/i, "out_for_delivery"],
  [/rto|return/i, "returned"],
  [/undelivered|cancell?ed|lost|damaged|exception/i, "failure"],
  [/delivered/i, "delivered"],
  [/in\s*transit|shipped|picked\s*up|dispatch/i, "in_transit"],
  [/awb\s*assigned|pickup\s*(scheduled|generated|queued)|manifest|new|invoiced|ready/i, "pre_transit"],
];

export function normalizeShiprocketStatus(
  status: string | undefined | null,
): NormalizedTrackingStatus {
  const text = String(status || "").trim();
  if (!text) return "unknown";
  for (const [pattern, normalized] of SHIPROCKET_STATUS_PATTERNS) {
    if (pattern.test(text)) return normalized;
  }
  return "unknown";
}

/**
 * The parcel status a normalized tracking status implies.
 *
 * Returns `null` when the tracking status carries no status change — a return
 * or a failed delivery is recorded as an exception rather than rewriting the
 * parcel's journey, and an unknown status must never downgrade a parcel that
 * is already further along.
 */
export function shipmentStatusForTracking(
  status: NormalizedTrackingStatus,
  current: ShipmentStatus,
): ShipmentStatus | null {
  switch (status) {
    case "pre_transit":
      // Never walk a moving parcel backwards on a late-arriving early event.
      return current === "draft" || current === "label_ready"
        ? "label_ready"
        : null;
    case "in_transit":
    case "out_for_delivery":
      if (current === "delivered" || current === "cancelled") return null;
      // The first movement is what "shipped" means; everything after is transit.
      return current === "draft" || current === "label_ready"
        ? "shipped"
        : "in_transit";
    case "delivered":
      return current === "cancelled" ? null : "delivered";
    case "returned":
    case "failure":
    case "unknown":
      return null;
  }
}

/** True when this status warrants an operator-visible exception on the parcel. */
export function isExceptionStatus(status: NormalizedTrackingStatus): boolean {
  return status === "returned" || status === "failure";
}
