import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { getWebPushStatus } from "@/lib/notifications/push-notifications";
import { createNotification } from "@/lib/notifications/notifications";
import { NotificationType } from "@/models/notification.model";
import { USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { withApi } from "@/lib/api/handler";

function getHomeLink(role?: string) {
  if (role === USER_ROLES.ADMIN) {
    return "/admin/dashboard";
  }
  if (isStaffRole(role)) return "/staff/dashboard";
  if (role === USER_ROLES.VENDOR) return "/vendor/dashboard";
  return "/account";
}

export const POST = withApi(
  { auth: "user" },
  async ({ session }) => {
    const status = getWebPushStatus();
    if (!status.configured) {
      throw new ValidationError(
        "Browser push is not configured. Add WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY.",
      );
    }

    const role =
      typeof session.user.role === "string" ? session.user.role : undefined;

    await createNotification({
      userId: session.user.id,
      type: NotificationType.SYSTEM,
      title: "Push notifications enabled",
      message:
        "This browser can now receive important store notifications in the background.",
      link: getHomeLink(role),
      data: { source: "push-test" },
    });

    return successResponse({ sent: true }, "Test push notification sent");
  },
);
