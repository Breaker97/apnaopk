import {
  listAllQueuedSales,
  readQueuedSale,
  removeQueuedSale,
  updateQueuedSale,
  type OfflineSale,
} from "@/lib/pos/offline-db";

/**
 * Draining the offline outbox.
 *
 * Replay is safe because every sale already carries `clientRequestId`, which
 * `POST /api/pos/orders` treats as an idempotency key (there is a unique
 * partial index behind it on `Order.posClientRequestId`). Re-sending a sale the
 * server already committed returns that same order rather than ringing up a
 * second one, so the only real question is what to do when the server says no.
 *
 * That question has a hard constraint: by the time a queued sale is replayed
 * the goods have left the shop and the money is in the drawer. Nothing here may
 * silently drop a sale, and nothing may retry forever a sale the server will
 * never accept. So refusals are split in two — retry what is transient, raise
 * what is not — and a raised sale stays in the queue until a human deals with
 * it (`components/pos/pos-offline-review-dialog.tsx`).
 */

type SyncOutcome =
  /** The order exists on the server. Safe to forget locally. */
  | { kind: "committed"; orderNumber?: string }
  /**
   * Transient: offline again, server error, rate limited. Try later.
   *
   * `halt` means the next sale would meet the same answer — the network is
   * gone, or the server asked for time — so the drain stops rather than
   * spending every remaining sale's attempt on it. A 5xx does not halt: it can
   * be one sale's problem (a product whose document the server cannot load),
   * and stopping there would let one sale hold up the rest, which is exactly
   * what a 403 used to do.
   */
  | { kind: "retry"; reason: string; halt?: "offline" | "throttled" }
  /** The session is no longer valid. Stop draining; retrying cannot help. */
  | { kind: "unauthenticated" }
  /** The server refused on the merits. A human has to decide. */
  | { kind: "needs_review"; reason: string };

/**
 * What a replay response means, as a pure decision.
 *
 * Split out from the IO so the interesting cases — the ones that decide whether
 * a real sale is kept, retried, or escalated — can be tested without a network
 * or a database.
 */
export function classifySyncResponse(
  status: number,
  body: { success?: boolean; message?: string; data?: { orderNumber?: string } } | null,
): SyncOutcome {
  if (status >= 200 && status < 300 && body?.success) {
    return { kind: "committed", orderNumber: body.data?.orderNumber };
  }

  // Only a 401 is the session. A 403 is a verdict on THIS sale — the product
  // was deleted or moved to another seller while the register was offline,
  // the seat lost its POS permission, the POS was switched off — and it used
  // to be read as "signed out", which stopped the drain at that sale and left
  // every sale queued behind it unsent, for good, with nothing flagged. The
  // drain only ever runs after an authenticated request succeeded, so a 403
  // here cannot be a dead session; it falls through to review with the 4xx.
  if (status === 401) {
    return { kind: "unauthenticated" };
  }

  // 429 and 5xx are the server asking for time, not refusing the sale.
  if (status === 429) {
    return {
      kind: "retry",
      reason: body?.message || `Server returned ${status}`,
      halt: "throttled",
    };
  }
  if (status >= 500) {
    return { kind: "retry", reason: body?.message || `Server returned ${status}` };
  }

  if (status >= 400) {
    // The common one: another terminal sold the last unit while this register
    // was offline. Insufficient stock cannot be resolved by retrying — the
    // sale already happened in the real world and the books have to catch up.
    return {
      kind: "needs_review",
      reason: body?.message || `Server rejected the sale (${status})`,
    };
  }

  return { kind: "retry", reason: `Unexpected response (${status})` };
}

export interface SyncSummary {
  committed: number;
  pending: number;
  needsReview: number;
  /** Set when the drain stopped early because the session expired. */
  stoppedUnauthenticated?: boolean;
  /**
   * Set when the drain stopped early because the network went away, or the
   * server asked for time. The rest of the queue is untouched and pending.
   */
  halted?: "offline" | "throttled";
}

async function replaySale(sale: OfflineSale): Promise<SyncOutcome> {
  try {
    const response = await fetch("/api/pos/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sale.payload),
    });
    const body = await response.json().catch(() => null);
    return classifySyncResponse(response.status, body);
  } catch (error) {
    // A thrown fetch is the network, not a verdict on the sale.
    return {
      kind: "retry",
      reason: error instanceof Error ? error.message : "Network unavailable",
      halt: "offline",
    };
  }
}

/**
 * Replay every queued sale, from every counter, oldest first.
 *
 * Every counter, not the one the register stands at: the sale names its own
 * counter in `posLocationId` and the server re-resolves it, so nothing about
 * the replay depends on where the register is now — and a counter that was
 * deactivated during the outage must not keep its takings parked forever.
 *
 * Sequential on purpose. These are inventory-decrementing writes against the
 * same small set of products, and firing a shift's backlog at the server at
 * once turns "we are two units short" into a pile of partial failures that are
 * far harder to reconcile than one refusal at a time.
 */
export async function syncOutbox(): Promise<SyncSummary> {
  const queued = await listAllQueuedSales();
  const summary: SyncSummary = { committed: 0, pending: 0, needsReview: 0 };

  /** Tallies the sales after `index` as they stand, when the drain stops. */
  const countUnsent = (index: number) => {
    for (const later of queued.slice(index + 1)) {
      if (later.status === "needs_review") summary.needsReview += 1;
      else summary.pending += 1;
    }
  };

  for (const [index, sale] of queued.entries()) {
    if (sale.status === "needs_review") {
      summary.needsReview += 1;
      continue;
    }

    const outcome = await replaySale(sale);

    if (outcome.kind === "committed") {
      await removeQueuedSale(sale.clientRequestId);
      summary.committed += 1;
      continue;
    }

    if (outcome.kind === "unauthenticated") {
      // Everything after this would fail the same way. Leave the queue intact
      // and let the cashier sign in again. This sale and every later one are
      // tallied as they stand — a later sale already under review stays one.
      summary.pending += 1;
      countUnsent(index);
      summary.stoppedUnauthenticated = true;
      return summary;
    }

    if (outcome.kind === "needs_review") {
      await updateQueuedSale({
        ...sale,
        status: "needs_review",
        attempts: sale.attempts + 1,
        lastError: outcome.reason,
      });
      summary.needsReview += 1;
      continue;
    }

    await updateQueuedSale({
      ...sale,
      status: "pending",
      attempts: sale.attempts + 1,
      lastError: outcome.reason,
    });
    summary.pending += 1;

    if (outcome.halt) {
      // The sales after this one are left exactly as they were — not even an
      // attempt is counted against them, because none was made.
      countUnsent(index);
      summary.halted = outcome.halt;
      return summary;
    }
  }

  return summary;
}

/**
 * Put a reviewed sale back in line to be sent.
 *
 * For the case where the cause has been fixed — the customer re-created, the
 * product restored, the seat's permission given back — rather than recorded by
 * hand. The attempt count and the last refusal are kept, so a sale that is
 * refused again shows its history.
 */
export async function requeueSale(clientRequestId: string): Promise<boolean> {
  const sale = await readQueuedSale(clientRequestId);
  if (!sale) return false;
  await updateQueuedSale({ ...sale, status: "pending" });
  return true;
}
