import type { CarrierProvider } from "@/lib/shipping/carrier-config";

/**
 * How a failed carrier call should be treated by the retry queue.
 *
 * Mirrors `ProviderFailure` in `lib/conversations/providers/registry.ts`, for
 * the same reason: the queue cannot know whether a 422 from Shippo and a 400
 * from Shiprocket mean the same thing, so each adapter says so itself.
 */
export interface CarrierFailure {
  /** Retrying this exact request will never succeed. */
  permanent: boolean;
  /** The stored credential is dead; the carrier should be flagged. */
  authFailure: boolean;
  retryAfterSeconds?: number;
  errorCode?: string;
  /** Message safe to show a merchant, when the provider gave a useful one. */
  operatorMessage?: string;
}

/**
 * A fault we raised ourselves, before or instead of contacting the carrier.
 *
 * An incomplete ship-from or an address with no country will not become valid
 * by waiting, so these carry `permanent: true` and skip the retry ladder — the
 * merchant has to fix something, and burning six attempts first only delays
 * telling them.
 */
export class CarrierError extends Error {
  readonly provider?: CarrierProvider;
  readonly code: string;
  readonly permanent: boolean;
  readonly authFailure: boolean;
  readonly retryAfterSeconds?: number;
  readonly status?: number;
  /** Field paths the merchant must fix, for the ADDRESS/SHIP_FROM codes. */
  readonly fields?: string[];

  constructor(params: {
    message: string;
    code: string;
    provider?: CarrierProvider;
    permanent?: boolean;
    authFailure?: boolean;
    retryAfterSeconds?: number;
    status?: number;
    fields?: string[];
  }) {
    super(params.message);
    this.name = "CarrierError";
    this.provider = params.provider;
    this.code = params.code;
    this.permanent = params.permanent ?? false;
    this.authFailure = params.authFailure ?? false;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.status = params.status;
    this.fields = params.fields;
  }

  toFailure(): CarrierFailure {
    return {
      permanent: this.permanent,
      authFailure: this.authFailure,
      retryAfterSeconds: this.retryAfterSeconds,
      errorCode: this.code,
      operatorMessage: this.message,
    };
  }
}

export const CARRIER_ERROR_CODES = {
  NOT_CONFIGURED: "CARRIER_NOT_CONFIGURED",
  DISABLED: "CARRIER_DISABLED",
  UNSUPPORTED_ORIGIN: "CARRIER_UNSUPPORTED_ORIGIN",
  SHIPROCKET_PICKUP_NOT_CONFIGURED: "SHIPROCKET_PICKUP_NOT_CONFIGURED",
  ADDRESS_NOT_CARRIER_READY: "ADDRESS_NOT_CARRIER_READY",
  SHIP_FROM_INCOMPLETE: "SHIP_FROM_INCOMPLETE",
  NO_RATES: "CARRIER_NO_RATES",
  RATE_EXPIRED: "CARRIER_RATE_EXPIRED",
  ALREADY_PURCHASED: "CARRIER_ALREADY_PURCHASED",
  AUTH_FAILED: "CARRIER_AUTH_FAILED",
  RATE_LIMITED: "CARRIER_RATE_LIMITED",
  PROVIDER_ERROR: "CARRIER_PROVIDER_ERROR",
  NO_SANDBOX: "CARRIER_NO_SANDBOX",
} as const;

/**
 * Classify a bare HTTP status when the provider gave nothing better.
 *
 * 4xx other than 408/429 is permanent — the request itself is wrong. 5xx and
 * transport faults stay retryable. An unrecognised shape returns `undefined`
 * so the caller treats it as retryable: mistaking an unknown fault for a
 * permanent one strands an order the carrier would have accepted.
 */
export function classifyHttpStatus(
  status: number,
  retryAfterSeconds?: number,
): CarrierFailure {
  if (status === 401 || status === 403) {
    return {
      permanent: true,
      authFailure: true,
      errorCode: CARRIER_ERROR_CODES.AUTH_FAILED,
    };
  }
  if (status === 429) {
    return {
      permanent: false,
      authFailure: false,
      retryAfterSeconds: retryAfterSeconds ?? 60,
      errorCode: CARRIER_ERROR_CODES.RATE_LIMITED,
    };
  }
  if (status === 408 || status >= 500) {
    return {
      permanent: false,
      authFailure: false,
      retryAfterSeconds,
      errorCode: CARRIER_ERROR_CODES.PROVIDER_ERROR,
    };
  }
  if (status >= 400) {
    return {
      permanent: true,
      authFailure: false,
      errorCode: CARRIER_ERROR_CODES.PROVIDER_ERROR,
    };
  }
  return { permanent: false, authFailure: false };
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const at = Date.parse(value);
  if (Number.isFinite(at)) {
    return Math.max(0, Math.round((at - Date.now()) / 1000));
  }
  return undefined;
}
