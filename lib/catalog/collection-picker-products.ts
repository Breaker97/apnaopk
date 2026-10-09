import "server-only";

import * as z from "zod";
import { isValidObjectId } from "@/lib/api/validate";
import { getCollectionProducts } from "@/lib/catalog/collections";
import { Collection } from "@/models";
import type {
  CollectionProductsResult,
  ProductPickerItem,
} from "@/types/product-list";

/** The query both collection-products routes take. */
export const CollectionProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  // 0 skips the list: a caller that only wants its picks checked.
  limit: z.coerce.number().int().min(0).max(100).default(50),
  // Plain text — `getCollectionProducts` escapes it for the match.
  search: z.string().max(100).optional(),
  picked: z.string().max(1000).optional(),
});

/** More ids than any picker sends — the widest shelf holds six. */
const MAX_PICKED = 24;

function toPickerItem(product: unknown): ProductPickerItem {
  const source = product as {
    _id: unknown;
    name?: string;
    title?: string;
    slug?: string;
    sku?: string;
    price?: number;
    images?: unknown;
    status?: string;
  };
  return {
    _id: String(source._id),
    name: source.name ?? "",
    ...(source.title ? { title: source.title } : {}),
    slug: source.slug ?? "",
    ...(source.sku ? { sku: source.sku } : {}),
    price: typeof source.price === "number" ? source.price : 0,
    images: Array.isArray(source.images)
      ? source.images
          .filter((image): image is string => typeof image === "string")
          .slice(0, 1)
      : [],
    status: source.status ?? "",
  };
}

/**
 * The products a collection puts on the online store, in the collection's own
 * order — what a storefront section that draws from it has to choose between.
 * Read through `getCollectionProducts`, the storefront's own reader, so the
 * list is exactly that pool for hand-picked and rule-based collections alike:
 * active, published to the online store, from an approved seller.
 *
 * `picked` asks about specific products as well. `picked` in the answer
 * holds those of them still in that pool, in the order asked — an id that is
 * missing from it has left the collection or is no longer on sale.
 *
 * `vendorId` (a vendor's builder) narrows both to that store's products.
 * Null for a collection that does not exist.
 *
 * Shared by GET /api/admin/collections/[id]/products and its vendor
 * counterpart under /api/vendor/store-page.
 */
export async function readCollectionPickerProducts(
  collectionId: string,
  options: {
    page: number;
    limit: number;
    search?: string;
    picked?: string;
    vendorId?: string;
  },
): Promise<CollectionProductsResult | null> {
  const { page, limit, search, picked, vendorId } = options;
  const pickedIds = [
    ...new Set(
      (picked ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(isValidObjectId),
    ),
  ].slice(0, MAX_PICKED);

  const collection = await Collection.findById(collectionId).lean();
  if (!collection) return null;

  const scope = vendorId ? { vendorId } : {};
  const [list, chosen] = await Promise.all([
    limit > 0
      ? getCollectionProducts(collection, {
          page,
          limit,
          search,
          publishingChannel: "onlineStore",
          fields: "picker",
          ...scope,
        })
      : { products: [], total: 0 },
    pickedIds.length > 0
      ? getCollectionProducts(collection, {
          ids: pickedIds,
          page: 1,
          limit: pickedIds.length,
          publishingChannel: "onlineStore",
          fields: "picker",
          ...scope,
        })
      : { products: [] },
  ]);

  const slot = new Map(pickedIds.map((value, index) => [value, index]));
  return {
    products: list.products.map(toPickerItem),
    total: list.total,
    picked: chosen.products
      .map(toPickerItem)
      .sort(
        (a, b) =>
          (slot.get(a._id) ?? pickedIds.length) -
          (slot.get(b._id) ?? pickedIds.length),
      ),
  };
}
