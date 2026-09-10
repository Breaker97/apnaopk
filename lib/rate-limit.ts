import { connectDB } from "@/lib/db";
import { RateLimitCounter } from "@/models/rate-limit-counter.model";

/**
 * Rate limiting.
 *
 * Counters live in MongoDB by default so a limit means the same thing on
 * every app instance. The in-process map this used to be is still here, but
 * only as a fallback: with two instances each keeps its own tally, so the
 * effective limit doubles and a caller can dodge it entirely by landing on
 * the other one — fine for one process, wrong the moment you scale out or put
 * a second client (a mobile app) on the same API.
 *
 * Windows are aligned to the wall clock (`floor(now / windowMs)`) rather than
 * started by each caller's first request. Instances have to agree on where a
 * window begins or they are counting different things.
 *
 * Set `RATE_LIMIT_STORE=memory` to skip the database round-trip on
 * single-instance deployments. If the database is unreachable the shared
 * store falls back to the in-process one rather than failing requests —
 * degraded limiting beats a dead API.
 */

// Fallback store, and the whole store when RATE_LIMIT_STORE=memory.
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds
  limit: number;
}

interface RateLimitOptions {
  windowMs?: number; // Time window in milliseconds
  max?: number; // Maximum requests per window
}

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX = 100;

function isSharedStoreEnabled(): boolean {
  return process.env.RATE_LIMIT_STORE !== "memory";
}

/** Start of the window `now` falls in, identical on every instance. */
function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

function toResult(
  count: number,
  max: number,
  resetAt: number,
  now: number,
): RateLimitResult {
  const resetIn = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return {
    allowed: count <= max,
    remaining: Math.max(0, max - count),
    resetIn,
    limit: max,
  };
}

function checkInMemory(
  identifier: string,
  windowMs: number,
  max: number,
  now: number,
): RateLimitResult {
  const record = rateLimitStore.get(identifier);

  if (!record || now > record.resetTime) {
    const resetTime = windowStartFor(now, windowMs) + windowMs;
    rateLimitStore.set(identifier, { count: 1, resetTime });
    return toResult(1, max, resetTime, now);
  }

  record.count += 1;
  return toResult(record.count, max, record.resetTime, now);
}

async function checkInMongo(
  identifier: string,
  windowMs: number,
  max: number,
  now: number,
): Promise<RateLimitResult> {
  const windowStart = windowStartFor(now, windowMs);
  const resetAt = windowStart + windowMs;

  await connectDB();
  // One atomic upsert per request: concurrent callers on any instance
  // increment the same document, so none of them can read a stale count and
  // let an over-limit request through.
  const counter = await RateLimitCounter.findOneAndUpdate(
    { key: `${identifier}:${windowStart}` },
    { $inc: { count: 1 }, $setOnInsert: { resetAt: new Date(resetAt) } },
    { upsert: true, returnDocument: "after", projection: { count: 1 } },
  ).lean();

  return toResult(counter?.count ?? 1, max, resetAt, now);
}

/**
 * Count this request against `identifier`'s limit.
 * @returns whether it is allowed, plus what is left in the window
 */
export async function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const { windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX } = options;
  const now = Date.now();

  if (!isSharedStoreEnabled()) {
    return checkInMemory(identifier, windowMs, max, now);
  }

  try {
    return await checkInMongo(identifier, windowMs, max, now);
  } catch (error) {
    console.error("Rate limit store unavailable, falling back to memory:", error);
    return checkInMemory(identifier, windowMs, max, now);
  }
}

/**
 * Clear a caller's counter — used after a successful authentication so a
 * legitimate user is not still locked out by their failed attempts.
 */
export async function resetRateLimit(identifier: string): Promise<void> {
  rateLimitStore.delete(identifier);
  if (!isSharedStoreEnabled()) return;

  try {
    await connectDB();
    // The window is part of the stored key, so clear every window this
    // identifier currently has open rather than guessing which one is live.
    await RateLimitCounter.deleteMany({
      key: { $regex: `^${identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` },
    });
  } catch (error) {
    console.error("Failed to reset shared rate limit counter:", error);
  }
}

// Preset rate limit configurations
export const rateLimitPresets = {
  // Strict: 5 attempts per 15 minutes (for login, password reset)
  strict: { windowMs: 15 * 60 * 1000, max: 5 },

  // Moderate: 20 attempts per 15 minutes (for registration)
  moderate: { windowMs: 15 * 60 * 1000, max: 20 },

  // Lenient: 100 attempts per 15 minutes (for general API)
  lenient: { windowMs: 15 * 60 * 1000, max: 100 },

  // Very strict: 3 attempts per 30 minutes (for 2FA)
  veryStrict: { windowMs: 30 * 60 * 1000, max: 3 },
};

export type RateLimitPreset = keyof typeof rateLimitPresets;

/**
 * Drop elapsed windows from the in-process fallback store. The shared store
 * needs no equivalent — its TTL index reaps expired counters.
 */
function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes. unref() so this housekeeping timer never
// keeps the Node process alive on its own (no-op in non-Node runtimes).
if (typeof setInterval !== "undefined") {
  const cleanupTimer = setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
  if (typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}
