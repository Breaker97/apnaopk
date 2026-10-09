import { VendorApplicationDetail } from "@/contracts/mobile/biz/v1/vendor-applications";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { readVendorApplication } from "./read";

/**
 * GET /vendor-applications/{id}: one application, with its documents as
 * links signed for a few minutes. No ETag: every answer carries new links.
 */
export const vendorApplicationDetailRoute = defineBizRoute({
  id: "vendor-applications.detail",
  method: "GET",
  path: "/vendor-applications/{id}",
  auth: "user",
  ...BIZ_ACCESS.REVIEW_VENDOR_APPLICATIONS,
  multiVendorOnly: true,
  cache: { kind: "private" },
  output: VendorApplicationDetail,
  handler: async ({ params }) => readVendorApplication(params.id),
});
