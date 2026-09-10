import { ValidationError } from "@/lib/api/errors";
import { createHeroBanner } from "@/lib/ai-authoring/hero-banner/service";
import type { HeroBannerRuntime } from "@/lib/ai-authoring/hero-banner/brief";
import {
  isHeroBannerEnabled,
  normalizeHeroBannerRequest,
} from "@/lib/ai-authoring/hero-banner/validation";

/**
 * The hero-banner endpoint's body, minus the endpoint.
 *
 * Both of these were exported from `app/api/admin/ai-authoring/hero-banner/
 * route.ts` so `tests/hero-banner.test.ts` could drive the generation path
 * without standing up a request. A `route.ts` may only export HTTP handlers and
 * the framework's config keys, though, and anything else fails the generated
 * route types — a `next build` error that never shows up in dev. Keeping them
 * here preserves exactly what the tests were reaching for.
 */
export async function createHeroBannerFromPayload(
  payload: unknown,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  runtime: HeroBannerRuntime = {},
) {
  if (!isHeroBannerEnabled(env)) {
    throw new ValidationError("AI hero banner generation is disabled");
  }
  return createHeroBanner(
    normalizeHeroBannerRequest(payload),
    undefined,
    runtime,
  );
}

export const HERO_BANNER_ROUTE_OPTIONS = {
  auth: "admin",
  rateLimit: {
    action: "admin:ai-authoring:hero-banner",
    preset: "strict",
  },
} as const;
