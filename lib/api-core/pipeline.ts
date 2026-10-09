import { createHash, randomUUID } from "node:crypto";
import { REQUEST_HEADERS as BIZ_REQUEST_HEADERS } from "@/contracts/mobile/biz/v1/common";
import { DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import {
  isBelowMinVersion,
  mobileAppReleaseFor,
  type MobileBizAppSettings,
  type MobileShopAppSettings,
} from "@/lib/settings/mobile-app";
import { assertGrantAllows, chooseWorkspace, workspaceNotAvailable } from "./biz/access";
import type { BizActor, BizWorkspaceGrant } from "./biz/actor";
import { scopeOf, type BizScope } from "./biz/scope";
import { readClientInfo, type ClientInfo } from "./client-info";
import {
  KNOWN_ERROR_CODES,
  MobileApiError,
  emailNotVerifiedError,
  localeNotAvailableError,
  routeNotFoundError,
  toErrorPayload,
} from "./errors";
import {
  ERROR_CACHE_CONTROL,
  FileBody,
  cacheControlFor,
  computeEtag,
  fileResponse,
  ifNoneMatchMatches,
  jsonResponse,
  notModifiedResponse,
  requestIdHeader,
} from "./http";
import { parseInput, queryToInput, readFormBody, readJsonBody } from "./input";
import type {
  BizPipelineDeps,
  LocaleRouting,
  MobileRuntimeSettings,
  MobileSession,
  PipelineDeps,
  StoredResponse,
} from "./ports";
import { enforceRateLimit } from "./rate-limit";
import {
  isWrite,
  type BizRouteEntry,
  type BizStaticRouteEntry,
  type DemoPolicy,
  type RouteEntry,
  type StaticRouteEntry,
} from "./registry";

/**
 * The request pipeline, framework-free. The Next route wrappers
 * (lib/api-next/routes.ts) call one of the two runners below.
 *
 * A request to a route that runs per request goes, in order, through:
 *  1. the API switched on (Settings → Mobile app), else 404 ROUTE_NOT_FOUND:
 *     a switched-off API does not admit it exists;
 *  2. the locale in the path served by the store, else 404
 *     LOCALE_NOT_AVAILABLE with the locales it does serve;
 *  3. a request id, on the response and in every error;
 *  4. the app's version, on writes: below the store's minimum is 426
 *     APP_UPDATE_REQUIRED (reads go on, so the update screen can load);
 *  5. the input (query or JSON body) against the contract, else 400;
 *  6. the session, only for routes that name one (never for a cached route),
 *     and 401 where a shopper is required, or 403 EMAIL_NOT_VERIFIED for one
 *     the store holds back until their email address is verified (a route a
 *     guest may use takes them as a guest meanwhile);
 *  7. the demo-mode policy, 403;
 *  8. the rate limit, 429;
 *  9. idempotency, where the route requires a key;
 * 10. the entry's cheap validator, where it has one: a 304 without running
 *     the handler;
 * 11. the handler;
 * 12. its answer against the contract (development and tests);
 * 13. the envelope, with ETag and Cache-Control, or a 304; or, for a file
 *     (an invoice), the file itself.
 * Any failure becomes the contract's error envelope.
 *
 * One pipeline serves both apps (PLAN §3.2), each through its profile:
 * - the shopper app (`runRoute`, `runStaticRoute`): `mobileApp.shop`, the
 *   shopper app's sessions;
 * - the business app (`runBizRoute`, `runBizStaticRoute`): `mobileApp.biz`,
 *   the business app's sessions, and after step 6 the operator: who they are
 *   (read fresh), the workspace the request is for (`X-Workspace`) and the
 *   route's permission there (./biz/access.ts), refused with 403
 *   WORKSPACE_NOT_AVAILABLE, VENDOR_NOT_ACTIVE or AUTHORIZATION_ERROR; a
 *   seller-only route on a store without sellers is 404. Its rate limits are
 *   counted under the admin's or the vendors' presets. The handler gets the
 *   operator, the workspace and the scope with the rest.
 *
 * Maintenance is not here: the proxy answers it before any route runs
 * (proxy.ts), for every method, cached routes included; the business app is
 * let through, as the website's dashboards are.
 */

type AppName = "shop" | "biz";

/** The settings of one app that the pipeline itself reads. */
type AppSettings = MobileShopAppSettings | MobileBizAppSettings;

function appSettings(app: AppName, runtime: MobileRuntimeSettings): AppSettings {
  return app === "biz" ? runtime.mobileApp.biz : runtime.mobileApp.shop;
}

/** What the business app's handler gets on top of the shop's context. */
interface BizAccess {
  actor: BizActor;
  workspace: BizWorkspaceGrant | null;
  scope: BizScope | null;
}

type RawParams = Record<string, string | string[] | undefined>;

/** The locale and the entry's own path parameters, from Next's params. */
function splitParams(entry: RouteEntry | BizRouteEntry, raw: RawParams) {
  const locale = raw.locale;
  if (typeof locale !== "string" || !locale) throw routeNotFoundError();
  const params: Record<string, string> = {};
  for (const [, name] of entry.path.matchAll(/\{([^}]+)\}/g)) {
    const value = raw[name];
    if (typeof value !== "string" || !value) throw routeNotFoundError();
    params[name] = value;
  }
  return { locale, params };
}

function assertLocaleServed(locale: string, routing: LocaleRouting): void {
  if (!routing.enabled.includes(locale)) throw localeNotAvailableError(routing);
}

function assertAppVersion(client: ClientInfo, app: AppSettings): void {
  if (!client.platform || !client.appVersion) return;
  const release = mobileAppReleaseFor(app, client.platform);
  if (!release.minVersion || !isBelowMinVersion(client.appVersion, release.minVersion)) return;
  throw new MobileApiError(
    426,
    "APP_UPDATE_REQUIRED",
    "This version of the app is no longer supported. Update it to continue.",
    {
      details: {
        minVersion: release.minVersion,
        ...(release.storeUrl ? { storeUrl: release.storeUrl } : {}),
      },
    },
  );
}

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isDemoRefused(policy: DemoPolicy, method: string): boolean {
  if (policy === "allow") return false;
  if (policy === "block-mutations") return WRITES.has(method);
  return method === "DELETE";
}

function assertOutput(entry: RouteEntry | BizRouteEntry, data: unknown): void {
  const parsed = entry.output.safeParse(data);
  if (parsed.success) return;
  const issues = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  throw new Error(`${entry.id} answered outside its contract: ${issues}`);
}

function successBody(data: unknown): string {
  return JSON.stringify({ success: true, data });
}

/**
 * Whose request an idempotency key belongs to. Exported for an endpoint that
 * stamps what it creates with its key (POST /checkout/orders).
 */
export function idempotencyScope(session: MobileSession | null, client: ClientInfo): string {
  if (session) return `user:${session.user.id}`;
  if (client.cartToken) return `cart:${client.cartToken}`;
  if (client.installId) return `install:${client.installId}`;
  throw new MobileApiError(400, "VALIDATION_ERROR", "This request needs an X-Install-Id or X-Cart-Token header.", {
    errors: { "X-Install-Id": ["Send the app's install id."] },
  });
}

/**
 * The business app's step after the session: the operator, the workspace the
 * request is for, and the route's permission in it.
 */
async function authorizeBiz(
  entry: BizRouteEntry,
  session: MobileSession,
  headers: Headers,
  runtime: MobileRuntimeSettings,
  deps: BizPipelineDeps,
): Promise<BizAccess> {
  const mode = entry.workspace;
  const permission = entry.permission;
  if (!mode || !permission) throw new Error(`${entry.id} declares no workspace or permission.`);
  const actor = await deps.actor.resolve(session, runtime.marketplace);
  // An account that runs nothing (a shopper, a seller demoted by a
  // suspension) holds a business session only from before the change.
  if (actor.role === null) throw workspaceNotAvailable(actor);
  const workspace = chooseWorkspace(actor, mode, headers.get(BIZ_REQUEST_HEADERS.workspace));
  if (mode !== "account" && workspace) assertGrantAllows(workspace, permission);
  return { actor, workspace, scope: workspace ? scopeOf(workspace) : null };
}

/** The rate-limit area an operator is counted under: the vendors', or the store team's. */
function operatorArea(access: BizAccess): "admin" | "vendor" {
  const workspace = access.workspace?.workspace;
  if (workspace) return workspace === "vendor" ? "vendor" : "admin";
  return access.actor.role === "vendor" ? "vendor" : "admin";
}

/** Runs a route of either app that answers per request. */
async function runPerRequest(
  app: AppName,
  entry: RouteEntry | BizRouteEntry,
  request: Request,
  rawParams: RawParams,
  deps: PipelineDeps | BizPipelineDeps,
): Promise<Response> {
  const requestId = randomUUID();
  try {
    const { locale, params } = splitParams(entry, rawParams);
    const runtime = await deps.settings.runtime();
    const settings = appSettings(app, runtime);
    if (!settings.enabled) throw routeNotFoundError();
    assertLocaleServed(locale, runtime.routing);
    if (
      app === "biz" &&
      ((entry as BizRouteEntry).workspace === "vendor" || (entry as BizRouteEntry).multiVendorOnly) &&
      !runtime.marketplace.multiVendor
    ) {
      // A store without sellers has no seller routes at all.
      throw routeNotFoundError();
    }

    const client = readClientInfo(request.headers);
    if (isWrite(entry.method)) assertAppVersion(client, settings);

    let input: unknown;
    if (entry.form) {
      const raw = await readFormBody(request, entry.form.maxBytes);
      input = entry.input ? parseInput(entry.input, raw) : raw;
    } else if (entry.input) {
      const raw =
        entry.method === "GET"
          ? queryToInput(entry.input, new URL(request.url).searchParams)
          : await readJsonBody(request);
      input = parseInput(entry.input, raw);
    }

    let session: MobileSession | null = null;
    if (entry.auth !== "none") {
      const resolved = await deps.session.resolve(request.headers);
      session = resolved.session;
      if (entry.auth === "user" && !session) {
        throw resolved.held === "EMAIL_NOT_VERIFIED"
          ? emailNotVerifiedError()
          : new MobileApiError(401, "AUTHENTICATION_ERROR", "Sign in to continue.");
      }
    }

    const access =
      app === "biz" && session
        ? await authorizeBiz(entry as BizRouteEntry, session, request.headers, runtime, deps as BizPipelineDeps)
        : undefined;

    if (deps.demoMode() && isDemoRefused(entry.demo ?? "default", entry.method)) {
      throw new MobileApiError(403, "DEMO_MODE_READ_ONLY", DEMO_MODE_MESSAGE);
    }

    if (entry.rateLimit) {
      await enforceRateLimit({
        policy: entry.rateLimit,
        store: entry.cache.kind === "private" ? "shared" : "memory",
        session,
        client,
        port: deps.rateLimit,
        ...(access ? { operator: { area: operatorArea(access) } } : {}),
      });
    }

    const context = {
      input,
      params,
      locale,
      session,
      client,
      requestId,
      mobileApp: settings,
      defer: deps.defer,
      ...access,
    };
    const handle = entry.handler as (ctx: typeof context) => Promise<unknown>;

    // A cheap version of the answer, compared before any of the work: most
    // revalidations find nothing new, and then the handler never runs.
    let version: string | undefined;
    if (entry.validator) {
      const validate = entry.validator as (ctx: typeof context) => Promise<unknown>;
      version = computeEtag(
        JSON.stringify({
          route: entry.id,
          locale,
          params,
          input: input ?? null,
          user: session?.user.id ?? null,
          // The same person sees another answer in another workspace.
          ...(access ? { workspace: access.workspace?.workspace ?? null } : {}),
          version: await validate(context),
        }),
      );
      if (ifNoneMatchMatches(request.headers.get("if-none-match"), version)) {
        return notModifiedResponse({
          "Cache-Control": cacheControlFor(entry.cache),
          ...requestIdHeader(requestId),
          ETag: version,
        });
      }
    }

    const entityTag = app === "biz" ? (entry as BizRouteEntry).entityTag : undefined;
    const toStored = (data: unknown): StoredResponse => {
      if (deps.validateOutput) assertOutput(entry, data);
      return {
        status: entry.status ?? 200,
        body: successBody(data),
        // The answer's own version, for a later If-Match (registry.ts, `entityTag`).
        headers: entityTag ? { ETag: `"${entityTag(data)}"` } : {},
      };
    };
    const execute = async (): Promise<StoredResponse> => toStored(await handle(context));

    let result: StoredResponse;
    if (entry.idempotency === "required") {
      if (!client.idempotencyKey) {
        throw new MobileApiError(400, "VALIDATION_ERROR", "Send a UUID in the Idempotency-Key header.", {
          errors: { "Idempotency-Key": ["Send a UUID in the Idempotency-Key header."] },
        });
      }
      const durable = app === "biz" && (entry as BizRouteEntry).durable;
      if (durable) {
        // Domain receipts retain uncertain outcomes indefinitely and authorize
        // their result records afresh. An HTTP cache must not bypass either.
        result = await execute();
      } else {
          if (!deps.idempotency) throw new Error(`${entry.id} requires an idempotency store, and none is set up.`);
          const workspaceIdentity = access?.workspace
            ? access.workspace.workspace === "vendor" ? `vendor:${access.workspace.vendor.id}` : "platform"
            : "account";
          result = await deps.idempotency.run(
            {
              scope: app === "biz" ? `biz:${idempotencyScope(session, client)}:${workspaceIdentity}` : idempotencyScope(session, client),
              key: client.idempotencyKey,
              routeId: entry.id,
              // Workspace and target are part of the request, so a cached
              // response never crosses into another workspace or record.
              requestHash: createHash("sha256")
                .update(JSON.stringify(app === "biz" ? { workspace: workspaceIdentity, params, input: input ?? null } : Object.keys(params).length > 0 ? { params, input: input ?? null } : (input ?? null)))
                .digest("hex"),
            },
            execute,
          );
      }
    } else {
      const data = await handle(context);
      if (data instanceof FileBody) {
        if (deps.validateOutput) assertOutput(entry, data);
        return fileResponse(data, {
          "Cache-Control": cacheControlFor(entry.cache),
          ...requestIdHeader(requestId),
        });
      }
      result = toStored(data);
    }

    const headers: Record<string, string> = {
      "Cache-Control": cacheControlFor(entry.cache),
      ...requestIdHeader(requestId),
      ...result.headers,
    };
    if ((version || entry.etag || entry.cache.kind === "static") && result.status === 200) {
      headers.ETag = version ?? computeEtag(result.body);
      if (ifNoneMatchMatches(request.headers.get("if-none-match"), headers.ETag)) {
        return notModifiedResponse(headers);
      }
    }
    return jsonResponse(result.status, result.body, headers);
  } catch (error) {
    const payload = toErrorPayload(error, {
      requestId,
      reasons: entry.reasons,
      codes: KNOWN_ERROR_CODES[app],
      log: deps.log,
    });
    return jsonResponse(payload.status, JSON.stringify(payload.body), {
      "Cache-Control": ERROR_CACHE_CONTROL,
      ...requestIdHeader(requestId),
      ...payload.headers,
    });
  }
}

/**
 * Runs a shopper-app route that answers per request (`public` or `private`,
 * or a `static` route switched to per-request by its wrapper).
 */
export async function runRoute(
  entry: RouteEntry,
  request: Request,
  rawParams: RawParams,
  deps: PipelineDeps,
): Promise<Response> {
  return runPerRequest("shop", entry, request, rawParams, deps);
}

/** Runs a business-app route that answers per request (every one but GET /config). */
export async function runBizRoute(
  entry: BizRouteEntry,
  request: Request,
  rawParams: RawParams,
  deps: BizPipelineDeps,
): Promise<Response> {
  return runPerRequest("biz", entry, request, rawParams, deps);
}

/**
 * Runs a static route's handler, as Next does when its cached answer is cold
 * or was expired by a tag. It sees the path and nothing else of the request:
 * reading a header, a cookie or the query makes Next answer every request
 * with a 500. So there is no session, no request id, no rate limit and no
 * version gate here, and the answer is the same for everybody who asks for
 * this path.
 *
 * Only a refusal (4xx) is answered here, as the contract's JSON; the cache
 * handler (cache-handler.cjs) never keeps one. Anything else is thrown on:
 * Next answers a plain 500 and keeps serving the last good answer while it
 * retries, where a JSON 5xx would have been stored as the answer itself.
 */
async function runStatic(
  app: AppName,
  entry: StaticRouteEntry | BizStaticRouteEntry,
  rawParams: RawParams,
  deps: PipelineDeps,
): Promise<Response> {
  try {
    const { locale, params } = splitParams(entry, rawParams);
    const runtime = await deps.settings.runtime();
    const settings = appSettings(app, runtime);
    if (!settings.enabled) throw routeNotFoundError();
    assertLocaleServed(locale, runtime.routing);

    const handle = entry.handler as unknown as (ctx: Record<string, unknown>) => Promise<unknown>;
    const data = await handle({
      input: undefined,
      params,
      locale,
      session: null,
      client: {},
      mobileApp: settings,
      defer: deps.defer,
    });
    if (deps.validateOutput) assertOutput(entry, data);
    const body = successBody(data);
    return jsonResponse(200, body, {
      "Cache-Control": cacheControlFor(entry.cache),
      ETag: computeEtag(body),
    });
  } catch (error) {
    const payload = toErrorPayload(error, {
      reasons: entry.reasons,
      codes: KNOWN_ERROR_CODES[app],
      log: deps.log,
    });
    if (payload.status < 400 || payload.status >= 500) throw error;
    return jsonResponse(payload.status, JSON.stringify(payload.body), {
      "Cache-Control": ERROR_CACHE_CONTROL,
      ...payload.headers,
    });
  }
}

/** A shopper-app static route (above). */
export async function runStaticRoute(
  entry: StaticRouteEntry,
  rawParams: RawParams,
  deps: PipelineDeps,
): Promise<Response> {
  return runStatic("shop", entry, rawParams, deps);
}

/** The business app's static route (GET /config), the same way. */
export async function runBizStaticRoute(
  entry: BizStaticRouteEntry,
  rawParams: RawParams,
  deps: PipelineDeps,
): Promise<Response> {
  return runStatic("biz", entry, rawParams, deps);
}
