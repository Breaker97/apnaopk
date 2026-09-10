import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { resolveFaviconUrl } from "@/config/branding.config";
import { connectDB } from "@/lib/db";
import { defaultLocale, locales } from "@/config/i18n.config";
import { USER_ROLES } from "@/config/app.config";
import { isInstallLocked } from "@/lib/install/payload";
import { User } from "@/models/user.model";
import { REQUEST_PATH_HEADER } from "@/lib/auth/return-path";
import {
  buildMaintenanceHtml,
  isAllowedMaintenanceIp,
  normalizeMaintenanceSettings,
} from "@/lib/maintenance";
import { getSettings, Settings } from "@/models/settings.model";

const intlProxy = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: "always",
});

const STATIC_FILE_PATTERN = /\.[^/]+$/;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PAGE_BYPASS_PREFIXES = ["/admin", "/login", "/role-redirect", "/forbidden"];
const API_BYPASS_PREFIXES = [
  "/api/admin",
  "/api/vendor",
  "/api/auth",
  "/api/payments/webhook",
  "/api/payments/paypal/capture",
  "/api/payments/verify",
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
  defaultLanguage?: string;
};

let maintenanceSnapshotCache:
  | {
      expiresAt: number;
      value: MaintenanceSnapshot;
    }
  | undefined;
let maintenanceSnapshotRefresh: Promise<MaintenanceSnapshot> | undefined;

function stripLocalePrefix(pathname: string) {
  const segments = pathname.split("/");
  const maybeLocale = segments[1];

  if (maybeLocale && locales.includes(maybeLocale as (typeof locales)[number])) {
    const stripped = `/${segments.slice(2).join("/")}`;
    return stripped === "/" ? "/" : stripped.replace(/\/+$/, "") || "/";
  }

  return pathname === "/" ? "/" : pathname.replace(/\/+$/, "") || "/";
}

function getLocaleFromPathname(pathname: string) {
  const candidate = pathname.split("/")[1];
  return candidate && locales.includes(candidate as (typeof locales)[number])
    ? candidate
    : defaultLocale;
}

/**
 * Routes a page request through the next-intl proxy, first honoring the
 * admin-configured default language (settings.general.defaultLanguage) for
 * first-time visitors: a locale-less URL with no NEXT_LOCALE cookie redirects
 * to the configured locale instead of the hardcoded build default. Returning
 * visitors keep their own choice — next-intl persists it in NEXT_LOCALE when
 * they navigate to another locale.
 */
function routeLocalizedPage(request: NextRequest, defaultLanguage?: string) {
  const { pathname } = request.nextUrl;
  const hasLocalePrefix = locales.includes(
    pathname.split("/")[1] as (typeof locales)[number],
  );

  if (!hasLocalePrefix && !request.cookies.get("NEXT_LOCALE")) {
    const configured = String(defaultLanguage || "").toLowerCase();
    if (
      configured !== defaultLocale &&
      locales.includes(configured as (typeof locales)[number])
    ) {
      const url = request.nextUrl.clone();
      url.pathname = pathname === "/" ? `/${configured}` : `/${configured}${pathname}`;
      return NextResponse.redirect(url);
    }
  }

  return intlProxy(request);
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
 */
let installLocked = false;

async function isStoreInstalled(): Promise<boolean> {
  if (installLocked) return true;

  await connectDB();
  // Two projected reads, not `getSettings()`: that one upserts the singleton,
  // and this runs on every page request until the store is set up.
  const [adminExists, settings] = await Promise.all([
    User.exists({ role: USER_ROLES.ADMIN }),
    Settings.findOne({})
      .select("installedAt")
      .lean<{ installedAt?: Date } | null>(),
  ]);

  installLocked = isInstallLocked({
    adminExists: Boolean(adminExists),
    installedAt: settings?.installedAt ?? null,
  });
  return installLocked;
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

  const url = request.nextUrl.clone();
  url.pathname = `/${getLocaleFromPathname(pathname)}/install`;
  url.search = "";
  return NextResponse.redirect(url);
}

function getClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    null
  );
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
  return {
    maintenance: normalizeMaintenanceSettings(
      settings.maintenance,
      settings.general?.storeName,
    ),
    storeName: settings.general?.storeName,
    storeEmail: settings.general?.storeEmail,
    logoUrl: settings.general?.logoUrl,
    faviconUrl: resolveFaviconUrl(settings.general?.faviconUrl),
    defaultLanguage: settings.general?.defaultLanguage,
  };
}

/**
 * Single-flight refresh: concurrent callers share one settings fetch instead
 * of stampeding Mongo when the TTL lapses (React `cache()` inside
 * `getSettings` can't dedupe here — the proxy runs outside a request scope).
 */
function refreshMaintenanceSnapshot() {
  if (!maintenanceSnapshotRefresh) {
    maintenanceSnapshotRefresh = loadMaintenanceSnapshot()
      .then((value) => {
        maintenanceSnapshotCache = {
          expiresAt: Date.now() + MAINTENANCE_SETTINGS_TTL_MS,
          value,
        };
        return value;
      })
      .finally(() => {
        maintenanceSnapshotRefresh = undefined;
      });
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

  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/_vercel/") ||
    STATIC_FILE_PATTERN.test(pathname) ||
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
        : routeLocalizedPage(request, snapshot.defaultLanguage);
    }

    if (isAllowedMaintenanceIp(getClientIp(request), maintenance.allowedIPs)) {
      return pathname.startsWith("/api/")
        ? passThrough(request)
        : routeLocalizedPage(request, snapshot.defaultLanguage);
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
      return intlProxy(request);
    }

    const html = buildMaintenanceHtml({
      lang: getLocaleFromPathname(pathname),
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
      : intlProxy(request);
  }
}

export const config = {
  // /api/upload is excluded: the proxy does nothing for it (uploads bypass the
  // maintenance check), but requests matched here get their body capped at
  // Next's proxyClientMaxBodySize default of 10MB — which truncated larger
  // uploads and surfaced as "Failed to parse body as FormData".
  matcher: ["/((?!_next|_vercel|api/upload|.*\\..*).*)", "/"],
};
