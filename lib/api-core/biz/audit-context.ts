import { API_BASE_PATH } from "@/contracts/mobile/biz/v1/common";
import type { ClientInfo } from "@/lib/api-core/client-info";
import type { MobileSession } from "@/lib/api-core/ports";
import type { AuditContext } from "@/lib/audit";

/**
 * Who a business-app handler is acting as, for the Activity Log: the same row
 * the website's dashboards write, with the request's facts where the web
 * routes carry a `request`, and the device described the way the app's own
 * requests describe it (the shopper app's twin: ../shop/audit-context.ts).
 *
 * `vendorId` stamps the seller a seller acts for, as the vendor routes do
 * when they hold the `Vendor`; left out, `audit()` works it out from the actor
 * (a seller's staff member gets their seller, an administrator none).
 */
export function bizAppAuditContext(input: {
  session: MobileSession;
  client: ClientInfo;
  requestId?: string;
  locale: string;
  method: string;
  /** The endpoint's path under the locale: `/products/{id}`, the id filled in. */
  path: string;
  vendorId?: string;
}): AuditContext {
  const { session, client, requestId, locale, method, path, vendorId } = input;
  return {
    userId: session.user.id,
    userEmail: session.user.email,
    userRole: session.user.role,
    ...(vendorId ? { vendorId } : {}),
    origin: {
      ...(client.ip ? { ip: client.ip } : {}),
      ...(requestId ? { requestId } : {}),
      method,
      path: `${API_BASE_PATH}/${locale}${path}`,
      userAgent: ["Storify business app", client.platform, client.appVersion].filter(Boolean).join(" "),
    },
  };
}
