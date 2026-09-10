/**
 * Return-to-where-you-were support for the login flow.
 *
 * The proxy stamps every page request with the URL the visitor actually asked
 * for. Server-side auth guards read it back to build a login callback that
 * lands the visitor on that exact page after signing in, instead of a
 * hardcoded dashboard. The module is import-safe from client components: the
 * login/register pages reuse `sanitizeReturnPath` on their query params.
 */
export const REQUEST_PATH_HEADER = "x-request-path";

/**
 * Auth-flow pages (with or without a locale prefix) are never valid return
 * targets: "come back to /login after logging in" is a loop, not a return.
 * The header's sign-in link builds its callback from the current pathname, so
 * this is what keeps auth pages from feeding themselves back in.
 */
const AUTH_PAGE_PATH_PATTERN =
  /^(?:\/[a-zA-Z0-9-]+)?\/(login|register|forgot-password|reset-password|verify-email|email-verified|role-redirect)(?:\/|\?|#|$)/;

/**
 * A bare storefront root (`/`, `/en`, `/en/`) is a valid page but carries no
 * return intent — "come back to the home page" is indistinguishable from a
 * default landing, and honoring it would keep every role off its post-login
 * dashboard (the header's sign-in link stamps the current path, so logging
 * in from the front page arrives with a home callback). Query-carrying home
 * paths (`/en?search=abc`) stay valid targets. Every route lives under a
 * locale prefix (the proxy redirects bare paths), so a single-segment path
 * can only be a locale root.
 */
const HOME_PATH_PATTERN = /^(?:\/[a-zA-Z0-9-]+)?\/?$/;

/**
 * WHATWG URL parsers (the browser's address bar, `new URL`, the Next router)
 * strip ASCII tab/newline/CR *before* parsing, so `"/\t/evil.com"` — which
 * passes a naive `//` prefix check — collapses into protocol-relative
 * `//evil.com` at navigation time. Any control character in a return path is
 * an evasion attempt, never a real destination, so the whole value is
 * rejected rather than trying to predict the parser.
 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Real return targets are short; browsers cap full URLs around 2k. Anything
 * longer only bloats the login URL and the Location header it ends up in.
 */
const MAX_RETURN_PATH_LENGTH = 2000;

/**
 * Accepts only same-origin absolute paths (`/en/vendor/products?page=2`).
 * External URLs, protocol-relative `//evil.com`, backslash variants, and
 * control-character smuggling are rejected so a crafted login link can't
 * turn the redirect into an open redirect off the store. Auth pages and
 * bare home paths are rejected because they aren't returns — see the
 * patterns above.
 */
export function sanitizeReturnPath(
  value: string | null | undefined,
): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.length > MAX_RETURN_PATH_LENGTH) return null;
  if (CONTROL_CHARACTER_PATTERN.test(value)) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (AUTH_PAGE_PATH_PATTERN.test(value)) return null;
  if (HOME_PATH_PATTERN.test(value)) return null;
  return value;
}

/**
 * The proxy-stamped path (with query) of the request currently being served,
 * or null outside the proxy (which overwrites any client-sent value, so this
 * is trustworthy). Callers pass the same `headers()` list they already hold
 * for the session lookup.
 */
export function returnPathFromHeaders(headers: Headers): string | null {
  return sanitizeReturnPath(headers.get(REQUEST_PATH_HEADER));
}

/**
 * Canonical login URL builder — every guard, link, and button that hands a
 * signed-out visitor to the login page goes through here, so the return-to
 * contract lives in one place. `callbackUrl` is the canonical param; the
 * login page keeps accepting `redirect` for older links.
 */
export function buildLoginUrl(
  locale: string,
  returnTo?: string | null,
): string {
  const safe = sanitizeReturnPath(returnTo);
  return `/${locale}/login${
    safe ? `?callbackUrl=${encodeURIComponent(safe)}` : ""
  }`;
}

/**
 * The URL (path + query) currently in the browser — the client-side twin of
 * `returnPathFromHeaders`, for login handoffs from event handlers. Null during
 * SSR, where a statically known target must be passed instead.
 */
export function currentBrowserPath(): string | null {
  if (typeof window === "undefined") return null;
  return sanitizeReturnPath(
    `${window.location.pathname}${window.location.search}`,
  );
}
