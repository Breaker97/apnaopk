import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";

/**
 * The brands the signed-in vendor's products carry, busiest first, in the
 * shape the Brand List editor reads (`/api/brands?assignable=true` on the
 * admin's side) — so its preview shows the strip the vendor's page will draw.
 * Unflagged: on a vendor page the strip is "the store's brands", not the
 * marketplace's featured set.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:brands", preset: "lenient" },
  },
  async ({ session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const { brands } = await getVendorStoreTaxonomy(String(vendor._id));
    return successResponse(
      brands.map((brand) => ({
        _id: brand.id,
        name: brand.name,
        slug: brand.slug,
        ...(brand.logo ? { logo: brand.logo } : {}),
        featured: false,
      })),
    );
  },
);
