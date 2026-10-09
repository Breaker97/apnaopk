import { bizNotificationListRoute } from "@/lib/api-core/biz/notifications/list";
import { bizNotificationsMarkReadRoute } from "@/lib/api-core/biz/notifications/mark-read";
import { bizPrivateRoute } from "@/lib/api-next/routes";

export const GET = bizPrivateRoute(bizNotificationListRoute);
export const PATCH = bizPrivateRoute(bizNotificationsMarkReadRoute);
