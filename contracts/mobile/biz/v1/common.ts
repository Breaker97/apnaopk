/**
 * Storify mobile contract, business app, v1: shared building blocks.
 *
 * This folder is the contract of `/api/mobile/biz/v1/{locale}/…`, the API the
 * store's operators (administrators, the store's own staff, sellers and
 * sellers' staff) run the store through from the business app. The API
 * implements it (lib/api-core) and the business app keeps a copy of it, taken
 * with the app's `pnpm contracts:sync`; the copy is never edited there.
 * `tests/mobile-api/contract-snapshot.test.ts` holds its JSON Schema and fails
 * on a change an installed app could not survive.
 *
 * The envelope, `Money`, `ImageSet`, lists and `ErrorBody` have exactly the
 * shapes of the shopper app's contract (contracts/mobile/shop/v1/common.ts), so
 * one client library reads both; a test fails when the two drift apart. They
 * are written out again here, not imported, because each app copies one
 * folder and nothing else.
 *
 * Rules every file in this folder follows:
 * - Only `zod` is imported. Nothing here may depend on the app or the server.
 * - A response schema has no transform and no default: the app reads the JSON
 *   as it arrives, so a schema that reshaped it would describe something else.
 * - An optional field is left out, never sent as `null`. An array is always
 *   sent, empty when there is nothing in it.
 * - Words the contract owns are UPPER_SNAKE where the app receives them
 *   (reasons, capabilities, home tiles) and lower_snake where the app sends
 *   them (workspaces, list tabs, order actions, decisions). Values that mirror
 *   the store's own data (locale and currency codes, order and payment
 *   statuses, permission names) are passed through as they are.
 * - Within v1 a change only adds: a new endpoint, a new optional field, a new
 *   value of a vocabulary. The app must therefore tolerate a value it does not
 *   know.
 * - A schema the app SENDS is named for what it is: `…Query`, `…Request`,
 *   `…Body` or `…Params`. Every other schema is one the app receives. The
 *   snapshot test judges a change by that direction: a request may accept
 *   more than before, a response may promise more than before.
 *
 * Who may call what: every endpoint but GET /config needs the business app's
 * own session (signed in from the app, see me.ts) of someone who runs the
 * store. What each one may do is decided on the server, per request, from
 * their role, permissions and scope; GET /me says it up front so the app can
 * hide what would be refused, and the API refuses it anyway.
 */
import * as z from "zod";

/**
 * A price. `amount` is in the currency's main unit and is for sorting and
 * analytics only; `formatted` is what the app prints. The app never formats or
 * calculates money.
 */
export const Money = z.object({
  amount: z.number(),
  currency: z.string(),
  formatted: z.string(),
});
export type Money = z.infer<typeof Money>;

/** One picture in the three sizes the app needs. */
export const ImageSet = z.object({
  thumb: z.string(),
  card: z.string(),
  full: z.string(),
  alt: z.string().optional(),
});
export type ImageSet = z.infer<typeof ImageSet>;

export const LIST_DEFAULT_LIMIT = 20;
export const LIST_MAX_LIMIT = 40;

/** Query of every list endpoint. `cursor` is opaque: send back what you got. */
export const ListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
});
export type ListQuery = z.infer<typeof ListQuery>;

/** A page of a list. `nextCursor` is `null` on the last page. */
export function listOf<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/** The envelope of a successful response. */
export function successOf<T extends z.ZodType>(data: T) {
  return z.object({
    success: z.literal(true),
    data,
  });
}

/**
 * The two sides of the store an operator can work in.
 *
 * - `platform`: the store itself. Administrators and the store's own staff.
 * - `vendor`: one seller's shop. The seller and the staff they took on.
 *
 * Nobody has both today, but the contract allows it: with two, the app asks
 * which one and sends it as `X-Workspace` on every call (GET /me lists them).
 */
export const WORKSPACES = ["platform", "vendor"] as const;
export const Workspace = z.enum(WORKSPACES);
export type Workspace = z.infer<typeof Workspace>;

/**
 * The category of a failure. It decides how the app reacts (ask to sign in,
 * show field errors, ask to update); `reason` says what happened in the
 * store's own terms.
 *
 * The same categories as the shopper app's, without STORE_MAINTENANCE (the
 * store's maintenance mode never closes the business app: its operators keep
 * working, as they do on the website's dashboard), plus four of its own.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_ERROR",
  /**
   * HTTP 403: signed in, but the store requires a verified email address
   * (sellers can be asked for one) and theirs is not verified yet. Not a lost
   * session: show "check your email". The same session works once the link
   * in the email is opened.
   */
  "EMAIL_NOT_VERIFIED",
  /** HTTP 403: their role or permissions do not allow this. */
  "AUTHORIZATION_ERROR",
  /**
   * HTTP 403: the endpoint belongs to a workspace this person does not have
   * (a seller's payouts asked for by an administrator), or `X-Workspace`
   * names one they do not have. `details`: `WorkspaceNotAvailableDetails`.
   */
  "WORKSPACE_NOT_AVAILABLE",
  /**
   * HTTP 403: the seller's shop is not open for this (suspended, rejected,
   * awaiting payment). `details`: `VendorNotActiveDetails`. GET /me still
   * answers, with the status, so the app can say why.
   */
  "VENDOR_NOT_ACTIVE",
  /** The store's demo site refuses this change. */
  "DEMO_MODE_READ_ONLY",
  "NOT_FOUND",
  "ROUTE_NOT_FOUND",
  /** The locale in the path is not one the store serves: `LocaleNotAvailableDetails`. */
  "LOCALE_NOT_AVAILABLE",
  "CONFLICT",
  /**
   * HTTP 412: `If-Match` names a version that is no longer current: somebody
   * else changed it. Read it again, show the change, and let them decide.
   */
  "PRECONDITION_FAILED",
  /** HTTP 428: this change must say which version it changes: send `If-Match`. */
  "PRECONDITION_REQUIRED",
  "REQUEST_IN_PROGRESS",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMIT_EXCEEDED",
  "APP_UPDATE_REQUIRED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The envelope of a failed response.
 *
 * `message` is an English fallback. The app shows its own translation, chosen
 * by `reason` first and `code` second, and prints `message` only when it knows
 * neither.
 */
export const ErrorBody = z.object({
  success: z.literal(false),
  code: z.string(),
  reason: z.string().optional(),
  message: z.string(),
  /** Field name → what is wrong with it. Sent with VALIDATION_ERROR. */
  errors: z.record(z.string(), z.array(z.string())).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

/**
 * The `details` of LOCALE_NOT_AVAILABLE (HTTP 404): the store does not serve
 * the locale in the path, or no longer does. The app retries once with
 * `defaultLocale`, so a store that switches a language off does not lock its
 * installed apps out.
 */
export const LocaleNotAvailableDetails = z.object({
  defaultLocale: z.string(),
  /** Every locale the store serves, the default among them. */
  locales: z.array(z.string()),
});
export type LocaleNotAvailableDetails = z.infer<typeof LocaleNotAvailableDetails>;

/**
 * The `details` of APP_UPDATE_REQUIRED (HTTP 426): this version of the app is
 * below the store's minimum, so it may still read but no longer change
 * anything. `storeUrl` is where the update is, when the store gave one.
 */
export const AppUpdateRequiredDetails = z.object({
  minVersion: z.string(),
  storeUrl: z.string().optional(),
});
export type AppUpdateRequiredDetails = z.infer<typeof AppUpdateRequiredDetails>;

/**
 * The `details` of RATE_LIMIT_EXCEEDED (HTTP 429): seconds until the request
 * may be tried again. The same number is in the `Retry-After` header.
 */
export const RateLimitDetails = z.object({
  retryAfter: z.number().int(),
});
export type RateLimitDetails = z.infer<typeof RateLimitDetails>;

/**
 * The `details` of WORKSPACE_NOT_AVAILABLE (HTTP 403): the workspaces this
 * person does have (possibly none: a staff member whose access was switched
 * off). Go back to the workspace choice, or to GET /me.
 */
export const WorkspaceNotAvailableDetails = z.object({
  workspaces: z.array(Workspace),
});
export type WorkspaceNotAvailableDetails = z.infer<typeof WorkspaceNotAvailableDetails>;

/**
 * The `details` of VENDOR_NOT_ACTIVE (HTTP 403): the seller's shop status, the
 * store's own word (`pending`, `payment_required`, `suspended`, `rejected`).
 * A shop awaiting payment is settled on the website, never in the app.
 */
export const VendorNotActiveDetails = z.object({
  status: z.string(),
});
export type VendorNotActiveDetails = z.infer<typeof VendorNotActiveDetails>;

/**
 * Headers the app sends. The locale is not among them: it is the first part of
 * the path, `/api/mobile/biz/v1/{locale}/…`.
 *
 * - `workspace`: `platform` or `vendor` (`Workspace`), on every call once the
 *   app knows it. Left out, the server picks the person's only workspace; a
 *   person with two must send it.
 * - `idempotencyKey`: a UUID per tap, kept for that tap's retries, on every
 *   change that moves stock, an order's status or money (each endpoint says
 *   so). A retry gets the first answer.
 * - `ifMatch`: the `version` (or the `ETag`) the change was made against, on
 *   the changes that ask for it (PATCH /products/{id}).
 */
export const REQUEST_HEADERS = {
  appVersion: "X-App-Version",
  appBuild: "X-App-Build",
  appPlatform: "X-App-Platform",
  installId: "X-Install-Id",
  workspace: "X-Workspace",
  idempotencyKey: "Idempotency-Key",
  ifMatch: "If-Match",
} as const;

/**
 * Headers the server sends. `requestId` is also in the body of every error
 * but a cached one; quoting it lets the store find the request in its logs.
 */
export const RESPONSE_HEADERS = {
  requestId: "X-Request-Id",
} as const;

export const API_BASE_PATH = "/api/mobile/biz/v1";
