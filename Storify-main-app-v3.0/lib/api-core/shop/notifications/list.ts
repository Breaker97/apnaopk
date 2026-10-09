import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { NotificationList, NotificationListQuery } from "@/contracts/mobile/shop/v1/notifications";
import { readNotificationPage } from "@/lib/api-core/notification-inbox";
import { defineRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { getNotificationVersion } from "@/lib/notifications/notification-version";

/**
 * GET /notifications: the shopper's inbox, newest first.
 *
 * Polled whenever the app comes back to the foreground or a push arrives, and
 * most of those find nothing new: the validator (two indexed reads) answers
 * 304 before the list and the count are read.
 */
export const notificationListRoute = defineRoute({
  id: "notifications.list",
  method: "GET",
  path: "/notifications",
  auth: "user",
  cache: { kind: "private" },
  input: NotificationListQuery,
  output: NotificationList,
  validator: async ({ session }) => {
    await connectDB();
    return getNotificationVersion(session.user.id);
  },
  handler: async ({ input, session, locale }) =>
    readNotificationPage({
      userId: session.user.id,
      app: "shop",
      locale,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
      cursor: input.cursor,
      unreadOnly: input.unreadOnly,
    }),
});
