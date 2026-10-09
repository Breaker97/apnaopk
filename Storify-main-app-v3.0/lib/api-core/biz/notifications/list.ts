import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import { NotificationList, NotificationListQuery } from "@/contracts/mobile/biz/v1/notifications";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { readNotificationPage } from "@/lib/api-core/notification-inbox";
import { defineBizRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { getNotificationVersion } from "@/lib/notifications/notification-version";

/**
 * GET /notifications: the operator's notifications about the store, newest
 * first. An unchanged list answers 304 before it is read.
 */
export const bizNotificationListRoute = defineBizRoute({
  id: "notifications.list",
  method: "GET",
  path: "/notifications",
  auth: "user",
  ...BIZ_ACCESS.account,
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
      app: "biz",
      locale,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
      cursor: input.cursor,
      unreadOnly: input.unreadOnly,
    }),
});
