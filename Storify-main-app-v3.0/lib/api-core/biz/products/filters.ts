import { ProductFilterOptions, type ProductListQuery } from "@/contracts/mobile/biz/v1/products";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { productScopeFilter, type BizScope } from "@/lib/api-core/biz/scope";
import { defineBizRoute } from "@/lib/api-core/registry";
import { expandCategoryIdsWithDescendants } from "@/lib/catalog/categories";
import { buildConditionQueryAsync } from "@/lib/catalog/collections";
import { connectDB } from "@/lib/db";
import { Brand, Category, Collection, Product } from "@/models";
import type { CollectionCondition } from "@/types";

/**
 * The list's category, brand and collection filters: what GET /products
 * can be narrowed by (GET /products/filters), and the conditions those ids
 * add to the list's query. A category takes in its whole branch, as the
 * storefront's category pages do (products sit on the leaves); a collection
 * is what it holds, hand-picked or by its rules, as its storefront page reads
 * them (`buildConditionQueryAsync`).
 */

const NOTHING = { _id: { $exists: false } };

const isObjectId = (value: string) => /^[0-9a-f]{24}$/i.test(value);

type CollectionRow = {
  _id: unknown;
  title?: string;
  collectionType?: string;
  products?: unknown[];
  conditions?: CollectionCondition[];
  conditionMatch?: string;
};

/** The products a collection holds. A rule-based collection with no rules holds none. */
async function collectionMatch(collection: CollectionRow): Promise<Record<string, unknown>> {
  if (collection.collectionType === "automated") {
    if (!collection.conditions?.length) return NOTHING;
    return buildConditionQueryAsync(collection.conditions, collection.conditionMatch);
  }
  // A product's `collectionIds` mirrors the hand-picked list.
  return {
    $or: [{ _id: { $in: collection.products ?? [] } }, { collectionIds: collection._id }],
  };
}

/** The conditions the list's category, brand and collection ids add to its query. */
export async function productTaxonomyNarrowing(
  input: Pick<ProductListQuery, "categoryId" | "brandId" | "collectionId">,
): Promise<Record<string, unknown>[]> {
  const narrowing: Record<string, unknown>[] = [];
  const ids = [input.categoryId, input.brandId, input.collectionId].filter(Boolean) as string[];
  if (ids.some((id) => !isObjectId(id))) return [NOTHING];

  if (input.categoryId) {
    narrowing.push({ category: { $in: await expandCategoryIdsWithDescendants([input.categoryId]) } });
  }
  if (input.brandId) narrowing.push({ brand: input.brandId });
  if (input.collectionId) {
    const collection = await Collection.findById(input.collectionId)
      .select("_id collectionType products conditions conditionMatch")
      .lean<CollectionRow | null>();
    narrowing.push(collection ? await collectionMatch(collection) : NOTHING);
  }
  return narrowing;
}

const byOrder = <T extends { order?: number; name?: string }>(a: T, b: T) =>
  (a.order ?? 0) - (b.order ?? 0) || (a.name ?? "").localeCompare(b.name ?? "");

/** What the operator's own products can be narrowed by. */
export async function readProductFilters(scope: BizScope): Promise<ProductFilterOptions> {
  const inScope = productScopeFilter(scope);
  const [categoryIds, brandIds, collections] = await Promise.all([
    Product.distinct("category", inScope),
    Product.distinct("brand", inScope),
    Collection.find({})
      .select("_id title collectionType products conditions conditionMatch position")
      .sort({ position: 1, title: 1 })
      .lean<Array<CollectionRow & { position?: number }>>(),
  ]);

  // The categories products sit in, and every category above them.
  const categories = await Category.find({})
    .select("_id name parentId order")
    .lean<Array<{ _id: unknown; name?: string; parentId?: unknown; order?: number }>>();
  const byId = new Map(categories.map((row) => [String(row._id), row]));
  const shown = new Set<string>();
  for (const id of categoryIds.map(String)) {
    let cursor: string | undefined = id;
    while (cursor && byId.has(cursor) && !shown.has(cursor)) {
      shown.add(cursor);
      const parent: unknown = byId.get(cursor)?.parentId;
      cursor = parent ? String(parent) : undefined;
    }
  }

  const [brands, holding] = await Promise.all([
    Brand.find({ _id: { $in: brandIds.filter(Boolean) } })
      .select("_id name order")
      .lean<Array<{ _id: unknown; name?: string; order?: number }>>(),
    // A collection is listed when it holds at least one product in scope.
    Promise.all(
      collections.map(async (collection) =>
        Boolean(
          await Product.exists({ $and: [inScope, await collectionMatch(collection)] }),
        ),
      ),
    ),
  ]);

  return {
    categories: categories
      .filter((row) => shown.has(String(row._id)) && row.name)
      .sort(byOrder)
      .map((row) => ({
        id: String(row._id),
        name: row.name ?? "",
        ...(row.parentId && shown.has(String(row.parentId)) ? { parentId: String(row.parentId) } : {}),
      })),
    brands: brands
      .filter((row) => row.name)
      .sort(byOrder)
      .map((row) => ({ id: String(row._id), name: row.name ?? "" })),
    collections: collections
      .filter((row, index) => holding[index] && row.title)
      .map((row) => ({ id: String(row._id), name: row.title ?? "" })),
  };
}

/**
 * GET /products/filters: the categories (as a tree), brands and collections of
 * the operator's products, for the list's filter sheet.
 */
export const productFiltersRoute = defineBizRoute({
  id: "products.filters",
  method: "GET",
  path: "/products/filters",
  auth: "user",
  ...BIZ_ACCESS.VIEW_PRODUCTS,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:products:read", preset: "lenient" },
  output: ProductFilterOptions,
  handler: async ({ scope }) => {
    await connectDB();
    return readProductFilters(scope);
  },
});
