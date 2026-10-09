import { MeOverview } from "@/contracts/mobile/shop/v1/me";
import { defineRoute } from "@/lib/api-core/registry";
import { shopperChatViewer } from "@/lib/api-core/shop/chat/shopper-chat";
import { countUnreadShopperNotifications } from "@/lib/api-core/shop/notifications/inbox";
import { imageSet } from "@/lib/api-core/shop/images";
import { getCartView } from "@/lib/cart/cart-service";
import { readAccountProfile } from "@/lib/customers/account-profile";
import { countUnreadConversationMessages } from "@/lib/conversations/service";
import { wishlistProductIds } from "@/lib/customers/wishlist";
import { connectDB } from "@/lib/db";

/**
 * GET /me/overview: the cart badge, the inbox and chat badges and the
 * wishlist's ids, read side by side. Each number is the one its own screen
 * shows: the cart count is GET /cart's (the same cart view, lines the store no
 * longer sells left out), the unread count GET /notifications' (the shopper
 * app's notifications only), the chat count GET /chat/conversations'.
 */
export const meOverviewRoute = defineRoute({
  id: "me.overview",
  method: "GET",
  path: "/me/overview",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  output: MeOverview,
  handler: async ({ session }) => {
    const userId = session.user.id;
    await connectDB();
    const [cart, unreadNotificationCount, unreadChatMessageCount, savedIds, profile] = await Promise.all([
      getCartView({ userId }, { forApp: true }),
      countUnreadShopperNotifications(userId),
      countUnreadConversationMessages({ viewer: shopperChatViewer(session) }),
      wishlistProductIds(userId),
      readAccountProfile(userId),
    ]);
    const image = imageSet(profile?.image, profile?.name);
    return {
      cartItemCount: cart.totalItems,
      unreadNotificationCount,
      unreadChatMessageCount,
      wishlistProductIds: savedIds,
      ...(image ? { image } : {}),
    };
  },
});
