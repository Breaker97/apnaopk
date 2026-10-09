import "server-only";

import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { createNotification } from "@/lib/notifications/notifications";
import type { MetaCatalogPauseCode } from "@/models/meta-catalog-feed.model";
import { NotificationType } from "@/models/notification.model";
import { User } from "@/models";

const WHAT_TO_DO: Record<MetaCatalogPauseCode, string> = {
  token: "Generate a new System User token in Meta Business Manager and save it",
  permission:
    "Give the System User the catalog with Manage permission, and a token with catalog_management",
  catalog: "Check the catalog ID, and that the catalog is assigned to the System User",
  key: "Paste the access token again",
};

/**
 * Tell the admins once that Meta stopped taking the catalog. Shaped like a
 * chat channel going down (lib/conversations/providers/connection-health.ts):
 * a bell row (and a push) for every admin, deduped on the event while unread,
 * so a sync that keeps meeting the same dead token does not repeat itself.
 * Never throws — the caller is already handling a failure.
 */
export async function notifyAdminsMetaCatalogPaused(params: {
  code: MetaCatalogPauseCode;
  reason: string;
}): Promise<void> {
  try {
    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id")
      .lean<Array<{ _id: unknown }>>();
    const message =
      `Meta stopped accepting catalog updates: ${params.reason.slice(0, 300)}. ` +
      `${WHAT_TO_DO[params.code]}; changes are kept and sent once it works again.`;
    await Promise.allSettled(
      admins.map((admin) =>
        createNotification({
          userId: String(admin._id),
          type: NotificationType.SYSTEM,
          title: "Meta catalog sync is paused",
          message,
          link: "/admin/settings/meta-catalog",
          data: { event: "meta_catalog_paused", pauseCode: params.code },
          dedupe: {
            type: NotificationType.SYSTEM,
            "data.event": "meta_catalog_paused",
            isRead: false,
          },
        }),
      ),
    );
  } catch (error) {
    console.error("Meta catalog: could not tell the admins the sync paused", error);
  }
}
