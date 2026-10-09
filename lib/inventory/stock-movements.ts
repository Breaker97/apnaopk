import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { ReturnRequest, Transfer } from "@/models";
import { AuditLog } from "@/models/audit-log.model";

/**
 * A product's stock movements, read from what the store already records.
 * Nothing here writes, and there is no movement collection of its own:
 *
 * - **adjustments**: the Activity Log's `inventory` rows `auditStockEdits`
 *   writes for every manual edit (./stock-edit-audit.ts), from the website's
 *   inventory screens and the business app alike: the figure before and
 *   after, who, why, where;
 * - **transfers** (./transfers.ts): the units leave the source when the
 *   transfer ships (`shippedAt`), arrive at the destination with each receipt
 *   (`received` events, the accepted units), and go back to the source when a
 *   transfer is cancelled on its way;
 * - **returns**: each restock step of a return (`restockedLines`,
 *   lib/returns/return-restock.ts and the business app's) and each held unit
 *   put back on sale (`unsellableDispositions`, lib/returns/held-units-actions.ts).
 *
 * Sales, cancelled orders and refunds move stock as well (./inventory.ts) and
 * leave no such record: an order says what it sold, not where and when its
 * units came off the shelf or went back. They are not listed. Neither is what
 * came before these records: an edit made before the Activity Log, a return
 * restocked in one piece (`inventoryRestored` with no `restockedLines`).
 *
 * Newest first, ties broken by `key`. The Activity Log, where most movements
 * are, is paged in the database; a product's transfers and returns, a handful
 * each, are read whole (up to `STOCK_MOVEMENT_SOURCE_CAP`) and merged in.
 */

/** The most transfers, and returns, one page reads for a product: its newest. */
export const STOCK_MOVEMENT_SOURCE_CAP = 500;

export type StockMovementKind =
  | "adjustment"
  | "transfer_shipped"
  | "transfer_received"
  | "transfer_cancelled"
  | "return_restocked";

/** Who moved the units, as the record has it. */
export interface StockMovementActorRecord {
  userId?: string;
  /** The name or email the record kept itself: a transfer's actor name, the Activity Log's email. */
  label?: string;
  /** The role the Activity Log recorded with the edit. */
  role?: string;
  /**
   * Whom the actor was acting for, when the record says: the Activity Log
   * stamps it (`actorVendorId`, empty for the store's own people). Other
   * records do not, and leave `vendorRecorded` false.
   */
  vendorId?: string;
  vendorRecorded: boolean;
}

export interface StockMovementRecord {
  /**
   * Unique and stable: the source (`a` Activity Log, `r` return, `t`
   * transfer), its document and the entry in it. Orders movements of the
   * same moment, and is the cursor's tiebreaker.
   */
  key: string;
  at: Date;
  kind: StockMovementKind;
  /** Signed: units in above 0, out below. */
  change: number;
  /** Adjustments only: the count after it, at its location or in all. */
  quantityAfter?: number;
  variantId?: string;
  /** The variant's name as the record kept it (a transfer's line). */
  variantName?: string;
  locationId?: string;
  /** The location's name as the record kept it. */
  locationName?: string;
  /** An adjustment that set the count instead of moving it by a number. */
  set?: boolean;
  reason?: string;
  note?: string;
  reference?: { kind: "transfer" | "return"; number: string };
  actor: StockMovementActorRecord;
}

export interface StockMovementQuery {
  productId: string;
  variantId?: string;
  locationId?: string;
  /**
   * A staff member's assigned locations: only movements at one of these, and
   * never one recorded without a location. Absent (or empty) for everyone else.
   */
  onlyLocations?: readonly string[];
  /** Strictly after this position in the list: the last movement of the page before. */
  before?: { at: Date; key: string };
  limit: number;
}

export interface StockMovementPage {
  movements: StockMovementRecord[];
  /** More movements follow the last one. */
  more: boolean;
}

/** Newest first; the same moment by key, descending. */
export function compareStockMovements(a: StockMovementRecord, b: StockMovementRecord): number {
  const byTime = b.at.getTime() - a.at.getTime();
  if (byTime !== 0) return byTime;
  return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
}

function comesAfter(movement: StockMovementRecord, before: StockMovementQuery["before"]): boolean {
  if (!before) return true;
  const time = movement.at.getTime();
  const cursor = before.at.getTime();
  return time < cursor || (time === cursor && movement.key < before.key);
}

/** The locations a query keeps, or null for any (and for none recorded). */
function wantedLocations(query: StockMovementQuery): string[] | null {
  if (query.locationId) return [query.locationId];
  return query.onlyLocations?.length ? [...query.onlyLocations] : null;
}

function keeps(movement: StockMovementRecord, query: StockMovementQuery): boolean {
  if (query.variantId && movement.variantId !== query.variantId) return false;
  const locations = wantedLocations(query);
  if (locations && !(movement.locationId && locations.includes(movement.locationId))) return false;
  return comesAfter(movement, query.before);
}

const pad = (index: number) => String(index).padStart(4, "0");
const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
const idOf = (value: unknown) => (value === undefined || value === null || value === "" ? undefined : String(value));
const units = (value: unknown) => {
  const count = Math.trunc(Number(value));
  return Number.isFinite(count) && count > 0 ? count : 0;
};

/** A user id when the record holds one; else what it holds is a label (an email from older code). */
function actorOf(by: unknown, label?: unknown): StockMovementActorRecord {
  const value = idOf(by);
  if (value && Types.ObjectId.isValid(value)) {
    return { userId: value, ...(text(label) ? { label: text(label) } : {}), vendorRecorded: false };
  }
  const named = text(label) ?? value;
  return { ...(named ? { label: named } : {}), vendorRecorded: false };
}

// ─── The Activity Log ────────────────────────────────────────────────────────

type AuditRow = {
  _id: unknown;
  createdAt: Date | string;
  userId?: unknown;
  userEmail?: string;
  userRole?: string;
  actorVendorId?: unknown;
  changes?: { before?: { quantity?: number }; after?: { quantity?: number } };
  metadata?: {
    variantId?: unknown;
    locationId?: unknown;
    locationName?: unknown;
    adjustment?: unknown;
    reason?: unknown;
    note?: unknown;
  };
};

/** Activity Log rows strictly after the cursor: every other source's key sorts after `a:`. */
function auditAfter(before: NonNullable<StockMovementQuery["before"]>): Record<string, unknown> {
  const id = before.key.startsWith("a:") ? before.key.slice(2) : null;
  if (id && Types.ObjectId.isValid(id)) {
    return {
      $or: [
        { createdAt: { $lt: before.at } },
        { createdAt: before.at, _id: { $lt: new Types.ObjectId(id) } },
      ],
    };
  }
  return { createdAt: { $lte: before.at } };
}

function adjustmentOf(row: AuditRow): StockMovementRecord {
  const from = Number(row.changes?.before?.quantity);
  const to = Number(row.changes?.after?.quantity);
  const meta = row.metadata ?? {};
  return {
    key: `a:${String(row._id)}`,
    at: new Date(row.createdAt),
    kind: "adjustment",
    change: Math.round(to - from),
    quantityAfter: Math.trunc(to),
    ...(idOf(meta.variantId) ? { variantId: idOf(meta.variantId) } : {}),
    ...(idOf(meta.locationId) ? { locationId: idOf(meta.locationId) } : {}),
    ...(text(meta.locationName) ? { locationName: text(meta.locationName) } : {}),
    ...(meta.adjustment === false ? { set: true } : {}),
    ...(text(meta.reason) ? { reason: text(meta.reason) } : {}),
    ...(text(meta.note) ? { note: text(meta.note) } : {}),
    actor: {
      ...(idOf(row.userId) ? { userId: idOf(row.userId) } : {}),
      ...(text(row.userEmail) ? { label: text(row.userEmail) } : {}),
      ...(text(row.userRole) ? { role: text(row.userRole) } : {}),
      ...(idOf(row.actorVendorId) ? { vendorId: idOf(row.actorVendorId) } : {}),
      vendorRecorded: true,
    },
  };
}

/**
 * The adjustments, a page and one more, in the database's order: the rows
 * `auditStockEdits` writes (a figure before and after; the Activity Log's
 * other `inventory` rows, which settle held return units, are read from the
 * returns instead).
 */
async function adjustments(query: StockMovementQuery): Promise<{ rows: StockMovementRecord[]; full: boolean }> {
  const and: Record<string, unknown>[] = [
    { resource: "inventory", resourceId: query.productId, action: "UPDATE", success: { $ne: false } },
    { "changes.before.quantity": { $type: "number" }, "changes.after.quantity": { $type: "number" } },
  ];
  if (query.variantId) and.push({ "metadata.variantId": query.variantId });
  const locations = wantedLocations(query);
  if (locations) and.push({ "metadata.locationId": { $in: locations } });
  if (query.before) and.push(auditAfter(query.before));

  const rows = await AuditLog.find({ $and: and })
    .select(
      "createdAt userId userEmail userRole actorVendorId changes.before changes.after metadata.variantId metadata.locationId metadata.locationName metadata.adjustment metadata.reason metadata.note",
    )
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean<AuditRow[]>();
  return { rows: rows.map(adjustmentOf), full: rows.length > query.limit };
}

// ─── Transfers ───────────────────────────────────────────────────────────────

type TransferItem = {
  productId?: unknown;
  variantId?: unknown;
  variantTitle?: string;
  quantity?: number;
};

type TransferEvent = {
  _id?: unknown;
  type?: string;
  at?: Date | string;
  actorId?: string;
  actorName?: string;
  lines?: Array<{ productId?: unknown; variantId?: unknown; accepted?: number }>;
};

type TransferRow = {
  _id: unknown;
  transferNumber?: string;
  fromLocationId?: string;
  fromLocationName?: string;
  toLocationId?: string;
  toLocationName?: string;
  status?: string;
  items?: TransferItem[];
  shippedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  events?: TransferEvent[];
};

/**
 * Who sent the units on their way: the person of the event nearest the
 * moment they left. That is the shipment, or, for a transfer shipped before
 * stock moved at shipping, its first receipt, which took them out then.
 */
function shipperOf(events: TransferEvent[], shippedAt: Date): StockMovementActorRecord {
  let nearest: TransferEvent | null = null;
  let distance = Infinity;
  for (const event of events) {
    if ((event.type !== "shipped" && event.type !== "received") || !event.at) continue;
    const gap = Math.abs(new Date(event.at).getTime() - shippedAt.getTime());
    if (gap < distance) {
      nearest = event;
      distance = gap;
    }
  }
  return nearest ? actorOf(nearest.actorId, nearest.actorName) : { vendorRecorded: false };
}

function movementsOfTransfer(transfer: TransferRow, query: StockMovementQuery): StockMovementRecord[] {
  if (!transfer.shippedAt) return [];
  const shippedAt = new Date(transfer.shippedAt);
  const id = String(transfer._id);
  const reference = { kind: "transfer" as const, number: String(transfer.transferNumber ?? "") };
  const ours = (productId: unknown, variantId: unknown) =>
    String(productId) === query.productId &&
    (!query.variantId || String(variantId ?? "") === query.variantId);
  const items = transfer.items ?? [];
  const variantOf = (variantId: unknown) => {
    const variant = idOf(variantId);
    if (!variant) return {};
    const item = items.find(
      (candidate) => String(candidate.productId) === query.productId && String(candidate.variantId ?? "") === variant,
    );
    return { variantId: variant, ...(text(item?.variantTitle) ? { variantName: text(item?.variantTitle) } : {}) };
  };
  const from = {
    ...(transfer.fromLocationId ? { locationId: String(transfer.fromLocationId) } : {}),
    ...(text(transfer.fromLocationName) ? { locationName: text(transfer.fromLocationName) } : {}),
  };
  const to = {
    ...(transfer.toLocationId ? { locationId: String(transfer.toLocationId) } : {}),
    ...(text(transfer.toLocationName) ? { locationName: text(transfer.toLocationName) } : {}),
  };
  const events = transfer.events ?? [];
  const movements: StockMovementRecord[] = [];

  const shipper = shipperOf(events, shippedAt);
  items.forEach((item, index) => {
    if (!ours(item.productId, item.variantId) || units(item.quantity) === 0) return;
    movements.push({
      key: `t:${id}:s:${pad(index)}`,
      at: shippedAt,
      kind: "transfer_shipped",
      change: -units(item.quantity),
      ...variantOf(item.variantId),
      ...from,
      reference,
      actor: shipper,
    });
  });

  events.forEach((event, eventIndex) => {
    if (event.type !== "received" || !event.at) return;
    (event.lines ?? []).forEach((line, lineIndex) => {
      if (!ours(line.productId, line.variantId) || units(line.accepted) === 0) return;
      movements.push({
        key: `t:${id}:r:${pad(eventIndex)}:${pad(lineIndex)}`,
        at: new Date(event.at!),
        kind: "transfer_received",
        change: units(line.accepted),
        ...variantOf(line.variantId),
        ...to,
        reference,
        actor: actorOf(event.actorId, event.actorName),
      });
    });
  });

  // Cancelled once shipped: on its way, before any receipt (cancelling is
  // refused after one), so every unit went back to the source.
  if (transfer.status === "cancelled") {
    const cancelled = [...events].reverse().find((event) => event.type === "cancelled");
    const at = cancelled?.at ?? transfer.cancelledAt;
    if (at) {
      items.forEach((item, index) => {
        if (!ours(item.productId, item.variantId) || units(item.quantity) === 0) return;
        movements.push({
          key: `t:${id}:c:${pad(index)}`,
          at: new Date(at),
          kind: "transfer_cancelled",
          change: units(item.quantity),
          ...variantOf(item.variantId),
          ...from,
          reference,
          actor: cancelled ? actorOf(cancelled.actorId, cancelled.actorName) : { vendorRecorded: false },
        });
      });
    }
  }
  return movements;
}

/** The product's transfers that moved stock: shipped (every movement is at or after `shippedAt`). */
async function transfers(query: StockMovementQuery, productId: Types.ObjectId): Promise<StockMovementRecord[]> {
  const where: Record<string, unknown> = {
    "items.productId": productId,
    shippedAt: query.before ? { $lte: query.before.at } : { $ne: null },
  };
  const locations = wantedLocations(query);
  if (locations) {
    where.$or = [{ fromLocationId: { $in: locations } }, { toLocationId: { $in: locations } }];
  }
  const rows = await Transfer.find(where)
    .select(
      "transferNumber fromLocationId fromLocationName toLocationId toLocationName status items shippedAt cancelledAt events",
    )
    .sort({ shippedAt: -1, _id: -1 })
    .limit(STOCK_MOVEMENT_SOURCE_CAP)
    .lean<TransferRow[]>();
  return rows.flatMap((row) => movementsOfTransfer(row, query));
}

// ─── Returns ─────────────────────────────────────────────────────────────────

type ReturnLine = {
  productId?: unknown;
  variantId?: unknown;
  quantity?: number;
  locationId?: unknown;
  at?: Date | string | null;
  by?: unknown;
};

type ReturnRow = {
  _id: unknown;
  returnNumber?: string;
  restockedLines?: ReturnLine[];
  unsellableDispositions?: Array<ReturnLine & { action?: string }>;
};

function movementsOfReturn(row: ReturnRow, query: StockMovementQuery): StockMovementRecord[] {
  const id = String(row._id);
  const reference = { kind: "return" as const, number: String(row.returnNumber ?? "") };
  const movementOf = (line: ReturnLine, key: string): StockMovementRecord[] => {
    if (String(line.productId) !== query.productId || !line.at || units(line.quantity) === 0) return [];
    return [
      {
        key,
        at: new Date(line.at),
        kind: "return_restocked",
        change: units(line.quantity),
        ...(idOf(line.variantId) ? { variantId: idOf(line.variantId) } : {}),
        ...(idOf(line.locationId) ? { locationId: idOf(line.locationId) } : {}),
        reference,
        actor: actorOf(line.by),
      },
    ];
  };
  return [
    ...(row.restockedLines ?? []).flatMap((line, index) => movementOf(line, `r:${id}:l:${pad(index)}`)),
    ...(row.unsellableDispositions ?? []).flatMap((line, index) =>
      line.action === "restocked" ? movementOf(line, `r:${id}:d:${pad(index)}`) : [],
    ),
  ];
}

/** The product's returns with units put back on sale, by step. */
async function returns(query: StockMovementQuery, productId: Types.ObjectId): Promise<StockMovementRecord[]> {
  const at = query.before ? { $lte: query.before.at } : { $ne: null };
  const rows = await ReturnRequest.find({
    $or: [
      { restockedLines: { $elemMatch: { productId, at } } },
      { unsellableDispositions: { $elemMatch: { productId, action: "restocked", at } } },
    ],
  })
    .select("returnNumber restockedLines unsellableDispositions")
    .sort({ updatedAt: -1, _id: -1 })
    .limit(STOCK_MOVEMENT_SOURCE_CAP)
    .lean<ReturnRow[]>();
  return rows.flatMap((row) => movementsOfReturn(row, query));
}

// ─── The list ────────────────────────────────────────────────────────────────

/**
 * A page of a product's movements. The caller has already checked the
 * product is in the operator's reach, and that a location asked for is one of
 * theirs.
 */
export async function readStockMovements(query: StockMovementQuery): Promise<StockMovementPage> {
  await connectDB();
  const productId = Types.ObjectId.isValid(query.productId) ? new Types.ObjectId(query.productId) : null;
  const [logged, moved, returned] = await Promise.all([
    adjustments(query),
    productId ? transfers(query, productId) : Promise.resolve([]),
    productId ? returns(query, productId) : Promise.resolve([]),
  ]);

  const merged = [...logged.rows, ...moved, ...returned]
    .filter((movement) => keeps(movement, query))
    .sort(compareStockMovements);
  const movements = merged.slice(0, query.limit);
  return {
    movements,
    // A full page of the Activity Log has more behind it, whatever the merge kept.
    more: merged.length > query.limit || logged.full,
  };
}
