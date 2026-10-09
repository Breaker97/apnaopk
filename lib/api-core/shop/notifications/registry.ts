import type { RouteEntry } from "@/lib/api-core/registry";
import { notificationListRoute } from "./list";
import { notificationsMarkReadRoute } from "./mark-read";

/**
 * The shopper's notifications.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const notificationsRoutes: readonly RouteEntry[] = [
  notificationListRoute,
  notificationsMarkReadRoute,
];
