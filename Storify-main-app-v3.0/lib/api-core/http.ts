import { createHash } from "node:crypto";
import { RESPONSE_HEADERS } from "@/contracts/mobile/shop/v1/common";
import type { CachePolicy } from "./registry";

/**
 * Response headers and bodies, without a framework: every function here
 * builds a web `Response` or the strings that go into one.
 */

/**
 * `Cache-Control` for an answer of each cache class.
 *
 * `max-age=0` everywhere: iOS's own HTTP cache honours `max-age`, so any
 * other value would hand a pull-to-refresh the old answer without the app
 * ever knowing. The app revalidates with `If-None-Match` instead. `s-maxage`
 * is for a CDN in front of the store, and only on answers that are the same
 * for everybody; one shopper's answer is never stored anywhere.
 */
export function cacheControlFor(cache: CachePolicy): string {
  if (cache.kind === "private") return "private, no-store";
  const sMaxAge = cache.kind === "static" ? cache.revalidate : cache.sMaxAge;
  const swr = cache.kind === "static" ? cache.revalidate : cache.swr;
  if (sMaxAge <= 0) return "no-store";
  return `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
}

/** Failures are one request's answer: nothing may keep them. */
export const ERROR_CACHE_CONTROL = "no-store";

/**
 * An ETag over a body, before any compression. Weak, because a CDN that
 * re-compresses the body weakens a strong tag anyway; a weak tag is all the
 * app compares with.
 */
export function computeEtag(body: string): string {
  return `W/"${createHash("sha1").update(body).digest("base64url")}"`;
}

function opaqueTag(tag: string): string {
  return tag.trim().replace(/^W\//i, "");
}

/**
 * Whether `If-None-Match` names this version. Compared weakly (RFC 9110
 * §13.1.2): a CDN may hand the tag back weakened, and `*` matches anything.
 */
export function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const target = opaqueTag(etag);
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || opaqueTag(value) === target;
  });
}

export function jsonResponse(
  status: number,
  body: string,
  headers: Record<string, string>,
): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** A 304 carries the validator and the caching rule of the full answer. */
export function notModifiedResponse(headers: Record<string, string>): Response {
  return new Response(null, { status: 304, headers });
}

export function requestIdHeader(requestId: string | undefined): Record<string, string> {
  return requestId ? { [RESPONSE_HEADERS.requestId]: requestId } : {};
}

/**
 * A file a GET answers with in place of the JSON envelope: an order's
 * invoice. The app downloads it with its session like any other request, so
 * there is no link to sign and nothing to expire. A failure is still the JSON
 * envelope.
 */
export class FileBody {
  constructor(
    readonly bytes: Uint8Array,
    readonly contentType: string,
    /** What the app saves it as; plain ASCII, no quotes. */
    readonly fileName: string,
  ) {}
}

export function fileResponse(file: FileBody, headers: Record<string, string>): Response {
  return new Response(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^\w.-]/g, "_")}"`,
      "Content-Length": String(file.bytes.byteLength),
      ...headers,
    },
  });
}
