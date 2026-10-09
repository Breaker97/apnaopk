import type * as z from "zod";
import type { MobileBizAppSettings, MobileShopAppSettings } from "@/lib/settings/mobile-app";
import type { BizPermission, BizWorkspaceMode } from "./biz/access";
import type { BizActor, BizWorkspaceGrant, PlatformGrant, VendorGrant } from "./biz/actor";
import type { BizScope } from "./biz/scope";
import type { ClientInfo } from "./client-info";
import type { MobileSession } from "./ports";

/**
 * The route registry: one entry per endpoint of the mobile API, holding its
 * whole policy next to its handler.
 *
 * An entry is the manifest the tests read (tests/mobile-api/registry-policy),
 * and what a Next route file hands to its wrapper (lib/api-next/routes.ts):
 *
 * ```ts
 * // app/api/mobile/shop/v1/[locale]/products/route.ts
 * import { productListRoute } from "@/lib/api-core/shop/catalog/product-list";
 * import { publicGet } from "@/lib/api-next/routes";
 *
 * export const GET = publicGet(productListRoute);
 * ```
 *
 * The types refuse what the policy forbids: a route cached for everybody
 * (`static`, `public`) cannot read the session, and a write cannot leave out
 * its rate limit or its demo-mode policy.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * How a response is cached.
 *
 * - `static`: served from Next's response cache (ISR). The handler runs only
 *   when the cache is cold or a tag expired it, sees nothing of the request
 *   but its path, and its output depends on the path alone.
 * - `public`: runs per request; the same answer for everybody, so a CDN may
 *   keep it for `sMaxAge` seconds. Reads its data through a cache.
 * - `private`: one shopper's answer, never stored anywhere.
 */
export type CachePolicy =
  | { kind: "static"; revalidate: number }
  | { kind: "public"; sMaxAge: number; swr: number }
  | { kind: "private" };

/** Who may call it: nobody in particular, anybody (signed in or not), a shopper. */
export type AuthMode = "none" | "optional" | "user";

/**
 * On a demo deployment (DEMO_MODE): `default` refuses DELETE, `block-mutations`
 * refuses every write, `allow` refuses nothing. The same rule `withApi` keeps
 * for the web (lib/api/handler.ts).
 */
export type DemoPolicy = "default" | "allow" | "block-mutations";

/**
 * The limiter presets of lib/rate-limit.ts, by name. Keyed by the shopper
 * (or the app install), with the address as a far higher ceiling.
 */
export type RateLimitPresetName =
  | "strict"
  | "moderate"
  | "lenient"
  | "browse"
  | "veryStrict";

export interface RateLimitPolicy {
  /**
   * The counter's name, `<area>:<action>`. The area is the one the admin's
   * rate-limit presets are chosen by: `cart:`, `checkout:`, `payments:`,
   * `coupons:`, `auth:`; anything else keeps its own preset.
   */
  bucket: string;
  preset: RateLimitPresetName;
}

/**
 * The `reason` vocabulary of an endpoint: the contract's values, and how the
 * app's own error details (`details.reason`) or error codes map onto them. A
 * failure whose reason is not listed goes out without one.
 */
export interface ReasonPolicy {
  values: readonly string[];
  map?: Readonly<Record<string, string>>;
}

/** The names in braces in a path: "/products/{slug}" → "slug". */
type PathParamNames<P extends string> =
  P extends `${string}{${infer Name}}${infer Rest}` ? Name | PathParamNames<Rest> : never;

type SessionFor<A extends AuthMode> = A extends "user"
  ? MobileSession
  : A extends "optional"
    ? MobileSession | null
    : null;

export interface HandlerContext<TInput, TSession, TParam extends string> {
  /** The query (GET) or the JSON body (a write), parsed by the entry's `input`. */
  input: TInput;
  /** The path's parameters, the locale excluded. */
  params: Record<TParam, string>;
  /** The locale in the path; the pipeline has checked the store serves it. */
  locale: string;
  session: TSession;
  /** The app's headers. Empty on a static route, which may not read them. */
  client: ClientInfo;
  /** Set on every request but a static route's, whose answer is shared. */
  requestId?: string;
  /** The store's mobile app settings (never the Expo token). */
  mobileApp: MobileShopAppSettings;
  /** Runs `task` after the response is sent (Next's `after()`). */
  defer: (task: () => Promise<unknown> | unknown) => void;
}

type EntryBase<TInput, TOutput, A extends AuthMode, P extends string> = {
  /** Stable, unique: "catalog.products.detail". */
  id: string;
  /** Under /api/mobile/shop/v1/{locale}, with `{name}` for a parameter. */
  path: P;
  auth: A;
  /** Parses the query (GET) or the body (a write); omitted when there is none. */
  input?: z.ZodType<TInput>;
  output: z.ZodType<TOutput>;
  reasons?: ReasonPolicy;
  /** The success status; 200 unless a write creates something. */
  status?: 200 | 201;
  handler: (
    ctx: HandlerContext<TInput, SessionFor<A>, PathParamNames<P>>,
  ) => Promise<TOutput>;
};

type GetEntry<TInput, TOutput, A extends AuthMode, P extends string> = EntryBase<
  TInput,
  TOutput,
  A,
  P
> & {
  method: "GET";
  /** A route read by one shopper is private; `static`/`public` read no session. */
  cache: A extends "none" ? CachePolicy : { kind: "private" };
  /** Answers 304 to a matching `If-None-Match` (not on a static route). */
  etag?: boolean;
  /**
   * A cheap version of the answer, read before the handler: when the app's
   * `If-None-Match` names it, the answer is 304 and the handler never runs.
   * What it returns must change whenever the body would; the entry, the
   * locale, the path, the input and the shopper are folded in for it. The
   * answer's ETag is then this version, not a hash of the body.
   */
  validator?: (
    ctx: HandlerContext<TInput, SessionFor<A>, PathParamNames<P>>,
  ) => Promise<unknown>;
  /** Required on `public`; a `static` route is served without its handler. */
  rateLimit?: RateLimitPolicy;
  demo?: DemoPolicy;
  idempotency?: never;
  form?: never;
};

type WriteEntry<TInput, TOutput, A extends AuthMode, P extends string> = EntryBase<
  TInput,
  TOutput,
  A,
  P
> & {
  method: Exclude<HttpMethod, "GET">;
  cache: { kind: "private" };
  etag?: never;
  validator?: never;
  rateLimit: RateLimitPolicy;
  demo: DemoPolicy;
  /** "required": the app sends an `Idempotency-Key`, and a retry replays the answer. */
  idempotency?: "required";
  /**
   * The body is `multipart/form-data` (a file upload), not JSON: read up to
   * `maxBytes`, one value per field, `files` naming the file fields. The
   * entry's `input` then judges those fields.
   */
  form?: FormPolicy;
};

export interface FormPolicy {
  maxBytes: number;
  files: readonly string[];
}

type RouteSpec<TInput, TOutput, A extends AuthMode, P extends string> =
  | GetEntry<TInput, TOutput, A, P>
  | WriteEntry<TInput, TOutput, A, P>;

/**
 * A registry entry as the pipeline and the tests see it: the handler's types
 * erased, the policy fields kept.
 */
export type RouteEntry = {
  id: string;
  method: HttpMethod;
  path: string;
  auth: AuthMode;
  cache: CachePolicy;
  etag?: boolean;
  validator?: (ctx: HandlerContext<unknown, MobileSession | null, string>) => Promise<unknown>;
  rateLimit?: RateLimitPolicy;
  demo?: DemoPolicy;
  idempotency?: "required";
  form?: FormPolicy;
  input?: z.ZodType;
  output: z.ZodType;
  reasons?: ReasonPolicy;
  status?: 200 | 201;
  handler: (ctx: HandlerContext<unknown, MobileSession | null, string>) => Promise<unknown>;
};

export type StaticRouteEntry = RouteEntry & {
  method: "GET";
  cache: { kind: "static"; revalidate: number };
};
export type PublicRouteEntry = RouteEntry & {
  method: "GET";
  cache: { kind: "public"; sMaxAge: number; swr: number };
};
export type PrivateRouteEntry = RouteEntry & { cache: { kind: "private" } };

/**
 * Declares an endpoint. Types the handler's input, session and path
 * parameters from the entry, and returns it as a plain `RouteEntry` for the
 * registry.
 */
export function defineRoute<
  TInput,
  TOutput,
  const A extends AuthMode,
  const P extends string,
  const M extends HttpMethod,
  const C extends CachePolicy,
>(
  entry: RouteSpec<TInput, TOutput, A, P> & { method: M; cache: C },
): RouteEntry & { method: M; cache: C } {
  return entry as unknown as RouteEntry & { method: M; cache: C };
}

export function isWrite(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

// ============================================
// The business app (/api/mobile/biz/v1)
// ============================================

/**
 * The business app's routes go through the same pipeline, with the business
 * app's profile (lib/api-core/pipeline.ts, `runBizRoute`): its own switch,
 * versions and sessions, and after the session the operator, the workspace
 * the request is for and the permission the route asks for (./biz/access.ts).
 *
 * ```ts
 * // lib/api-core/biz/orders/list.ts
 * export const orderListRoute = defineBizRoute({
 *   id: "orders.list",
 *   method: "GET",
 *   path: "/orders",
 *   auth: "user",
 *   ...BIZ_ACCESS.VIEW_ORDERS,          // workspace + permission
 *   cache: { kind: "private" },
 *   input: OrderListQuery,
 *   output: OrderList,
 *   handler: async ({ input, workspace, scope }) => { … },
 * });
 * ```
 *
 * Every route but GET /config needs an operator's session and declares
 * `workspace` and `permission` (one of `BIZ_ACCESS`); writes their rate
 * limit and demo policy, as the shop's do. GET /config is the one static
 * route: no session, no workspace.
 */

type GrantFor<W extends BizWorkspaceMode> = W extends "account"
  ? BizWorkspaceGrant | null
  : W extends "platform"
    ? PlatformGrant
    : W extends "vendor"
      ? VendorGrant
      : BizWorkspaceGrant;

type ScopeFor<W extends BizWorkspaceMode> = W extends "account" ? BizScope | null : BizScope;

export interface BizHandlerContext<TInput, TParam extends string, W extends BizWorkspaceMode> {
  /** The query (GET) or the JSON body (a write), parsed by the entry's `input`. */
  input: TInput;
  /** The path's parameters, the locale excluded. */
  params: Record<TParam, string>;
  /** The locale in the path; the pipeline has checked the store serves it. */
  locale: string;
  /** The operator's session, signed in from the business app. */
  session: MobileSession;
  /** Who they are, with every workspace they can work in. */
  actor: BizActor;
  /**
   * The workspace this request is for, already checked against the route's
   * permission. On an `account` route, the one that can be told (or null).
   */
  workspace: GrantFor<W>;
  /** What it may reach: put it into every query (./biz/scope.ts). */
  scope: ScopeFor<W>;
  /** The app's headers. */
  client: ClientInfo;
  requestId?: string;
  /** The store's business app settings. */
  mobileApp: MobileBizAppSettings;
  /** Runs `task` after the response is sent (Next's `after()`). */
  defer: (task: () => Promise<unknown> | unknown) => void;
}

/** What a static (ISR) business route sees: its path, nothing of the request. */
export interface BizStaticHandlerContext<TParam extends string> {
  params: Record<TParam, string>;
  locale: string;
  mobileApp: MobileBizAppSettings;
  defer: (task: () => Promise<unknown> | unknown) => void;
}

/**
 * The answer's own version, sent as its `ETag` (quoted): what a later change
 * names in `If-Match` (PATCH /products/{id}). Unlike `etag`, never a hash of
 * the body, and no 304 is answered on it.
 */
type EntityTagOf<TOutput> = (output: TOutput) => string;

type BizEntryBase<TOutput, P extends string> = {
  /** Stable, unique: "orders.list". */
  id: string;
  /** Under /api/mobile/biz/v1/{locale}, with `{name}` for a parameter. */
  path: P;
  output: z.ZodType<TOutput>;
  reasons?: ReasonPolicy;
  status?: 200 | 201;
};

type BizAccessFields<W extends BizWorkspaceMode> = {
  auth: "user";
  workspace: W;
  permission: BizPermission;
  /**
   * The route is about sellers and exists only on a store with sellers
   * (sellers' applications): 404 otherwise. Implied by `workspace: "vendor"`.
   */
  multiVendorOnly?: true;
};

type BizGetEntry<TInput, TOutput, P extends string, W extends BizWorkspaceMode> = BizEntryBase<TOutput, P> &
  BizAccessFields<W> & {
    method: "GET";
    cache: { kind: "private" };
    input?: z.ZodType<TInput>;
    /** Answers 304 to a matching `If-None-Match`. */
    etag?: boolean;
    /** A cheap version of the answer, read before the handler (as on the shop's routes). */
    validator?: (ctx: BizHandlerContext<TInput, PathParamNames<P>, W>) => Promise<unknown>;
    entityTag?: EntityTagOf<TOutput>;
    rateLimit?: RateLimitPolicy;
    demo?: DemoPolicy;
    idempotency?: never;
    handler: (ctx: BizHandlerContext<TInput, PathParamNames<P>, W>) => Promise<TOutput>;
  };

type BizWriteEntry<TInput, TOutput, P extends string, W extends BizWorkspaceMode> = BizEntryBase<TOutput, P> &
  BizAccessFields<W> & {
    method: Exclude<HttpMethod, "GET">;
    cache: { kind: "private" };
    input?: z.ZodType<TInput>;
    etag?: never;
    validator?: never;
    rateLimit: RateLimitPolicy;
    demo: DemoPolicy;
    /**
     * "required": the app sends an `Idempotency-Key`, and a retry replays the
     * answer. Every write that moves stock, an order's status or money.
     */
    /** Typed, bounded multipart uploads share the same workspace/auth pipeline. */
    form?: FormPolicy;
    entityTag?: EntityTagOf<TOutput>;
    handler: (ctx: BizHandlerContext<TInput, PathParamNames<P>, W>) => Promise<TOutput>;
  } & (
    | { idempotency: "required"; /** Re-authorize replay through a durable domain receipt. */ durable: true }
    | { idempotency?: "required"; durable?: never }
  );

type BizStaticEntry<TOutput, P extends string> = BizEntryBase<TOutput, P> & {
  method: "GET";
  auth: "none";
  cache: { kind: "static"; revalidate: number };
  workspace?: never;
  permission?: never;
  multiVendorOnly?: never;
  input?: never;
  etag?: never;
  validator?: never;
  entityTag?: never;
  rateLimit?: never;
  demo?: never;
  idempotency?: never;
  handler: (ctx: BizStaticHandlerContext<PathParamNames<P>>) => Promise<TOutput>;
};

type BizRouteSpec<TInput, TOutput, P extends string, W extends BizWorkspaceMode> =
  | BizGetEntry<TInput, TOutput, P, W>
  | BizWriteEntry<TInput, TOutput, P, W>
  | BizStaticEntry<TOutput, P>;

/** A business route as the pipeline and the tests see it: the handler's types erased. */
export type BizRouteEntry = {
  /** Set by `defineBizRoute`: which app's pipeline serves it. */
  app: "biz";
  id: string;
  method: HttpMethod;
  path: string;
  auth: "none" | "user";
  cache: CachePolicy;
  workspace?: BizWorkspaceMode;
  permission?: BizPermission;
  multiVendorOnly?: true;
  etag?: boolean;
  validator?: (ctx: BizHandlerContext<unknown, string, BizWorkspaceMode>) => Promise<unknown>;
  entityTag?: (output: unknown) => string;
  rateLimit?: RateLimitPolicy;
  demo?: DemoPolicy;
  idempotency?: "required";
  durable?: true;
  form?: FormPolicy;
  input?: z.ZodType;
  output: z.ZodType;
  reasons?: ReasonPolicy;
  status?: 200 | 201;
  handler: (
    ctx: BizHandlerContext<unknown, string, BizWorkspaceMode> | BizStaticHandlerContext<string>,
  ) => Promise<unknown>;
};

export type BizStaticRouteEntry = BizRouteEntry & {
  method: "GET";
  cache: { kind: "static"; revalidate: number };
};
/** `defineBizRoute` has already required its session, workspace and permission. */
export type BizPrivateRouteEntry = BizRouteEntry & { cache: { kind: "private" } };

/**
 * Declares a business-app endpoint. Types the handler's input, path
 * parameters and workspace from the entry (a `vendor` route's handler gets a
 * seller's grant), and returns it as a plain `BizRouteEntry`.
 */
export function defineBizRoute<
  TInput,
  TOutput,
  const P extends string,
  const M extends HttpMethod,
  const C extends CachePolicy,
  const W extends BizWorkspaceMode,
>(
  entry: BizRouteSpec<TInput, TOutput, P, W> & { method: M; cache: C },
): BizRouteEntry & { method: M; cache: C } {
  return { ...entry, app: "biz" } as unknown as BizRouteEntry & { method: M; cache: C };
}
