/**
 * The operator's notifications: the list and marking them read.
 *
 * The same notifications as the website's dashboard bell: a new order to
 * fulfil, low stock, a message, a seller's application, a payout. Only the
 * store's own: a notification an operator receives as a shopper (their own
 * orders) stays in the shopper app. The store keeps them for 30 days.
 *
 * GET /notifications is cheap to ask again: send the last `ETag` back as
 * `If-None-Match` (on returning to the foreground, after a push) and an
 * unchanged list answers 304 before the server reads it.
 */
import * as z from "zod";

import { ListQuery, listOf } from "./common";

/** GET /notifications. Newest first. */
export const NotificationListQuery = ListQuery.extend({
  /** Only the unread ones. */
  unreadOnly: z.boolean().optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuery>;

export const NotificationItem = z.object({
  id: z.string(),
  /** The store's own word: `order_placed`, `order_status`, `product_low_stock`, `chat_message`, `vendor_application`, `payouts`, … */
  type: z.string(),
  /** In the language the store wrote it in. */
  title: z.string(),
  message: z.string(),
  /**
   * The dashboard path it leads to, with the locale in front
   * (`/en/vendor/orders/{id}`): the app opens the matching screen, or the
   * page in a browser when it has none.
   */
  link: z.string().optional(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationList = listOf(NotificationItem).extend({
  /** For the badge: unread notifications in all, not only on this page. */
  unreadCount: z.number().int(),
});
export type NotificationList = z.infer<typeof NotificationList>;

/** PATCH /notifications: mark some, or all, read. */
export const MarkNotificationsReadRequest = z.object({
  /** These. Ids that are not the operator's are skipped. */
  ids: z.array(z.string()).max(100).optional(),
  /** Every unread one. */
  all: z.boolean().optional(),
});
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequest>;

/** The answer to PATCH /notifications. */
export const NotificationsReadResult = z.object({
  unreadCount: z.number().int(),
});
export type NotificationsReadResult = z.infer<typeof NotificationsReadResult>;
