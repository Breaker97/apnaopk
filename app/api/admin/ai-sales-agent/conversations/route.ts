import { AISalesConversation } from "@/models";
import { paginatedResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { parsePageLimit } from "@/lib/api/list-query";

type ConversationListItem = {
  _id: unknown;
  sessionId?: string;
  userId?: unknown;
  locale?: string;
  status?: string;
  messages?: Array<{ role?: string; content?: string; createdAt?: Date }>;
  actions?: unknown[];
  cartItemCount?: number;
  lastMessageAt?: Date;
  updatedAt?: Date;
  createdAt?: Date;
};

export const GET = withApi(
  { auth: "admin" },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 20,
      maxLimit: 50,
    });
    const search = (searchParams.get("search") || "").trim();
    const locale = (searchParams.get("locale") || "").trim();
    const status = (searchParams.get("status") || "").trim();

    const filter: Record<string, unknown> = {};
    if (locale) filter.locale = locale;
    if (status && (status === "active" || status === "closed")) {
      filter.status = status;
    }
    if (search) {
      const regex = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      filter.$or = [
        { sessionId: regex },
        { "messages.content": regex },
      ];
    }

    const total = await AISalesConversation.countDocuments(filter);
    const skip = (page - 1) * limit;
    const conversations = await AISalesConversation.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select(
        "sessionId userId locale status messages actions cartItemCount updatedAt lastMessageAt createdAt",
      )
      .lean();

    const data = (conversations as ConversationListItem[]).map((conversation) => {
      const messages = conversation.messages || [];
      const lastUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user");
      const lastAssistantMessage = [...messages]
        .reverse()
        .find((message) => message.role === "assistant");
      return {
        id: String(conversation._id),
        sessionId: conversation.sessionId,
        userId: conversation.userId ? String(conversation.userId) : undefined,
        locale: conversation.locale,
        status: conversation.status,
        messageCount: messages.length,
        actionCount: conversation.actions?.length || 0,
        cartItemCount: conversation.cartItemCount || 0,
        lastUserMessage: lastUserMessage?.content || "",
        lastAssistantMessage: lastAssistantMessage?.content || "",
        lastMessageAt:
          conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt,
        createdAt: conversation.createdAt,
      };
    });

    return paginatedResponse(data, page, limit, total);
  },
);
