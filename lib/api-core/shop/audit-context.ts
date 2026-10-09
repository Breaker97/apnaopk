import { API_BASE_PATH } from "@/contracts/mobile/shop/v1/common";
import type { ClientInfo } from "@/lib/api-core/client-info";
import type { MobileSession } from "@/lib/api-core/ports";
import type { AuditContext } from "@/lib/audit";

/**
 * Who a mobile API handler is acting as, for the Activity Log.
 *
 * A handler sees the request's facts, not the request, so the context carries an
 * `origin` where the web routes carry a `request`. The device is described the
 * way the app's own requests describe it: the app, its platform and its version.
 */
export function shopAppAuditContext(input: {
  session: MobileSession;
  client: ClientInfo;
  requestId?: string;
  locale: string;
  method: string;
  /** The endpoint's path under the locale: `/me/password`. */
  path: string;
}): AuditContext {
  const { session, client, requestId, locale, method, path } = input;
  return {
    userId: session.user.id,
    userEmail: session.user.email,
    userRole: session.user.role,
    origin: {
      ...(client.ip ? { ip: client.ip } : {}),
      ...(requestId ? { requestId } : {}),
      method,
      path: `${API_BASE_PATH}/${locale}${path}`,
      userAgent: ["Storify shop app", client.platform, client.appVersion]
        .filter(Boolean)
        .join(" "),
    },
  };
}
