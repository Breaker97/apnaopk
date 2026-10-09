import { connectDB, mongoose } from "@/lib/db";
import {
  bizNotificationCondition,
  shopNotificationCondition,
} from "@/lib/notifications/notification-app";
import { withLocalePrefix } from "@/lib/notifications/notification-link";
import { Notification } from "@/models";
import { MobileApiError } from "./errors";
import { afterTimeCursor, encodeTimeCursor } from "./shop/time-cursor";

/**
 * A person's notifications as one of the store's apps shows them: theirs, not
 * archived, and only that app's (lib/notifications/notification-app.ts). The
 * shopper app's GET/PATCH /notifications and the business app's answer
 * through these, so the list, the badge and "mark all read" never count
 * differently, and a store owner's dashboard notifications stay out of their
 * shopper app (and their own orders out of their business app).
 */

type InboxApp = "shop" | "biz";

export function appInboxFilter(userId: string, app: InboxApp): Record<string, unknown> {
  return {
    userId,
    isArchived: { $ne: true },
    ...(app === "biz" ? bizNotificationCondition() : shopNotificationCondition()),
  };
}

export async function countUnreadAppNotifications(userId: string, app: InboxApp): Promise<number> {
  await connectDB();
  return Notification.countDocuments({ ...appInboxFilter(userId, app), isRead: false });
}

type Row = {
  _id: unknown;
  type?: string;
  title?: string;
  message?: string;
  link?: string;
  isRead?: boolean;
  createdAt?: Date;
};

/** One page of the app's notifications, newest first, with the unread count. */
export async function readNotificationPage(input: {
  userId: string;
  app: InboxApp;
  locale: string;
  limit: number;
  cursor?: string;
  unreadOnly?: boolean;
}) {
  const { userId, app, locale, limit } = input;
  await connectDB();

  const conditions: Record<string, unknown>[] = [appInboxFilter(userId, app)];
  if (input.unreadOnly) conditions.push({ isRead: false });
  if (input.cursor) conditions.push(afterTimeCursor(input.cursor));

  const [rows, unreadCount] = await Promise.all([
    Notification.find({ $and: conditions })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select("type title message link isRead createdAt")
      .lean<Row[]>(),
    countUnreadAppNotifications(userId, app),
  ]);
  const page = rows.slice(0, limit);

  return {
    items: page.map((row) => ({
      id: String(row._id),
      type: String(row.type ?? ""),
      title: String(row.title ?? ""),
      message: String(row.message ?? ""),
      ...(row.link?.trim() ? { link: withLocalePrefix(row.link, locale) } : {}),
      read: row.isRead === true,
      createdAt: new Date(row.createdAt ?? 0).toISOString(),
    })),
    nextCursor: rows.length > limit ? encodeTimeCursor(page[page.length - 1]) : null,
    unreadCount,
  };
}

/**
 * Marks the named notifications read, or all of them, in this app only; ids
 * that are not the person's (or not this app's) are skipped. Answers the
 * unread count after it.
 */
export async function markAppNotificationsRead(input: {
  userId: string;
  app: InboxApp;
  ids?: string[];
  all?: boolean;
}): Promise<{ unreadCount: number }> {
  if (!input.all && !input.ids?.length) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "Name the notifications to mark read, or send all: true.", {
      errors: { ids: ["Send the ids to mark read, or all: true."] },
    });
  }
  await connectDB();
  const filter = appInboxFilter(input.userId, input.app);
  if (input.all) {
    await Notification.updateMany({ ...filter, isRead: false }, { $set: { isRead: true } });
  } else {
    const ids = (input.ids ?? []).filter((id) => mongoose.isValidObjectId(id));
    if (ids.length > 0) {
      await Notification.updateMany({ ...filter, _id: { $in: ids } }, { $set: { isRead: true } });
    }
  }
  return { unreadCount: await countUnreadAppNotifications(input.userId, input.app) };
}
