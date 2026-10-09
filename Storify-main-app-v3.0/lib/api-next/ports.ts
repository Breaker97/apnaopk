import { unstable_cache } from "next/cache";
import { after } from "next/server";
import { loadBizActor, marketplaceFacts } from "@/lib/api-core/biz/actor";
import type {
  BizPipelineDeps,
  MobileRuntimeSettings,
  MobileSession,
  PipelineDeps,
  SessionResolution,
} from "@/lib/api-core/ports";
import { resolveRateLimitPresetForIdentifier } from "@/lib/api/rate-limit-config";
import { auth } from "@/lib/auth/auth";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import { resolveLocaleRouting } from "@/lib/i18n/locale-prefix";
import { checkRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { resolveMobileAppSettings } from "@/lib/settings/mobile-app";
import type { SessionClient } from "@/lib/auth/session-audience";
import { getSettingsLean } from "@/models/settings.model";
import { mongoIdempotencyStore } from "./idempotency";

/**
 * The pipeline's ports, on Next.js (lib/api-core/ports.ts).
 */

async function readRuntimeSettings(): Promise<MobileRuntimeSettings> {
  await connectDB();
  const settings = await getSettingsLean();
  return {
    mobileApp: resolveMobileAppSettings(settings.mobileApp),
    routing: resolveLocaleRouting(settings.general),
    marketplace: marketplaceFacts(settings),
  };
}

/**
 * The switch and the languages every mobile request checks: one read of the
 * settings, cached for the whole server on the settings tag, so a save is seen
 * by the next request. A database error is thrown, never replaced by a
 * default: inside a static route a default ("English only", "switched off")
 * would be cached as the store's answer (lib/storefront/cached-read.ts says
 * the same of the storefront's reads).
 */
export const getMobileRuntimeSettings = unstable_cache(
  readRuntimeSettings,
  ["mobile-api-runtime-settings"],
  { revalidate: 60, tags: [CACHE_TAGS.settings] },
);

/**
 * One app's own sessions only (lib/auth/session-audience.ts): a browser's
 * session cookie sent here, or the other app's, is no session at all. A
 * person whom the store wants to verify their email address first is held
 * back with the reason, so the app can say "check your email".
 */
async function resolveSession(
  headers: Headers,
  expect: Extract<SessionClient, "shop-app" | "biz-app">,
): Promise<SessionResolution> {
  const { session, hold } = await auth.api.getSessionVerdict({ headers, expect });
  if (!session) {
    return hold === "email_not_verified"
      ? { session: null, held: "EMAIL_NOT_VERIFIED" }
      : { session: null };
  }
  const { user } = session;
  const signedInAt = session.session.createdAt
    ? new Date(session.session.createdAt)
    : null;
  const shopper: MobileSession = {
    sessionId: session.session.id,
    ...(signedInAt && Number.isFinite(signedInAt.getTime())
      ? { signedInAt: signedInAt.toISOString() }
      : {}),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      ...(user.image ? { image: user.image } : {}),
      ...(user.phone ? { phone: user.phone } : {}),
      emailVerified: user.emailVerified,
      role: user.role,
    },
  };
  return { session: shopper };
}

export const nextPipelineDeps: PipelineDeps = {
  settings: { runtime: getMobileRuntimeSettings },
  session: { resolve: (headers) => resolveSession(headers, "shop-app") },
  rateLimit: {
    window: (preset) => rateLimitPresets[preset],
    resolvePreset: resolveRateLimitPresetForIdentifier,
    checkShared: checkRateLimit,
  },
  demoMode: isDemoModeEnabled,
  defer: (task) => after(async () => {
    await task();
  }),
  idempotency: mongoIdempotencyStore,
  validateOutput: process.env.NODE_ENV !== "production",
  log: (message, error) => console.error(`[mobile-api] ${message}`, error ?? ""),
};

/**
 * The business app's pipeline: the same ports, the business app's own
 * sessions, and the operator read fresh on every request.
 */
export const nextBizPipelineDeps: BizPipelineDeps = {
  ...nextPipelineDeps,
  session: { resolve: (headers) => resolveSession(headers, "biz-app") },
  actor: { resolve: loadBizActor },
};
