import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { ValidationError } from "@/lib/api/errors";
import {
  appendConversationMessage,
  listConversationMessages,
  requireConversationViewer,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

const SendMessageSchema = z.object({
  message: z.string().min(1).max(4000),
  clientMessageId: z.string().trim().max(100).optional(),
});

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:messages:list",
      "lenient",
      session.user.role,
    );
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    const before = request.nextUrl.searchParams.get("before") || undefined;
    const limit = Number.parseInt(
      request.nextUrl.searchParams.get("limit") || "30",
      10,
    );
    return successResponse(
      await listConversationMessages({
        conversationId: params.id,
        viewer,
        before,
        limit,
      }),
    );
  },
);

export const POST = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:messages:send",
      "moderate",
      session.user.role,
    );
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );

    const parsed = SendMessageSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || "Invalid message",
      );
    }
    return successResponse(
      await appendConversationMessage({
        conversationId: params.id,
        viewer,
        ...parsed.data,
      }),
      "Message sent",
    );
  },
);
