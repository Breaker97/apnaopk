/**
 * The stock transfer workflow, as plain rules with no database behind them —
 * shared by the API routes and the admin screens so both agree on what a
 * transfer may do next and who may do it.
 *
 * Stock moves at two points, the way Shopify moves it:
 * - **Ship** (`ready_to_ship` → `in_transit`): the units leave the source
 *   location. They are in a truck, not on a shelf, so they must stop being
 *   sellable there — and the product's total stock drops with them.
 * - **Receive** (`in_transit`, possibly several times): each accepted unit lands
 *   at the destination. A rejected unit (damaged, short-shipped, lost) is
 *   recorded and never lands anywhere; it already left the source at ship time.
 *
 * A transfer is `completed` once every shipped unit is either accepted or
 * rejected. Cancelling an `in_transit` transfer returns its units to the source,
 * and is only allowed while nothing has been received yet.
 */

export const TRANSFER_STATUSES = [
  "draft",
  "ready_to_ship",
  "in_transit",
  "completed",
  "cancelled",
] as const;

export type TransferLifecycleStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_EVENT_TYPES = [
  "created",
  "updated",
  "ready_to_ship",
  "returned_to_draft",
  "shipped",
  "received",
  "completed",
  "cancelled",
  "stock_lock_released",
] as const;

export type TransferEventType = (typeof TRANSFER_EVENT_TYPES)[number];

/**
 * Status changes made through `set_status`. `completed` is deliberately absent:
 * a transfer completes by receiving its last unit, never by a bare status flip
 * that would say nothing about what actually arrived.
 */
const STATUS_TRANSITIONS: Record<
  TransferLifecycleStatus,
  TransferLifecycleStatus[]
> = {
  draft: ["ready_to_ship", "cancelled"],
  ready_to_ship: ["draft", "in_transit", "cancelled"],
  in_transit: ["cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * How long a stock movement may hold a transfer before it counts as stuck. A
 * real ship or receive finishes in seconds; one still holding the lock after
 * this died part-way (a server restart mid-move), and nothing will clear it.
 */
export const TRANSFER_LOCK_STALE_MS = 10 * 60 * 1000;

export function isTransferLockStale(
  startedAt: Date | string | null | undefined,
  now: number = Date.now(),
): boolean {
  // A lock with no start time predates the timestamp and is stuck by definition.
  if (!startedAt) return true;
  const started = new Date(startedAt).getTime();
  return !Number.isFinite(started) || now - started >= TRANSFER_LOCK_STALE_MS;
}

export function isTransferStatus(
  value: unknown,
): value is TransferLifecycleStatus {
  return (TRANSFER_STATUSES as readonly unknown[]).includes(value);
}

export function canTransitionTransferStatus(
  currentStatus: TransferLifecycleStatus,
  nextStatus: TransferLifecycleStatus,
) {
  return STATUS_TRANSITIONS[currentStatus]?.includes(nextStatus) ?? false;
}

export type TransferLineProgress = {
  quantity: number;
  receivedQuantity?: number;
  rejectedQuantity?: number;
};

/** Units of a line not yet accepted or rejected. */
export function remainingTransferQuantity(line: TransferLineProgress): number {
  return Math.max(
    0,
    (Number(line.quantity) || 0) -
      (Number(line.receivedQuantity) || 0) -
      (Number(line.rejectedQuantity) || 0),
  );
}

export function hasTransferReceipts(lines: TransferLineProgress[]): boolean {
  return lines.some(
    (line) =>
      (Number(line.receivedQuantity) || 0) > 0 ||
      (Number(line.rejectedQuantity) || 0) > 0,
  );
}

/**
 * What a caller may do with one transfer, given the locations they may act on.
 *
 * `allowedLocationIds === null` means unrestricted (a platform admin). A staff
 * member restricted to some locations acts as the end they hold: the sender
 * ships or cancels, the receiver receives, and editing a draft — which can
 * change either end — needs both.
 */
export function transferAccess(
  transfer: { fromLocationId: string; toLocationId: string },
  allowedLocationIds: ReadonlySet<string> | null,
) {
  const holds = (locationId: string) =>
    allowedLocationIds === null || allowedLocationIds.has(String(locationId));
  const atSource = holds(transfer.fromLocationId);
  const atDestination = holds(transfer.toLocationId);

  return {
    canView: atSource || atDestination,
    canSend: atSource,
    canReceive: atDestination,
    canEdit: atSource && atDestination,
  };
}

export type TransferAccess = ReturnType<typeof transferAccess>;

export type TransferReceiptInput = {
  productId: string;
  variantId: string;
  accepted: number;
  rejected: number;
};

export type TransferReceiptLine = {
  productId: string;
  variantId: string;
  quantity: number;
  receivedQuantity: number;
  rejectedQuantity: number;
};

export type TransferReceiptPlan = {
  /** Every line of the transfer with its progress after this receipt. */
  items: TransferReceiptLine[];
  /** Units to add at the destination, one entry per line with any accepted. */
  accepted: Array<{ productId: string; variantId: string; quantity: number }>;
  /** What this receipt recorded per line, for the history entry. */
  lines: TransferReceiptInput[];
  /** Whether this receipt accounts for the last outstanding unit. */
  completes: boolean;
};

export class TransferReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferReceiptError";
  }
}

/**
 * Apply one receipt to a transfer's lines, refusing anything that would
 * account for more units than were shipped. Input lines that name the same
 * variant are added together; lines with nothing accepted or rejected are
 * ignored.
 */
export function planTransferReceipt(
  items: TransferReceiptLine[],
  input: TransferReceiptInput[],
): TransferReceiptPlan {
  const byKey = new Map<string, { accepted: number; rejected: number }>();
  for (const row of input) {
    const accepted = Math.trunc(Number(row.accepted) || 0);
    const rejected = Math.trunc(Number(row.rejected) || 0);
    if (accepted < 0 || rejected < 0) {
      throw new TransferReceiptError("Quantities cannot be negative");
    }
    if (accepted === 0 && rejected === 0) continue;

    const key = `${row.productId}:${row.variantId}`;
    const current = byKey.get(key) || { accepted: 0, rejected: 0 };
    byKey.set(key, {
      accepted: current.accepted + accepted,
      rejected: current.rejected + rejected,
    });
  }

  if (byKey.size === 0) {
    throw new TransferReceiptError("Enter at least one unit to receive or reject");
  }

  const known = new Set(
    items.map((item) => `${item.productId}:${item.variantId}`),
  );
  for (const key of byKey.keys()) {
    if (!known.has(key)) {
      throw new TransferReceiptError("A received item is not on this transfer");
    }
  }

  const consumed = new Set<string>();
  const accepted: TransferReceiptPlan["accepted"] = [];
  const lines: TransferReceiptInput[] = [];

  const nextItems = items.map((item) => {
    const key = `${item.productId}:${item.variantId}`;
    const entry = byKey.get(key);
    // A variant listed twice on a transfer is filled line by line, so the
    // receipt lands on the first line with room and the rest spills over.
    if (!entry || consumed.has(key)) return { ...item };

    const room = remainingTransferQuantity(item);
    const take = Math.min(room, entry.accepted + entry.rejected);
    const takeAccepted = Math.min(entry.accepted, take);
    const takeRejected = take - takeAccepted;
    entry.accepted -= takeAccepted;
    entry.rejected -= takeRejected;
    if (entry.accepted === 0 && entry.rejected === 0) consumed.add(key);

    if (takeAccepted > 0) {
      accepted.push({
        productId: item.productId,
        variantId: item.variantId,
        quantity: takeAccepted,
      });
    }
    if (take > 0) {
      lines.push({
        productId: item.productId,
        variantId: item.variantId,
        accepted: takeAccepted,
        rejected: takeRejected,
      });
    }

    return {
      ...item,
      receivedQuantity: (Number(item.receivedQuantity) || 0) + takeAccepted,
      rejectedQuantity: (Number(item.rejectedQuantity) || 0) + takeRejected,
    };
  });

  for (const entry of byKey.values()) {
    if (entry.accepted > 0 || entry.rejected > 0) {
      throw new TransferReceiptError(
        "You cannot receive more units than are still outstanding",
      );
    }
  }

  return {
    items: nextItems,
    accepted,
    lines,
    completes: nextItems.every((item) => remainingTransferQuantity(item) === 0),
  };
}
