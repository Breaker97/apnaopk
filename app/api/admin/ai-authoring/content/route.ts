import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import { normalizeAIAuthoringRequest } from "@/lib/ai-authoring/validation";
import { generateAuthoringContent } from "@/lib/ai-authoring/content";
import { assertAIAuthoringAllowed } from "@/lib/ai-authoring/runtime";

export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.CREATE_PRODUCTS,
      STAFF_PERMISSIONS.EDIT_PRODUCTS,
      STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      STAFF_PERMISSIONS.EDIT_REVIEWS,
      STAFF_PERMISSIONS.MANAGE_REVIEWS,
    ],
    staffMode: "any",
  },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:ai-authoring:content",
      "moderate",
      session.user.role,
    );

    const payload = await request.json();
    const authoringRequest = normalizeAIAuthoringRequest(payload);
    const runtime = await assertAIAuthoringAllowed({
      entity: authoringRequest.entity,
      caller: session.user.role === USER_ROLES.ADMIN ? "admin" : "staff",
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
