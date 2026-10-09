/**
 * Storify mobile contract, shopper app, v1: shared building blocks.
 *
 * This folder is the contract of `/api/mobile/shop/v1/{locale}/…`. The API
 * implements it (lib/api-core) and the shopper app keeps a copy of it, taken
 * with the app's `pnpm contracts:sync`; the copy is never edited there.
 * `tests/mobile-api/contract-snapshot.test.ts` holds its JSON Schema and fails
 * on a change an installed app could not survive.
 *
 * Rules every file in this folder follows:
 * - Only `zod` is imported. Nothing here may depend on the app or the server.
 * - A response schema has no transform and no default: the app reads the JSON
 *   as it arrives, so a schema that reshaped it would describe something else.
 * - An optional field is left out, never sent as `null`. An array is always
 *   sent, empty when there is nothing in it.
 * - Words the contract owns (reasons, block types, sort orders) are
 *   UPPER_SNAKE. Values that mirror the store's own data (locale and currency
 *   codes, order statuses) are passed through as they are.
 * - Within v1 a change only adds: a new endpoint, a new optional field, a new
 *   value of a vocabulary. The app must therefore tolerate a value it does not
 *   know.
 * - A schema the app SENDS is named for what it is: `…Query`, `…Request`,
 *   `…Body` or `…Params`. Every other schema is one the app receives. The
 *   snapshot test judges a change by that direction: a request may accept
 *   more than before, a response may promise more than before.
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
 * The category of a failure. It decides how the app reacts (ask to sign in,
 * show field errors, ask to update); `reason` says what happened in the
 * store's own terms.
 */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_ERROR",
  /**
   * HTTP 403 on any endpoint that needs a shopper: they are signed in, but the
   * store requires a verified email address and theirs is not verified yet
   * (`Config.auth.emailVerificationRequired`). Not a lost session, so do not
   * sign out or ask the session again: show "check your email". The same
   * session works once the link in the email is opened.
   */
  "EMAIL_NOT_VERIFIED",
  "AUTHORIZATION_ERROR",
  /** The store's demo site refuses this change. */
  "DEMO_MODE_READ_ONLY",
  "NOT_FOUND",
  "ROUTE_NOT_FOUND",
  /** The locale in the path is not one the store serves: `LocaleNotAvailableDetails`. */
  "LOCALE_NOT_AVAILABLE",
  "CONFLICT",
  "REQUEST_IN_PROGRESS",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMIT_EXCEEDED",
  "APP_UPDATE_REQUIRED",
  "STORE_MAINTENANCE",
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
 * The `details` of STORE_MAINTENANCE (HTTP 503). Every request under
 * `/api/mobile` gets it while the store is in maintenance, reads included,
 * unless it comes from an address the store lets through.
 */
export const MaintenanceDetails = z.object({
  title: z.string().optional(),
  message: z.string().optional(),
  backgroundImageUrl: z.string().optional(),
  countdownEnabled: z.boolean().optional(),
  countdownEndsAt: z.string().optional(),
});
export type MaintenanceDetails = z.infer<typeof MaintenanceDetails>;

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
 * Headers the app sends. The locale is not among them: it is the first part of
 * the path, `/api/mobile/shop/v1/{locale}/…`.
 */
export const REQUEST_HEADERS = {
  appVersion: "X-App-Version",
  appBuild: "X-App-Build",
  appPlatform: "X-App-Platform",
  installId: "X-Install-Id",
  cartToken: "X-Cart-Token",
  idempotencyKey: "Idempotency-Key",
} as const;

/**
 * Headers the server sends. `requestId` is also in the body of every error
 * but a cached one; quoting it lets the store find the request in its logs.
 */
export const RESPONSE_HEADERS = {
  requestId: "X-Request-Id",
} as const;

export const API_BASE_PATH = "/api/mobile/shop/v1";
