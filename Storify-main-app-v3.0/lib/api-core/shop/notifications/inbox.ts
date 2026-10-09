import { appInboxFilter, countUnreadAppNotifications } from "@/lib/api-core/notification-inbox";

/**
 * The shopper's inbox as the shopper app sees it: their notifications, not
 * archived, and none of the store's own (notification-app.ts). Shared by the
 * list, marking read and GET /me/overview, so the badge and the list never
 * count differently.
 */
export function shopperInboxFilter(userId: string): Record<string, unknown> {
  return appInboxFilter(userId, "shop");
}

export async function countUnreadShopperNotifications(userId: string): Promise<number> {
  return countUnreadAppNotifications(userId, "shop");
}
