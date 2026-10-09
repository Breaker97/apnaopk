import {
  MarkNotificationsReadRequest,
  NotificationsReadResult,
} from "@/contracts/mobile/shop/v1/notifications";
import { markAppNotificationsRead } from "@/lib/api-core/notification-inbox";
import { defineRoute } from "@/lib/api-core/registry";

/**
 * PATCH /notifications: mark the named notifications read, or all of them.
 * Only the shopper's own, and only the shopper app's: "mark all read" here
 * leaves a store owner's dashboard notifications unread where they belong.
 */
export const notificationsMarkReadRoute = defineRoute({
  id: "notifications.mark-read",
  method: "PATCH",
  path: "/notifications",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "notifications:read", preset: "lenient" },
  demo: "default",
  input: MarkNotificationsReadRequest,
  output: NotificationsReadResult,
  handler: async ({ input, session }) =>
    markAppNotificationsRead({ userId: session.user.id, app: "shop", ids: input.ids, all: input.all }),
});
