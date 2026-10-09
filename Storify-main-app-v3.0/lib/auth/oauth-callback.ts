/**
 * OAuth redirect URIs, defined once.
 *
 * Google and Meta both refuse a sign-in whose redirect URI is not registered
 * character-for-character in their console, so the URL an admin copies out of
 * the Settings page has to be the exact URL Better Auth will send. That URL is
 * derived from the server's auth base URL — `BETTER_AUTH_URL`, else
 * `NEXT_PUBLIC_APP_URL` — which the browser cannot see, and which is not
 * necessarily the host the admin happens to be browsing on (a store reached
 * through a preview domain, a tunnel, or an IP would otherwise print a callback
 * that can never work).
 *
 * So the server resolves the base URL and publishes it in the settings payload,
 * and both sides build the callback from the same two functions here.
 */

const OAUTH_PROVIDER_IDS = ["google", "facebook"] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

export function isOAuthProviderId(value: unknown): value is OAuthProviderId {
  return (
    typeof value === "string" &&
    (OAUTH_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/**
 * Better Auth's default `basePath`. Declared here because the callback path is
 * built from it; if `betterAuth({ basePath })` is ever set in `lib/auth.ts`,
 * this constant has to move with it.
 */
const AUTH_BASE_PATH = "/api/auth";

/** Fallback base URL — matches Next's own dev server default. */
const DEFAULT_AUTH_BASE_URL = "http://localhost:3000";

/** Drop trailing slashes so the callback never comes out with a double slash. */
function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * The base URL Better Auth runs on. Server-side only in practice:
 * `BETTER_AUTH_URL` is not a `NEXT_PUBLIC_` variable, so in a browser bundle it
 * reads as undefined and this would silently fall back to localhost.
 */
export function resolveAuthBaseUrl(): string {
  const configured =
    process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  return trimTrailingSlash(configured) || DEFAULT_AUTH_BASE_URL;
}

/**
 * The redirect URI to register with the provider, e.g.
 * `https://store.example.com/api/auth/callback/google`.
 */
export function buildOAuthCallbackUrl(
  baseUrl: string,
  provider: OAuthProviderId,
): string {
  return `${trimTrailingSlash(baseUrl)}${AUTH_BASE_PATH}/callback/${provider}`;
}
