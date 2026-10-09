import { ServiceUnavailableError } from "@/lib/api/errors";

/**
 * The one way this app talks to Meta's Graph API: the pinned version, the
 * request with Meta's structured error kept, and nothing else. Messaging
 * (lib/conversations/providers/meta-client.ts) and the catalog sync
 * (lib/meta-catalog/catalog-api.ts) both go through it, so a version, a
 * timeout or an error shape is decided once.
 *
 * What an error *means* is the caller's: a code that tells the messaging
 * outbox to dead-letter one message tells the catalog sync to stop for every
 * product (lib/meta-catalog/catalog-errors.ts).
 */

const GRAPH_ORIGIN = "https://graph.facebook.com";

export function graphVersion() {
  const version = process.env.META_GRAPH_API_VERSION?.trim();
  if (!version || !/^v\d+\.\d+$/.test(version)) {
    throw new ServiceUnavailableError(
      "META_GRAPH_API_VERSION is not configured",
      undefined,
      "META_GRAPH_VERSION_NOT_CONFIGURED",
    );
  }
  return version;
}

/**
 * Where Graph requests go. `META_GRAPH_BASE_URL` points them at a local
 * stand-in for checks on a development machine; it is ignored in a
 * production build, so no environment can quietly send a store's tokens to
 * another host.
 */
export function graphOrigin(): string {
  const override = process.env.META_GRAPH_BASE_URL?.trim();
  if (!override || process.env.NODE_ENV === "production") return GRAPH_ORIGIN;
  try {
    const url = new URL(override);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : GRAPH_ORIGIN;
  } catch {
    return GRAPH_ORIGIN;
  }
}

/** `https://graph.facebook.com/<version>/<path>`. */
export function graphUrl(path: string): string {
  return `${graphOrigin()}/${graphVersion()}/${path.replace(/^\/+/, "")}`;
}

/**
 * A test run never reaches the real Graph API: the request has to go to a
 * stubbed `fetch` (vi.fn / vi.spyOn) or to a local stand-in. Without this a
 * test that forgot its stub would call Meta with whatever token it built.
 */
function refuseRealGraphInTests(url: string) {
  if (!process.env.VITEST) return;
  if (!url.startsWith(`${GRAPH_ORIGIN}/`)) return;
  const current = globalThis.fetch as unknown as { mock?: unknown };
  if (current && typeof current.mock === "object") return;
  throw new Error("A test tried to call graph.facebook.com without stubbing fetch");
}

/** Meta codes that mean the stored token is dead — retrying cannot help. */
const META_AUTH_ERROR_CODES = new Set([102, 190, 463, 467]);

/** Meta codes that mean "slow down", not "this will never work". */
const META_THROTTLE_ERROR_CODES = new Set([4, 17, 32, 613, 80007, 131056]);

/**
 * Meta codes that are terminal for THIS message: the payload, recipient or
 * template is unacceptable, so the outbox should dead-letter it immediately
 * instead of burning eight retries on a guaranteed rejection.
 */
const META_PERMANENT_ERROR_CODES = new Set([
  10, // permission denied
  100, // invalid parameter
  131026, // message undeliverable
  131047, // re-engagement required (24h window closed)
  131051, // unsupported message type
  131052, // media download error
  131053, // media upload error
  132000, // template param count mismatch
  132001, // template does not exist
  132005, // template hydrated text too long
  132007, // template format character policy violated
  132012, // template parameter format mismatch
  132015, // template is paused
  132016, // template is disabled
  368, // temporarily blocked for policy violations
]);

/**
 * A Graph API failure with Meta's structured error preserved.
 *
 * The previous `new Error(payload.error.message)` destroyed `code` /
 * `error_subcode` at the transport boundary, which left every caller unable to
 * tell a revoked token from a rate limit from a malformed template — so all
 * three were retried identically.
 *
 * The getters below are the messaging outbox's reading of a failure; the
 * catalog sync reads `code`/`subcode`/`status` through its own classifier.
 */
export class MetaGraphError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    status: number;
    code?: number;
    subcode?: number;
    type?: string;
    fbtraceId?: string;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "MetaGraphError";
    this.status = params.status;
    this.code = params.code;
    this.subcode = params.subcode;
    this.type = params.type;
    this.fbtraceId = params.fbtraceId;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }

  /** The connection's token is invalid or revoked; the connection is dead. */
  get isAuthFailure() {
    return (
      (this.code !== undefined && META_AUTH_ERROR_CODES.has(this.code)) ||
      (this.subcode !== undefined && META_AUTH_ERROR_CODES.has(this.subcode)) ||
      this.status === 401
    );
  }

  /** Rate limited: retry later, with a longer delay. */
  get isThrottled() {
    return (
      this.status === 429 ||
      (this.code !== undefined && META_THROTTLE_ERROR_CODES.has(this.code))
    );
  }

  /** Retrying this exact request will never succeed. */
  get isPermanent() {
    if (this.isThrottled) return false;
    if (this.isAuthFailure) return true;
    if (this.code !== undefined && META_PERMANENT_ERROR_CODES.has(this.code)) {
      return true;
    }
    // Meta's permission errors occupy 200-299. Everything else 4xx that we do
    // not recognise stays retryable, so an unknown code degrades safely.
    if (this.code !== undefined && this.code >= 200 && this.code <= 299) {
      return true;
    }
    return false;
  }
}

function positiveInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * One Graph call. `body` goes as JSON; `form` as multipart form fields, the
 * shape Meta's own examples send the catalog batch in (`-F requests=[…]`).
 */
export async function graphRequest<T>(params: {
  path: string;
  token: string;
  method?: "GET" | "POST" | "DELETE";
  body?: Record<string, unknown>;
  form?: Record<string, string>;
  /** Milliseconds before the call is abandoned; 15 s by default. */
  timeoutMs?: number;
}) {
  const url = graphUrl(params.path);
  refuseRealGraphInTests(url);

  let body: BodyInit | undefined;
  const headers: Record<string, string> = { Authorization: `Bearer ${params.token}` };
  if (params.form) {
    const form = new FormData();
    for (const [key, value] of Object.entries(params.form)) form.append(key, value);
    body = form;
  } else if (params.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(params.body);
  }

  const response = await fetch(url, {
    method: params.method || "GET",
    headers,
    body,
    signal: AbortSignal.timeout(params.timeoutMs ?? 15_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & {
        error?: {
          message?: string;
          code?: number;
          error_subcode?: number;
          type?: string;
          fbtrace_id?: string;
        };
      })
    | null;
  if (!response.ok || !payload) {
    throw new MetaGraphError({
      message:
        payload?.error?.message || `Meta Graph API returned ${response.status}`,
      status: response.status,
      code: payload?.error?.code,
      subcode: payload?.error?.error_subcode,
      type: payload?.error?.type,
      fbtraceId: payload?.error?.fbtrace_id,
      retryAfterSeconds: positiveInteger(response.headers.get("retry-after")),
    });
  }
  return payload;
}
