import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import {
  createdResponse,
  successResponse,
} from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  listConversations,
  requireConversationViewer,
  startLiveConversation,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

// No `name`/`email`: the shopper is signed in, so their identity comes from the
// session rather than from anything the client can claim.
const StartConversationSchema = z.object({
  message: z.string().min(1).max(4000),
  subject: z.string().trim().max(180).optional(),
  productId: z.string().trim().optional(),
  vendorId: z.string().trim().optional(),
  variantId: z.string().trim().optional(),
  variantName: z.string().trim().max(160).optional(),
  clientMessageId: z.string().trim().max(100).optional(),
});

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:conversations:list",
      "moderate",
      session.user.role,
    );
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    const limit = Number.parseInt(
      request.nextUrl.searchParams.get("limit") || "50",
      10,
    );
    const status = request.nextUrl.searchParams.get("status") || undefined;
    const before = request.nextUrl.searchParams.get("before") || undefined;
    return successResponse(
      await listConversations({ viewer, limit, status, before }),
    );
  },
);

/**
 * Starting a storefront chat is sign-in gated, so the shopper always owns the
 * thread from their account inbox rather than a browser-scoped guest cookie.
 * The public contact form keeps its own anonymous route.
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:conversations:start",
      "moderate",
      session.user.role,
    );

    const parsed = StartConversationSchema.safeParse(await request.json());
    if (!parsed.success) {
      const { ValidationError } = await import("@/lib/api/errors");
      throw new ValidationError(
        parsed.error.issues[0]?.message || "Invalid conversation",
      );
    }

    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    const result = await startLiveConversation({
      viewer,
      ...parsed.data,
    });
    return result.created
      ? createdResponse(result, "Conversation started")
      : successResponse(result, "Message sent");
  },
);
