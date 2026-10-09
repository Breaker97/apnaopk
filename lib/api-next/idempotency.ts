import type { IdempotencyPort, StoredResponse } from "@/lib/api-core/ports";
import { MobileApiError } from "@/lib/api-core/errors";
import { connectDB } from "@/lib/db";
import {
  IDEMPOTENCY_STATUS,
  IdempotencyRecord,
} from "@/models/idempotency-record.model";

/**
 * The idempotency store of the mobile API (lib/api-core/ports.ts), in
 * MongoDB (models/idempotency-record.model.ts).
 *
 * Why: placing a cash-on-delivery order writes the order and empties the cart
 * in one request. When its answer is lost on the way back, the app's retry
 * found an empty cart and showed an error for an order that exists. With a
 * key, the retry gets the first answer.
 *
 * The rules, per `(scope, key)`:
 * - The first request inserts the record `in_progress` and runs. The unique
 *   index is what makes a second, concurrent request lose that insert.
 * - The same key with another endpoint or another body is refused, 422
 *   IDEMPOTENCY_KEY_REUSED, whatever state the first is in.
 * - While the first still runs, a repeat is refused, 409 REQUEST_IN_PROGRESS
 *   (with Retry-After): the app waits and asks again.
 * - Once it answered, a repeat gets that answer, byte for byte.
 * - A request that failed frees its key: a refusal wrote no order, so the
 *   same key may be sent again (with the form corrected, say). One that
 *   failed after writing its order left that order, stamped with the key, and
 *   the endpoint answers the retry with it (POST /checkout/orders,
 *   `Order.idempotencyKey`; the card intent hands Stripe the key) — the store
 *   alone does not prevent a second order.
 * - A request still `in_progress` after `STALE_AFTER_MS` died with its
 *   process; the next repeat takes the key over and runs.
 */

/**
 * Longer than any request may run on any host this ships to (Vercel's longest
 * function limit is five minutes), so a request still running is never taken
 * over — only one that died.
 */
const STALE_AFTER_MS = 10 * 60_000;

const IN_PROGRESS_RETRY_SECONDS = 2;

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

function keyReused(): MobileApiError {
  return new MobileApiError(
    422,
    "IDEMPOTENCY_KEY_REUSED",
    "This Idempotency-Key was already used for a different request. Send a new key.",
  );
}

function inProgress(): MobileApiError {
  return new MobileApiError(
    409,
    "REQUEST_IN_PROGRESS",
    "This request is still being processed. Try again in a moment.",
    { headers: { "Retry-After": String(IN_PROGRESS_RETRY_SECONDS) } },
  );
}

type Claim =
  | { kind: "run"; id: unknown; lockedAt: Date }
  | { kind: "replay"; response: StoredResponse };

async function claim(request: {
  scope: string;
  key: string;
  routeId: string;
  requestHash: string;
}): Promise<Claim> {
  // Twice at most: the record can expire between a refused insert and the
  // read of what refused it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const lockedAt = new Date();
    try {
      const created = await IdempotencyRecord.create({
        ...request,
        status: IDEMPOTENCY_STATUS.IN_PROGRESS,
        lockedAt,
      });
      return { kind: "run", id: created._id, lockedAt };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }

    const existing = await IdempotencyRecord.findOne({
      scope: request.scope,
      key: request.key,
    }).lean();
    if (!existing) continue;
    if (existing.routeId !== request.routeId || existing.requestHash !== request.requestHash) {
      throw keyReused();
    }
    if (existing.status === IDEMPOTENCY_STATUS.DONE) {
      return {
        kind: "replay",
        response: {
          status: existing.responseStatus ?? 200,
          body: existing.responseBody ?? "",
          headers: existing.responseHeaders ?? {},
        },
      };
    }
    if (Date.now() - new Date(existing.lockedAt).getTime() < STALE_AFTER_MS) {
      throw inProgress();
    }
    // Its request died: take the key over, unless another repeat just did.
    const takenAt = new Date();
    const taken = await IdempotencyRecord.findOneAndUpdate(
      {
        _id: existing._id,
        status: IDEMPOTENCY_STATUS.IN_PROGRESS,
        lockedAt: existing.lockedAt,
      },
      { $set: { lockedAt: takenAt } },
      { projection: { _id: 1 } },
    ).lean();
    if (!taken) throw inProgress();
    return { kind: "run", id: existing._id, lockedAt: takenAt };
  }
  throw inProgress();
}

export const mongoIdempotencyStore: IdempotencyPort = {
  async run(request, execute) {
    await connectDB();
    const claimed = await claim(request);
    if (claimed.kind === "replay") return claimed.response;

    // Only this request's own claim is touched below: one taken over after it
    // was given up for dead is no longer this request's to settle.
    const mine = { _id: claimed.id, lockedAt: claimed.lockedAt };

    let response: StoredResponse;
    try {
      response = await execute();
    } catch (error) {
      await IdempotencyRecord.deleteOne({
        ...mine,
        status: IDEMPOTENCY_STATUS.IN_PROGRESS,
      }).catch((cleanupError) =>
        console.error("[mobile-api] Failed to release an idempotency key:", cleanupError),
      );
      throw error;
    }

    // The work is done; failing to remember its answer must not turn it into
    // an error. A retry then waits out the stale window and runs again, and
    // the endpoint answers it with what the first run made instead of doing
    // the work twice: the order stamped with the key (POST /checkout/orders),
    // the PaymentIntent Stripe keeps under it (POST /checkout/stripe/intent).
    await IdempotencyRecord.updateOne(mine, {
      $set: {
        status: IDEMPOTENCY_STATUS.DONE,
        responseStatus: response.status,
        responseBody: response.body,
        responseHeaders: response.headers,
      },
    }).catch((saveError) =>
      console.error("[mobile-api] Failed to keep an idempotent answer:", saveError),
    );
    return response;
  },
};
