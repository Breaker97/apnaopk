import { AuthenticationError, ValidationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { rateLimitByIP, rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { normalizeAIAuthoringRequest } from "@/lib/ai-authoring/validation";
import { generateAuthoringContent } from "@/lib/ai-authoring/content";

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    if (!session) {
      await rateLimitByIP(request, "moderate");
      throw new AuthenticationError();
    }

    await rateLimitByUser(
      request,
      session.user.id,
      "customer:ai-authoring:review",
      "moderate",
      session.user.role,
    );

    const payload = await request.json();
    const authoringRequest = normalizeAIAuthoringRequest(payload);
    if (authoringRequest.entity !== "review") {
      throw new ValidationError("Customer AI authoring is limited to reviews");
    }
    if (
      authoringRequest.operation !== "review" &&
      authoringRequest.operation !== "summary"
    ) {
      throw new ValidationError("Unsupported review authoring operation");
    }

    const draft = await generateAuthoringContent(authoringRequest);

    return successResponse(draft);
  },
);
