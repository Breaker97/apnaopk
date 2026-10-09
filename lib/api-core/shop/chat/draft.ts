import { ChatDraft, ChatDraftQuery } from "@/contracts/mobile/shop/v1/chat";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { previewLiveConversation } from "@/lib/conversations/service";
import {
  sellerLogos,
  shopperChatViewer,
  toChatConversation,
  toChatProduct,
  toChatSeller,
} from "./shopper-chat";

/**
 * GET /chat/draft: a chat from the screen the shopper is on, before its first
 * message. Resolved as POST /chat/conversations resolves it
 * (`previewLiveConversation`), so the screen never promises a seller, a
 * product or an open conversation that sending would not use. A product the
 * store no longer shows is a 404; a seller who is not taking chats is
 * `available: false`.
 */
export const chatDraftRoute = defineRoute({
  id: "chat.draft",
  method: "GET",
  path: "/chat/draft",
  auth: "user",
  cache: { kind: "private" },
  input: ChatDraftQuery,
  output: ChatDraft,
  handler: async ({ input, session }) => {
    await connectDB();
    const draft = await previewLiveConversation({
      viewer: shopperChatViewer(session),
      productId: input.productId,
      vendorId: input.vendorId,
      variantId: input.variantId,
    });
    // The seller and the open conversation are the same vendor: one lookup.
    const logos = await sellerLogos([draft, draft.conversation]);
    return {
      available: draft.available,
      ...(draft.ownerVendorId
        ? { seller: toChatSeller(draft.ownerVendorId, draft.ownerName, logos) }
        : {}),
      ...(draft.productContext ? { product: toChatProduct(draft.productContext) } : {}),
      ...(draft.conversation
        ? { conversation: toChatConversation(draft.conversation, logos) }
        : {}),
    };
  },
});
