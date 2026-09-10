export const RETURN_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  REJECTED: "rejected",
  AWAITING_SHIPMENT: "awaiting_shipment",
  IN_TRANSIT: "in_transit",
  RECEIVED: "received",
  INSPECTED: "inspected",
  REFUND_PENDING: "refund_pending",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially_refunded",
  CLOSED: "closed",
  CANCELLED: "cancelled",
} as const;

export const RETURN_REFUND_STATUS = {
  NOT_REQUIRED: "not_required",
  PENDING: "pending",
  PROCESSING: "processing",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  MANUAL_REQUIRED: "manual_required",
} as const;

export type ReturnStatus = (typeof RETURN_STATUS)[keyof typeof RETURN_STATUS];
export type ReturnRefundStatus =
  (typeof RETURN_REFUND_STATUS)[keyof typeof RETURN_REFUND_STATUS];

const OPEN_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REQUESTED,
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.AWAITING_SHIPMENT,
  RETURN_STATUS.IN_TRANSIT,
  RETURN_STATUS.RECEIVED,
  RETURN_STATUS.INSPECTED,
  RETURN_STATUS.REFUND_PENDING,
  RETURN_STATUS.PARTIALLY_REFUNDED,
];

// Statuses that still consume returnable quantity when validating a new
// return request: every open return PLUS completed ones (refunded/closed).
// Only rejected/cancelled returns release their claim, so those are excluded.
// Using OPEN_RETURN_STATUSES alone here would let a fully-refunded return's
// quantity become "available" again and be returned/refunded a second time.
export const QUANTITY_CONSUMING_RETURN_STATUSES: ReturnStatus[] = [
  ...OPEN_RETURN_STATUSES,
  RETURN_STATUS.REFUNDED,
  RETURN_STATUS.CLOSED,
];

export const RETURN_REASONS = [
  "wrong_size_or_variant",
  "damaged_or_defective",
  "not_as_described",
  "wrong_item_received",
  "arrived_late",
  "other",
] as const;

