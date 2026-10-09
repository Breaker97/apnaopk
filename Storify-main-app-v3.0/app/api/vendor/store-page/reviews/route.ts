import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { listVendorReviewOptions } from "@/lib/vendors/vendor-review-highlights";
import { requireVendorStorePageAccess } from "@/lib/vendors/vendor-store-page-access";

/**
 * The signed-in vendor's quotable reviews, for the Review Highlights
 * hand-pick: approved reviews of its own products with something written,
 * newest first. `?search=` narrows by the words, `?minRating=` by stars, and
 * `?ids=a,b` reads the picks back by id so the editor can label them.
 */
export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:store-page:reviews", preset: "lenient" },
  },
  async ({ request, session }) => {
    const vendor = await requireVendorStorePageAccess(session.user, "view");
    const params = request.nextUrl.searchParams;
    const ids = params.get("ids");
    const minRating = Number(params.get("minRating"));
    const options = await listVendorReviewOptions({
      vendorId: String(vendor._id),
      // Escaped for the regex by the reader itself.
      search: (params.get("search") || "").slice(0, 100),
      minRating: Number.isFinite(minRating) && minRating > 0 ? minRating : 1,
      ...(ids ? { ids: ids.split(",").slice(0, 12) } : {}),
    });
    return successResponse(options);
  },
);
