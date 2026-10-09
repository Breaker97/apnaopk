import {
  ERROR_CODES as BIZ_ERROR_CODES,
  type ErrorCode as BizErrorCode,
} from "@/contracts/mobile/biz/v1/common";
import {
  ERROR_CODES as SHOP_ERROR_CODES,
  type ErrorBody,
  type ErrorCode as ShopErrorCode,
} from "@/contracts/mobile/shop/v1/common";
import {
  ApiError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  publicErrorMessage,
} from "@/lib/api/errors";
import type { LocaleRouting } from "./ports";
import type { ReasonPolicy } from "./registry";

/**
 * Failures, as the mobile contract words them (contracts … common.ts,
 * `ErrorBody`): `code` is the category the app reacts to, `reason` the
 * endpoint's own word for what happened, `message` an English fallback.
 *
 * Handlers throw `MobileApiError` for what the contract names. The library
 * code they call throws the web's errors (lib/api/errors.ts); those are
 * translated here, so a web error class never reaches the app in its own
 * shape: its internal code and `details` stay behind, and only a reason the
 * endpoint maps (`ReasonPolicy`) goes out.
 *
 * Each app's contract has its own list of codes (`KNOWN_ERROR_CODES`); a
 * code the app's list does not have becomes the category for its status.
 */

/** A code of either app's contract. A handler throws only its own app's. */
export type ErrorCode = ShopErrorCode | BizErrorCode;

export const KNOWN_ERROR_CODES = {
  shop: new Set<string>(SHOP_ERROR_CODES),
  biz: new Set<string>(BIZ_ERROR_CODES),
} as const;

interface MobileApiErrorOptions {
  reason?: string;
  details?: Record<string, unknown>;
  errors?: Record<string, string[]>;
  headers?: Record<string, string>;
}

export class MobileApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly options: MobileApiErrorOptions = {},
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export function routeNotFoundError(): MobileApiError {
  return new MobileApiError(404, "ROUTE_NOT_FOUND", "There is nothing at this address.");
}

/**
 * A shopper the store holds back until their email address is verified: they
 * signed up, so they are signed in, but the store requires the address
 * proven first. 403, not 401: the session is good, and an app that took this
 * for a lost session would only ask for it again.
 */
export function emailNotVerifiedError(): MobileApiError {
  return new MobileApiError(
    403,
    "EMAIL_NOT_VERIFIED",
    "Verify your email address to continue: open the link in the email we sent you.",
  );
}

export function localeNotAvailableError(routing: LocaleRouting): MobileApiError {
  return new MobileApiError(
    404,
    "LOCALE_NOT_AVAILABLE",
    "The store does not serve this language.",
    {
      details: {
        defaultLocale: routing.storeDefault,
        locales: [...routing.enabled],
      },
    },
  );
}

export interface ErrorPayload {
  status: number;
  body: ErrorBody;
  headers: Record<string, string>;
}

/** The category of a web error the contract has no code for, by its status. */
function codeForStatus(status: number): ErrorCode {
  if (status === 401) return "AUTHENTICATION_ERROR";
  if (status === 403) return "AUTHORIZATION_ERROR";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "RATE_LIMIT_EXCEEDED";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  if (status >= 500) return "INTERNAL_ERROR";
  return "VALIDATION_ERROR";
}

/** The contract's reason for an internal one, when the endpoint maps it. */
function contractReason(
  internal: string | undefined,
  reasons: ReasonPolicy | undefined,
): string | undefined {
  if (!internal || !reasons) return undefined;
  const mapped = reasons.map?.[internal] ?? internal;
  return reasons.values.includes(mapped) ? mapped : undefined;
}

/** The database cannot be reached: worth retrying, unlike a bug. */
function isDatabaseUnavailable(error: Error): boolean {
  return (
    /^Mongo(ServerSelection|Network|NotConnected|TopologyClosed)/.test(error.name) ||
    /buffering timed out|Client must be connected/i.test(error.message)
  );
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

type MongooseValidationLike = { name: "ValidationError"; errors: Record<string, { message?: string }> };

function isMongooseValidation(error: unknown): error is MongooseValidationLike {
  return (
    typeof error === "object" &&
    error !== null &&
    !(error instanceof ApiError) &&
    (error as { name?: unknown }).name === "ValidationError" &&
    typeof (error as { errors?: unknown }).errors === "object"
  );
}

function isMongooseCast(error: unknown): error is { name: "CastError"; path: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "CastError" &&
    typeof (error as { path?: unknown }).path === "string"
  );
}

const INTERNAL_MESSAGE = "Something went wrong on our side. Please try again.";

/**
 * The status, body and headers a failure is answered with. `requestId` goes
 * into the body when the response is one request's own (never on a static
 * route, whose answers are shared).
 */
export function toErrorPayload(
  error: unknown,
  context: {
    requestId?: string;
    reasons?: ReasonPolicy;
    /** The app's codes; the shopper app's unless said. */
    codes?: ReadonlySet<string>;
    log: (message: string, error?: unknown) => void;
  },
): ErrorPayload {
  const { requestId, reasons } = context;
  const knownCodes = context.codes ?? KNOWN_ERROR_CODES.shop;
  const build = (
    status: number,
    code: ErrorCode,
    message: string,
    extra: Omit<ErrorBody, "success" | "code" | "message"> = {},
    headers: Record<string, string> = {},
  ): ErrorPayload => ({
    status,
    body: {
      success: false,
      code,
      ...(extra.reason ? { reason: extra.reason } : {}),
      message,
      ...(extra.errors ? { errors: extra.errors } : {}),
      ...(extra.details ? { details: extra.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
    headers,
  });

  if (error instanceof MobileApiError) {
    const reason = error.options.reason;
    if (reason && reasons && !reasons.values.includes(reason)) {
      context.log(`Reason "${reason}" is not in this endpoint's reasons; sent without it.`);
    }
    return build(
      error.status,
      error.code,
      error.message,
      {
        reason: reason && (!reasons || reasons.values.includes(reason)) ? reason : undefined,
        errors: error.options.errors,
        details: error.options.details,
      },
      error.options.headers,
    );
  }

  if (error instanceof ValidationError) {
    return build(400, "VALIDATION_ERROR", error.message, {
      errors: error.errors,
      reason: contractReason(
        (error.details?.reason as string | undefined) ?? undefined,
        reasons,
      ),
    });
  }

  if (error instanceof RateLimitError) {
    return build(
      429,
      "RATE_LIMIT_EXCEEDED",
      error.message,
      { details: { retryAfter: error.retryAfter } },
      { "Retry-After": String(error.retryAfter) },
    );
  }

  if (error instanceof ApiError) {
    const code = knownCodes.has(error.code)
      ? (error.code as ErrorCode)
      : codeForStatus(error.statusCode);
    const internalReason =
      typeof error.details?.reason === "string" ? error.details.reason : error.code;
    const retryAfter =
      error instanceof ServiceUnavailableError && error.retryAfter
        ? { "Retry-After": String(error.retryAfter) }
        : undefined;
    return build(
      error.statusCode,
      code,
      error.message,
      { reason: contractReason(internalReason, reasons) },
      retryAfter,
    );
  }

  if (isDuplicateKey(error)) {
    return build(409, "CONFLICT", "A record with these details already exists.");
  }
  if (isMongooseValidation(error)) {
    const errors = Object.fromEntries(
      Object.entries(error.errors).map(([path, detail]) => [
        path,
        [detail?.message || `Invalid value for ${path}`],
      ]),
    );
    return build(400, "VALIDATION_ERROR", `Validation failed: ${Object.keys(errors).join(", ")}`, {
      errors,
    });
  }
  if (isMongooseCast(error)) {
    return build(400, "VALIDATION_ERROR", `Invalid value for ${error.path}`, {
      errors: { [error.path]: [`Invalid value for ${error.path}`] },
    });
  }

  if (error instanceof Error && isDatabaseUnavailable(error)) {
    context.log(`Database unavailable [${requestId ?? "static"}]`, error);
    return build(
      503,
      "SERVICE_UNAVAILABLE",
      "The store cannot be reached right now. Please try again.",
      {},
      { "Retry-After": "5" },
    );
  }

  context.log(`Unhandled error [${requestId ?? "static"}]`, error);
  return build(500, "INTERNAL_ERROR", publicErrorMessage(error, INTERNAL_MESSAGE));
}
