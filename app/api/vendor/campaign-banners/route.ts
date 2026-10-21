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
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import {
  CAMPAIGN_BANNER_CONTENT,
  auditContentCreated,
} from "@/lib/site-config/audit-content";
import { CreateCampaignBannerSchema } from "@/lib/validations";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";

const STATES: readonly CampaignBannerState[] = [
  "draft",
  "paused",
  "scheduled",
  "live",
  "ended",
];

/**
 * The signed-in vendor's own Campaign Banners (Online Store → Campaign
 * Banner). Same shapes as /api/admin/campaign-banners, so the admin's screens
 * run on them unchanged; every read and write is limited to the vendor's own
 * banners, and the vendor id comes from the session, never the request.
 * Reading needs the store-settings view grant, changing needs the edit grant
 * — the same ones the sliders use.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:campaign-banners:list", preset: "lenient" },
  },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const sp = request.nextUrl.searchParams;
    const state = sp.get("state") ?? "all";
    const items = await listCampaignBanners(
      { kind: "vendor", vendorId: String(vendor._id) },
      {
        search: sanitizeSearchString(sp.get("search") || ""),
        state: STATES.includes(state as CampaignBannerState)
          ? (state as CampaignBannerState)
          : "all",
      },
    );
    return successResponse(items);
  },
);

export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:campaign-banners:create" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const parsed = CreateCampaignBannerSchema.safeParse(await request.json());
    if (!parsed.success) throw new ValidationError("Invalid campaign banner");

    const banner = await createCampaignBanner(
      { kind: "vendor", vendorId: String(vendor._id) },
      parsed.data,
      session.user.id,
    );
    await auditContentCreated(
      createAuditContext(request, session, { vendorId: vendor._id }),
      CAMPAIGN_BANNER_CONTENT,
      { id: banner.id, name: banner.name },
      { name: banner.name, type: banner.type, status: banner.status },
      `as a ${banner.type}`,
    );
    return createdResponse(banner);
  },
);
