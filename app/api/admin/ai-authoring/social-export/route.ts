import { AuthorizationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import { getAIAuthoringRuntime } from "@/lib/ai-authoring/runtime";
import { validateSocialExportRequest } from "@/lib/ai-authoring/social-export/validation";
import { createSocialExport } from "@/lib/ai-authoring/social-export/service";

/**
 * Social export is a deterministic sharp render of an already-uploaded image,
 * so — unlike the media route — it needs no OpenAI key and consumes no AI
 * usage cap. It is still gated on the AI feature flag, role access, and the
 * rate limiter.
 */
export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.EDIT_PRODUCTS,
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
    ],
    staffMode: "any",
  },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:ai-authoring:social-export",
      "strict",
      session.user.role,
    );

    const runtime = await getAIAuthoringRuntime();
    if (!runtime.settings.enabled) {
      throw new AuthorizationError("AI authoring is disabled in Settings");
    }
    if (
      session.user.role !== USER_ROLES.ADMIN &&
      !runtime.settings.access.staffEnabled
    ) {
      throw new AuthorizationError(
        "AI authoring is not enabled for staff accounts",
      );
    }

    const payload = await request.json();
    const exportRequest = validateSocialExportRequest(payload);
    const alt =
      payload && typeof payload === "object" && "alt" in payload
        ? (payload as { alt?: unknown }).alt
        : undefined;

    const media = await createSocialExport({
      ...exportRequest,
      padColor: runtime.settings.brandKit.primaryColor || undefined,
      logoUrl: runtime.settings.brandKit.logoUrl || undefined,
      alt: typeof alt === "string" ? alt : undefined,
    });

    return successResponse(media);
  },
);
