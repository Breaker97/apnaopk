/**
 * Pure shape of one inbox live-feed tick.
 *
 * `GET /api/chat/conversations/live` answers a poll from
 * `hooks/use-live-resource.ts`. Everything here is the part of that route that
 * needs no database and no request: the tick's bounds, and the arithmetic that
 * advances the delivery-status watermark. It lives outside the route so the
 * arithmetic — the part with an actual invariant to keep — can be tested
 * without standing up Mongo.
 */

/**
 * How far back a client with no `statusSince` replays delivery-status changes.
 * Wide enough to cover the gap left by a reload or a tab that was hidden for a
 * moment, narrow enough that a fresh client does not replay hundreds of rows.
 */
export const STATUS_REPLAY_MS = 30_000;

/**
 * Overlap re-scanned on each tick, on top of the newest `updatedAt` already
 * seen. It absorbs the skew between this process's clock and Mongo's, and a
 * write that lands with a timestamp fractionally behind one already observed.
 *
 * The SSE stream this replaced suppressed the rows this re-reads with a
 * server-side map of message → state. Statelessly there is no such map, so a
 * quiet inbox re-reads the same handful of rows every tick — and that is
 * precisely why it costs nothing: an identical tick has an identical version,
 * so the client is answered 304 and never sees the repetition. The margin is
 * paid for in documents read, not in bytes sent or renders performed.
 */
export const STATUS_WATERMARK_OVERLAP_MS = 5_000;

/** Delivery-status rows read per tick. */
export const STATUS_POLL_LIMIT = 500;

/** Messages created per tick. A burst beyond this is picked up by the next one. */
export const CREATED_POLL_LIMIT = 100;

/** Conversations in the snapshot page. Matches the inbox's own first page. */
export const CONVERSATION_LIMIT = 100;

/**
 * Where the next tick should resume reading delivery-status changes.
 *
 * Three properties, each of which a naive `max(...updatedAt)` gets wrong:
 *
 * - **Nothing is stranded.** A saturated page means rows at or below the oldest
 *   one returned were cut off by the limit, so the floor stops there rather
 *   than jumping to the newest and skipping them.
 * - **The floor never walks backwards.** `Math.max` against the incoming
 *   watermark is what stops the overlap from being subtracted afresh every
 *   tick — without it a quiet inbox would creep 5s back per tick until it was
 *   re-reading the whole replay window.
 * - **It settles.** On a quiet inbox the same rows come back every tick, so the
 *   result equals its input from the second tick on, which is what lets the
 *   version match and the request be answered 304.
 */
export function nextStatusWatermark(params: {
  /** The watermark this tick started from. */
  statusSince: number;
  /** `updatedAt` of the rows this tick read, newest first. */
  updatedAts: number[];
  /** Rows read this tick, capped at `STATUS_POLL_LIMIT`. */
  limit?: number;
}): number {
  const { statusSince, updatedAts } = params;
  const limit = params.limit ?? STATUS_POLL_LIMIT;
  if (updatedAts.length === 0) return statusSince;

  const newest = updatedAts.reduce(
    (max, value) => Math.max(max, value),
    statusSince,
  );
  const oldestConsumed = updatedAts[updatedAts.length - 1];
  const saturated = updatedAts.length >= limit && oldestConsumed !== undefined;
  const floor = saturated ? oldestConsumed : newest;

  return Math.max(statusSince, floor - STATUS_WATERMARK_OVERLAP_MS);
}
