import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireConversationViewer } from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import { syncWhatsAppTemplates } from "@/lib/conversations/providers/whatsapp-templates";

const SyncTemplatesSchema = z.object({
  connectionId: z.string().trim().min(1),
});

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:templates:sync",
      "strict",
      session.user.role,
    );
    const body = await validateBody(request, SyncTemplatesSchema);
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    return successResponse(
      await syncWhatsAppTemplates({
        viewer,
        connectionId: body.connectionId,
      }),
      "WhatsApp templates synchronized",
    );
  },
);
