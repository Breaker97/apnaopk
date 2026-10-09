import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/api/errors";
import { paginatedResponse } from "@/lib/api/response";
import { validateQuery } from "@/lib/api/validate";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { fetchActivityLogList } from "@/lib/activity-log/list";
import {
  VendorActivityLogQuerySchema,
  toVendorListQuery,
} from "@/lib/activity-log/vendor-query";
import { getSettings } from "@/models/settings.model";

/**
 * GET /api/vendor/activity-log
 *
 * What a vendor's own team did in its store: "My activity" (the owner) and, with
 * `view_staff`, "Staff activity" (everyone else on the team).
 *
 * The scope is the Vendor the session resolves to and nothing in the query
 * string: the schema does not name `vendor`, `vendorId` or `actorVendorId`, so
 * they are stripped before the filter is built. "My activity" needs no
 * permission beyond owning an approved store; the staff tab is refused here, not
 * just hidden by the page.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:activity-log:list", preset: "lenient" },
  },
  async ({ request, session }) => {
    const query = validateQuery(request, VendorActivityLogQuerySchema);

    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const tab = query.tab ?? "mine";
    if (tab === "staff") {
      await assertVendorPermission(
        session.user,
        VENDOR_PERMISSIONS.VIEW_STAFF,
        "You do not have permission to view staff activity",
      );
    }

    const list = await fetchActivityLogList(toVendorListQuery(query), {
      kind: "vendor",
      vendorId: String(vendor._id),
      ownerUserId: String(vendor.userId),
      tab,
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);
