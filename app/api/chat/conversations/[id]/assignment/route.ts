import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  getConversationAssignmentOptions,
  updateConversationAssignment,
} from "@/lib/conversations/assignment";
import { requireConversationViewer } from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

const AssignmentSchema = z.object({
  userId: z.string().trim().min(1).nullable(),
});

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:assignment:list",
      "lenient",
      session.user.role,
    );
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    return successResponse(
      await getConversationAssignmentOptions({
        conversationId: params.id,
        viewer,
      }),
    );
  },
);

export const PATCH = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:assignment:update",
      "moderate",
      session.user.role,
    );
    const body = await validateBody(request, AssignmentSchema);
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    const conversation = await updateConversationAssignment({
      conversationId: params.id,
      viewer,
      userId: body.userId,
    });
    return successResponse({ conversation }, "Assignment updated");
  },
);
