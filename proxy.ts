import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { resolveFaviconUrl } from "@/config/branding.config";
import { connectDB } from "@/lib/db";
import { defaultLocale, locales, type Locale } from "@/config/i18n.config";
import {
  buildLocalePath,
  LOCALE_COOKIE_NAME,
  resolveLocaleRouting,
  splitLocalePath,
  type LocaleRouting,
} from "@/lib/i18n/locale-prefix";
import { USER_ROLES } from "@/config/app.config";
import { isInstallLocked } from "@/lib/install/payload";
import { User } from "@/models/user.model";
import { REQUEST_PATH_HEADER } from "@/lib/auth/return-path";
import {
  UNCACHED_SEGMENT,
  hasVisitorQuery,
  isCachedPagePath,
} from "@/lib/storefront/cached-pages";
import { CLIENT_IP_HEADER, stampClientIp } from "@/lib/api/client-ip";
import {
  buildMaintenanceHtml,
  isAllowedMaintenanceIp,
  normalizeMaintenanceSettings,
} from "@/lib/maintenance";
import { getSettings, Settings } from "@/models/settings.model";
import { isMobileApiPath, mobileGate } from "@/lib/api-core/gate";
import { resolveMobileAppSettings } from "@/lib/settings/mobile-app";

/**
 * The store's default language owns the unprefixed URLs (`/products`), every
 * other enabled language keeps its prefix (`/bn/products`) — next-intl's
 * `as-needed` mode. A store with one language therefore serves no locale
 * prefix at all, and `localePrefix: "always"`, which used to stamp `/en/` onto
 * every URL of every single-language store, is gone.
 *
 * `locales` is the ENABLED set rather than the build's 18, so language
 * detection can only ever resolve to a language the store actually serves, and
 * a disabled language's prefix is recognised as the stale link it is (handled
 * in `routeLocalizedPage` below).
 *
 * Instances are memoised because the middleware is built from settings that
 * change once in a blue moon, and building one per request would re-parse the
 * routing config on every page view.
 */
const intlProxies = new Map<string, ReturnType<typeof createMiddleware>>();

function getIntlProxy(routing: LocaleRouting, localeDetection: boolean) {
  const key = `${routing.storeDefault}|${routing.enabled.join(",")}|${localeDetection}`;
  let intlProxy = intlProxies.get(key);

  if (!intlProxy) {
    // A running store uses two or three variants; anything beyond that is a
    // settings change, so the old entries are dead weight.
    if (intlProxies.size > 8) intlProxies.clear();

    intlProxy = createMiddleware({
      locales: routing.enabled,
      defaultLocale: routing.storeDefault,
      localePrefix: "as-needed",
      localeDetection,
      localeCookie: { name: LOCALE_COOKIE_NAME },
    });
    intlProxies.set(key, intlProxy);
  }

  return intlProxy;
}

/**
 * How requests are routed when settings cannot be read (a cold process with an
 * unreachable database). Every build locale stays servable: guessing a
 * narrower set here would redirect a store's real languages away while its
 * database is down.
 */
const FALLBACK_PROXY_ROUTING: LocaleRouting = {
  enabled: [...locales],
  storeDefault: defaultLocale,
};

const STATIC_FILE_PATTERN = /\.[^/]+$/;
/**
 * The signed-link pages: `/order/address/{token}`, `/order/pay/{token}`,
 * `/pre-order/manage/{token}` and `/pre-order/balance/{token}`, with a
 * language prefix or without. Their token is `{orderId}.{signature}`
 * (lib/payments/preorder-balance-link.ts), so the path ends in a "file
 * extension" and was let through as a file — the matcher below skipped it
 * too. The emails and notifications link without a prefix, so in the store's
 * default language the page never got its language rewrite and answered 404.
 */
const SIGNED_LINK_PAGE_PATTERN =
  /^\/(?:[a-z]{2}\/)?(?:order\/(?:address|pay)|pre-order\/(?:manage|balance))\/[^/]+$/;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PAGE_BYPASS_PREFIXES = ["/admin", "/login", "/role-redirect", "/forbidden"];
const API_BYPASS_PREFIXES = [
  "/api/admin",
  "/api/vendor",
  "/api/auth",
  "/api/payments/webhook",
  "/api/payments/paypal/capture",
  "/api/payments/verify",
  "/api/payments/razorpay/callback",
  "/api/payments/razorpay/verify",
  "/api/payments/razorpay/webhook",
  "/api/payments/paystack/verify",
  "/api/payments/paystack/webhook",
  "/api/settings/public",
];
const PROTECTED_API_PREFIXES = [
  "/api/cart",
  "/api/wishlist",
  "/api/orders",
  "/api/returns",
  "/api/payments/checkout",
  "/api/payments/stripe/intent",
  "/api/vendor/apply",
  "/api/reviews",
  "/api/blog-comments",
  "/api/user",
];
const MAINTENANCE_SETTINGS_TTL_MS = 15_000;

type MaintenanceSnapshot = {
  maintenance: ReturnType<typeof normalizeMaintenanceSettings>;
  storeName?: string;
  storeEmail?: string;
  logoUrl?: string;
  faviconUrl?: string;
  routing: LocaleRouting;
  mobileApp: { shopEnabled: boolean; bizEnabled: boolean };
};

let maintenanceSnapshotCache:
  | {
      expiresAt: number;
      value: MaintenanceSnapshot;
    }
  | undefined;
let maintenanceSnapshotRefresh: Promise<MaintenanceSnapshot> | undefined;
/**
 * Which store the snapshot belongs to. Bumped once, when this process first
 * sees the store installed (`isStoreInstalled`): a read that started before
 * then describes the store as it was before the install and must not be
 * cached after it.
 */
let snapshotGeneration = 0;

function stripLocalePrefix(pathname: string) {
  const { rest } = splitLocalePath(pathname);
  return rest === "/" ? "/" : rest.replace(/\/+$/, "") || "/";
}

/**
 * The locale a request is being served in. An unprefixed URL is the store
 * default's — which is the admin's choice, not the build's `en`, so the caller
 * passes it in.
 */
function getLocaleFromPathname(pathname: string, storeDefault: Locale) {
  return splitLocalePath(pathname).locale ?? storeDefault;
}

/**
 * Routes a page request through the next-intl proxy.
 *
 * Two things happen here that next-intl cannot decide on its own:
 *
 * 1. A prefix that this store no longer serves — the store default's own
 *    (its pages live at the bare path now) or a language the admin turned
 *    off — is a stale link, not a 404. It is redirected PERMANENTLY to the
 *    bare path, which is how a store retires the `/en/…` URLs it indexed
 *    before this mode existed. next-intl redirects the default locale's
 *    prefix too, but only with a 307, which leaves the old URL in the index.
 * 2. First-time visitors honour the admin-configured default language: a
 *    locale-less URL with no locale cookie resolves to it rather than to
 *    `Accept-Language`. Returning visitors keep their own choice, which the
 *    locale cookie carries — written by the app before every page it
 *    requests (`rememberLocale`, hooks/use-locale-navigation.ts) and by
 *    next-intl on a direct page load.
 *
 * And one thing next-intl knows nothing about: a page served from the cache,
 * asked for with a query string, is rendered by its uncached twin instead
 * (lib/storefront/cached-pages.ts).
 */
function routeLocalizedPage(request: NextRequest, routing: LocaleRouting) {
  const { pathname } = request.nextUrl;
  const { locale: pathLocale, rest } = splitLocalePath(pathname);

  // The twins are reached through the rewrite below, never by their own URL:
  // a path no route claims, which the store's catch-all answers with a 404.
  if (rest === `/${UNCACHED_SEGMENT}` || rest.startsWith(`/${UNCACHED_SEGMENT}/`)) {
    const locale =
      pathLocale && routing.enabled.includes(pathLocale)
        ? pathLocale
        : routing.storeDefault;
    return NextResponse.rewrite(new URL(`/${locale}/404`, request.url), {
      request: { headers: request.headers },
    });
  }

  const staleLocalePrefix =
    pathLocale !== null &&
    (pathLocale === routing.storeDefault ||
      !routing.enabled.includes(pathLocale));

  if (staleLocalePrefix) {
    const url = request.nextUrl.clone();
    // Always the bare path: the store default is the one language that has
    // no prefix, so it is also the one a retired prefix falls back to.
    url.pathname = buildLocalePath(
      routing.storeDefault,
      rest,
      routing.storeDefault,
    );
    const response = NextResponse.redirect(url, 308);

    // The store default's own prefix still names a language — every link the
    // store printed before this mode, and the emailed links that keep the
    // prefix, ask for it. The bare path is served in the cookie's language,
    // so it is recorded here, as next-intl records it on its own redirect of
    // this prefix; otherwise a cookie naming another language sends the
    // visitor straight on to that one.
    if (pathLocale === routing.storeDefault) {
      response.cookies.set(LOCALE_COOKIE_NAME, routing.storeDefault, {
        path: "/",
        sameSite: "lax",
      });
    }
    return response;
  }

  // Detection covers the locale cookie AND `Accept-Language`, and it is
  // all-or-nothing in next-intl — so it is turned off in the one case where
  // the admin's choice has to win over the browser's: a first visit, to a URL
  // that names no language, at a store whose default is not the build's. That
  // is exactly the case this branch has always covered; a store that runs on
  // `en` keeps honouring `Accept-Language` as it did before. With a locale in
  // the path, or a cookie naming a language this store serves, the visitor
  // has already chosen. A cookie naming one the store has since turned off is
  // no choice: next-intl ignores its value, and counting it would hand the
  // visitor to `Accept-Language` instead of the store's default.
  const cookieLocale = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  const hasChosen =
    pathLocale !== null ||
    routing.enabled.some((locale) => locale === cookieLocale);
  const firstVisitToStoreDefault =
    !hasChosen && routing.storeDefault !== defaultLocale;

  const response = getIntlProxy(routing, !firstVisitToStoreDefault)(request);
  return isCachedPagePath(rest) && hasVisitorQuery(request.nextUrl.searchParams)
    ? toUncachedTwin(response, request)
    : response;
}

/**
 * A cached page asked for with a query string, pointed at its uncached twin
 * (lib/storefront/cached-pages.ts), one segment under the locale. next-intl
 * has already decided the language: a redirect stands as it is, and its
 * rewrite — or pass-through, for a prefixed URL — goes to the twin, query
 * string and request headers as next-intl left them.
 */
function toUncachedTwin(response: NextResponse, request: NextRequest) {
  if (response.headers.has("location")) return response;

  const target = new URL(
    response.headers.get("x-middleware-rewrite") ?? request.url,
  );
  const { locale, rest } = splitLocalePath(target.pathname);
  // next-intl's internal path always names the language; without one this is
  // not a page it routed, so it is left alone.
  if (!locale) return response;

  target.pathname = `/${locale}/${UNCACHED_SEGMENT}${rest === "/" ? "" : rest}`;
  response.headers.delete("x-middleware-next");
  response.headers.set("x-middleware-rewrite", target.toString());
  return response;
}

/**
 * Whether this store has been set up, remembered for the life of the process.
 *
 * The flag is STICKY because the state it tracks is: a store that has an
 * admin can never go back to being installable (the wizard 404s from then
 * on), so once this is true the check is never paid again — an installed
 * store adds nothing to any request. Before that it runs live on every page
 * request rather than riding the 15-second settings snapshot: the only
 * traffic a store gets in that window is the buyer setting it up, and a
 * stale `false` would send them from their finished storefront to a wizard
 * that answers 404.
 *
 * Both signals of the lock are read, exactly as `lib/install/status.ts`
 * reads them, so a store set up from the command line (`pnpm create-admin`,
 * `pnpm db:seed`) is recognized as installed too.
 *
 * The moment this process first sees the store installed, it forgets the
 * settings snapshot. The buyer's own visit to /install warmed it with the
 * PRE-install settings (English only, the default name), and serving those
 * for another 15 s — or once more after expiry, stale-while-revalidate — sent
 * a Turkish store's first sign-in to English. Every process notices on its
 * own: each one reads the lock live until it has seen it, so no message
 * between workers or serverless instances is needed, and no request after
 * the install is ever routed by the store that existed before it.
 */
let installLocked = false;

async function isStoreInstalled(): Promise<boolean> {
  if (installLocked) return true;

  await connectDB();
  // Two projected reads, not `getSettings()`: that one upserts the singleton,
  // and this runs on every page request until the store is set up.
  const [adminExists, settings] = await Promise.all([
    // Either field: an admin held only in `roles` is still the store's admin.
    User.exists({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
    }),
    Settings.findOne({})
      .select("installedAt")
      .lean<{ installedAt?: Date } | null>(),
  ]);

  const locked = isInstallLocked({
    adminExists: Boolean(adminExists),
    installedAt: settings?.installedAt ?? null,
  });
  // Only ever false → true: a slower read that started before the install
  // must not flip a process that has already seen it back.
  if (locked && !installLocked) {
    installLocked = true;
    forgetPreInstallSnapshot();
  }
  return locked;
}

/** Drop the snapshot, and orphan any refresh that is still reading the old store. */
function forgetPreInstallSnapshot() {
  snapshotGeneration += 1;
  maintenanceSnapshotCache = undefined;
  maintenanceSnapshotRefresh = undefined;
}

/**
 * Send a pre-install visitor to the wizard instead of an empty storefront.
 *
 * A fresh deployment otherwise renders the built-in starter layout with no
 * catalog and no way to sign in, and the one URL that fixes that lives in
 * the README — which is not where a buyer looks when the site they just
 * deployed appears to be broken. Returns null (carry on) for the installer
 * itself and whenever the check cannot be made, so a database problem shows
 * up as the storefront's own error, never as a redirect loop.
 */
async function routeUninstalled(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (stripLocalePrefix(pathname) === "/install") return null;

  try {
    if (await isStoreInstalled()) return null;
  } catch {
    return null;
  }

  // No settings to read yet, so the locale can only come from the URL: a
  // visitor already on a prefixed path keeps it, everyone else gets the
  // unprefixed installer and next-intl resolves the language for it.
  const { locale: pathLocale } = splitLocalePath(pathname);
  const url = request.nextUrl.clone();
  url.pathname = pathLocale ? `/${pathLocale}/install` : "/install";
  url.search = "";
  return NextResponse.redirect(url);
}

/** The address stampClientIp recorded at the top of the proxy. */
function getClientIp(request: NextRequest) {
  return request.headers.get(CLIENT_IP_HEADER);
}

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function shouldBypassMaintenanceApi(pathname: string, method: string) {
  return (
    !MUTATION_METHODS.has(method) ||
    matchesPrefix(pathname, API_BYPASS_PREFIXES) ||
    !matchesPrefix(pathname, PROTECTED_API_PREFIXES)
  );
}

function createMaintenanceHeaders(retryAfter?: number) {
  const headers = new Headers({
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    "X-Robots-Tag": "noindex, nofollow",
    Vary: "x-forwarded-for, x-real-ip, cf-connecting-ip",
  });

  if (retryAfter) {
    headers.set("Retry-After", String(retryAfter));
  }

  return headers;
}

async function loadMaintenanceSnapshot(): Promise<MaintenanceSnapshot> {
  await connectDB();
  const settings = await getSettings();
  const mobileApp = resolveMobileAppSettings(settings.mobileApp);
  return {
    maintenance: normalizeMaintenanceSettings(
      settings.maintenance,
      settings.general?.storeName,
    ),
    storeName: settings.general?.storeName,
    storeEmail: settings.general?.storeEmail,
    logoUrl: settings.general?.logoUrl,
    faviconUrl: resolveFaviconUrl(settings.general?.faviconUrl),
    routing: resolveLocaleRouting(settings.general),
    mobileApp: {
      shopEnabled: mobileApp.shop.enabled,
      bizEnabled: mobileApp.biz.enabled,
    },
  };
}

/**
 * Single-flight refresh: concurrent callers share one settings fetch instead
 * of stampeding Mongo when the TTL lapses (React `cache()` inside
 * `getSettings` can't dedupe here — the proxy runs outside a request scope).
 */
function refreshMaintenanceSnapshot() {
  if (!maintenanceSnapshotRefresh) {
    const generation = snapshotGeneration;
    const refresh: Promise<MaintenanceSnapshot> = loadMaintenanceSnapshot()
      .then((value) => {
        // Read before the install was seen: answer the request that asked,
        // but never cache the store that no longer exists.
        if (generation === snapshotGeneration) {
          maintenanceSnapshotCache = {
            expiresAt: Date.now() + MAINTENANCE_SETTINGS_TTL_MS,
            value,
          };
        }
        return value;
      })
      .finally(() => {
        if (maintenanceSnapshotRefresh === refresh) {
          maintenanceSnapshotRefresh = undefined;
        }
      });
    maintenanceSnapshotRefresh = refresh;
  }

  return maintenanceSnapshotRefresh;
}

/**
 * Stale-while-revalidate: once warm, requests are served from the snapshot
 * synchronously — an expired entry answers immediately while one background
 * refresh runs, so the Mongo round trip never sits in a visitor's request
 * path. Only a cold process (or a failed first fetch) awaits the database;
 * a refresh failure keeps the last known snapshot and retries on the next
 * request, matching the proxy's fail-open catch below.
 */
async function getMaintenanceSnapshot() {
  const cached = maintenanceSnapshotCache;
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      refreshMaintenanceSnapshot().catch(() => {});
    }
    return cached.value;
  }

  return refreshMaintenanceSnapshot();
}

/**
 * The mobile API (`/api/mobile/*`), before its routes: a switched-off API
 * answers 404 for every path, and maintenance answers 503 to every method —
 * reads included, because an app has no maintenance page of its own to fall
 * back on. The rules are lib/api-core/gate.ts; this reads the settings for
 * them. When the settings cannot be read the request goes on, and the route
 * checks the switch itself.
 */
async function routeMobileApi(request: NextRequest) {
  let snapshot: MaintenanceSnapshot;
  try {
    snapshot = await getMaintenanceSnapshot();
  } catch {
    return passThrough(request);
  }

  const { maintenance } = snapshot;
  const answer = mobileGate({
    pathname: request.nextUrl.pathname,
    shopEnabled: snapshot.mobileApp.shopEnabled,
    bizEnabled: snapshot.mobileApp.bizEnabled,
    maintenance:
      maintenance.enabled &&
      !isAllowedMaintenanceIp(getClientIp(request), maintenance.allowedIPs)
        ? {
            title: maintenance.title,
            message: maintenance.message,
            backgroundImageUrl: maintenance.backgroundImageUrl,
            countdownEnabled: maintenance.countdownEnabled,
            countdownEndsAt: maintenance.countdownEndsAt,
            retryAfterSeconds: maintenance.retryAfterSeconds,
          }
        : null,
    requestId: crypto.randomUUID(),
  });
  if (!answer) return passThrough(request);

  const headers =
    answer.status === 503
      ? createMaintenanceHeaders(maintenance.retryAfterSeconds)
      : new Headers({ "Cache-Control": "no-store" });
  for (const [name, value] of Object.entries(answer.headers)) headers.set(name, value);
  if (answer.body.requestId) headers.set("X-Request-Id", answer.body.requestId);
  return NextResponse.json(answer.body, { status: answer.status, headers });
}

/**
 * A bare `NextResponse.next()` hands the route the *original* request —
 * including any client-sent x-request-path — because header mutations only
 * reach handlers when re-attached via the `request` option (next-intl does
 * this internally for the page paths). Every pass-through goes here so the
 * stamped value is the one downstream code sees, on API routes too.
 */
function passThrough(request: NextRequest) {
  return NextResponse.next({ request: { headers: request.headers } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Stamp the URL the visitor asked for so server-side auth guards can send
  // them back here after login. `set` also overwrites any client-supplied
  // value; passThrough/next-intl forward the mutated headers downstream.
  request.headers.set(
    REQUEST_PATH_HEADER,
    `${pathname}${request.nextUrl.search}`,
  );
  // The client's address, read from the right of the proxy chain. Better Auth
  // takes it from this header (its sign-in limit keys on it), and the
  // maintenance allow-list below checks it; a client-sent value is replaced.
  stampClientIp(request.headers);

  // Before the static-file test below, which would let a dotted mobile path
  // (`/products/a.b`) walk past the mobile API's maintenance and switch.
  if (isMobileApiPath(pathname)) return routeMobileApi(request);

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vercel/") ||
    (STATIC_FILE_PATTERN.test(pathname) &&
      !SIGNED_LINK_PAGE_PATTERN.test(pathname)) ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/favicon.ico"
  ) {
    return passThrough(request);
  }

  if (
    pathname.startsWith("/api/") &&
    shouldBypassMaintenanceApi(pathname, request.method)
  ) {
    return passThrough(request);
  }

  // Before maintenance: an unconfigured store has default settings, so the
  // maintenance flag there says nothing about intent. APIs are untouched —
  // /api/install/* is how the wizard finishes.
  if (!pathname.startsWith("/api/")) {
    const toInstaller = await routeUninstalled(request);
    if (toInstaller) return toInstaller;
  }

  try {
    const snapshot = await getMaintenanceSnapshot();
    const maintenance = snapshot.maintenance;

    if (!maintenance.enabled) {
      return pathname.startsWith("/api/")
        ? passThrough(request)
        : routeLocalizedPage(request, snapshot.routing);
    }

    if (isAllowedMaintenanceIp(getClientIp(request), maintenance.allowedIPs)) {
      return pathname.startsWith("/api/")
        ? passThrough(request)
        : routeLocalizedPage(request, snapshot.routing);
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          code: "STORE_MAINTENANCE",
          message: maintenance.message,
          data: {
            title: maintenance.title,
            message: maintenance.message,
            backgroundImageUrl: maintenance.backgroundImageUrl,
            countdownEnabled: maintenance.countdownEnabled,
            countdownEndsAt: maintenance.countdownEndsAt,
          },
        },
        {
          status: 503,
          headers: createMaintenanceHeaders(maintenance.retryAfterSeconds),
        },
      );
    }

    const normalizedPath = stripLocalePrefix(pathname);
    if (matchesPrefix(normalizedPath, PAGE_BYPASS_PREFIXES)) {
      return routeLocalizedPage(request, snapshot.routing);
    }

    const html = buildMaintenanceHtml({
      lang: getLocaleFromPathname(pathname, snapshot.routing.storeDefault),
      storeName: snapshot.storeName,
      storeEmail: snapshot.storeEmail,
      logoUrl: snapshot.logoUrl,
      faviconUrl: snapshot.faviconUrl,
      backgroundImageUrl: maintenance.backgroundImageUrl,
      title: maintenance.title,
      message: maintenance.message,
      countdownEndsAt: maintenance.countdownEnabled
        ? maintenance.countdownEndsAt
        : undefined,
    });

    const headers = createMaintenanceHeaders(maintenance.retryAfterSeconds);
    headers.set("Content-Type", "text/html; charset=utf-8");

    return new NextResponse(html, {
      status: 503,
      headers,
    });
  } catch {
    return pathname.startsWith("/api/")
      ? passThrough(request)
      : routeLocalizedPage(request, FALLBACK_PROXY_ROUTING);
  }
}

export const config = {
  // /api/upload is excluded: the proxy does nothing for it (uploads bypass the
  // maintenance check), but requests matched here get their body capped at
  // Next's proxyClientMaxBodySize default of 10MB — which truncated larger
  // uploads and surfaced as "Failed to parse body as FormData".
  //
  // /api/auth is listed on its own because the first pattern skips any path
  // with a dot in it, and Better Auth believes CLIENT_IP_HEADER only because
  // every auth request comes through here to have a client-sent one replaced.
  // /api/mobile for the same reason, and because its maintenance and on/off
  // answers are given here: `/products/a.b` must not walk past them.
  matcher: [
    "/((?!_next|_vercel|api/upload|.*\\..*).*)",
    "/",
    "/api/auth/:path*",
    "/api/mobile/:path*",
    // The signed-link pages, whose token holds a dot (SIGNED_LINK_PAGE_PATTERN).
    "/order/:path*",
    "/pre-order/:path*",
    "/:locale/order/:path*",
    "/:locale/pre-order/:path*",
  ],
};
