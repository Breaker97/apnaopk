import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  updateConversationStatus,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

const StatusSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "closed", "spam"]),
});

export const PATCH = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    const viewer = await resolveConversationViewer({ session });
    if (!viewer) throw new ValidationError("Conversation viewer is required");
    const parsed = StatusSchema.safeParse(await request.json());
    if (!parsed.success) throw new ValidationError("Invalid conversation status");
    const conversation = await updateConversationStatus({
      conversationId: params.id,
      viewer,
      status: parsed.data.status,
    });
    return successResponse({ conversation }, "Conversation updated");
  },
);
