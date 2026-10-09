import { VendorDetail } from "@/contracts/mobile/shop/v1/catalog";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { getStorefrontVendorBySlug } from "@/lib/storefront/storefront-vendors";
import { formatVendorAddress } from "@/lib/vendors/vendor-address";
import { toVendorSummary } from "./summaries";

/**
 * GET /vendors/{slug}: a seller's own page header. Its products come from
 * `GET /products?vendor=`. The address only as precisely as the seller chose
 * to publish it (`addressDisplay`), worded in the path's language. Static:
 * expired by the products and settings tags. 404 on a store with one seller.
 */
export const vendorDetailRoute = defineRoute({
  id: "catalog.vendors.detail",
  method: "GET",
  path: "/vendors/{slug}",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: VendorDetail,
  handler: async ({ params, locale }) => {
    const vendor = await getStorefrontVendorBySlug(params.slug);
    if (!vendor) throw new MobileApiError(404, "NOT_FOUND", "This seller is not available.");
    const location = formatVendorAddress(vendor.address, vendor.addressDisplay, locale)?.lines.join(", ");
    const joined = vendor.memberSince ? new Date(vendor.memberSince) : null;
    const memberSince =
      joined && !Number.isNaN(joined.getTime()) ? joined.toISOString() : undefined;
    return {
      ...toVendorSummary(vendor),
      ...(vendor.description ? { description: vendor.description } : {}),
      ...(location ? { location } : {}),
      unitsSold: vendor.unitsSold,
      ...(memberSince ? { memberSince } : {}),
    };
  },
});
