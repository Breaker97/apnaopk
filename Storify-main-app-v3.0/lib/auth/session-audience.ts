import { isValidAppScheme, resolveMobileAppSettings } from "@/lib/settings/mobile-app";

/**
 * A session's audience: which client it was signed in from, and so where it
 * may be used. A session from the shopper app works on the shopper app's API
 * and nowhere else; one from the business app on the business app's API; a
 * browser's on the web. Someone who lifts an app's cookie off a phone cannot
 * walk into the admin with it, a page's cookie cannot drive an app's API, and
 * a shopper app's session cannot drive the business app's.
 *
 * Stored on the session row as `client`, set once when the session is minted
 * (`databaseHooks.session.create.before` in lib/auth/auth.ts) and never
 * writable after (`input: false`). A row without one predates the field and
 * is a web session, so nothing needs migrating.
 *
 * Better Auth's own endpoints under /api/auth (get-session, sign-out,
 * two-factor, update-user, delete-user) accept every audience: they are the
 * account holder's own actions, on whichever device they signed in.
 */

export const SESSION_CLIENTS = ["web", "shop-app", "biz-app"] as const;
export type SessionClient = (typeof SESSION_CLIENTS)[number];

/** Who a session read accepts: one audience, or several. */
export type SessionExpectation = SessionClient | readonly SessionClient[];

/** The audience of a stored session; missing or unknown means web. */
export function sessionClientOf(value: unknown): SessionClient {
  return typeof value === "string" &&
    (SESSION_CLIENTS as readonly string[]).includes(value)
    ? (value as SessionClient)
    : "web";
}

/** Whether a session of `client` may be used where `expect` is asked for. */
export function isExpectedClient(
  client: SessionClient,
  expect: SessionExpectation,
): boolean {
  return typeof expect === "string" ? client === expect : expect.includes(client);
}

/**
 * The origins the store's apps sign in from, as Better Auth sees them: the
 * `@better-auth/expo` plugin copies the app's `expo-origin` header (its URL
 * scheme, `mystore://`) into `Origin`. Only an app the store has switched on,
 * with a scheme that can never be a web origin (lib/settings/mobile-app.ts),
 * is trusted; a store that never set one up trusts no app at all.
 */
export interface AppOrigins {
  /** `"<scheme>://"` of the shopper app, or null. */
  shop: string | null;
  /** `"<scheme>://"` of the business app, or null. */
  biz: string | null;
}

export const NO_APP_ORIGINS: AppOrigins = { shop: null, biz: null };

export function appOriginsFromSettings(mobileApp: unknown): AppOrigins {
  const { shop, biz } = resolveMobileAppSettings(mobileApp);
  const shopOrigin =
    shop.enabled && isValidAppScheme(shop.scheme) ? `${shop.scheme}://` : null;
  const bizOrigin =
    biz.enabled && isValidAppScheme(biz.scheme) ? `${biz.scheme}://` : null;
  return {
    shop: shopOrigin,
    // The save refuses one scheme for both apps; a document written past the
    // save that has it anyway trusts it for the shopper app only, never as a
    // business sign-in.
    biz: bizOrigin && bizOrigin !== shopOrigin ? bizOrigin : null,
  };
}

/** The app origins as Better Auth's `trustedOrigins` list takes them. */
export function trustedAppOrigins(apps: AppOrigins): string[] {
  return [apps.shop, apps.biz].filter((origin): origin is string => Boolean(origin));
}

/**
 * The audience of a session being signed in, from the request's `Origin`.
 *
 * A prefix match, so a development build that reports its bundler's address
 * (`mystore://192.168.1.5:8081`) is the app too. In development, Expo Go's
 * `exp://` is the shopper app as well: the plugin trusts that origin only
 * under `next dev`, and a session labelled "web" would be refused by the very
 * API the developer is building against. Expo Go cannot tell the two apps
 * apart (both send `exp://`), so the business app is never run in it: it is
 * developed in a development build with its own scheme. Everything else, no
 * origin at all included, is the web.
 */
export function resolveSessionClient(
  origin: string | null | undefined,
  apps: AppOrigins,
  development: boolean = process.env.NODE_ENV === "development",
): SessionClient {
  const value = origin?.trim().toLowerCase() ?? "";
  if (!value) return "web";
  if (apps.shop && value.startsWith(apps.shop)) return "shop-app";
  if (apps.biz && value.startsWith(apps.biz)) return "biz-app";
  if (development && value.startsWith("exp://")) return "shop-app";
  return "web";
}
