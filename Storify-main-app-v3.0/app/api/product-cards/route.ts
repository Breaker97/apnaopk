import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateQuery } from "@/lib/api/validate";
import { loadProductGroupTab } from "@/lib/storefront/section-data/product-group";
import {
  PRODUCT_GROUP_SOURCES,
  productGroupLimit,
} from "@/lib/storefront/sections/product-group-query";
import {
  isProductTargetSource,
  PRODUCT_SOURCE_TARGET_KEYS,
} from "@/lib/storefront/sections/product-source";

const ObjectIdParam = z.string().regex(/^[a-f0-9]{24}$/i, "must be an id");

/**
 * The parameters a tab sends, and nothing else: an unknown parameter is
 * refused, not ignored, so the endpoint can never be steered into a filter a
 * tab does not have. A picked category, brand or collection names its one
 * id — and only the one its source reads.
 */
const QuerySchema = z
  .object({
    source: z.enum(PRODUCT_GROUP_SOURCES),
    ids: z.string().max(2000).optional(),
    categoryId: ObjectIdParam.optional(),
    brandId: ObjectIdParam.optional(),
    collectionId: ObjectIdParam.optional(),
    limit: z.coerce.number().int().optional(),
    // A vendor's landing page: the tab lists that store's products alone.
    vendor: ObjectIdParam.optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    const own = isProductTargetSource(query.source)
      ? PRODUCT_SOURCE_TARGET_KEYS[query.source]
      : null;
    for (const key of Object.values(PRODUCT_SOURCE_TARGET_KEYS)) {
      if (key === own) {
        if (!query[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: "is required" });
        }
      } else if (query[key] !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `is not read by the ${query.source} source`,
        });
      }
    }
    if (query.ids !== undefined && query.source !== "manual") {
      ctx.addIssue({
        code: "custom",
        path: ["ids"],
        message: `is not read by the ${query.source} source`,
      });
    }
  });

/**
 * GET /api/product-cards?source=featured&limit=8
 * GET /api/product-cards?source=category&categoryId=<id>&limit=8
 *
 * One tab of a tabbed product shelf, as the section would have fetched it —
 * through the same source resolver. The shelf sends its first tab with the
 * page and asks here for the others once the page is idle or a tab is
 * reached for.
 *
 * Every home page view with a tabbed shelf asks for its other tabs, so the
 * limit is the browse preset, like the storefront's other reads: one address
 * is often many shoppers (tests/rate-limit-browse.test.ts).
 */
export const GET = withApi(
  { rateLimit: { action: "product-cards", preset: "browse" } },
  async ({ request }) => {
    const { source, ids, categoryId, brandId, collectionId, limit, vendor } =
      validateQuery(request, QuerySchema);
    const { products } = await loadProductGroupTab(
      {
        source,
        productIds: ids ? ids.split(",") : [],
        categoryId,
        brandId,
        collectionId,
      },
      productGroupLimit(limit),
      vendor ? { id: vendor } : undefined,
    );
    return successResponse(products);
  },
);
