import { Notification } from "@/models";

/**
 * A cheap "has anything changed for this user" pair, for the conditional
 * requests of the notification lists (the web's GET /api/notifications and
 * the mobile API's GET /notifications).
 *
 * Two indexed reads (`{ userId: 1, updatedAt: -1 }`), against the five a full
 * snapshot costs. Every mutation moves one of them: a create bumps both, a
 * read/archive bumps `updatedAt` — Mongoose stamps it on `updateMany` — and a
 * delete drops the count. The rendered fields (title, message, link, data) are
 * write-once at creation, so nothing a list shows can change without one of
 * these moving.
 */
export async function getNotificationVersion(userId: string) {
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
