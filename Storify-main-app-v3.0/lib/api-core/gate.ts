import type { MaintenanceDetails } from "@/contracts/mobile/shop/v1/common";
import {
  MobileApiError,
  routeNotFoundError,
  toErrorPayload,
  type ErrorPayload,
} from "./errors";

/**
 * What the proxy (proxy.ts) decides for `/api/mobile/*` before any route
 * runs. It is the only place every request passes, whatever its method and
 * whether its answer comes from a cache, so two rules live here:
 *
 * 1. an app whose API is switched off gets 404 ROUTE_NOT_FOUND, the answer
 *    for a path that does not exist, maintenance or not;
 * 2. maintenance answers the shopper app's API 503 STORE_MAINTENANCE to
 *    every request, reads included (the web API lets reads through; the app
 *    has no page to show instead), except from the store's allow-listed
 *    addresses, with the maintenance facts under `details`. The business
 *    app's API (`/api/mobile/biz`) is let through: maintenance closes the
 *    store to shoppers, not to the people running it, as the website's
 *    `/api/admin` and `/api/vendor` keep working (proxy.ts).
 *
 * The routes check the switch again (lib/api-core/pipeline.ts), with the
 * locale: the proxy's settings are up to fifteen seconds old, and it lets
 * requests through when it cannot read them at all. The locale is left to
 * the routes alone, so a language switched on is served the moment the
 * setting is saved.
 */

const MOBILE_API_PREFIX = "/api/mobile";

export function isMobileApiPath(pathname: string): boolean {
  return pathname === MOBILE_API_PREFIX || pathname.startsWith(`${MOBILE_API_PREFIX}/`);
}

interface MobileGateInput {
  pathname: string;
  shopEnabled: boolean;
  bizEnabled: boolean;
  /** The maintenance facts when maintenance applies to this caller, else null. */
  maintenance: (MaintenanceDetails & { retryAfterSeconds?: number }) | null;
  requestId: string;
}

function omitEmpty(details: MaintenanceDetails): MaintenanceDetails {
  return Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== ""),
  ) as MaintenanceDetails;
}

/** The answer the proxy gives instead of the route, or null to let it through. */
export function mobileGate(input: MobileGateInput): ErrorPayload | null {
  const { pathname, requestId } = input;
  if (!isMobileApiPath(pathname)) return null;
  const namespace = pathname.split("/")[3];
  const payload = (error: MobileApiError) =>
    toErrorPayload(error, { requestId, log: () => {} });

  const enabled = namespace === "biz" ? input.bizEnabled : input.shopEnabled;
  if (!enabled) return payload(routeNotFoundError());

  if (input.maintenance && namespace !== "biz") {
    const { retryAfterSeconds, ...facts } = input.maintenance;
    return payload(
      new MobileApiError(
        503,
        "STORE_MAINTENANCE",
        facts.message || "The store is down for maintenance.",
        {
          details: omitEmpty(facts),
          ...(retryAfterSeconds ? { headers: { "Retry-After": String(retryAfterSeconds) } } : {}),
        },
      ),
    );
  }
  return null;
}
