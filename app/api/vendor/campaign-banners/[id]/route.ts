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
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import {
  CAMPAIGN_BANNER_CONTENT,
  auditContentDeleted,
  auditContentUpdated,
} from "@/lib/site-config/audit-content";
import { UpdateCampaignBannerSchema } from "@/lib/validations";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";

const demo = {
  demo: "block-mutations",
  demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
} as const;

export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:campaign-banners:read", preset: "lenient" },
  },
  async ({ params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    return successResponse(
      await getCampaignBanner(
        { kind: "vendor", vendorId: String(vendor._id) },
        params.id,
      ),
    );
  },
);

export const PUT = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:campaign-banners:update" },
    ...demo,
  },
  async ({ request, params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const body = await request.json();
    const parsed = UpdateCampaignBannerSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError("Invalid campaign banner");
    const patch: Record<string, unknown> = pickSubmittedKeys(body, parsed.data);

    const { before, after } = await updateCampaignBanner(
      { kind: "vendor", vendorId: String(vendor._id) },
      params.id,
      patch,
    );
    await auditContentUpdated(
      createAuditContext(request, session, { vendorId: vendor._id }),
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
    auth: "user",
    rateLimit: { action: "vendor:campaign-banners:delete" },
    ...demo,
  },
  async ({ request, params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const removed = await deleteCampaignBanner(
      { kind: "vendor", vendorId: String(vendor._id) },
      params.id,
    );
    await auditContentDeleted(
      createAuditContext(request, session, { vendorId: vendor._id }),
      CAMPAIGN_BANNER_CONTENT,
      { id: removed.id, name: removed.name },
      { name: removed.name, type: removed.type, status: removed.status },
    );
    return successResponse({ deleted: true });
  },
);
