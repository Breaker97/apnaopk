import { ValidationError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import { normalizeAIAuthoringRequest } from "@/lib/ai-authoring/validation";
import {
  canStreamAuthoringRequest,
  streamAuthoringContent,
} from "@/lib/ai-authoring/stream";
import { assertAIAuthoringAllowed } from "@/lib/ai-authoring/runtime";

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
    // Shares the non-streaming content limiter bucket on purpose — streaming
    // must not be a way around the rate limit.
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:ai-authoring:content",
      "moderate",
      session.user.role,
    );

    const payload = await request.json();
    const authoringRequest = normalizeAIAuthoringRequest(payload);
    if (!canStreamAuthoringRequest(authoringRequest)) {
      throw new ValidationError("This operation does not support streaming");
    }
    const runtime = await assertAIAuthoringAllowed({
      entity: authoringRequest.entity,
      caller: session.user.role === USER_ROLES.ADMIN ? "admin" : "staff",
      userId: session.user.id,
      kind: "text",
    });

    const stream = await streamAuthoringContent(authoringRequest, {
      apiKey: runtime.apiKey,
      model: runtime.textModel,
      brandVoice: runtime.settings.brandVoice,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  },
);
