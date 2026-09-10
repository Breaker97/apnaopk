import "server-only";

import { after } from "next/server";

/**
 * Runs a best-effort side effect once the response has been sent, while keeping
 * it inside the invocation the platform is still willing to execute.
 *
 * A bare `void promise` is not safe on a serverless runtime: the instance can be
 * frozen as soon as the response is returned, so work that had not yet reached
 * the database is silently dropped with no retry and no log. That is how an
 * inbound-message notification — the point of an omnichannel inbox — could go
 * missing. `after()` is the supported way to keep the work alive.
 *
 * Falls back to fire-and-forget outside a request scope (scripts and tests), so
 * callers can be used from both.
 */
export function afterResponse(run: () => Promise<unknown>) {
  const guarded = async () => {
    try {
      await run();
    } catch (error) {
      console.error("Deferred task failed:", error);
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
