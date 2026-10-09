import { MetaGraphError } from "@/lib/meta/graph-client";

/**
 * What a failed catalog call means for the live sync, read from Meta's
 * structured error rather than its message:
 *
 * - `throttle`: Meta asked us to slow down (80014 is "too many batch upload
 *   calls for this catalog"). Everything waits and is sent later; nothing is
 *   dropped and no product's tries are counted against it.
 * - `auth`: the token is dead, lacks the catalog permission, or the catalog is
 *   not this token's to manage. Every further call would fail the same way, so
 *   the sync pauses until an admin fixes it.
 * - `config`: this server cannot make the call at all (no Graph version
 *   configured). Nothing is paused; the page says what to set.
 * - `invalid`: Meta refused this request as malformed. Retried with a growing
 *   delay, since a later edit may cure it.
 * - `transient`: a 5xx, a timeout, a dropped connection, an unknown code —
 *   retried with a growing delay.
 *
 * Problems with one item are not errors at all: Meta reports them per item in
 * the batch's answer, and they are recorded on that product
 * (lib/meta-catalog/sync-worker.ts).
 */

export type CatalogFailureKind = "throttle" | "auth" | "config" | "invalid" | "transient";

/** Why the sync paused, for the page to word. */
export type CatalogPauseCode = "token" | "permission" | "catalog" | "key";

export interface CatalogFailure {
  kind: CatalogFailureKind;
  message: string;
  /** Set on `auth`. */
  pauseCode?: CatalogPauseCode;
  /** Meta's Retry-After, when it sent one. */
  retryAfterSeconds?: number;
  code?: number;
  subcode?: number;
}

/**
 * Rate limits: the generic app/user limits (4, 17, 32, 613) and the catalog
 * business use cases — 80009 catalog management, 80014 catalog batch.
 */
const THROTTLE_CODES = new Set([4, 17, 32, 613, 80009, 80014]);

/** The token itself is invalid, expired or revoked. */
const TOKEN_CODES = new Set([102, 190, 463, 467]);

/** Graph's "Unsupported request: the object does not exist or you lack permission". */
const MISSING_OBJECT_SUBCODE = 33;

export class CatalogConfigError extends Error {
  readonly pauseCode?: CatalogPauseCode;

  constructor(message: string, pauseCode?: CatalogPauseCode) {
    super(message);
    this.name = "CatalogConfigError";
    this.pauseCode = pauseCode;
  }
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? "Unknown error")).slice(0, 1000);
}

export function classifyCatalogError(error: unknown): CatalogFailure {
  const message = messageOf(error);

  if (error instanceof CatalogConfigError) {
    return error.pauseCode
      ? { kind: "auth", message, pauseCode: error.pauseCode }
      : { kind: "config", message };
  }

  if (!(error instanceof MetaGraphError)) {
    const code = (error as { code?: unknown } | null)?.code;
    // Raised before any call: the Graph version or an encryption key is missing.
    if (code === "META_GRAPH_VERSION_NOT_CONFIGURED") return { kind: "config", message };
    if (typeof code === "string" && code.endsWith("_ENCRYPTION_KEY_NOT_CONFIGURED")) {
      return { kind: "auth", message, pauseCode: "key" };
    }
    return { kind: "transient", message };
  }

  const base = { message, code: error.code, subcode: error.subcode };

  if (
    error.status === 429 ||
    (error.code !== undefined && THROTTLE_CODES.has(error.code))
  ) {
    return { ...base, kind: "throttle", retryAfterSeconds: error.retryAfterSeconds };
  }

  if (
    error.status === 401 ||
    (error.code !== undefined && TOKEN_CODES.has(error.code)) ||
    (error.subcode !== undefined && TOKEN_CODES.has(error.subcode))
  ) {
    return { ...base, kind: "auth", pauseCode: "token" };
  }

  // 10 and 200-299 are permission errors: the token cannot manage catalogs.
  if (error.code === 10 || (error.code !== undefined && error.code >= 200 && error.code <= 299)) {
    return { ...base, kind: "auth", pauseCode: "permission" };
  }

  // The catalog id names nothing this token can see.
  if (error.code === 100 && error.subcode === MISSING_OBJECT_SUBCODE) {
    return { ...base, kind: "auth", pauseCode: "catalog" };
  }
  if (error.code === 803) {
    return { ...base, kind: "auth", pauseCode: "catalog" };
  }

  if (error.code === 100) return { ...base, kind: "invalid" };

  return { ...base, kind: "transient" };
}
