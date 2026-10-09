import { locales } from "@/config/i18n.config";

/**
 * Which of the store's apps a notification belongs to.
 *
 * - `shop`: the shopper app. Everything a person hears about as a customer:
 *   their orders, returns, quotes, store credit.
 * - `biz`: the business app. What reaches somebody running the store: a new
 *   order to fulfil, low stock, a vendor application, a payout.
 *
 * A notification carries no audience field, but its link says it: business
 * notifications open a dashboard (`/admin`, `/vendor`, `/staff`), and nothing
 * else does. That is also why the rule is right for the shopper app: it
 * cannot open a dashboard page, so a notification that leads to one is not
 * its to show. A store owner signed in to their own shopper app is the case
 * this exists for; without it every new order and low-stock alert of the
 * store landed on their phone as a shopper's notification.
 *
 * Web push is not split: the website serves both audiences.
 */
type NotificationApp = "shop" | "biz";

const LOCALE = locales.map((locale) => locale.replace(/[^a-z-]/gi, "")).join("|");

/** A path into a dashboard, with or without the locale in front. */
const DASHBOARD_LINK = new RegExp(`^(?:/(?:${LOCALE}))?/(?:admin|vendor|staff)(?:[/?#]|$)`, "i");

export function notificationAppFor(link: string | null | undefined): NotificationApp {
  return link && DASHBOARD_LINK.test(link) ? "biz" : "shop";
}

/**
 * The MongoDB condition for a shopper's notifications: the same rule as
 * `notificationAppFor`, so the shopper app's list, its unread count and its
 * "mark all read" never touch the store's own notifications. A row without a
 * link is a shopper's.
 */
export function shopNotificationCondition(): Record<string, unknown> {
  return { link: { $not: DASHBOARD_LINK } };
}

/**
 * The MongoDB condition for the store's own notifications: the business
 * app's list, unread count and "mark all read". The other side of
 * `shopNotificationCondition`, by the same rule: between them every
 * notification is exactly one app's.
 */
export function bizNotificationCondition(): Record<string, unknown> {
  return { link: DASHBOARD_LINK };
}
