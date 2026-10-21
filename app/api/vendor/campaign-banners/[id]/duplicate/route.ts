import { withApi } from "@/lib/api/handler";
import { createdResponse } from "@/lib/api/response";
import { createAuditContext } from "@/lib/audit";
import { duplicateCampaignBanner } from "@/lib/campaign-banners/service";
import { STORE_BUILDER_DEMO_MODE_MESSAGE } from "@/lib/demo-mode-shared";
import {
  CAMPAIGN_BANNER_CONTENT,
  auditContentCreated,
} from "@/lib/site-config/audit-content";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";

/** A copy of the vendor's banner, saved as a draft. */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:campaign-banners:duplicate" },
    demo: "block-mutations",
    demoMessage: STORE_BUILDER_DEMO_MODE_MESSAGE,
  },
  async ({ request, params, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "edit");
    const copy = await duplicateCampaignBanner(
      { kind: "vendor", vendorId: String(vendor._id) },
      params.id,
      session.user.id,
    );
    await auditContentCreated(
      createAuditContext(request, session, { vendorId: vendor._id }),
      CAMPAIGN_BANNER_CONTENT,
      { id: copy.id, name: copy.name },
      { name: copy.name, type: copy.type, status: copy.status },
      "as a copy",
    );
    return createdResponse(copy);
  },
);
