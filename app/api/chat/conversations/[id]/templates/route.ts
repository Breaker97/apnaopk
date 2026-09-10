import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  listConversationWhatsAppTemplates,
  requireConversationViewer,
  sendConversationWhatsAppTemplate,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

const SendTemplateSchema = z.object({
  templateId: z.string().trim().min(1),
  values: z.record(
    z.string().max(200),
    z.string().trim().min(1).max(2000),
  ).default({}),
  clientMessageId: z.string().trim().max(100).optional(),
});

export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:templates:list",
      "lenient",
      session.user.role,
    );
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    return successResponse(
      await listConversationWhatsAppTemplates({
        conversationId: params.id,
        viewer,
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
      "chat:templates:send",
      "strict",
      session.user.role,
    );
    const body = await validateBody(request, SendTemplateSchema);
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    return successResponse(
      await sendConversationWhatsAppTemplate({
        conversationId: params.id,
        viewer,
        ...body,
      }),
      "WhatsApp template queued",
    );
  },
);
