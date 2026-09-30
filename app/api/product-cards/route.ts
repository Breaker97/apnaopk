import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateQuery } from "@/lib/api/validate";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import {
  PRODUCT_GROUP_SOURCES,
  buildProductGroupQuery,
  productGroupLimit,
} from "@/lib/storefront/sections/product-group-query";

const QuerySchema = z.object({
  source: z.enum(PRODUCT_GROUP_SOURCES),
  ids: z.string().max(2000).optional(),
  limit: z.coerce.number().int().optional(),
});

/**
 * GET /api/product-cards?source=featured&limit=8
 *
 * One tab of a tabbed product shelf, as the section would have fetched it. The
 * shelf sends its first tab with the page and asks here for the others once
 * the page is idle or a tab is reached for.
 *
 * Every home page view with a tabbed shelf asks for its other tabs, so the
 * limit is the browse preset, like the storefront's other reads: one address
 * is often many shoppers (tests/rate-limit-browse.test.ts).
 */
export const GET = withApi(
  { rateLimit: { action: "product-cards", preset: "browse" } },
  async ({ request }) => {
    const { source, ids, limit } = validateQuery(request, QuerySchema);
    const query = buildProductGroupQuery(
      source,
      ids ? ids.split(",") : [],
      productGroupLimit(limit),
    );
    return successResponse(query ? await getStorefrontProductCards(query) : []);
  },
);
