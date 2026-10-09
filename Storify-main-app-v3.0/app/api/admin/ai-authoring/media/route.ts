import { ValidationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { USER_ROLES } from "@/config/app.config";
import {
  normalizeAIAuthoringRequest,
  validateMediaOptions,
} from "@/lib/ai-authoring/validation";
import {
  editAuthoringMedia,
  generateAuthoringMedia,
} from "@/lib/ai-authoring/media";
import { assertAIAuthoringAllowed } from "@/lib/ai-authoring/runtime";
import { brandColorsOf } from "@/lib/ai-authoring/settings";

const MEDIA_OPERATIONS = new Set(["image", "icon", "logo"]);

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
      "admin:ai-authoring:media",
      "strict",
      session.user.role,
    );

    const payload = await request.json();
    const authoringRequest = normalizeAIAuthoringRequest(payload);
    const isEdit = authoringRequest.operation === "image_edit";
    if (!isEdit && !MEDIA_OPERATIONS.has(authoringRequest.operation)) {
      throw new ValidationError("AI media route only supports image operations");
    }

    const runtime = await assertAIAuthoringAllowed({
      entity: authoringRequest.entity,
      caller: session.user.role === USER_ROLES.ADMIN ? "admin" : "staff",
      userId: session.user.id,
      kind: "image",
    });

    const options = validateMediaOptions(
      typeof payload === "object" && payload !== null && "options" in payload
        ? (payload as { options?: unknown }).options
        : undefined,
    );
    const mediaRuntime = {
      apiKey: runtime.apiKey,
      model: runtime.imageModel,
      defaults: runtime.settings.imageDefaults,
      styleGuidance: runtime.settings.brandVoice.imageStyle,
      brandColors: brandColorsOf(runtime.settings),
    };
    const media = isEdit
      ? await editAuthoringMedia(authoringRequest, options, mediaRuntime)
      : await generateAuthoringMedia(authoringRequest, options, mediaRuntime);

    return successResponse(media);
  },
);
