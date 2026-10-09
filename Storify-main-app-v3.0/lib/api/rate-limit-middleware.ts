/**
 * Rate Limiting Middleware Helpers
 * Simplified helpers for applying rate limits in API routes
 */

import { NextRequest } from "next/server";
import {
  checkRateLimit,
  rateLimitPresets,
  type RateLimitPreset,
} from "@/lib/rate-limit";
import { RateLimitError } from "./errors";
import { resolveClientIp } from "@/lib/api/client-ip";
import { rateLimitMessage } from "@/lib/api/rate-limit-message";
import { resolveRateLimitPresetForIdentifier } from "@/lib/api/rate-limit-config";
import { USER_ROLES, type UserRole } from "@/config/app.config";

export type { RateLimitPreset };

/**
 * How many times an action's limit the store's own people get: vendors,
 * staff and the admin team.
 *
 * They used to skip the limiter altogether, so a vendor's or staff member's
 * account — or a stolen one — could call upload, AI and every other limited
 * route without end. Their work comes in bursts a shopper's does not (a
 * catalogue's images one request each, a till on a busy day), so the limit is
 * the action's own twenty times over: generous, never unlimited.
 */
const STORE_ROLE_ALLOWANCE = 20;

/**
 * How many sessions' worth one address gets, when a guest is limited by
 * session. Many shoppers can share an address — a mobile carrier's NAT, an
 * office — so it is a backstop, not the limit.
 */
const GUEST_ADDRESS_ALLOWANCE = 5;

/**
 * The address backstop for the steps many shoppers behind one address take in
 * the same quarter hour: checkout and payment, the cart, order tracking. A
 * mobile carrier's shared address (common where carriers ran out of IPv4), an
 * office or a school is hundreds of people, and at five sessions' worth the
 * sixth shopper's checkout there was refused. Each shopper's own limit — per
 * session, per signed-in account — stays as tight as it was; the address only
 * stops one machine from rotating sessions without end.
 */
export const SHOPPING_ADDRESS_ALLOWANCE = 10;

function isStoreRole(role?: UserRole | string | null): boolean {
  return typeof role === "string" && role !== USER_ROLES.CUSTOMER;
}

/**
 * The client's IP address — see `lib/api/client-ip.ts` for how the proxy
 * chain is read — or "unknown" when the headers do not establish one.
 *
 * Takes anything carrying headers, so a server component can pass
 * `{ headers: await headers() }` instead of keeping its own copy of the
 * proxy-header order.
 */
export function getClientIP(request: {
  headers: Pick<NextRequest["headers"], "get">;
}): string {
  return resolveClientIp(request.headers) ?? "unknown";
}

/**
 * Counts one request against `identifier`'s limit, with no request to word a
 * refusal from: the caller words it — the website in the visitor's language,
 * the mobile API in its own envelope. Null when the request is allowed, or
 * when the store has rate limiting off.
 */
export async function countRequest(
  identifier: string,
  preset: RateLimitPreset = "lenient",
  allowance = 1,
): Promise<{ resetIn: number } | null> {
  const resolved = resolveRateLimitPresetForIdentifier(identifier, preset);
  if (!resolved) return null;
  const config = rateLimitPresets[resolved];
  const result = await checkRateLimit(identifier, {
    ...config,
    max: config.max * allowance,
  });
  return result.allowed ? null : { resetIn: result.resetIn };
}

/**
 * Apply rate limiting with the given identifier and preset
 * @throws RateLimitError if rate limit exceeded
 */
async function applyRateLimit(
  request: NextRequest,
  identifier: string,
  preset: RateLimitPreset = "lenient",
  allowance = 1,
): Promise<void> {
  const refusal = await countRequest(identifier, preset, allowance);
  if (refusal) {
    throw new RateLimitError(
      await rateLimitMessage(request, refusal.resetIn),
      refusal.resetIn,
    );
  }
}

function getRequestRateLimitScope(request: NextRequest): string {
  const req = request as NextRequest & {
    nextUrl?: { pathname?: string };
    url?: string;
  };
  const method = req.method || "UNKNOWN";

  if (req.nextUrl?.pathname) {
    return `${method}:${req.nextUrl.pathname}`;
  }

  if (req.url) {
    try {
      return `${method}:${new URL(req.url).pathname}`;
    } catch {
      // Fall through to the stable fallback below.
    }
  }

  return `${method}:/unknown`;
}

/**
 * Rate limit by IP address
 * Use for public endpoints or when user is not authenticated. `allowance`
 * multiplies the preset where one address is many visitors by design (see
 * `SHOPPING_ADDRESS_ALLOWANCE`).
 */
export async function rateLimitByIP(
  request: NextRequest,
  preset: RateLimitPreset = "lenient",
  allowance = 1,
): Promise<void> {
  const ip = getClientIP(request);
  const scope = getRequestRateLimitScope(request);
  await applyRateLimit(request, `ip:${ip}:${scope}`, preset, allowance);
}

/**
 * Rate limit by user ID and action
 * Use for authenticated endpoints to track per-user limits. A vendor, staff
 * member or admin gets `STORE_ROLE_ALLOWANCE` times the limit a shopper does.
 */
export async function rateLimitByUser(
  request: NextRequest,
  userId: string,
  action: string,
  preset: RateLimitPreset = "moderate",
  role?: UserRole | string | null
): Promise<void> {
  await applyRateLimit(
    request,
    `user:${userId}:${action}`,
    preset,
    isStoreRole(role) ? STORE_ROLE_ALLOWANCE : 1,
  );
}

/**
 * Rate limit by session ID, with the caller's address as a backstop.
 * Use for guest users with a session identifier.
 *
 * A guest's session is a cookie the guest sends: a new one on each request
 * used to open a fresh bucket each time, so the limit bound nothing. The
 * address behind them has a limit of its own on the same action now.
 */
export async function rateLimitBySession(
  request: NextRequest,
  sessionId: string,
  action: string,
  preset: RateLimitPreset = "lenient",
  addressAllowance = GUEST_ADDRESS_ALLOWANCE,
): Promise<void> {
  const ip = resolveClientIp(request.headers);
  // No address the proxy chain vouches for (local development, a proxy not
  // configured): one shared bucket for every guest would be worse than none.
  if (ip) {
    await applyRateLimit(
      request,
      `ip:${ip}:guest:${action}`,
      preset,
      addressAllowance,
    );
  }
  await applyRateLimit(request, `session:${sessionId}:${action}`, preset);
}

