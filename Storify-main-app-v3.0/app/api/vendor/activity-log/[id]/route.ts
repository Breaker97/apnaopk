import { withApi } from "@/lib/api/handler";
import { NotFoundError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { hasVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { fetchActivityLogEntry } from "@/lib/activity-log/list";
import { getSettings } from "@/models/settings.model";

/**
 * GET /api/vendor/activity-log/[id]
 *
 * One entry of the caller's own store, with its before and after values and an
 * allowlisted request block (IP and device — never the method, path or request
 * id). Answers 404 for a row of another store, for one that does not exist, and
 * for a staff member's row when the caller lacks `view_staff`: the three are
 * deliberately indistinguishable.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:activity-log:detail", preset: "lenient" },
  },
  async ({ params, session }) => {
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id);
    const canViewStaff = await hasVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.VIEW_STAFF,
    );

    const entry = await fetchActivityLogEntry(params.id, {
      kind: "vendor",
      vendorId: String(vendor._id),
      ownerUserId: String(vendor.userId),
      canViewStaff,
    });
    if (!entry) throw new NotFoundError("Activity log entry");

    return successResponse(entry);
  },
);
