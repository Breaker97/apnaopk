import { Collection, Product } from "@/models";
import {
  successResponse,
  notFoundResponse,
} from "@/lib/api/response";
import { validatePartialBody, isValidObjectId } from "@/lib/api/validate";
import { UpdateCollectionSchema } from "@/lib/validations";
import { normalizeCollectionConditions, updateCollectionProductCount, syncCollectionProducts } from "@/lib/catalog/collections";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";
import { revalidateCollectionContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";

function toHandle(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * GET /api/admin/collections/[id]
 * Get a single collection by ID
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:collections:read", preset: "lenient" },
  },
  async ({ params }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Collection");

    const collection = await Collection.findById(id)
      .populate("products", "name title slug price images status")
      .lean();

    if (!collection) {
      return notFoundResponse("Collection");
    }

    return successResponse(collection);
  },
);

/**
 * PUT /api/admin/collections/[id]
 * Update a collection
 */
export const PUT = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:collections:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Collection");

    const body = await validatePartialBody(request, UpdateCollectionSchema);

    delete (body as Record<string, unknown>)._id;
    delete (body as Record<string, unknown>).createdAt;

    const existing = await Collection.findById(id)
      .select("slug products")
      .lean();
    if (!existing) {
      return notFoundResponse("Collection");
    }
    const oldProductIds = Array.isArray(existing.products)
      ? existing.products.map((p: unknown) => String(p))
      : [];

    const updateSet: Record<string, unknown> = {
      ...(body as unknown as Record<string, unknown>),
    };

    if (Array.isArray(body.conditions) && body.conditions.length > 0) {
      updateSet.conditions = await normalizeCollectionConditions(body.conditions);
    }

    // Handle slug/handle update
    const rawHandle =
      typeof body?.seo?.handle === "string" && body.seo.handle.trim()
        ? body.seo.handle.trim()
        : typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : undefined;

    if (rawHandle) {
      const nextSlug = toHandle(rawHandle);
      if (nextSlug && nextSlug !== existing.slug) {
        const conflict = await Collection.exists({
          slug: nextSlug,
          _id: { $ne: id },
        });
        if (conflict) {
          updateSet.slug = `${nextSlug}-${Date.now()}`;
        } else {
          updateSet.slug = nextSlug;
        }
      }

      updateSet.handle = updateSet.slug || toHandle(rawHandle);
      updateSet.seo = { ...(body.seo || {}), handle: updateSet.handle };
    }

    const collection = await Collection.findByIdAndUpdate(
      id,
      { $set: updateSet },
      { returnDocument: "after", runValidators: true }
    )
      .populate("products", "name title slug price images status")
      .lean();

    if (!collection) {
      return notFoundResponse("Collection");
    }

    // Mirror manual membership changes onto product.collectionIds so the
    // storefront `?collection=` filter (which reads collectionIds) stays in
    // sync with Collection.products (which the collection page reads).
    if (Array.isArray(body.products)) {
      const newProductIds = body.products.map((p) => String(p));
      await syncCollectionProducts(id, oldProductIds, newProductIds).catch(
        (err) =>
          console.error("Failed to sync collection product memberships:", err),
      );
    }

    // Update product count after changes
    await updateCollectionProductCount(id);

    // Fetch updated collection with new product count
    const updatedCollection = await Collection.findById(id)
      .populate("products", "name title slug price images status")
      .lean();

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "collection",
      id,
      existing as unknown as Record<string, unknown>,
      updatedCollection as unknown as Record<string, unknown>
    );

    revalidateCollectionContent({
      slugs: [existing.slug, updatedCollection?.slug],
    });

    return successResponse(updatedCollection);
  },
);

/**
 * DELETE /api/admin/collections/[id]
 * Delete a collection
 */
export const DELETE = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:collections:delete", preset: "strict" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Collection");

    const before = await Collection.findById(id).lean();
    const collection = await Collection.findByIdAndDelete(id);

    if (!collection) {
      return notFoundResponse("Collection");
    }

    // Remove this collection from products' collectionIds
    await Product.updateMany(
      { collectionIds: id },
      { $pull: { collectionIds: id } }
    );

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "collection",
      id,
      (before || collection.toObject?.() || collection) as unknown as Record<
        string,
        unknown
      >
    );

    revalidateCollectionContent({ slugs: [before?.slug, collection.slug] });

    return successResponse({ message: "Collection deleted successfully" });
  },
);
