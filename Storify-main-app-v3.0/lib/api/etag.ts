import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Conditional-request helpers for polled endpoints.
 *
 * The live surfaces (notification drawer, account notifications) refetch on a
 * timer, on tab focus, and whenever a push arrives — most of those refetches
 * find nothing new. Without a validator every one of them costs the same five
 * database round-trips as a first load, which is what made the old SSE streams
 * expensive: they were paying full price for "nothing changed" twenty times a
 * minute.
 *
 * `successResponse` sends `Cache-Control: no-store`, so the browser's HTTP
 * cache never revalidates on its own. That is deliberate — these payloads are
 * per-user and must not sit on disk. The client therefore keeps the ETag in
 * memory and sends `If-None-Match` itself (see `hooks/use-live-resource.ts`);
 * this module is the server half of that agreement, not an HTTP-cache feature.
 *
 * Tags are weak (`W/`) because they are computed from a *reduced* projection
 * of the payload, not the bytes: the goal is "has anything the UI renders
 * changed", so volatile fields (server timestamps, pagination echoes) are left
 * out of the signature on purpose. A byte-exact tag would change on every
 * request and defeat the whole mechanism.
 */

/** Weak ETag over the caller's signature value. */
export function computeEtag(signature: unknown): string {
  const hash = createHash("sha1")
    .update(typeof signature === "string" ? signature : JSON.stringify(signature))
    .digest("base64url");
  return `W/"${hash}"`;
}

/** Strip the weak marker and surrounding quotes so `W/"x"` and `"x"` compare equal. */
function normalizeTag(tag: string): string {
  return tag.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

/**
 * Whether the caller already holds this exact version.
 *
 * `If-None-Match` is a list, and `*` matches anything — a client sends it to
 * say "any version I might have will do", which for a polled resource means
 * "don't resend what I have".
 */
export function matchesIfNoneMatch(
  request: NextRequest,
  etag: string,
): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) return false;

  const target = normalizeTag(etag);
  return header
    .split(",")
    .some((candidate) => {
      const value = candidate.trim();
      return value === "*" || normalizeTag(value) === target;
    });
}

/**
 * A 304 with no body.
 *
 * The ETag is repeated so a client that dropped its copy (a reload mid-poll)
 * can re-learn it without a full fetch, and `no-store` is repeated because a
 * 304 that omits it lets an intermediary decide the caching policy instead.
 */
export function notModifiedResponse(etag: string): NextResponse {
  return new NextResponse(null, {
    status: 304,
    headers: {
      ETag: etag,
      "Cache-Control": "no-store",
    },
  });
}
