import { Notification } from "@/models";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { parsePageLimit } from "@/lib/api/list-query";
import {
  computeEtag,
  matchesIfNoneMatch,
  notModifiedResponse,
} from "@/lib/api/etag";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

type NotificationTab = "all" | "unread" | "archived";
type NotificationAction = "read" | "unread" | "archive" | "unarchive";

function getTabQuery(tab: NotificationTab, userId: string) {
  const query: Record<string, unknown> = { userId };

  if (tab === "archived") {
    query.isArchived = true;
    return query;
  }

  query.isArchived = { $ne: true };
  if (tab === "unread") query.isRead = false;

  return query;
}

async function getNotificationCounts(userId: string) {
  const [all, unread, archived] = await Promise.all([
    Notification.countDocuments({ userId, isArchived: { $ne: true } }),
    Notification.countDocuments({
      userId,
      isRead: false,
      isArchived: { $ne: true },
    }),
    Notification.countDocuments({ userId, isArchived: true }),
  ]);

  return { all, unread, archived };
}

/**
 * Cheap "has anything changed for this user" pair.
 *
 * Two indexed reads (`{ userId: 1, updatedAt: -1 }`), against the five a full
 * snapshot costs. Every mutation moves one of them: a create bumps both, a
 * read/archive bumps `updatedAt` — Mongoose stamps it on `updateMany` — and a
 * delete drops the count. The rendered fields (title, message, link, data) are
 * write-once at creation, so nothing the UI shows can change without one of
 * these moving.
 */
async function getNotificationVersion(userId: string) {
  const [total, newest] = await Promise.all([
    Notification.countDocuments({ userId }),
    Notification.findOne({ userId })
      .sort({ updatedAt: -1 })
      .select("updatedAt")
      .lean(),
  ]);

  return {
    total,
    updatedAt: (newest as { updatedAt?: Date } | null)?.updatedAt?.getTime() ?? 0,
  };
}

const NotificationUpdateSchema = z.object({
  ids: z.array(z.string().max(64)).max(500).optional(),
  markAll: z.boolean().optional(),
  action: z.enum(["read", "unread", "archive", "unarchive"]).optional(),
});

/**
 * GET /api/notifications
 * Get current user's notifications
 *
 * Answers 304 when the caller's `If-None-Match` still matches, which is the
 * common case for the polled surfaces (`hooks/use-live-resource.ts`). Pass
 * `recentUnread=true` for the extra newest-unread list the admin drawer needs
 * to raise a toast while sitting on the archived tab, where the main list
 * cannot contain the arrival.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = parsePageLimit(searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const unreadOnly = searchParams.get("unread") === "true";
    const includeRecentUnread = searchParams.get("recentUnread") === "true";
    const tabParam = searchParams.get("tab");
    const tab: NotificationTab =
      tabParam === "unread" || tabParam === "archived" ? tabParam : "all";

    // The version is user-wide, so the request's own shape has to be folded in
    // — otherwise switching tab or page would match the previous tag and the
    // client would be told "nothing changed" about a payload it never held.
    //
    // The caller's id goes in for the same reason one step out: two users with
    // an empty inbox reduce to the same numbers, and the client holds its tag
    // in memory across a sign-out that does not remount (`use-live-resource.ts`
    // keys on the url, which does not change). Cheap insurance that "nothing
    // changed" can never mean "nothing changed for somebody else".
    const version = await getNotificationVersion(session.user.id);
    const etag = computeEtag({
      userId: session.user.id,
      ...version,
      tab,
      page,
      limit,
      unreadOnly,
      includeRecentUnread,
    });

    if (matchesIfNoneMatch(request, etag)) {
      return notModifiedResponse(etag);
    }

    const query = unreadOnly
      ? getTabQuery("unread", session.user.id)
      : getTabQuery(tab, session.user.id);

    const [notifications, total, counts, recentUnreadNotifications] =
      await Promise.all([
        Notification.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Notification.countDocuments(query),
        getNotificationCounts(session.user.id),
        includeRecentUnread
          ? Notification.find({
              userId: session.user.id,
              isRead: false,
              isArchived: { $ne: true },
            })
              .sort({ createdAt: -1 })
              .limit(5)
              .lean()
          : Promise.resolve([]),
      ]);

    const response = successResponse({
      notifications,
      recentUnreadNotifications,
      unreadCount: counts.unread,
      counts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
    response.headers.set("ETag", etag);
    return response;
  },
);

/**
 * PUT /api/notifications
 * Mark notifications as read
 */
export const PUT = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const { ids, markAll, action } = await validateBody(
      request,
      NotificationUpdateSchema,
    );
    const notificationAction: NotificationAction =
      action === "unread" ||
      action === "archive" ||
      action === "unarchive" ||
      action === "read"
        ? action
        : "read";

    const updateByAction: Record<NotificationAction, Record<string, unknown>> = {
      read: { isRead: true },
      unread: { isRead: false },
      archive: { isArchived: true, isRead: true },
      unarchive: { isArchived: false },
    };

    if (markAll) {
      await Notification.updateMany(
        { userId: session.user.id, isRead: false, isArchived: { $ne: true } },
        { $set: { isRead: true } },
      );
    } else if (ids && Array.isArray(ids)) {
      await Notification.updateMany(
        { _id: { $in: ids }, userId: session.user.id },
        { $set: updateByAction[notificationAction] },
      );
    } else {
      throw new ValidationError("Notification ids are required");
    }

    const counts = await getNotificationCounts(session.user.id);

    return successResponse({ unreadCount: counts.unread, counts });
  },
);

/**
 * DELETE /api/notifications
 * Delete notifications
 */
export const DELETE = withApi(
  // Shopper-owned data: dismissing your own notifications stays available on demo.
  { auth: "user", demo: "allow" },
  async ({ request, session }) => {
    const notificationId = request.nextUrl.searchParams.get("id");
    const deleteAll = request.nextUrl.searchParams.get("all") === "true";

    if (deleteAll) {
      await Notification.deleteMany({ userId: session.user.id });
    } else if (notificationId) {
      await Notification.deleteOne({
        _id: notificationId,
        userId: session.user.id,
      });
    }

    const counts = await getNotificationCounts(session.user.id);

    return successResponse({
      message: "Notifications deleted",
      unreadCount: counts.unread,
      counts,
    });
  },
);
