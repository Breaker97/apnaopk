import { notificationListRoute } from "@/lib/api-core/shop/notifications/list";
import { notificationsMarkReadRoute } from "@/lib/api-core/shop/notifications/mark-read";
import { privateRoute } from "@/lib/api-next/routes";

export const GET = privateRoute(notificationListRoute);
export const PATCH = privateRoute(notificationsMarkReadRoute);
