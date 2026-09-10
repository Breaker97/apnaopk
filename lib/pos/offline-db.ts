import type { POSCartItem, POSCategory, POSProduct } from "@/components/pos/pos-types";

/**
 * The register's local store: a catalogue snapshot to sell from, and an outbox
 * of sales taken while the connection was down.
 *
 * IndexedDB rather than `localStorage`, which held orders use
 * (`lib/pos/held-orders.ts`): a parked cart is a handful of lines, a catalogue
 * is thousands of products with variants and images, well past the ~5MB
 * localStorage ceiling — and every localStorage read is synchronous, so
 * deserializing a catalogue would block the thread the cashier is scanning
 * into.
 *
 * Everything here is scoped by POS location, for the same reason held orders
 * are: two counters in one browser profile must not sell from each other's
 * stock snapshot or drain each other's outbox.
 */

const DB_NAME = "storify-pos";
/**
 * Bumped when a store's shape changes.
 *
 * `onupgradeneeded` below only *creates* stores that are absent — it deletes
 * nothing — so raising this number preserves both stores as they stand. That
 * is the whole of the current guarantee, and it is deliberately stated rather
 * than implied, because the outbox holds sales that took real money and have
 * not reached the server yet.
 *
 * If a future change makes an `OfflineSale` unreadable by the new code, this
 * handler is where it has to be dealt with: read the old rows, convert them,
 * write them back. Dropping the store and recreating it would destroy takings.
 * The catalogue store has no such constraint — it is a cache and may be
 * discarded freely.
 */
const DB_VERSION = 1;

const CATALOG_STORE = "catalog";
const OUTBOX_STORE = "outbox";

/** A catalogue snapshot for one POS location. */
export interface OfflineCatalogSnapshot {
  /** `${locationId || "default"}` — the primary key. */
  scope: string;
  products: POSProduct[];
  categories: POSCategory[];
  /** ISO timestamp, shown to the cashier so stale stock is visibly stale. */
  savedAt: string;
}

/**
 * How a queued sale is progressing.
 *
 * `needs_review` is the important one: the sale reached the server and the
 * server refused it — almost always because the stock it needed was sold by
 * another terminal while this one was offline. The goods have already left the
 * shop and the money is already in the drawer, so the queue entry is kept and
 * raised to a human rather than retried forever or dropped.
 *
 * There is deliberately no "syncing": a drain is sequential and in-process, so
 * an in-flight marker would only ever be observed as a stale one — written by a
 * tab that was closed mid-replay, and then indistinguishable from a sale nobody
 * is working on.
 */
export type OfflineSaleStatus = "pending" | "needs_review";

export interface OfflineSale {
  /** The idempotency key. Also the primary key, so one sale can only queue once. */
  clientRequestId: string;
  scope: string;
  /** Exactly the body `POST /api/pos/orders` expects. */
  payload: Record<string, unknown>;
  /** Shown on the receipt handed over at the counter; see `localReceiptNumber`. */
  localReceiptNumber: string;
  /** Cart snapshot, so the queue can be reviewed without decoding the payload. */
  items: Pick<POSCartItem, "name" | "quantity" | "price">[];
  total: number;
  status: OfflineSaleStatus;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

/**
 * How many unsynced sales one counter may hold.
 *
 * Not a storage limit — a signal. A register that has queued this many has been
 * offline for most of a busy shift, and the failure that follows an unbounded
 * queue is the worst one available: IndexedDB hits its quota, `enqueueSale`
 * throws, and the till starts refusing sales with a customer at the counter.
 * Refusing at a known number instead means the merchant is told while there is
 * still time to do something about it.
 *
 * 500 is roughly a full day of a fast counter. Held orders cap at 50 for the
 * same reason (`lib/pos/held-orders.ts`), on a much smaller scale.
 */
export const MAX_QUEUED_SALES = 500;

/** Thrown when the queue is full, so the caller can say why rather than "failed". */
export class OutboxFullError extends Error {
  constructor() {
    super(
      "This register has too many unsynced sales. Reconnect to sync before taking more.",
    );
    this.name = "OutboxFullError";
  }
}

export function offlineScope(locationId?: string | null): string {
  return locationId || "default";
}

function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        db.createObjectStore(CATALOG_STORE, { keyPath: "scope" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, {
          keyPath: "clientRequestId",
        });
        // Draining is always "this counter's queue, oldest sale first".
        store.createIndex("scope_queuedAt", ["scope", "queuedAt"]);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab is holding an older version open. Failing here is better
    // than hanging forever on a promise that never settles.
    request.onblocked = () =>
      reject(new Error("POS offline storage is open in another tab"));
  }).catch((error) => {
    // Do not cache a failed open: a private-mode window that later gets
    // storage, or a transient quota error, should be able to try again.
    dbPromise = null;
    throw error;
  });

  return dbPromise;
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------- catalogue

export async function saveCatalogSnapshot(
  snapshot: OfflineCatalogSnapshot,
): Promise<void> {
  if (!isAvailable()) return;
  const db = await openDB();
  const tx = db.transaction(CATALOG_STORE, "readwrite");
  tx.objectStore(CATALOG_STORE).put(snapshot);
  await runTransaction(tx);
}

export async function readCatalogSnapshot(
  scope: string,
): Promise<OfflineCatalogSnapshot | null> {
  if (!isAvailable()) return null;
  const db = await openDB();
  const tx = db.transaction(CATALOG_STORE, "readonly");
  const result = await runRequest(
    tx.objectStore(CATALOG_STORE).get(scope) as IDBRequest<
      OfflineCatalogSnapshot | undefined
    >,
  );
  return result ?? null;
}

// ------------------------------------------------------------------- outbox

/**
 * Queue a sale.
 *
 * `add`, not `put`: the key is the sale's idempotency key, so a double-submit
 * must be refused here rather than queued twice and deduplicated later by the
 * server. A `ConstraintError` means this exact sale is already queued, which is
 * success from the caller's point of view.
 */
export async function enqueueSale(sale: OfflineSale): Promise<void> {
  if (!isAvailable()) {
    throw new Error("This browser cannot store offline sales");
  }

  // Counted per counter, and before the write: a shared browser profile with
  // two registers must not have one fill the other's allowance.
  const existing = await listQueuedSales(sale.scope);
  if (existing.length >= MAX_QUEUED_SALES) {
    throw new OutboxFullError();
  }

  const db = await openDB();
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  const request = tx.objectStore(OUTBOX_STORE).add(sale);
  try {
    await runRequest(request);
    await runTransaction(tx);
  } catch (error) {
    if ((error as DOMException)?.name === "ConstraintError") return;
    throw error;
  }
}

/**
 * This counter's queue, oldest sale first.
 *
 * Read through the `scope_queuedAt` index rather than `getAll()` plus a filter:
 * on a shared browser profile that would pull every counter's queue into memory
 * to return one of them, and the index already stores exactly this order. The
 * bound is the key range, so a second register's backlog costs nothing here.
 */
export async function listQueuedSales(scope: string): Promise<OfflineSale[]> {
  if (!isAvailable()) return [];
  const db = await openDB();
  const tx = db.transaction(OUTBOX_STORE, "readonly");
  const range = IDBKeyRange.bound([scope, ""], [scope, "\uffff"]);
  return runRequest(
    tx.objectStore(OUTBOX_STORE).index("scope_queuedAt").getAll(range) as
      IDBRequest<OfflineSale[]>,
  );
}

export async function updateQueuedSale(sale: OfflineSale): Promise<void> {
  if (!isAvailable()) return;
  const db = await openDB();
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  tx.objectStore(OUTBOX_STORE).put(sale);
  await runTransaction(tx);
}

/** Called only once the server has confirmed the order exists. */
export async function removeQueuedSale(
  clientRequestId: string,
): Promise<void> {
  if (!isAvailable()) return;
  const db = await openDB();
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  tx.objectStore(OUTBOX_STORE).delete(clientRequestId);
  await runTransaction(tx);
}
