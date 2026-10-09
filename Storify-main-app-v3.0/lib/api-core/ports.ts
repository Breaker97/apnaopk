import type { ErrorCode } from "@/contracts/mobile/shop/v1/common";
import type { MobileAppSettings } from "@/lib/settings/mobile-app";
import type { BizActor, MarketplaceFacts } from "./biz/actor";
import type { RateLimitPresetName } from "./registry";

/**
 * What the pipeline needs from the world around it, as interfaces. The Next
 * implementations are in lib/api-next/ports.ts; tests pass their own.
 */

/**
 * The signed-in person, as a handler sees them: a shopper on the shopper
 * app's API, an operator on the business app's.
 */
export interface MobileSession {
  sessionId: string;
  /**
   * When this sign-in happened (ISO 8601). A change a stolen session could
   * abuse asks for the password, or for a sign-in this recent.
   */
  signedInAt?: string;
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
    phone?: string;
    emailVerified: boolean;
    role: string;
  };
}

/** What the request's cookie comes to. */
export interface SessionResolution {
  session: MobileSession | null;
  /**
   * Only without a session: why a session that is otherwise good is held
   * back, when the shopper can put it right themselves. `EMAIL_NOT_VERIFIED`:
   * the store requires a verified email address, and theirs is not yet.
   */
  held?: Extract<ErrorCode, "EMAIL_NOT_VERIFIED">;
}

export interface SessionPort {
  /**
   * The session the request's cookie carries, or none. Never cached. Only a
   * session signed in from this port's app counts (the shopper app's on the
   * shop pipeline, the business app's on the biz one): a browser's, or the
   * other app's, is none here.
   */
  resolve(headers: Headers): Promise<SessionResolution>;
}

/** Which languages the store serves (lib/i18n/locale-prefix.ts). */
export interface LocaleRouting {
  enabled: readonly string[];
  storeDefault: string;
}

/** The settings every request checks, read through one cached read. */
export interface MobileRuntimeSettings {
  mobileApp: MobileAppSettings;
  routing: LocaleRouting;
  /** Sellers and their access rules, for the business app's operators. */
  marketplace: MarketplaceFacts;
}

export interface SettingsPort {
  runtime(): Promise<MobileRuntimeSettings>;
}

export interface RateLimitWindow {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. */
  resetIn: number;
}

export interface RateLimitPort {
  /** The window of a preset (lib/rate-limit.ts). */
  window(preset: RateLimitPresetName): RateLimitWindow;
  /**
   * The preset the store's admin chose for this counter, or null when the
   * store has rate limiting off (Settings → Security).
   */
  resolvePreset(identifier: string, preset: RateLimitPresetName): RateLimitPresetName | null;
  /** Counts in the shared store (MongoDB), the same on every app instance. */
  checkShared(identifier: string, window: RateLimitWindow): Promise<RateLimitResult>;
}

/** A response as the idempotency store keeps it. */
export interface StoredResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export interface IdempotencyPort {
  /**
   * Runs `execute` once per `(scope, key)`: a repeat with the same request
   * gets the stored answer, one still running is refused (409
   * REQUEST_IN_PROGRESS), and the same key with another request is refused
   * (422 IDEMPOTENCY_KEY_REUSED).
   */
  run(
    request: { scope: string; key: string; routeId: string; requestHash: string },
    execute: () => Promise<StoredResponse>,
  ): Promise<StoredResponse>;
}

export interface PipelineDeps {
  settings: SettingsPort;
  session: SessionPort;
  rateLimit: RateLimitPort;
  /** Whether this deployment is a demo (DEMO_MODE). */
  demoMode(): boolean;
  /** Runs `task` after the response is sent. */
  defer(task: () => Promise<unknown> | unknown): void;
  /** Absent until an endpoint needs it; an entry marked idempotent then fails loudly. */
  idempotency?: IdempotencyPort;
  /** Check each answer against its contract (development and tests). */
  validateOutput: boolean;
  log(message: string, error?: unknown): void;
}

/**
 * The operator behind a business-app session (./biz/actor.ts), read from the
 * database on every request: never cached, so a role or permission taken away
 * applies to the very next call.
 */
export interface ActorPort {
  resolve(session: MobileSession, marketplace: MarketplaceFacts): Promise<BizActor>;
}

/** The business app's pipeline: the same ports, its own session, and the operator. */
export interface BizPipelineDeps extends PipelineDeps {
  actor: ActorPort;
}

export type { RateLimitPresetName };
