/**
 * An AbortController for effect-scoped requests that only aborts what is
 * actually still in flight.
 *
 * Cleanup used to call `controller.abort()` unconditionally, which runs the
 * signal's abort algorithms even when the response landed long ago. That does
 * nothing useful — our own promise chain has already settled — but it does
 * construct an `AbortError` and reject anything still branched off that fetch.
 * A wrapper around `window.fetch` that branches the promise without attaching a
 * rejection handler (browser extensions commonly do) then surfaces it as an
 * unhandled rejection, attributed to our `abort()` call site because that is
 * where the DOMException was created.
 *
 * Effects here re-run on more than the thing they fetch — the inbox's message
 * effect depends on a `useCallback` identity, not only the conversation id — so
 * "cleanup after the request already finished" is the common case, not the rare
 * one. Skipping those aborts removes the noise without giving up cancellation
 * for a request that genuinely is still open.
 *
 * The abort reason is explicit so anything that does observe it says what
 * happened, instead of the anonymous "signal is aborted without reason".
 */
export function createRequestAbort(label: string) {
  const controller = new AbortController();
  let settled = false;

  return {
    signal: controller.signal,
    /** Call once the request has resolved, failed, or been discarded. */
    settle() {
      settled = true;
    },
    /** Effect cleanup: cancels only a request that is still open. */
    cancel() {
      if (settled) return;
      settled = true;
      controller.abort(
        new DOMException(`${label} was superseded`, "AbortError"),
      );
    },
  };
}

