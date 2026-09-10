import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { normalizeAIAuthoringRequest } from "@/lib/ai-authoring/validation";
import { generateAuthoringContent } from "@/lib/ai-authoring/content";
import { assertVendorAuthoringAccess } from "@/lib/ai-authoring/permissions";
import { USER_ROLES } from "@/config/app.config";
import { assertAIAuthoringAllowed } from "@/lib/ai-authoring/runtime";

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:ai-authoring:content",
      "moderate",
      session.user.role,
    );

    const payload = await request.json();
    const authoringRequest = normalizeAIAuthoringRequest(payload);
    await assertVendorAuthoringAccess(
      session.user,
      authoringRequest,
    );
    const runtime = await assertAIAuthoringAllowed({
      entity: authoringRequest.entity,
      caller: session.user.role === USER_ROLES.ADMIN ? "admin" : "vendor",
      userId: session.user.id,
      kind: "text",
    });

    const draft = await generateAuthoringContent(authoringRequest, {
      apiKey: runtime.apiKey,
      model: runtime.textModel,
      brandVoice: runtime.settings.brandVoice,
    });

    return successResponse(draft);
  },
);
