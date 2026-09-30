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

export const OPEN_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REQUESTED,
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.AWAITING_SHIPMENT,
  RETURN_STATUS.IN_TRANSIT,
  RETURN_STATUS.RECEIVED,
  RETURN_STATUS.INSPECTED,
  RETURN_STATUS.REFUND_PENDING,
  RETURN_STATUS.PARTIALLY_REFUNDED,
];

/** Still running: not refused, not cancelled, not refunded, not closed. */
export function isOpenReturnStatus(status: unknown): boolean {
  return OPEN_RETURN_STATUSES.includes(String(status || "") as ReturnStatus);
}

/**
 * A return's own refund is moving: sent to the gateway and not settled, or
 * recorded by hand and still to be paid. Nothing may close it underneath
 * that money.
 */
export const REFUND_IN_MOTION_STATUSES: ReturnRefundStatus[] = [
  RETURN_REFUND_STATUS.PROCESSING,
  RETURN_REFUND_STATUS.MANUAL_REQUIRED,
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

/** Refused when one return request lists the same order line twice. */
export const RETURN_ITEM_LISTED_TWICE = "Each item can be returned only once per request";

/**
 * The returns a seller's payout waits on: asked for, agreed or on the way
 * back, and nothing refunded yet. Paid out while one was open, a return
 * refunded afterwards could only be recovered from the seller's NEXT payout —
 * which a seller who stops selling never has.
 */
export const PAYOUT_HOLDING_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REQUESTED,
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.AWAITING_SHIPMENT,
  RETURN_STATUS.IN_TRANSIT,
  RETURN_STATUS.RECEIVED,
  RETURN_STATUS.INSPECTED,
  RETURN_STATUS.REFUND_PENDING,
];

const QUANTITY_RELEASING_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.CANCELLED,
];

/**
 * The units of an order line a return holds on to.
 *
 * What the store agreed to take back, once it has said: approving one of two
 * units used to leave the declined one claimed for good — it could not be
 * returned again, nor refunded from the order screen, and the return's own
 * estimate no longer counted it. `quantityApproved` is stamped with the
 * requested figure when a return is created, so a return nobody has touched
 * yet still holds everything it asked for.
 */
export function returnClaimedQuantity(item: {
  quantityRequested?: number | null;
  quantityApproved?: number | null;
} | null | undefined): number {
  return Math.max(
    0,
    Number(item?.quantityApproved ?? item?.quantityRequested ?? 0) || 0,
  );
}

/**
 * The states a return passes through before any money moves on it. Once a
 * refund has gone out, a return never walks back into one of these: a
 * refunded return put back to "approved" or "in transit" reopened it on every
 * screen and told the shopper their refunded return was still on its way.
 */
const BEFORE_REFUND_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REQUESTED,
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.AWAITING_SHIPMENT,
  RETURN_STATUS.IN_TRANSIT,
  RETURN_STATUS.RECEIVED,
  RETURN_STATUS.INSPECTED,
  RETURN_STATUS.REFUND_PENDING,
];

/** The states that say money went back — reached only by sending it. */
const REFUNDED_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.PARTIALLY_REFUNDED,
  RETURN_STATUS.REFUNDED,
];

/**
 * Where a return goes when a tracking number is recorded for the parcel
 * coming back: in transit while it is still on its way, and where it already
 * is once it has arrived. Forced to "in transit" from anywhere, a tracking
 * number typed in after the refund walked a refunded return backwards.
 */
export function returnStatusForTracking(current: unknown): ReturnStatus | null {
  const status = String(current || "") as ReturnStatus;
  return (
    [
      RETURN_STATUS.REQUESTED,
      RETURN_STATUS.APPROVED,
      RETURN_STATUS.AWAITING_SHIPMENT,
      RETURN_STATUS.IN_TRANSIT,
    ] as ReturnStatus[]
  ).includes(status)
    ? RETURN_STATUS.IN_TRANSIT
    : null;
}

/**
 * Why a return may not move from `from` to `to`, or null when it may.
 *
 * Rejected and cancelled are the two states that hand a return's quantity
 * back, so they guard the money. Putting a refunded return there let the
 * shopper open a second return for the same units and be refunded again; and
 * reopening one after its quantity had been released let two returns claim
 * the same units.
 */
export function returnStatusChangeProblem(params: {
  from?: string | null;
  to?: string | null;
  refundedAmount?: number | null;
  /** The return's goods are already back on the shelf. */
  restocked?: boolean | null;
  /** A refund is being issued in this same request. */
  refundingNow?: boolean;
}): string | null {
  const from = String(params.from || "") as ReturnStatus;
  const to = String(params.to || "") as ReturnStatus;
  if (!to || to === from) return null;
  if (QUANTITY_RELEASING_RETURN_STATUSES.includes(from)) {
    return "This return was rejected or cancelled and cannot be reopened. The customer can open a new return.";
  }
  const moneyMoved = Number(params.refundedAmount || 0) > 0;
  if (QUANTITY_RELEASING_RETURN_STATUSES.includes(to) && moneyMoved) {
    return "Money has already been refunded on this return, so it can no longer be rejected or cancelled.";
  }
  // Rejecting kept the restocked units on the shelf AND released them, so a
  // second return for the same units put them back a second time.
  if (QUANTITY_RELEASING_RETURN_STATUSES.includes(to) && params.restocked) {
    return "These items are already back in stock, so this return can no longer be rejected or cancelled.";
  }
  if (moneyMoved && BEFORE_REFUND_RETURN_STATUSES.includes(to)) {
    return `Money has already been refunded on this return, so it cannot go back to "${to.replace(/_/g, " ")}".`;
  }
  // Saying it did not make it so: the shopper was told they had been refunded
  // and every screen stopped offering the refund, with nothing sent.
  if (REFUNDED_RETURN_STATUSES.includes(to) && !params.refundingNow) {
    return "A return is marked refunded by issuing the refund. To finish one without sending more, close it.";
  }
  return null;
}

/** A write filter that still holds when a return may be rejected or cancelled. */
export const NOTHING_REFUNDED_ON_RETURN = {
  $or: [
    { "actualRefund.amount": { $exists: false } },
    { "actualRefund.amount": { $lte: 0 } },
  ],
};

/**
 * The states a VENDOR may move a return into.
 *
 * Everything the person holding the parcel decides: whether to take it back,
 * that it is on its way, that it arrived, what was found. Not one of the money
 * states — `refund_pending`, `partially_refunded` and `refunded` all say the
 * shopper has been paid, and a vendor cannot pay them: the money is on the
 * platform's gateway and only an admin can send it.
 *
 * The refund FIELDS were already refused on that route, which made this the
 * remaining way to say it: a vendor setting the status alone stamped
 * `refundedAt`, closed the return and sent the shopper "accepted and refunded"
 * — for money nobody had moved, and with the return's own `refundStatus` still
 * reading `pending` underneath it.
 */
const VENDOR_SETTABLE_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.APPROVED,
  RETURN_STATUS.REJECTED,
  RETURN_STATUS.AWAITING_SHIPMENT,
  RETURN_STATUS.IN_TRANSIT,
  RETURN_STATUS.RECEIVED,
  RETURN_STATUS.INSPECTED,
  RETURN_STATUS.CANCELLED,
];

export function vendorMaySetReturnStatus(status: unknown): boolean {
  return VENDOR_SETTABLE_RETURN_STATUSES.includes(
    String(status || "") as ReturnStatus,
  );
}

/**
 * The states in which a return's goods may go back on the shelf — the ones
 * the returns screen offers "Put back in stock" from: the parcel has arrived,
 * or the shopper has been paid for it.
 *
 * Held by the routes as well as the screen. Restocking is a flag on the
 * request, and without this a call made while the goods were still with the
 * shopper — or on a return that was refused — added stock nobody had, took a
 * cost-of-goods reversal into the books, and spent the one-time claim the real
 * restock would have needed.
 */
const RESTOCKABLE_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.RECEIVED,
  RETURN_STATUS.INSPECTED,
  RETURN_STATUS.REFUND_PENDING,
  RETURN_STATUS.PARTIALLY_REFUNDED,
  RETURN_STATUS.REFUNDED,
  RETURN_STATUS.CLOSED,
];

export function returnMayRestock(status: unknown): boolean {
  return RESTOCKABLE_RETURN_STATUSES.includes(
    String(status || "") as ReturnStatus,
  );
}

/**
 * Whether a return's goods came back to the store: counted, or marked
 * received or inspected. One refunded without them — the shopper kept the
 * item (`no_shipping`), or the money went before the parcel arrived — has
 * nothing to put back on the shelf, whatever its status says.
 */
export function returnGoodsBack(request: {
  returnMethod?: unknown;
  receivedAt?: unknown;
  itemsCountedAt?: unknown;
  inspectedAt?: unknown;
}): boolean {
  if (request.itemsCountedAt) return true;
  if (String(request.returnMethod || "") === "no_shipping") return false;
  return Boolean(request.receivedAt || request.inspectedAt);
}

/** The states money has already moved in, or the return is done with. */
const PAST_RECEIPT_RETURN_STATUSES: ReturnStatus[] = [
  RETURN_STATUS.REFUND_PENDING,
  RETURN_STATUS.PARTIALLY_REFUNDED,
  RETURN_STATUS.REFUNDED,
  RETURN_STATUS.CLOSED,
];

/**
 * Where a return stands once its parcel has been counted.
 *
 * `received`, unless it is already past that: counting a parcel after the
 * shopper has been paid records what arrived, and used to walk a refunded
 * return back to "received" — reopening it on every screen and telling the
 * shopper their refunded return had only just arrived.
 */
export function returnStatusAfterCount(current: unknown): ReturnStatus {
  const status = String(current || "") as ReturnStatus;
  return PAST_RECEIPT_RETURN_STATUSES.includes(status)
    ? status
    : RETURN_STATUS.RECEIVED;
}

export function releasesReturnQuantity(status: unknown): boolean {
  return QUANTITY_RELEASING_RETURN_STATUSES.includes(
    String(status || "") as ReturnStatus,
  );
}

/**
 * Conditions a counted unit cannot be sold in. It stays out of stock and is
 * held as the inventory's "Unavailable" figure instead — see
 * `lib/returns/held-units.ts`.
 */
export const UNSELLABLE_RETURN_CONDITIONS = ["damaged", "missing_parts", "unusable"];

type ReturnRestockLine = {
  productId: string;
  variantId?: string;
  quantity: number;
};

/** The fields of a return line a restock reads. */
type RestockableReturnItem = {
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

/**
 * The units of one line that may go back on sale in all: what arrived and
 * can be sold once the parcel was counted, else what the store agreed to take.
 */
function returnSellableUnits(
  item: RestockableReturnItem,
  itemsCounted: boolean,
): number {
  const quantity = itemsCounted
    ? UNSELLABLE_RETURN_CONDITIONS.includes(String(item.condition || ""))
      ? 0
      : Number(item.quantityReceived || 0)
    : Number(item.quantityApproved ?? item.quantityRequested ?? 0);
  return Math.max(0, quantity);
}

/** One line's part of a restock: what goes back now, and what already has. */
export type ReturnRestockStep = ReturnRestockLine & {
  orderItemIndex: number;
  vendorId?: string;
  /** Units of the line already back on the shelf before this step. */
  restockedBefore: number;
};

/**
 * What putting a return back in stock would add now, line by line.
 *
 * A parcel can arrive in parts — two of three units this week, the third
 * next — so a return is restocked in steps, each adding only the sellable
 * units that arrived since the last (`items[].quantityRestocked`). A return
 * marked `inventoryRestored` was put back whole, the one-time way returns
 * were restocked before, or by an order-wide restock: nothing more goes back.
 */
export function returnRestockPlan(
  items: ReadonlyArray<RestockableReturnItem> | null | undefined,
  params: { itemsCounted: boolean; inventoryRestored?: boolean | null },
): ReturnRestockStep[] {
  if (params.inventoryRestored) return [];
  return (items || [])
    .map((item) => {
      const restockedBefore = Math.max(0, Number(item.quantityRestocked || 0));
      return {
        orderItemIndex: Number(item.orderItemIndex),
        productId: String(item.productId || ""),
        variantId: item.variantId ? String(item.variantId) : undefined,
        vendorId: item.vendorId ? String(item.vendorId) : undefined,
        restockedBefore,
        quantity: Math.max(
          0,
          returnSellableUnits(item, params.itemsCounted) - restockedBefore,
        ),
      };
    })
    .filter(
      (line) =>
        line.productId && line.quantity > 0 && Number.isInteger(line.orderItemIndex),
    );
}

/**
 * How far a return's goods are back on the shelf, for the screens: units put
 * back, units that could still go back, and whether all of it is done.
 */
export function returnRestockProgress(request: {
  items?: ReadonlyArray<RestockableReturnItem> | null;
  itemsCountedAt?: unknown;
  inventoryRestored?: boolean | null;
}): { restocked: number; remaining: number; done: boolean } {
  const restocked = (request.items || []).reduce(
    (sum, item) => sum + Math.max(0, Number(item.quantityRestocked || 0)),
    0,
  );
  const remaining = returnRestockPlan(request.items, {
    itemsCounted: Boolean(request.itemsCountedAt),
    inventoryRestored: request.inventoryRestored,
  }).reduce((sum, line) => sum + line.quantity, 0);
  return {
    restocked,
    remaining,
    done: Boolean(request.inventoryRestored) || (restocked > 0 && remaining === 0),
  };
}

/**
 * Whether any of a return's goods are back on the shelf — which is what stops
 * it being rejected or cancelled: its units would be released with the stock
 * still counted.
 */
export function returnHasRestocked(request: {
  items?: ReadonlyArray<RestockableReturnItem> | null;
  inventoryRestored?: boolean | null;
}): boolean {
  return (
    Boolean(request.inventoryRestored) ||
    (request.items || []).some((item) => Number(item.quantityRestocked || 0) > 0)
  );
}

/**
 * The ledger key of one restock step. A return restocked the one-time way
 * before steps existed recorded no step, and keeps the key it was posted
 * under.
 */
export function returnRestockEventKey(returnId: unknown, step?: string | null): string {
  return step ? `return-${String(returnId)}:${step}` : `return-${String(returnId)}`;
}

/** A write filter that holds only while none of a return's goods are restocked. */
export const NOTHING_RESTOCKED_ON_RETURN = {
  inventoryRestored: { $ne: true },
  items: { $not: { $elemMatch: { quantityRestocked: { $gt: 0 } } } },
};

/**
 * Why the store declined a return, kept for the store alone — the shopper is
 * told in the store's own words (`rejectionReason`). The same three Shopify
 * offers.
 */
export const RETURN_DECLINE_REASONS = [
  "final_sale",
  "return_window_ended",
  "other",
] as const;

export type ReturnDeclineReason = (typeof RETURN_DECLINE_REASONS)[number];

export const RETURN_DECLINE_REASON_LABELS: Record<ReturnDeclineReason, string> = {
  final_sale: "Final sale",
  return_window_ended: "Return window ended",
  other: "Other",
};

/** The message a declined shopper is sent unless the store writes its own. */
export const RETURN_DECLINE_MESSAGES: Record<ReturnDeclineReason, string> = {
  final_sale: "This item was sold as final sale, so it can't be returned.",
  return_window_ended: "The return window for this order has ended, so it can't be returned.",
  other: "",
};

export function isReturnDeclineReason(value: unknown): value is ReturnDeclineReason {
  return RETURN_DECLINE_REASONS.includes(String(value || "") as ReturnDeclineReason);
}

export const RETURN_REASONS = [
  "wrong_size_or_variant",
  "damaged_or_defective",
  "not_as_described",
  "wrong_item_received",
  "arrived_late",
  // The shopper's own choice, said plainly (R6). It used to be "Other" with a
  // note to write; it is still not the store's fault, so the policy's fees
  // apply and delivery stays with the store.
  "changed_mind",
  "other",
] as const;

