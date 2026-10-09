const DEFAULT_APP_URL = "http://localhost:3000";

/**
 * The configured public origin without a trailing slash, for links built
 * outside a request (notification payloads, emails, background jobs) and for
 * any link that is stored or sent to someone else.
 */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * The origins this deployment is configured to answer on — the ones sign-in
 * trusts too (lib/auth/auth.ts).
 */
function configuredOrigins(): string[] {
  const origins = [process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL]
    .map(originOf)
    .filter((origin): origin is string => Boolean(origin));
  return origins.length > 0 ? origins : [DEFAULT_APP_URL];
}

/**
 * Whether a hostname belongs to a private network — the ranges a router
 * hands out at home or in an office, plus loopback. Used to widen the
 * trusted origins for LAN testing; anything routable from the internet
 * answers false.
 */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]" || host === "::1") return true;
  // A name, not an address (a tunnel or a staging domain): not our call.
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const [a, b] = host.split(".").map(Number);
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 169.254.0.0/16 — link-local, what a device picks with no DHCP.
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * The origin a gateway should send the payer back to, or a link in this
 * request's own answer should point at.
 *
 * The browser's origin when it is one this deployment is configured with, so
 * a store on two configured hostnames returns the payer to the one they
 * started on — a checkout that completes on another origin drops the session
 * cookie and looks like a failed payment. The same goes for a private address
 * the request arrived on (a phone testing the store on the LAN), as sign-in
 * allows. Anything else gets `appBaseUrl()`: `Origin` is a header any client
 * can set, and taking it as given put another site into payment return links
 * and into the recovery links stored with a checkout.
 */
export function appUrlForRequest(request: Request): string {
  const origin = originOf(request.headers.get("origin"));
  if (!origin) return appBaseUrl();
  if (configuredOrigins().includes(origin)) return origin;
  const { hostname, host } = new URL(origin);
  const requestHost = request.headers.get("host")?.trim().toLowerCase();
  if (isPrivateNetworkHost(hostname) && requestHost === host.toLowerCase()) {
    return origin;
  }
  return appBaseUrl();
}

/**
 * A link stored earlier, moved onto `appBaseUrl()`: the same path and query on
 * this deployment's own origin. Recovery links were built from the request's
 * `Origin` header, so one stored before that stopped can name any site.
 */
export function onAppOrigin(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { pathname, search } = new URL(url, appBaseUrl());
    return `${appBaseUrl()}${pathname}${search}`;
  } catch {
    return undefined;
  }
}
