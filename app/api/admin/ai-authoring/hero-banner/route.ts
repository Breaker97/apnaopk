import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { assertAIAuthoringAllowed } from "@/lib/ai-authoring/runtime";
// Kept out of this file deliberately: a `route.ts` may only export HTTP
// handlers and the framework's config keys, and anything else fails the
// generated route types at build time.
import {
  createHeroBannerFromPayload,
  HERO_BANNER_ROUTE_OPTIONS,
} from "@/lib/ai-authoring/hero-banner/api";

export const POST = withApi(
  HERO_BANNER_ROUTE_OPTIONS,
  async ({ request, session }) => {
  const startedAt = Date.now();
  let operation = "unknown";
  try {
    const payload = await request.json();
    if (payload && typeof payload === "object" && "operation" in payload) {
      operation = String(payload.operation).slice(0, 20);
    }
    const authoring = await assertAIAuthoringAllowed({
      surface: "heroBanner",
      caller: "admin",
      userId: session.user.id,
      kind: "image",
    });
    const result = await createHeroBannerFromPayload(payload, process.env, {
      apiKey: authoring.apiKey,
      textModel: authoring.textModel,
      imageModel: authoring.imageModel,
    });
    console.info("[AI Hero Banner]", {
      operation,
      status: "success",
      durationMs: Date.now() - startedAt,
      mediaId: result.media._id,
    });
    return successResponse(result);
  } catch (error) {
    console.error("[AI Hero Banner]", {
      operation,
      status: "error",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
  },
);
