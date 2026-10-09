import type { BizRouteEntry } from "@/lib/api-core/registry";
import { bizNotificationListRoute } from "./list";
import { bizNotificationsMarkReadRoute } from "./mark-read";

/** The operator's notifications about the store. */
export const notificationsRoutes: readonly BizRouteEntry[] = [
  bizNotificationListRoute,
  bizNotificationsMarkReadRoute,
];
