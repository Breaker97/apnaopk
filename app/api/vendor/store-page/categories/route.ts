import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { vendorCategoryPool } from "@/lib/vendors/vendor-category-source";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";
import { getVendorStoreTaxonomy } from "@/lib/vendors/vendor-store-taxonomy";

/**
 * The categories the signed-in vendor can show — those its products are in
 * and the top-level categories above them — in the flat shape the category
 * editors read (`/api/categories?flat=true` on the admin's side), with the
 * marketplace's own `featured` and `parentId`. So the Category List's and
 * the Category Mosaic's sources (Featured, Top-level, Hand-picked) preview
 * and pick exactly as the vendor's page will draw them.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:categories", preset: "lenient" },
  },
  async ({ session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const taxonomy = await getVendorStoreTaxonomy(String(vendor._id));
    return successResponse(
      vendorCategoryPool(taxonomy).map((category) => ({
        _id: category.id,
        name: category.name,
        slug: category.slug,
        ...(category.image ? { image: category.image } : {}),
        parentId: category.parentId,
        featured: category.featured,
        isActive: true,
      })),
    );
  },
);
