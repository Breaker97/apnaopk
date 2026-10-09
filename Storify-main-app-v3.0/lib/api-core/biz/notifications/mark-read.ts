import {
  MarkNotificationsReadRequest,
  NotificationsReadResult,
} from "@/contracts/mobile/biz/v1/notifications";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { markAppNotificationsRead } from "@/lib/api-core/notification-inbox";
import { defineBizRoute } from "@/lib/api-core/registry";

/**
 * PATCH /notifications: mark the named notifications read, or all of them.
 * Only the store's: the operator's own orders' notifications stay unread in
 * their shopper app.
 */
export const bizNotificationsMarkReadRoute = defineBizRoute({
  id: "notifications.mark-read",
  method: "PATCH",
  path: "/notifications",
  auth: "user",
  ...BIZ_ACCESS.account,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:notifications:read", preset: "lenient" },
  demo: "default",
  input: MarkNotificationsReadRequest,
  output: NotificationsReadResult,
  handler: async ({ input, session }) =>
    markAppNotificationsRead({ userId: session.user.id, app: "biz", ids: input.ids, all: input.all }),
});
