import { randomUUID } from "node:crypto";
import { routeNotFoundError, toErrorPayload } from "@/lib/api-core/errors";
import { ERROR_CACHE_CONTROL, jsonResponse, requestIdHeader } from "@/lib/api-core/http";
import {
  runBizRoute,
  runBizStaticRoute,
  runRoute,
  runStaticRoute,
} from "@/lib/api-core/pipeline";
import type {
  BizPrivateRouteEntry,
  BizRouteEntry,
  BizStaticRouteEntry,
  PrivateRouteEntry,
  PublicRouteEntry,
  RouteEntry,
  StaticRouteEntry,
} from "@/lib/api-core/registry";
import { nextBizPipelineDeps, nextPipelineDeps } from "./ports";

/**
 * The Next route wrappers of the mobile API: a route file hands its registry
 * entry to one of these and exports the result.
 *
 * Static (ISR), one route file per endpoint, GET and nothing else:
 *
 * ```ts
 * // app/api/mobile/shop/v1/[locale]/config/route.ts
 * import { staticGet } from "@/lib/api-next/routes";
 * import { configRoute } from "@/lib/api-core/shop/config/config";
 *
 * export const revalidate = 60;  // a literal, equal to the entry's cache.revalidate
 * export async function generateStaticParams() {
 *   return [];
 * }
 * export const GET = staticGet(configRoute);
 * ```
 *
 * To run a static route per request instead (ISR is an optimisation, never
 * a dependency), add
 * `export const dynamic = "force-dynamic";` and swap `staticGet` for
 * `publicGet`; its answer stays the same, and gains 304s and a request id.
 *
 * Public and private routes export no `revalidate` and no
 * `generateStaticParams`: `export const GET = publicGet(entry)`,
 * `export const PUT = privateRoute(entry)`. A static route never shares its
 * file with another method: Next answers every method of such a file with a
 * 500.
 *
 * The business app's routes (`/api/mobile/biz/v1/[locale]/…`) take its own
 * two: `bizStaticGet` (GET /config, the same file shape as `staticGet`) and
 * `bizPrivateRoute` for every other method of every other route. It has no
 * public routes: everything but GET /config is one operator's.
 */

type NextRouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>;
};

export type MobileRouteWrapper = "static" | "public" | "private";

export type MobileRouteHandler = ((
  request: Request,
  context: NextRouteContext,
) => Promise<Response>) & {
  /** Read by the registry tests: which entry this export serves, and how. */
  readonly entry: RouteEntry | BizRouteEntry;
  readonly wrapper: MobileRouteWrapper;
};

function tagged(
  handler: (request: Request, context: NextRouteContext) => Promise<Response>,
  entry: RouteEntry | BizRouteEntry,
  wrapper: MobileRouteWrapper,
): MobileRouteHandler {
  return Object.assign(handler, { entry, wrapper });
}

function assertCache(entry: RouteEntry | BizRouteEntry, kinds: string[], wrapper: string): void {
  if (!kinds.includes(entry.cache.kind)) {
    throw new Error(`${wrapper}(${entry.id}): the entry's cache is "${entry.cache.kind}".`);
  }
}

/** An ISR route: its handler sees the path only. */
export function staticGet(entry: StaticRouteEntry): MobileRouteHandler {
  assertCache(entry, ["static"], "staticGet");
  return tagged(
    async (_request, context) => runStaticRoute(entry, await context.params, nextPipelineDeps),
    entry,
    "static",
  );
}

/**
 * A read that is the same for everybody, answered per request. Also takes a
 * static entry, for a static route switched to per-request.
 */
export function publicGet(entry: PublicRouteEntry | StaticRouteEntry): MobileRouteHandler {
  assertCache(entry, ["public", "static"], "publicGet");
  return tagged(
    async (request, context) => runRoute(entry, request, await context.params, nextPipelineDeps),
    entry,
    "public",
  );
}

/** One shopper's read, or any write. */
export function privateRoute(entry: PrivateRouteEntry): MobileRouteHandler {
  assertCache(entry, ["private"], "privateRoute");
  return tagged(
    async (request, context) => runRoute(entry, request, await context.params, nextPipelineDeps),
    entry,
    "private",
  );
}

/** The business app's GET /config: an ISR route, its handler sees the path only. */
export function bizStaticGet(entry: BizStaticRouteEntry): MobileRouteHandler {
  assertCache(entry, ["static"], "bizStaticGet");
  return tagged(
    async (_request, context) => runBizStaticRoute(entry, await context.params, nextPipelineDeps),
    entry,
    "static",
  );
}

/** Every other business-app route and method: one operator's, never stored. */
export function bizPrivateRoute(entry: BizPrivateRouteEntry): MobileRouteHandler {
  assertCache(entry, ["private"], "bizPrivateRoute");
  return tagged(
    async (request, context) => runBizRoute(entry, request, await context.params, nextBizPipelineDeps),
    entry,
    "private",
  );
}

/**
 * Every path under /api/mobile that no route claims
 * (app/api/mobile/[...rest]/route.ts): the contract's JSON 404 rather than
 * the storefront's "page not found".
 */
export async function mobileRouteNotFound(): Promise<Response> {
  const requestId = randomUUID();
  const payload = toErrorPayload(routeNotFoundError(), {
    requestId,
    log: nextPipelineDeps.log,
  });
  return jsonResponse(payload.status, JSON.stringify(payload.body), {
    "Cache-Control": ERROR_CACHE_CONTROL,
    ...requestIdHeader(requestId),
  });
}
