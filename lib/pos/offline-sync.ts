import {
  listQueuedSales,
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
 * it.
 */

type SyncOutcome =
  /** The order exists on the server. Safe to forget locally. */
  | { kind: "committed"; orderNumber?: string }
  /** Transient: offline again, server error, rate limited. Try later. */
  | { kind: "retry"; reason: string }
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

  if (status === 401 || status === 403) {
    return { kind: "unauthenticated" };
  }

  // 429 and 5xx are the server asking for time, not refusing the sale.
  if (status === 429 || status >= 500) {
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
    };
  }
}

/**
 * Replay every queued sale for this counter, oldest first.
 *
 * Sequential on purpose. These are inventory-decrementing writes against the
 * same small set of products, and firing a shift's backlog at the server at
 * once turns "we are two units short" into a pile of partial failures that are
 * far harder to reconcile than one refusal at a time.
 */
export async function syncOutbox(scope: string): Promise<SyncSummary> {
  const queued = await listQueuedSales(scope);
  const summary: SyncSummary = { committed: 0, pending: 0, needsReview: 0 };

  for (const sale of queued) {
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
      // and let the cashier sign in again.
      //
      // Counted from what is left rather than from the whole queue: sales
      // already tallied this pass (`summary.pending`, from an earlier retry)
      // would otherwise be counted twice and the banner would report more
      // outstanding sales than exist.
      const remaining =
        queued.length - summary.committed - summary.needsReview - summary.pending;
      summary.pending += Math.max(0, remaining);
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
  }

  return summary;
}
