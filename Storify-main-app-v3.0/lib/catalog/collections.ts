import { Product, Collection, Vendor, Brand, Category } from "@/models";
import type {
  IProduct,
  ICollection,
  CollectionCondition,
  CollectionConditionField,
  CollectionSortOrder,
} from "@/types";
import mongoose from "mongoose";
import { expandCategoryIdsWithDescendants } from "@/lib/catalog/categories";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { PRODUCT_CARD_SELECT } from "@/lib/products/storefront-product-cards";
import { escapeRegExp } from "@/lib/strings";

/**
 * A 24-hex id. `ObjectId.isValid` also accepts any 12-character string, which
 * would read a vendor, brand or category typed by a 12-letter name as an id.
 */
function isObjectIdString(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
}

/** The operators that keep the products they name OUT. */
function isExcluding(operator: CollectionCondition["operator"]): boolean {
  return operator === "not_equals" || operator === "not_contains";
}

/**
 * Map collection condition fields to product schema fields
 */
const FIELD_MAP: Record<CollectionConditionField, string> = {
  title: "title",
  productType: "productType",
  vendor: "vendorId",
  tag: "tags",
  price: "price",
  comparePrice: "comparePrice",
  weight: "shipping.weight",
  stock: "stock",
  createdAt: "createdAt",
  category: "category",
  brand: "brand",
};

/**
 * What a rule's field holds on the product, which decides the questions a rule
 * on it can ask. Mongoose throws — and takes the whole page down with it — on
 * a query that compares a number, date or id path with text it cannot cast, or
 * runs a text match on one. "Category is equal to Shoes" was exactly that: the
 * admin form takes the category as typed text, and `category` is an id.
 */
const FIELD_KIND: Record<
  CollectionConditionField,
  "text" | "number" | "date" | "reference"
> = {
  title: "text",
  productType: "text",
  tag: "text",
  price: "number",
  comparePrice: "number",
  weight: "number",
  stock: "number",
  createdAt: "date",
  vendor: "reference",
  category: "reference",
  brand: "reference",
};

/**
 * What a rule its field cannot answer comes to — a number rule holding "abc",
 * a text match on a date: it takes in no product, rather than failing every
 * page that reads the collection. A fresh object each time, because Mongoose
 * casts a filter in place.
 */
function matchesNothing(): Record<string, unknown> {
  return { _id: { $in: [] } };
}

/** A typed name, matched the way the rule's operator reads it. */
function nameMatcher(
  operator: CollectionCondition["operator"],
  raw: string,
): RegExp {
  const escaped = escapeRegExp(raw);
  if (operator === "equals" || operator === "not_equals") {
    return new RegExp(`^${escaped}$`, "i");
  }
  if (operator === "starts_with") return new RegExp(`^${escaped}`, "i");
  if (operator === "ends_with") return new RegExp(`${escaped}$`, "i");
  return new RegExp(escaped, "i");
}

/** A reference rule's value as text: typed, or an id stored by the API. */
function referenceText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return value instanceof mongoose.Types.ObjectId ? String(value) : "";
}

async function resolveVendorIdsForCondition(
  operator: CollectionCondition["operator"],
  value: unknown
): Promise<string[]> {
  const raw = referenceText(value);
  if (!raw) return [];
  if (isObjectIdString(raw)) return [raw];

  const vendors = await Vendor.find({
    $or: [
      { slug: raw.toLowerCase() },
      { storeName: { $regex: nameMatcher(operator, raw) } },
    ],
  })
    .select("_id")
    .lean();

  return vendors.map((v) => String(v._id));
}

/**
 * The brands a rule's value names. An id is taken as it is; anything else —
 * a name or a slug typed into an import — is looked up like a vendor's store
 * name, so `is` / `is not` read the whole name and the text operators part of
 * it.
 */
async function resolveBrandIdsForCondition(
  operator: CollectionCondition["operator"],
  value: unknown,
): Promise<string[]> {
  const raw = referenceText(value);
  if (!raw) return [];
  if (isObjectIdString(raw)) return [raw];

  const brands = await Brand.find({
    $or: [
      { slug: raw.toLowerCase() },
      { name: { $regex: nameMatcher(operator, raw) } },
    ],
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  return brands.map((brand) => String(brand._id));
}

/**
 * The categories a rule's value names — by id, slug or name — before their
 * sub-categories are added. The rule builder stores an id. Rules saved from
 * the free-text box that came before it hold a name instead, and keep working
 * without a migration: `is` / `is not` find the category by its slug or its
 * whole name (any case); the text operators (contains, starts with, …)
 * compare part of the name. Any other operator, or a value that names no
 * category, answers no ids.
 */
async function resolveCategoryIdsForCondition(
  operator: CollectionCondition["operator"],
  value: unknown,
): Promise<string[]> {
  const raw = referenceText(value);
  if (!raw) return [];
  if (isObjectIdString(raw)) return [raw];

  const readsNames =
    operator === "equals" ||
    operator === "not_equals" ||
    operator === "contains" ||
    operator === "not_contains" ||
    operator === "starts_with" ||
    operator === "ends_with";
  if (!readsNames) return [];

  const categories = await Category.find({
    $or: [
      { slug: raw.toLowerCase() },
      { name: { $regex: nameMatcher(operator, raw) } },
    ],
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  return categories.map((category) => String(category._id));
}

/**
 * A vendor, brand or category rule, as the ids its value names.
 *
 * Products are filed on any level of the tree, so a category rule takes in
 * the whole branch of every category it names — the way the storefront's own
 * category page does: `is` matches a product in the category or any category
 * below it, `is not` keeps that same set out. A category rule that names no
 * category matches nothing — whatever the operator — so a rule whose category
 * is gone can never sweep the whole catalogue into the collection, or into
 * the final-sale and return-window settings that read the same rules. The
 * rule builder marks such a rule for attention.
 */
async function referenceConditionQuery(
  field: CollectionConditionField,
  path: string,
  operator: CollectionCondition["operator"],
  value: unknown,
): Promise<Record<string, unknown>> {
  const excluding = isExcluding(operator);

  if (field === "category") {
    const named = await resolveCategoryIdsForCondition(operator, value);
    if (named.length === 0 && excluding) return matchesNothing();
    const branch = await expandCategoryIdsWithDescendants(named);
    return excluding ? { [path]: { $nin: branch } } : { [path]: { $in: branch } };
  }

  const ids =
    field === "vendor"
      ? await resolveVendorIdsForCondition(operator, value)
      : await resolveBrandIdsForCondition(operator, value);
  return excluding ? { [path]: { $nin: ids } } : { [path]: { $in: ids } };
}

function ruleNumber(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(number) ? number : null;
}

function ruleDate(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * `is_set` / `is_not_set`. An empty string counts as unset on a text field
 * only — compared with a number, date or id path it is a cast error.
 */
function presenceQuery(
  path: string,
  kind: (typeof FIELD_KIND)[CollectionConditionField],
  wanted: boolean,
): Record<string, unknown> {
  const empties: Array<null | ""> = kind === "text" ? [null, ""] : [null];
  return wanted
    ? {
        $and: [
          { [path]: { $exists: true } },
          ...empties.map((empty) => ({ [path]: { $ne: empty } })),
        ],
      }
    : {
        $or: [
          { [path]: { $exists: false } },
          ...empties.map((empty) => ({ [path]: empty })),
        ],
      };
}

function textConditionQuery(
  field: CollectionConditionField,
  path: string,
  operator: CollectionCondition["operator"],
  value: unknown,
): Record<string, unknown> {
  const text = value == null ? "" : String(value);

  switch (operator) {
    case "equals":
      return { [path]: text };

    case "not_equals":
      return { [path]: { $ne: text } };

    case "greater_than":
      return { [path]: { $gt: text } };

    case "less_than":
      return { [path]: { $lt: text } };

    case "starts_with":
      return { [path]: { $regex: `^${escapeRegExp(text)}`, $options: "i" } };

    case "ends_with":
      return { [path]: { $regex: `${escapeRegExp(text)}$`, $options: "i" } };

    case "contains":
      if (field === "tag") {
        return { tags: { $in: [text] } };
      }
      return { [path]: { $regex: escapeRegExp(text), $options: "i" } };

    case "not_contains":
      if (field === "tag") {
        return { tags: { $nin: [text] } };
      }
      return {
        [path]: { $not: { $regex: escapeRegExp(text), $options: "i" } },
      };

    default:
      return matchesNothing();
  }
}

/**
 * One rule as a product query that Mongoose can always cast, whatever the
 * rule holds — it was saved by the admin form, the API or a CSV import, some
 * of them before this check existed.
 */
async function buildConditionQuery(
  condition: CollectionCondition,
): Promise<Record<string, unknown>> {
  const { field, operator, value } = condition;
  const kind = FIELD_KIND[field];
  const path = FIELD_MAP[field];
  if (!kind || !path) return matchesNothing();

  if (operator === "is_set" || operator === "is_not_set") {
    return presenceQuery(path, kind, operator === "is_set");
  }

  if (kind === "reference") {
    return referenceConditionQuery(field, path, operator, value);
  }

  if (kind === "number" || kind === "date") {
    const cast = kind === "number" ? ruleNumber(value) : ruleDate(value);
    if (cast === null) return matchesNothing();
    switch (operator) {
      case "equals":
        return { [path]: cast };
      case "not_equals":
        return { [path]: { $ne: cast } };
      case "greater_than":
        return { [path]: { $gt: cast } };
      case "less_than":
        return { [path]: { $lt: cast } };
      default:
        return matchesNothing();
    }
  }

  return textConditionQuery(field, path, operator, value);
}

/**
 * The product filter for a rule set — the ONE place rules are read, behind
 * the storefront's collection pages and shelves (`getCollectionProducts`),
 * the stored product counts (`updateCollectionProductCount`) and the
 * final-sale and return-window settings (`productsJoiningByRule`), so all of
 * them agree on which products a collection holds.
 *
 * `.lean()` skips schema defaults, so a raw-written collection may carry no
 * rules or no match type: no rules is no narrowing, and an unknown match type
 * is "all".
 */
export async function buildConditionQueryAsync(
  conditions: ReadonlyArray<CollectionCondition | null> | null | undefined,
  matchType: string | null | undefined
): Promise<Record<string, unknown>> {
  const rules = (conditions ?? []).filter(
    (condition): condition is CollectionCondition => Boolean(condition),
  );
  if (rules.length === 0) return {};

  const conditionQueries = await Promise.all(rules.map(buildConditionQuery));

  return matchType === "any"
    ? { $or: conditionQueries }
    : { $and: conditionQueries };
}


/**
 * A collection that takes products in by its rules, in the plain form
 * `productsJoiningByRule` matches against — and that a cached reader can keep
 * (no ObjectIds or subdocument ids).
 */
export type CollectionRules = {
  id: string;
  conditions: CollectionCondition[];
  conditionMatch: "all" | "any";
};

/**
 * The named collections that take products in by their rules: automated, with
 * at least one condition. A collection with no rules takes in nothing here,
 * rather than everything.
 */
export async function automatedCollectionRules(
  collectionIds: ReadonlyArray<unknown>,
): Promise<CollectionRules[]> {
  const named = Array.from(new Set(collectionIds.map(String))).filter(isObjectIdString);
  if (named.length === 0) return [];
  const automated = await Collection.find({
    _id: { $in: named },
    collectionType: "automated",
    "conditions.0": { $exists: true },
  })
    .select("_id conditions conditionMatch")
    .lean<
      Array<{
        _id: unknown;
        conditions: CollectionCondition[];
        conditionMatch?: "all" | "any";
      }>
    >();
  return automated.map((collection) => ({
    id: String(collection._id),
    conditions: collection.conditions.map(({ field, operator, value }) => ({
      field,
      operator,
      value,
    })),
    conditionMatch: collection.conditionMatch === "any" ? "any" : "all",
  }));
}

/**
 * Which of `rules`' collections each product joins. One query per collection,
 * all at once, over the products asked about only.
 */
export async function productsJoiningByRule(
  productIds: ReadonlyArray<unknown>,
  rules: ReadonlyArray<CollectionRules>,
): Promise<Map<string, string[]>> {
  const byProduct = new Map<string, string[]>();
  const products = Array.from(new Set(productIds.map(String))).filter(isObjectIdString);
  if (products.length === 0 || rules.length === 0) return byProduct;
  const matched = await Promise.all(
    rules.map(async (rule) => {
      const query = await buildConditionQueryAsync(rule.conditions, rule.conditionMatch);
      return Product.find({ _id: { $in: products }, ...query })
        .select("_id")
        .lean<Array<{ _id: unknown }>>();
    }),
  );
  rules.forEach((rule, index) => {
    for (const product of matched[index]) {
      const key = String(product._id);
      byProduct.set(key, [...(byProduct.get(key) || []), rule.id]);
    }
  });
  return byProduct;
}

/**
 * Which of the named collections each product belongs to by an automated
 * collection's rules. `product.collectionIds` mirrors hand-picked membership
 * only, so a setting that names collections — final sale, a return window —
 * never matched a product that joins one by its rules.
 *
 * Reads the rules afresh; the storefront's cached copy is
 * lib/returns/final-sale-collections.ts.
 */
export async function ruleCollectionsOf(
  productIds: ReadonlyArray<unknown>,
  collectionIds: ReadonlyArray<unknown>,
): Promise<Map<string, string[]>> {
  if (productIds.length === 0) return new Map();
  return productsJoiningByRule(productIds, await automatedCollectionRules(collectionIds));
}

/**
 * Rules as they are stored: a vendor, brand or category named by its name or
 * slug is stored by its id when the name finds exactly one — on create,
 * update and import alike. A name that finds none (or several) is kept as it
 * was typed; the rule builder marks it, and the rule reader still resolves
 * it (see `buildConditionQueryAsync`).
 */
export async function normalizeCollectionConditions(
  conditions: CollectionCondition[]
): Promise<CollectionCondition[]> {
  const normalized: CollectionCondition[] = [];

  for (const condition of conditions) {
    if (
      (condition.field === "brand" || condition.field === "category") &&
      (condition.operator === "equals" || condition.operator === "not_equals") &&
      typeof condition.value === "string" &&
      condition.value.trim() &&
      !isObjectIdString(condition.value.trim())
    ) {
      const ids =
        condition.field === "brand"
          ? await resolveBrandIdsForCondition(condition.operator, condition.value)
          : await resolveCategoryIdsForCondition(condition.operator, condition.value);
      normalized.push(ids.length === 1 ? { ...condition, value: ids[0] } : condition);
      continue;
    }

    if (condition.field !== "vendor") {
      normalized.push(condition);
      continue;
    }

    if (isObjectIdString(condition.value)) {
      normalized.push(condition);
      continue;
    }

    const vendorIds = await resolveVendorIdsForCondition(
      condition.operator,
      condition.value
    );

    if (vendorIds.length === 1) {
      normalized.push({ ...condition, value: vendorIds[0] });
      continue;
    }

    normalized.push(condition);
  }

  return normalized;
}

/**
 * Build sort object based on collection sortOrder
 */
function buildSortObject(
  sortOrder: CollectionSortOrder
): Record<string, 1 | -1> {
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    "title-asc": { title: 1 },
    "title-desc": { title: -1 },
    "price-asc": { price: 1 },
    "price-desc": { price: -1 },
    "created-asc": { createdAt: 1 },
    "created-desc": { createdAt: -1 },
    "best-selling": { totalSales: -1, createdAt: -1 },
    manual: { createdAt: -1 },
  };
  return sortMap[sortOrder] || { createdAt: -1 };
}

/**
 * What an admin product picker draws — a thumbnail, a name, a price — and the
 * SKU, so a picker can match what is typed against the same three fields
 * `search` does below.
 */
const PRODUCT_PICKER_SELECT = "name title slug sku price images status";

/**
 * Get products for a collection (handles both manual and automated)
 */
export async function getCollectionProducts(
  collection: ICollection,
  options: {
    page?: number;
    limit?: number;
    publishingChannel?: "onlineStore" | "pointOfSale";
    locationId?: string;
    sortOrder?: CollectionSortOrder;
    /**
     * Only these products — the ones of them the collection holds. How a
     * section resolves hand-placed products without trusting that each one
     * still belongs to the collection it was picked from.
     */
    ids?: ReadonlyArray<string>;
    /** Plain text matched against a product's name, title or SKU. */
    search?: string;
    /**
     * `"card"` selects only the product-card fields. Every storefront caller
     * renders cards, and the full document (variants with per-location
     * inventory, the description HTML, …) was ~15 KB per product on the
     * home page's collection shelf. `"picker"` is smaller still: what an
     * admin picker row shows.
     */
    fields?: "card" | "picker";
    /**
     * One store's products alone — a vendor's landing page showing a
     * marketplace collection. Unset, the collection reads as it always did.
     */
    vendorId?: string;
  } = {}
): Promise<{ products: IProduct[]; total: number }> {
  const {
    page = 1,
    limit = 24,
    publishingChannel,
    sortOrder,
    fields,
    ids,
    search,
    vendorId,
  } = options;
  const skip = (page - 1) * limit;

  let query: Record<string, unknown> = {
    status: "active",
    ...(await getStorefrontProductConstraint()),
  };

  // Filter by publishing channel
  if (publishingChannel) {
    query[`publishing.${publishingChannel}`] = true;
  }

  if (collection.collectionType === "manual") {
    // Manual collection: use product IDs
    if (collection.products && collection.products.length > 0) {
      query._id = { $in: collection.products };
    } else {
      // Empty manual collection
      return { products: [], total: 0 };
    }
  } else {
    // Automated collection: build query from conditions
    const conditionQuery = await buildConditionQueryAsync(
      collection.conditions,
      collection.conditionMatch
    );
    query = { ...query, ...conditionQuery };
  }

  // Narrowing rides in `$and`, never as top-level keys: a manual collection
  // already owns `_id`, and a rule set matched on "any" owns `$or`.
  const narrowing: Record<string, unknown>[] = [];
  // The storefront constraint and an automated collection's own vendor rule
  // may both already read `vendorId`; a store's narrowing must hold with them.
  if (vendorId !== undefined) {
    if (!isObjectIdString(vendorId)) return { products: [], total: 0 };
    narrowing.push({ vendorId: new mongoose.Types.ObjectId(vendorId) });
  }
  if (ids !== undefined) {
    const wanted = ids.filter(isObjectIdString);
    if (wanted.length === 0) return { products: [], total: 0 };
    narrowing.push({ _id: { $in: wanted } });
  }
  const term = search?.trim();
  if (term) {
    const pattern = { $regex: escapeRegExp(term), $options: "i" };
    narrowing.push({
      $or: [{ name: pattern }, { title: pattern }, { sku: pattern }],
    });
  }
  if (narrowing.length > 0) {
    query.$and = [
      ...((query.$and as Record<string, unknown>[] | undefined) ?? []),
      ...narrowing,
    ];
  }

  // A shopper's location deliberately does NOT narrow a collection. Location is
  // a lens on the storefront, not a filter — see `getStorefrontProducts` — and a
  // collection that hid its far-away products while the products grid showed
  // them would read as a broken page rather than as a location rule.

  // Use provided sortOrder or collection's default
  const effectiveSortOrder = sortOrder || collection.sortOrder;
  const sort = buildSortObject(effectiveSortOrder);

  const [products, total] = await Promise.all([
    Product.find(query)
      .select(
        fields === "card"
          ? PRODUCT_CARD_SELECT
          : fields === "picker"
            ? PRODUCT_PICKER_SELECT
            : {},
      )
      .populate("vendorId", "storeName slug")
      .populate("category", "name slug")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(query),
  ]);

  return { products: products as IProduct[], total };
}

type CollectionCountFields = Pick<
  ICollection,
  "collectionType" | "products" | "conditions" | "conditionMatch"
>;

/**
 * Update product count for a collection.
 *
 * Callers that already hold the collection document (e.g. the bulk refresh
 * below) can pass it in to skip a redundant `findById`.
 */
export async function updateCollectionProductCount(
  collectionId: string,
  preloaded?: CollectionCountFields | null
): Promise<number> {
  const collection =
    preloaded ??
    (await Collection.findById(collectionId)
      .select("collectionType products conditions conditionMatch")
      .lean<CollectionCountFields | null>());
  if (!collection) return 0;

  let count = 0;
  if (collection.collectionType === "manual") {
    count = collection.products?.length || 0;
  } else {
    const query = await buildConditionQueryAsync(
      collection.conditions,
      collection.conditionMatch
    );
    count = await Product.countDocuments({ ...query, status: "active" });
  }

  await Collection.updateOne({ _id: collectionId }, { productCount: count });
  return count;
}

/**
 * Update product counts for all collections
 * Useful for background jobs or after bulk product updates
 */
export async function updateAllCollectionProductCounts(): Promise<void> {
  const collections = await Collection.find({})
    .select("collectionType products conditions conditionMatch")
    .lean<Array<CollectionCountFields & { _id: unknown }>>();

  // Reuse the already-loaded docs (no per-collection re-fetch) and run the
  // counts concurrently instead of one-at-a-time.
  await Promise.all(
    collections.map((collection) =>
      updateCollectionProductCount(String(collection._id), collection)
    )
  );
}

/**
 * Sync a product's collection memberships when collectionIds change.
 * Adds the product to newly selected collections and removes from deselected ones.
 */
export async function syncProductCollections(
  productId: string,
  oldCollectionIds: string[],
  newCollectionIds: string[]
): Promise<void> {
  const oldSet = new Set(oldCollectionIds.map(String));
  const newSet = new Set(newCollectionIds.map(String));

  const added = newCollectionIds.filter((id) => !oldSet.has(String(id)));
  const removed = oldCollectionIds.filter((id) => !newSet.has(String(id)));

  if (added.length > 0) {
    await Collection.updateMany(
      { _id: { $in: added } },
      { $addToSet: { products: productId } }
    );
  }

  if (removed.length > 0) {
    await Collection.updateMany(
      { _id: { $in: removed } },
      { $pull: { products: productId } }
    );
  }

  // Update product counts for all affected collections (independent → parallel)
  const allAffected = [...new Set([...added, ...removed])];
  await Promise.all(allAffected.map((id) => updateCollectionProductCount(id)));
}

/**
 * Reverse of syncProductCollections: when a manual collection's `products`
 * list is edited, mirror the change onto each product's `collectionIds`.
 *
 * Without this the two sides drift — the collection page reads
 * `Collection.products` while the storefront `?collection=` filter and grids
 * read `product.collectionIds`, so products added from the collection editor
 * are invisible to the public collection filter.
 */
export async function syncCollectionProducts(
  collectionId: string,
  oldProductIds: string[],
  newProductIds: string[]
): Promise<void> {
  const oldSet = new Set(oldProductIds.map(String));
  const newSet = new Set(newProductIds.map(String));

  const added = newProductIds.filter((id) => !oldSet.has(String(id)));
  const removed = oldProductIds.filter((id) => !newSet.has(String(id)));

  if (added.length > 0) {
    await Product.updateMany(
      { _id: { $in: added } },
      { $addToSet: { collectionIds: collectionId } }
    );
  }
  if (removed.length > 0) {
    await Product.updateMany(
      { _id: { $in: removed } },
      { $pull: { collectionIds: collectionId } }
    );
  }
}

/**
 * Remove a product from all collections it belongs to.
 * Call this when a product is deleted.
 */
export async function removeProductFromAllCollections(
  productId: string
): Promise<void> {
  const affected = await Collection.find({ products: productId })
    .select("_id")
    .lean();

  if (affected.length > 0) {
    await Collection.updateMany(
      { products: productId },
      { $pull: { products: productId } }
    );

    await Promise.all(
      affected.map((col) => updateCollectionProductCount(col._id.toString()))
    );
  }
}
