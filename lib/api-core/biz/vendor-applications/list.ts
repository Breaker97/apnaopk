import {
  VendorApplicationList,
  VendorApplicationListQuery,
} from "@/contracts/mobile/biz/v1/vendor-applications";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { listVendorApplications } from "./read";

/** GET /vendor-applications: the waiting ones by default, oldest first. */
export const vendorApplicationListRoute = defineBizRoute({
  id: "vendor-applications.list",
  method: "GET",
  path: "/vendor-applications",
  auth: "user",
  ...BIZ_ACCESS.REVIEW_VENDOR_APPLICATIONS,
  multiVendorOnly: true,
  cache: { kind: "private" },
  etag: true,
  input: VendorApplicationListQuery,
  output: VendorApplicationList,
  handler: async ({ input }) => listVendorApplications(input),
});
