/**
 * Server-side reads of a stored file by its URL: the 3D model preview proxy,
 * and the AI studio's source images and download button.
 *
 * Each caller first checks that the URL is the store's own storage (or the
 * demo catalogue's). Following a redirect would undo that check — an allowed
 * host answering 3xx could send the server to any address it can reach,
 * loopback and the cloud metadata service included — so none is followed.
 * Storage must also start answering within a deadline, and a body read into
 * memory stops at a size cap.
 */

type StoredFileFetchFailure = "redirect" | "timeout" | "too_large";

const FAILURE_MESSAGES: Record<StoredFileFetchFailure, string> = {
  redirect: "The stored file's URL redirects elsewhere",
  timeout: "Storage did not answer in time",
  too_large: "The stored file is too large",
};

export class StoredFileFetchError extends Error {
  constructor(readonly failure: StoredFileFetchFailure) {
    super(FAILURE_MESSAGES[failure]);
    this.name = "StoredFileFetchError";
  }
}

/** How long storage has to start answering. */
const RESPONSE_START_DEADLINE_MS = 15_000;

/**
 * Fetches a stored file without following a redirect. Only the start of the
 * response is timed, so a large file relayed to a slow client is not cut off;
 * pass `signal` to bound the whole read.
 */
export async function fetchStoredFile(
  url: URL | string,
  init: {
    method?: "GET" | "HEAD";
    headers?: HeadersInit;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const responseStarted = new AbortController();
  const timer = setTimeout(
    () => responseStarted.abort(),
    RESPONSE_START_DEADLINE_MS,
  );
  const signal = init.signal
    ? AbortSignal.any([responseStarted.signal, init.signal])
    : responseStarted.signal;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: init.headers,
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw new StoredFileFetchError("timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new StoredFileFetchError("redirect");
  }
  return response;
}

/**
 * Reads a body into memory, refusing one larger than `maxBytes`: by its
 * declared length when it has one, and by counting as it streams. Takes a
 * request as readily as a response.
 */
export async function readCappedBody(
  response: Pick<Response, "headers" | "body">,
  maxBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new StoredFileFetchError("too_large");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new StoredFileFetchError("too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}
