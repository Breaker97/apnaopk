import { Collection } from "@/models";
import { paginatedResponse, createdResponse } from "@/lib/api/response";
import { validateQuery, validateBody } from "@/lib/api/validate";
import {
  CollectionListQuerySchema,
  CreateCollectionSchema,
} from "@/lib/validations";
import { normalizeCollectionConditions, updateCollectionProductCount, syncCollectionProducts } from "@/lib/catalog/collections";
import { revalidateCollectionContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { fetchAdminCollectionList } from "@/lib/catalog/collection-list";

function toHandle(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * GET /api/admin/collections
 * Get all collections for admin
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:collections:list", preset: "lenient" },
  },
  async ({ request }) => {
    const { page, limit, search, status, type, channel, sortOrder } =
      validateQuery(request, CollectionListQuerySchema);

    const list = await fetchAdminCollectionList({
      page,
      limit,
      search,
      status,
      type,
      channel,
      sortOrder,
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

/**
 * POST /api/admin/collections
 * Create a new collection
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:collections:create", preset: "moderate" },
  },
  async ({ request }) => {
    const body = await validateBody(request, CreateCollectionSchema);

    const baseHandle =
      typeof body?.seo?.handle === "string" && body.seo.handle.trim()
        ? body.seo.handle.trim()
        : body.title;

    const slug = toHandle(baseHandle);

    const existingCollection = await Collection.findOne({ slug });
    const finalSlug = existingCollection ? `${slug}-${Date.now()}` : slug;

    const normalizedConditions =
      body.collectionType === "automated" && Array.isArray(body.conditions) && body.conditions.length > 0
        ? await normalizeCollectionConditions(body.conditions)
        : body.conditions;

    const collectionData = {
      ...body,
      conditions: normalizedConditions,
      slug: finalSlug,
      handle: finalSlug,
      seo: { ...(body.seo || {}), handle: finalSlug },
    };

    const collection = await Collection.create(collectionData);

    // Mirror manual membership onto product.collectionIds so the storefront
    // `?collection=` filter matches the collection page from creation.
    if (Array.isArray(body.products) && body.products.length > 0) {
      await syncCollectionProducts(
        collection._id.toString(),
        [],
        body.products.map((p: unknown) => String(p)),
      ).catch((err) =>
        console.error("Failed to sync collection product memberships:", err),
      );
    }

    // Update product count
    await updateCollectionProductCount(collection._id.toString());

    // Fetch the updated collection
    const updatedCollection = await Collection.findById(collection._id).lean();

    revalidateCollectionContent({ slugs: [updatedCollection?.slug] });

    return createdResponse(updatedCollection);
  },
);
