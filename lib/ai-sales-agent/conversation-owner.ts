import { createHash } from "node:crypto";
import { AISalesConversation } from "@/models";
import type { AISalesToolContext } from "./types";

/**
 * Who a sales-agent conversation belongs to.
 *
 * A conversation was found by whatever id the client sent, and a guest's was
 * keyed by their `cart_session` cookie — so the id that opens a guest's cart
 * went to the browser in every reply and sat in the admin's conversation list,
 * and anyone holding another conversation's id could write into it and have
 * the model read its history back to them. Conversations now carry an id of
 * their own, and the owner is recorded beside it: the account, or for a guest
 * a hash of their cart session (never the value itself).
 */

type ConversationOwnerFields = {
  sessionId: string;
  userId?: unknown;
  ownerSessionHash?: string | null;
};

type Caller = { userId?: string; sessionId?: string };

export function conversationOwnerHash(cartSessionId: string): string {
  return createHash("sha256").update(cartSessionId).digest("hex");
}

export function ownsConversation(
  conversation: ConversationOwnerFields,
  caller: Caller,
): boolean {
  if (conversation.userId) {
    return Boolean(caller.userId) && String(conversation.userId) === caller.userId;
  }
  if (!caller.sessionId) return false;
  if (conversation.ownerSessionHash) {
    return conversationOwnerHash(caller.sessionId) === conversation.ownerSessionHash;
  }
  // Written before conversations had owners: keyed by the guest's own cart
  // session, which is exactly what proves it is theirs.
  return conversation.sessionId === caller.sessionId;
}

/** Filter for the caller's own conversations, newest first by the caller. */
function ownerConversationFilter(caller: Caller): Record<string, unknown> | null {
  if (caller.userId) return { userId: caller.userId };
  if (!caller.sessionId) return null;
  return {
    userId: { $exists: false },
    $or: [
      { ownerSessionHash: conversationOwnerHash(caller.sessionId) },
      { ownerSessionHash: { $exists: false }, sessionId: caller.sessionId },
    ],
  };
}

/**
 * The conversation this turn continues: the one the client names if it is the
 * caller's, else the caller's latest (a page load forgets the id, not the
 * conversation), else a new one under an id of its own — never the cart
 * session (see the top of this file).
 */
export async function resolveConversation(
  conversationId: string | undefined,
  ctx: AISalesToolContext,
) {
  const caller = { userId: ctx.userId, sessionId: ctx.sessionId };
  if (conversationId) {
    const requested = await AISalesConversation.findOne({
      sessionId: conversationId,
    });
    if (requested && ownsConversation(requested, caller)) {
      return adoptConversation(requested, ctx);
    }
  }
  const ownerFilter = ownerConversationFilter(caller);
  if (ownerFilter) {
    const latest = await AISalesConversation.findOne({
      ...ownerFilter,
      status: "active",
    }).sort({ lastMessageAt: -1 });
    if (latest) return adoptConversation(latest, ctx);
  }
  return new AISalesConversation({
    sessionId: crypto.randomUUID(),
    userId: ctx.userId,
    ownerSessionHash: ctx.sessionId
      ? conversationOwnerHash(ctx.sessionId)
      : undefined,
    locale: ctx.locale,
    messages: [],
    actions: [],
  });
}

/**
 * A conversation written before it had an id of its own is keyed by the cart
 * session: it gets a fresh id and its owner recorded, so the cart session
 * stops travelling with it.
 */
function adoptConversation<
  T extends { sessionId: string; ownerSessionHash?: string | null },
>(conversation: T, ctx: AISalesToolContext): T {
  if (ctx.sessionId && conversation.sessionId === ctx.sessionId) {
    conversation.sessionId = crypto.randomUUID();
    conversation.ownerSessionHash = conversationOwnerHash(ctx.sessionId);
  }
  return conversation;
}
