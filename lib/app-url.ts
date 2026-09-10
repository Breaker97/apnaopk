/**
 * The origin a gateway should send the payer back to.
 *
 * Taken from the request rather than configuration so a store reachable on
 * several hostnames returns the vendor to the one they actually started on —
 * a checkout that completes on a different origin drops the session cookie and
 * looks like a failed payment.
 *
 * Duplicated in `app/api/vendor/boosts/checkout/route.ts` until this existed; a
 * `route.ts` may only export route handlers, so a shared helper cannot live in
 * one.
 */
export function appUrlForRequest(request: Request): string {
  return (
    request.headers.get("origin") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/**
 * The configured public origin without a trailing slash, for links built
 * outside a request (notification payloads, emails, background jobs). Inside a
 * route handler prefer `appUrlForRequest`, which honours the origin the caller
 * actually used.
 */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}
