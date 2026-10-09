import * as z from "zod";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { resolveProductCollectionOffer } from "@/lib/locations/product-collection";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";

/** Raw, as the listing pages carry them; the resolver parses and bounds them. */
const QuerySchema = z.object({
  lat: z.string().max(32),
  lng: z.string().max(32),
  radius: z.string().max(16).optional(),
});

/**
 * GET /api/products/[slug]/collection-offer?lat=&lng=&radius=
 *
 * "Collect at <branch>" for the product page (hooks/use-collection-offer.ts):
 * the nearest branch in the radius that can hand the product over, and which
 * of its variants it holds. `null` when there is none, or no usable point.
 *
 * Asked from the browser because the page is served from the cache: an answer
 * for one shopper's place rendered into it would be shown to every visitor.
 * The place is the one the page's URL carries, as the page read it when it
 * was rendered per request.
 *
 * Only the branch's name and the variant ids leave the server — the same two
 * facts the page handed its buy box. The per-branch counts behind them stay
 * in lib/locations/product-collection.ts, and a product the storefront does
 * not show is not found here either.
 */
export const GET = withApi<{ slug: string }>(
  { rateLimit: { action: "products:collection-offer", preset: "lenient" } },
  async ({ request, params }) => {
    const { lat, lng, radius } = validateQuery(request, QuerySchema);

    const product = await getStorefrontProductBySlug(params.slug);
    if (!product) return notFoundResponse("Product");

    const offer = await resolveProductCollectionOffer({
      productId: String(product._id),
      vendorId: product.vendorId?._id,
      lat,
      lng,
      radius,
    });

    return successResponse(offer);
  },
);
