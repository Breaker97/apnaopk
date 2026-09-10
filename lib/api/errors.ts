import { NextResponse } from "next/server";

/**
 * Custom API Error Classes
 * Provides structured error handling for API endpoints
 */

export class ApiError extends Error {
  public readonly statusCode: number;
  public code: string;
  /**
   * Structured payload echoed to the client alongside the message. The channel
   * exists for errors a UI has to *act* on rather than just display — a
   * conflict that must name which items collided, say. `ValidationError`'s
   * `errors` map cannot carry an array, and it answers 400 where a conflict
   * needs 409.
   */
  public details?: Record<string, unknown>;

  constructor(message: string, statusCode: number = 400, code?: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code || "API_ERROR";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends ApiError {
  public readonly errors: Record<string, string[]>;

  constructor(errors: Record<string, string[]> | string) {
    const message =
      typeof errors === "string"
        ? errors
        : "Validation failed: " + Object.keys(errors).join(", ");
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.errors = typeof errors === "string" ? { _error: [errors] } : errors;
  }
}

export class AuthenticationError extends ApiError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "AUTHENTICATION_ERROR");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends ApiError {
  constructor(
    message: string = "You do not have permission to perform this action"
  ) {
    super(message, 403, "AUTHORIZATION_ERROR");
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor(
    message: string = "Resource already exists",
    details?: Record<string, unknown>,
  ) {
    super(message, 409, "CONFLICT");
    this.name = "ConflictError";
    if (details) this.details = details;
  }
}

export class RateLimitError extends ApiError {
  public readonly retryAfter: number;

  constructor(message: string = "Too many requests", retryAfter: number = 60) {
    super(message, 429, "RATE_LIMIT_EXCEEDED");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class ServiceUnavailableError extends ApiError {
  public readonly retryAfter?: number;

  constructor(
    message: string = "Service temporarily unavailable",
    retryAfter?: number,
    code: string = "SERVICE_UNAVAILABLE",
  ) {
    super(message, 503, code);
    this.name = "ServiceUnavailableError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Error handler utility for API routes
 * Returns a proper NextResponse for API routes
 */
type MongooseValidationLike = {
  name: "ValidationError";
  errors: Record<string, { message?: string } | undefined>;
};
type MongooseCastLike = { name: "CastError"; path: string };

// Duck-typed on purpose: this module is shared with client code, so it must
// not import mongoose to recognise its errors.
function isMongooseValidationError(
  error: unknown,
): error is MongooseValidationLike {
  return (
    typeof error === "object" &&
    error !== null &&
    !(error instanceof ApiError) &&
    (error as { name?: unknown }).name === "ValidationError" &&
    typeof (error as { errors?: unknown }).errors === "object" &&
    (error as { errors?: unknown }).errors !== null
  );
}

function isMongooseCastError(error: unknown): error is MongooseCastLike {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "CastError" &&
    typeof (error as { path?: unknown }).path === "string"
  );
}

export function handleApiError(error: unknown): NextResponse {
  // Handle rate limit errors with Retry-After header
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      {
        success: false,
        message: error.message,
        code: error.code,
        retryAfter: error.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(error.retryAfter),
        },
      }
    );
  }

  // Handle validation errors with detailed field errors
  if (error instanceof ValidationError) {
    return NextResponse.json(
      {
        success: false,
        message: error.message,
        code: error.code,
        errors: error.errors,
        // Same passthrough the ApiError branch below has. A refusal the client
        // must react to differently — rather than just print — needs something
        // machine-readable to branch on; matching the English sentence breaks
        // the moment either side is reworded.
        ...(error.details ? { details: error.details } : {}),
      },
      { status: 400 }
    );
  }

  // Handle other API errors
  if (error instanceof ApiError) {
    const headers =
      error instanceof ServiceUnavailableError && error.retryAfter
        ? { "Retry-After": String(error.retryAfter) }
        : undefined;

    return NextResponse.json(
      {
        success: false,
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
      { status: error.statusCode, headers }
    );
  }

  // Handle MongoDB duplicate-key errors as a clean 409 rather than a 500 that
  // leaks the index/collection name in the message.
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  ) {
    const keyPattern = (error as { keyPattern?: Record<string, unknown> })
      .keyPattern;
    const field = keyPattern ? Object.keys(keyPattern)[0] : undefined;
    return NextResponse.json(
      {
        success: false,
        message: field
          ? `A record with this ${field} already exists`
          : "A record with these details already exists",
        code: "DUPLICATE_KEY",
      },
      { status: 409 },
    );
  }

  // Handle standard JavaScript errors — show clean message, log full detail
  // Mongoose said no on a `save()` — an enum, cast or required-path failure in
  // a document the route trusted its allow-list for. Name the paths in a 400
  // instead of hiding them behind "Internal server error".
  if (isMongooseValidationError(error)) {
    const errors = Object.fromEntries(
      Object.entries(error.errors).map(([path, detail]) => [
        path,
        [detail?.message || `Invalid value for ${path}`],
      ]),
    );
    return NextResponse.json(
      {
        success: false,
        message: "Validation failed: " + Object.keys(errors).join(", "),
        code: "VALIDATION_ERROR",
        errors,
      },
      { status: 400 },
    );
  }
  if (isMongooseCastError(error)) {
    return NextResponse.json(
      {
        success: false,
        message: `Invalid value for ${error.path}`,
        code: "VALIDATION_ERROR",
        errors: { [error.path]: [`Invalid value for ${error.path}`] },
      },
      { status: 400 },
    );
  }

  if (error instanceof Error) {
    console.error("Unhandled error:", error);

    // Strip any JSON / stack traces from the message shown to the client.
    // Keep the human-readable prefix (e.g. "PayPal auth failed: …") but
    // replace embedded JSON blobs with the extracted description.
    let clientMessage = error.message || "Internal server error";

    // Remove embedded JSON objects like {"error":"…","error_description":"…"}
    clientMessage = clientMessage.replace(/\{[\s\S]*\}/g, "").trim();

    // Remove trailing colon/whitespace left behind after stripping JSON
    clientMessage = clientMessage.replace(/:\s*$/, "").trim();

    return NextResponse.json(
      {
        success: false,
        message: clientMessage || "Internal server error",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }

  // Handle unknown errors
  return NextResponse.json(
    {
      success: false,
      message: "An unexpected error occurred",
      code: "UNKNOWN_ERROR",
    },
    { status: 500 }
  );
}
