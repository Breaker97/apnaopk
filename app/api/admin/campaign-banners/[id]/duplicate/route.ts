import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertUnscopedStaff } from "@/lib/access/staff-authz";
import { withApi } from "@/lib/api/handler";
import { createdResponse } from "@/lib/api/response";
import { createAuditContext } from "@/lib/audit";
import { duplicateCampaignBanner } from "@/lib/campaign-banners/service";
import {
  CAMPAIGN_BANNER_CONTENT,
  auditContentCreated,
} from "@/lib/site-config/audit-content";

/** A copy of a banner, saved as a draft. */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_CAMPAIGN_BANNERS],
  },
  async ({ request, params, session, staff }) => {
    assertUnscopedStaff(
      staff?.scope,
      "Campaign banners are managed for the whole store",
    );
    const copy = await duplicateCampaignBanner(
      { kind: "platform" },
      params.id,
      session.user.id,
    );
    await auditContentCreated(
      createAuditContext(request, session),
      CAMPAIGN_BANNER_CONTENT,
      { id: copy.id, name: copy.name },
      { name: copy.name, type: copy.type, status: copy.status },
      "as a copy",
    );
    return createdResponse(copy);
  },
);
