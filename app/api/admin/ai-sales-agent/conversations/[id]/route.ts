import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB, mongoose } from "@/lib/db";
import { AISalesConversation, User } from "@/models";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  handleApiError,
} from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { USER_ROLES } from "@/config/app.config";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";

type RouteContext = { params: Promise<{ id: string }> };

type ConversationDoc = {
  _id: unknown;
  sessionId?: string;
  userId?: unknown;
  locale?: string;
  status?: string;
  messages?: Array<{
    role?: string;
    content?: string;
    metadata?: unknown;
    createdAt?: Date;
  }>;
  actions?: Array<{
    type?: string;
    name?: string;
    payload?: unknown;
    createdAt?: Date;
  }>;
  recommendedProductIds?: unknown[];
  cartItemCount?: number;
  lastMessageAt?: Date;
  updatedAt?: Date;
  createdAt?: Date;
};

type UserLean = {
  _id: unknown;
  name?: string;
  email?: string;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    if (session.user.role !== USER_ROLES.ADMIN) throw new AuthorizationError();

    await connectDB();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid conversation id");
    }

    const conversation = await AISalesConversation.findById(id).lean<ConversationDoc | null>();
    if (!conversation) throw new NotFoundError("Conversation");

    let customer: { id: string; name?: string; email?: string } | undefined;
    if (conversation.userId) {
      const userDoc = await User.findById(conversation.userId)
        .select("name email")
        .lean<UserLean | null>();
      if (userDoc) {
        customer = {
          id: String(userDoc._id),
          name: userDoc.name,
          email: userDoc.email,
        };
      }
    }

    return successResponse({
      id: String(conversation._id),
      sessionId: conversation.sessionId,
      locale: conversation.locale,
      status: conversation.status,
      cartItemCount: conversation.cartItemCount || 0,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      customer,
      messages: (conversation.messages || []).map((message, index) => ({
        id: `${String(conversation._id)}-msg-${index}`,
        role: message.role,
        content: message.content || "",
        metadata: message.metadata ?? null,
        createdAt: message.createdAt,
      })),
      actions: (conversation.actions || []).map((action, index) => ({
        id: `${String(conversation._id)}-act-${index}`,
        type: action.type,
        name: action.name,
        payload: action.payload ?? null,
        createdAt: action.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    if (session.user.role !== USER_ROLES.ADMIN) throw new AuthorizationError();

    const demoBlock = getDemoModeMutationResponse();
    if (demoBlock) return demoBlock;

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:ai-sales-agent:delete-conversation",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid conversation id");
    }

    const deleted = await AISalesConversation.findByIdAndDelete(id);
    if (!deleted) throw new NotFoundError("Conversation");

    return successResponse({ id });
  } catch (error) {
    return handleApiError(error);
  }
}
