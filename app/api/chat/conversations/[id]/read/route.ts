import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  markConversationRead,
  requireConversationViewer,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

export const POST = withApi<{ id: string }>(
  { auth: "user" },
  async ({ params, session }) => {
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    const conversation = await markConversationRead({
      conversationId: params.id,
      viewer,
    });
    return successResponse({ conversation });
  },
);
