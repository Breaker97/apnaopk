import type { ClientInfo } from "./client-info";
import { MobileApiError } from "./errors";
import type {
  MobileSession,
  RateLimitPort,
  RateLimitResult,
  RateLimitWindow,
} from "./ports";
import type { RateLimitPolicy } from "./registry";

/**
 * Rate limits for the mobile API.
 *
 * The web keys a guest on the address, and one address is often hundreds of
 * shoppers (a carrier's shared address, an office). Every screen of the app is
 * an API call, so the app is limited per shopper instead: the signed-in user,
 * else the install id the app made on its first launch. An install id costs
 * nothing to make up, so the address keeps a ceiling of its own, far above
 * any one shopper's limit, that only a machine rotating ids reaches.
 *
 * Where the count is kept depends on the route:
 * - a public read counts in this process. It is answered from a cache, and a
 *   database round trip per request to count it would cost more than the
 *   answer; a second instance keeping its own count only doubles a limit that
 *   is generous anyway.
 * - everything else (a shopper's own reads, every write) counts in the shared
 *   store (lib/rate-limit.ts), the same on every instance.
 * A static route is not limited at all: its answer comes from the response
 * cache without running anything.
 */

/**
 * How many shoppers' worth one address gets. A carrier's shared address is
 * hundreds of people, so this is a backstop against one machine inventing
 * install ids, not a limit anyone browsing reaches.
 */
const ADDRESS_CEILING_ALLOWANCE = 20;

type RateLimitStore = "memory" | "shared";

interface Counter {
  count: number;
  resetAt: number;
}

/**
 * Counters kept in this process. Bounded: install ids are made up by the
 * client, so without a bound a flood of new ids would grow this without end.
 * The oldest counters go first; Map keeps insertion order.
 */
const MAX_COUNTERS = 50_000;
const counters = new Map<string, Counter>();

function checkInProcess(
  identifier: string,
  window: RateLimitWindow,
  now: number,
): RateLimitResult {
  const current = counters.get(identifier);
  if (!current || now >= current.resetAt) {
    if (current) counters.delete(identifier);
    if (counters.size >= MAX_COUNTERS) {
      // Down to 90% at once, so a flood pays for this once per few thousand
      // new ids rather than on each.
      for (const key of counters.keys()) {
        if (counters.size < MAX_COUNTERS * 0.9) break;
        counters.delete(key);
      }
    }
    const resetAt = (Math.floor(now / window.windowMs) + 1) * window.windowMs;
    counters.set(identifier, { count: 1, resetAt });
    return { allowed: window.max >= 1, resetIn: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
  }
  current.count += 1;
  return {
    allowed: current.count <= window.max,
    resetIn: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

/** Test hook: forget every in-process counter. */
export function resetInProcessRateLimits(): void {
  counters.clear();
}

function describeWait(seconds: number): string {
  const wait =
    seconds < 60 ? { amount: seconds, unit: "second" } : { amount: Math.ceil(seconds / 60), unit: "minute" };
  return `${wait.amount} ${wait.unit}${wait.amount === 1 ? "" : "s"}`;
}

/**
 * The 429 every limit answers with, in the app's envelope: the wait in
 * words, `details.retryAfter` and `Retry-After`. Also for an endpoint that
 * counts a limit of its own (order tracking's per-order limit).
 */
export function rateLimitExceeded(resetIn: number): MobileApiError {
  return new MobileApiError(
    429,
    "RATE_LIMIT_EXCEEDED",
    `Too many requests. Wait ${describeWait(resetIn)}, then try again.`,
    {
      details: { retryAfter: resetIn },
      headers: { "Retry-After": String(resetIn) },
    },
  );
}

/**
 * How many shoppers' worth one person running the store gets: the website's
 * dashboards give every store role this many times a shopper's limit
 * (`rateLimitByUser` in lib/api/rate-limit-middleware.ts), and the business
 * app is the same work from a phone.
 */
export const OPERATOR_ALLOWANCE = 20;

/**
 * Counts this request against the route's limit, and throws 429 when it is
 * over. A request with no user, no install id and no address the proxy chain
 * vouches for (a local development server) is not counted: one bucket shared
 * by every such caller would be worse than none.
 *
 * The business app's operators (`operator`) are counted under the area the
 * admin chose presets for (Settings → Security: `admin:` for the store's own
 * team, `vendor:` for sellers), with `OPERATOR_ALLOWANCE`.
 */
export async function enforceRateLimit(input: {
  policy: RateLimitPolicy;
  store: RateLimitStore;
  session: MobileSession | null;
  client: ClientInfo;
  port: RateLimitPort;
  operator?: { area: "admin" | "vendor" };
  now?: number;
}): Promise<void> {
  const { policy, store, session, client, port, operator } = input;
  const now = input.now ?? Date.now();
  const allowance = operator ? OPERATOR_ALLOWANCE : 1;
  const bucket = operator ? `${operator.area}:${policy.bucket}` : policy.bucket;

  const subject = session
    ? `user:${session.user.id}`
    : client.installId
      ? `install:${client.installId}`
      : undefined;
  const checks: { identifier: string; allowance: number }[] = [];
  if (subject) checks.push({ identifier: `${subject}:${bucket}`, allowance });
  if (client.ip) {
    checks.push({
      identifier: `ip:${client.ip}:mobile:${policy.bucket}`,
      // Without a shopper to count, the address is the shopper.
      allowance: (subject ? ADDRESS_CEILING_ALLOWANCE : 1) * allowance,
    });
  }

  for (const { identifier, allowance } of checks) {
    const preset = port.resolvePreset(identifier, policy.preset);
    if (!preset) return;
    const base = port.window(preset);
    const window = { windowMs: base.windowMs, max: base.max * allowance };
    const result =
      store === "memory"
        ? checkInProcess(identifier, window, now)
        : await port.checkShared(identifier, window);
    if (!result.allowed) throw rateLimitExceeded(result.resetIn);
  }
}
