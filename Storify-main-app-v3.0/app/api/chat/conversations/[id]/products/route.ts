import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import {
  requireConversationViewer,
  searchShareableProducts,
} from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

/**
 * GET /api/chat/conversations/{id}/products?q=: the products the viewer may
 * share in this conversation, found by name or SKU, for the composer's
 * product picker. The server decides which: the storefront's products and,
 * in a seller's conversation, that seller's own.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:products:search",
      "lenient",
      session.user.role,
    );
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    const products = await searchShareableProducts({
      conversationId: params.id,
      viewer,
      query: request.nextUrl.searchParams.get("q") || undefined,
    });
    return successResponse({ products });
  },
);
