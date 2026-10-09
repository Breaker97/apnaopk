/** Thirty days: a basket survives a week or two of thinking it over. */
const CART_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The guest cart's `Set-Cookie` value — every route that hands out a cart
 * session writes it through this.
 *
 * `Secure` whenever the request came over HTTPS, directly or through a proxy
 * that says so (`X-Forwarded-Proto`), so the cookie that opens a guest's cart
 * never travels over a plain connection. A store tried over plain HTTP (a LAN
 * test) still keeps its cart: a browser drops a `Secure` cookie set there.
 */
export function cartSessionCookie(request: Request, sessionId: string): string {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const https = forwarded
    ? forwarded === "https"
    : new URL(request.url).protocol === "https:";
  return `cart_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CART_SESSION_MAX_AGE}${
    https ? "; Secure" : ""
  }`;
}
