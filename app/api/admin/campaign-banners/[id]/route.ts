import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertUnscopedStaff } from "@/lib/access/staff-authz";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import {
  deleteCampaignBanner,
  getCampaignBanner,
  updateCampaignBanner,
} from "@/lib/campaign-banners/service";
import {
  CAMPAIGN_BANNER_CONTENT,
  auditContentDeleted,
  auditContentUpdated,
} from "@/lib/site-config/audit-content";
import { UpdateCampaignBannerSchema } from "@/lib/validations";

const PLATFORM = { kind: "platform" } as const;
const PLATFORM_ONLY = "Campaign banners are managed for the whole store";

export const GET = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_CAMPAIGN_BANNERS],
  },
  async ({ params, staff }) => {
    assertUnscopedStaff(staff?.scope, PLATFORM_ONLY);
    return successResponse(await getCampaignBanner(PLATFORM, params.id));
  },
);

/**
 * PUT: any of the banner's fields. What the payload leaves out keeps its
 * stored value, so the list's pause button can send `{ status }` alone.
 */
export const PUT = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_CAMPAIGN_BANNERS],
  },
  async ({ request, params, session, staff }) => {
    assertUnscopedStaff(staff?.scope, PLATFORM_ONLY);
    const body = await request.json();
    const parsed = UpdateCampaignBannerSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError("Invalid campaign banner");
    // `.partial()` keeps the base schema's defaults, which would overwrite
    // fields the caller did not send.
    const patch: Record<string, unknown> = pickSubmittedKeys(body, parsed.data);

    const { before, after } = await updateCampaignBanner(
      PLATFORM,
      params.id,
      patch,
    );
    await auditContentUpdated(
      createAuditContext(request, session),
      CAMPAIGN_BANNER_CONTENT,
      { id: after.id, name: after.name },
      before,
      after,
    );
    return successResponse(after);
  },
);

export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_CAMPAIGN_BANNERS],
  },
  async ({ request, params, session, staff }) => {
    assertUnscopedStaff(staff?.scope, PLATFORM_ONLY);
    const removed = await deleteCampaignBanner(PLATFORM, params.id);
    await auditContentDeleted(
      createAuditContext(request, session),
      CAMPAIGN_BANNER_CONTENT,
      { id: removed.id, name: removed.name },
      { name: removed.name, type: removed.type, status: removed.status },
    );
    return successResponse({ deleted: true });
  },
);
