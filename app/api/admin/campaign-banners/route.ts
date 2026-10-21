import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertUnscopedStaff } from "@/lib/access/staff-authz";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { createdResponse, successResponse } from "@/lib/api/response";
import { sanitizeSearchString } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import {
  createCampaignBanner,
  listCampaignBanners,
} from "@/lib/campaign-banners/service";
import type { CampaignBannerState } from "@/lib/campaign-banners/types";
import {
  CAMPAIGN_BANNER_CONTENT,
  auditContentCreated,
} from "@/lib/site-config/audit-content";
import { CreateCampaignBannerSchema } from "@/lib/validations";

const PLATFORM = { kind: "platform" } as const;
const PLATFORM_ONLY = "Campaign banners are managed for the whole store";

const STATES: readonly CampaignBannerState[] = [
  "draft",
  "paused",
  "scheduled",
  "live",
  "ended",
];

/**
 * The marketplace's own Campaign Banners (Online Store → Campaign Banner).
 * Admins, and staff holding the campaign-banner grants with no vendor,
 * location or region scope: a scoped staff member cannot be narrowed to a
 * store-wide surface, so they are refused.
 */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_CAMPAIGN_BANNERS],
  },
  async ({ request, staff }) => {
    assertUnscopedStaff(staff?.scope, PLATFORM_ONLY);
    const sp = request.nextUrl.searchParams;
    const state = sp.get("state") ?? "all";
    const items = await listCampaignBanners(PLATFORM, {
      search: sanitizeSearchString(sp.get("search") || ""),
      state: STATES.includes(state as CampaignBannerState)
        ? (state as CampaignBannerState)
        : "all",
    });
    return successResponse(items);
  },
);

export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.MANAGE_CAMPAIGN_BANNERS],
  },
  async ({ request, session, staff }) => {
    assertUnscopedStaff(staff?.scope, PLATFORM_ONLY);
    const parsed = CreateCampaignBannerSchema.safeParse(await request.json());
    if (!parsed.success) throw new ValidationError("Invalid campaign banner");

    const banner = await createCampaignBanner(
      PLATFORM,
      parsed.data,
      session.user.id,
    );
    await auditContentCreated(
      createAuditContext(request, session),
      CAMPAIGN_BANNER_CONTENT,
      { id: banner.id, name: banner.name },
      { name: banner.name, type: banner.type, status: banner.status },
      `as a ${banner.type}`,
    );
    return createdResponse(banner);
  },
);
