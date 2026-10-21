import { mongoose } from "@/lib/db";
import { Category, Collection, Product } from "@/models";
import {
  revalidateCategoryContent,
  revalidateCollectionContent,
} from "@/lib/cache-invalidation";
import {
  normalizeCollectionConditions,
  updateCollectionProductCount,
} from "@/lib/catalog/collections";
import type { CollectionCondition, CollectionSortOrder } from "@/types";
import { escapeRegExp, slugify } from "@/lib/strings";
import { importedTax } from "@/lib/tax/tax-settings";
import { CollectionConditionSchema } from "@/lib/validations";
import {
  csvFileResponse,
  csvLine,
  datedCsvFilename,
  parseCsv,
} from "@/lib/catalog/csv";

export const CATEGORY_CSV_HEADERS = [
  "id",
  "name",
  "slug",
  "description",
  "image",
  "icon",
  "parent",
  "parentId",
  "order",
  "isActive",
  "featured",
  "seoPageTitle",
  "seoMetaDescription",
  "seoTags",
  "taxClass",
  "taxRate",
] as const;

export const COLLECTION_CSV_HEADERS = [
  "id",
  "title",
  "slug",
  "description",
  "descriptionHtml",
  "imageUrl",
  "imageAlt",
  "collectionType",
  "status",
  "productIds",
  "products",
  "conditions",
  "conditionMatch",
  "sortOrder",
  "position",
  "onlineStore",
  "pointOfSale",
  "seoPageTitle",
  "seoMetaDescription",
] as const;

type CategoryCsvHeader = (typeof CATEGORY_CSV_HEADERS)[number];
type CollectionCsvHeader = (typeof COLLECTION_CSV_HEADERS)[number];
type CsvRow = Record<string, string>;

type ImportResult = {
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
  /** Things a row got past that its author should still hear about. */
  warnings?: string[];
};

type CategoryForCsv = {
  _id?: unknown;
  name?: string;
  slug?: string;
  description?: string;
  image?: string;
  icon?: string;
  parentId?: unknown;
  order?: number;
  isActive?: boolean;
  featured?: boolean;
  seo?: {
    pageTitle?: string;
    metaDescription?: string;
    tags?: string[];
  };
  taxClass?: string | null;
  taxRate?: number | null;
};

type CollectionForCsv = {
  _id?: unknown;
  title?: string;
  slug?: string;
  description?: string;
  descriptionHtml?: string;
  image?: {
    url?: string;
    alt?: string;
  };
  collectionType?: "manual" | "automated";
  products?: unknown[];
  conditions?: CollectionCondition[];
  conditionMatch?: "all" | "any";
  sortOrder?: CollectionSortOrder;
  position?: number;
  status?: "active" | "draft";
  publishing?: {
    onlineStore?: boolean;
    pointOfSale?: boolean;
  };
  seo?: {
    pageTitle?: string;
    metaDescription?: string;
  };
};

const MAX_IMPORT_ROWS = 1000;
const COLLECTION_SORT_ORDERS = new Set<CollectionSortOrder>([
  "manual",
  "best-selling",
  "title-asc",
  "title-desc",
  "price-asc",
  "price-desc",
  "created-asc",
  "created-desc",
]);

function objectId(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id?: unknown })._id || "");
  }
  return String(value);
}

function splitList(value: string) {
  return value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string, fallback: boolean) {
  const text = value.trim().toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function parseNumber(value: string, fallback: number) {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function importLimitResult(rowCount: number): ImportResult | null {
  if (rowCount <= MAX_IMPORT_ROWS) return null;
  return {
    created: 0,
    updated: 0,
    failed: rowCount,
    errors: [
      {
        row: 0,
        message: `Import supports up to ${MAX_IMPORT_ROWS} rows at a time.`,
      },
    ],
  };
}

async function uniqueCategorySlug(baseSlug: string, categoryId?: string) {
  let candidate = baseSlug;
  let suffix = 1;
  const query: Record<string, unknown> = { slug: candidate };
  if (categoryId) query._id = { $ne: categoryId };

  while (await Category.exists(query)) {
    suffix++;
    candidate = `${baseSlug}-${suffix}`;
    query.slug = candidate;
  }

  return candidate;
}

async function uniqueCollectionSlug(baseSlug: string, collectionId?: string) {
  let candidate = baseSlug;
  let suffix = 1;
  const query: Record<string, unknown> = { slug: candidate };
  if (collectionId) query._id = { $ne: collectionId };

  while (await Collection.exists(query)) {
    suffix++;
    candidate = `${baseSlug}-${suffix}`;
    query.slug = candidate;
  }

  return candidate;
}

async function resolveParentCategoryId(
  row: CsvRow,
  currentCategoryId?: string,
) {
  const rawParentId = row.parentId || row.parent_id;
  const rawParent = row.parent || row.parentSlug || row.parentName;
  const value = (rawParentId || rawParent || "").trim();
  if (!value) return null;

  let parent:
    | { _id?: unknown; parentId?: unknown; slug?: string; name?: string }
    | null = null;
  if (mongoose.Types.ObjectId.isValid(value)) {
    parent = await Category.findById(value)
      .select("_id parentId slug name")
      .lean();
  }
  if (!parent) {
    const slug = slugify(value);
    parent = await Category.findOne({
      $or: [
        { slug },
        { name: { $regex: `^${escapeRegExp(value)}$`, $options: "i" } },
      ],
    })
      .select("_id parentId slug name")
      .lean();
  }

  if (!parent?._id) {
    throw new Error(`Parent category "${value}" was not found.`);
  }

  const parentId = String(parent._id);
  if (currentCategoryId && parentId === currentCategoryId) {
    throw new Error("Category cannot be its own parent.");
  }

  if (currentCategoryId) {
    const visited = new Set<string>([currentCategoryId]);
    let cursor: string | null = parentId;
    while (cursor) {
      if (visited.has(cursor)) {
        throw new Error("Category parent would create a circular reference.");
      }
      visited.add(cursor);
      const ancestor: { parentId?: unknown } | null = await Category.findById(cursor)
        .select("parentId")
        .lean();
      cursor = ancestor?.parentId ? String(ancestor.parentId) : null;
    }
  }

  return parentId;
}

/**
 * The products a row names, by id (`productIds`) or by slug, SKU or name
 * (`products`). `named` says whether the row named any at all, so a row that
 * leaves both columns empty can keep the collection's current products;
 * `missing` lists what matched no product.
 */
async function resolveProducts(row: CsvRow) {
  const explicitIds = splitList(row.productIds || row.product_ids || "");
  const labels = splitList(row.products || row.productSlugs || "");
  const ids = new Set<string>();
  const missingIds: string[] = [];
  const missingLabels: string[] = [];

  const validExplicitIds = explicitIds.filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (validExplicitIds.length > 0) {
    // One query for the whole id list instead of an existence check per id.
    const found = await Product.find({ _id: { $in: validExplicitIds } })
      .select("_id")
      .lean();
    for (const product of found) ids.add(String(product._id));
  }
  for (const id of explicitIds) {
    if (!ids.has(id)) missingIds.push(id);
  }

  for (const label of labels) {
    const slug = slugify(label);
    const product = await Product.findOne({
      $or: [
        { slug },
        { handle: slug },
        { sku: label },
        { name: { $regex: `^${escapeRegExp(label)}$`, $options: "i" } },
        { title: { $regex: `^${escapeRegExp(label)}$`, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();
    if (product?._id) ids.add(String(product._id));
    else missingLabels.push(label);
  }

  // An export names every product twice, by id and by label, and a file from
  // another store matches by label only. Either way each product is found
  // once at least, so it is only a miss when fewer were found than were named.
  const named = Math.max(explicitIds.length, labels.length);
  const missing =
    explicitIds.length > 0 && labels.length > 0
      ? ids.size < named
        ? [...missingLabels, ...missingIds]
        : []
      : [...missingLabels, ...missingIds];

  return { ids: [...ids], missing, named: named > 0 };
}

/**
 * A row's rules, held to the same schema the create and update routes use:
 * a field or an operator the rule builder does not know fails the row
 * instead of being saved.
 */
function parseConditions(row: CsvRow, existing?: CollectionForCsv | null) {
  const raw = row.conditions?.trim();
  if (!raw) return existing?.conditions || [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Collection conditions must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Collection conditions must be a JSON array.");
  }

  return parsed.map((candidate, index) => {
    const result = CollectionConditionSchema.safeParse(candidate);
    if (!result.success) {
      const problems = result.error.issues
        .map((issue) =>
          issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
        )
        .join("; ");
      throw new Error(`Collection condition ${index + 1} is not valid (${problems}).`);
    }
    return result.data as CollectionCondition;
  });
}

async function syncManualCollectionProductRefs(
  collectionId: string,
  oldProductIds: string[],
  newProductIds: string[],
) {
  const oldSet = new Set(oldProductIds.map(String));
  const newSet = new Set(newProductIds.map(String));
  const added = newProductIds.filter((id) => !oldSet.has(String(id)));
  const removed = oldProductIds.filter((id) => !newSet.has(String(id)));

  if (added.length > 0) {
    await Product.updateMany(
      { _id: { $in: added } },
      { $addToSet: { collectionIds: collectionId } },
    );
  }

  if (removed.length > 0) {
    await Product.updateMany(
      { _id: { $in: removed } },
      { $pull: { collectionIds: collectionId } },
    );
  }
}

function buildCategoryCsvRow(
  category: CategoryForCsv,
  parentNames: Map<string, string>,
): Record<CategoryCsvHeader, string> {
  const parentId = objectId(category.parentId);

  return {
    id: objectId(category._id),
    name: category.name || "",
    slug: category.slug || "",
    description: category.description || "",
    image: category.image || "",
    icon: category.icon || "",
    parent: parentId ? parentNames.get(parentId) || "" : "",
    parentId,
    order: String(category.order ?? 0),
    isActive: String(category.isActive ?? true),
    featured: String(category.featured ?? false),
    seoPageTitle: category.seo?.pageTitle || "",
    seoMetaDescription: category.seo?.metaDescription || "",
    seoTags: Array.isArray(category.seo?.tags)
      ? category.seo.tags.join("|")
      : "",
    // A custom rate stands in for a class, so a row carries one or the other.
    taxClass: category.taxClass || "",
    taxRate: category.taxRate == null ? "" : String(category.taxRate),
  };
}

export async function categoriesCsvResponse(
  categories: CategoryForCsv[],
  prefix: string,
) {
  const parentIds = [
    ...new Set(categories.map((category) => objectId(category.parentId)).filter(Boolean)),
  ];
  const parents =
    parentIds.length > 0
      ? await Category.find({ _id: { $in: parentIds } }).select("name").lean()
      : [];
  const parentNames = new Map(
    parents.map((parent) => [String(parent._id), String(parent.name || "")]),
  );
  const rows = categories.map((category) => {
    const record = buildCategoryCsvRow(category, parentNames);
    return csvLine(CATEGORY_CSV_HEADERS.map((header) => record[header]));
  });

  return csvFileResponse(datedCsvFilename(prefix), [
    CATEGORY_CSV_HEADERS.join(","),
    ...rows,
  ]);
}

function buildCollectionCsvRow(
  collection: CollectionForCsv,
  productLabels: Map<string, string>,
): Record<CollectionCsvHeader, string> {
  const productIds = Array.isArray(collection.products)
    ? collection.products.map(objectId).filter(Boolean)
    : [];

  return {
    id: objectId(collection._id),
    title: collection.title || "",
    slug: collection.slug || "",
    description: collection.description || "",
    descriptionHtml: collection.descriptionHtml || "",
    imageUrl: collection.image?.url || "",
    imageAlt: collection.image?.alt || "",
    collectionType: collection.collectionType || "manual",
    status: collection.status || "draft",
    productIds: productIds.join("|"),
    products: productIds
      .map((id) => productLabels.get(id))
      .filter(Boolean)
      .join("|"),
    conditions: collection.conditions?.length
      ? JSON.stringify(collection.conditions)
      : "",
    conditionMatch: collection.conditionMatch || "all",
    sortOrder: collection.sortOrder || "manual",
    position: String(collection.position ?? 0),
    onlineStore: String(collection.publishing?.onlineStore ?? true),
    pointOfSale: String(collection.publishing?.pointOfSale ?? false),
    seoPageTitle: collection.seo?.pageTitle || "",
    seoMetaDescription: collection.seo?.metaDescription || "",
  };
}

export async function collectionsCsvResponse(
  collections: CollectionForCsv[],
  prefix: string,
) {
  const productIds = [
    ...new Set(
      collections
        .flatMap((collection) => collection.products || [])
        .map(objectId)
        .filter(Boolean),
    ),
  ];
  const products =
    productIds.length > 0
      ? await Product.find({ _id: { $in: productIds } })
          .select("name title slug sku")
          .lean()
      : [];
  const productLabels = new Map(
    products.map((product) => [
      String(product._id),
      String(product.slug || product.sku || product.title || product.name || ""),
    ]),
  );
  const rows = collections.map((collection) => {
    const record = buildCollectionCsvRow(collection, productLabels);
    return csvLine(COLLECTION_CSV_HEADERS.map((header) => record[header]));
  });

  return csvFileResponse(datedCsvFilename(prefix), [
    COLLECTION_CSV_HEADERS.join(","),
    ...rows,
  ]);
}

/**
 * A category file's tax rate cell, read strictly: tax is not a field to
 * guess at, so a value that is not a plain percentage fails the row.
 */
function parseTaxRateCell(value: string | undefined): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (!/^(d+(.d+)?|.d+)$/.test(text)) {
    throw new Error(`taxRate must be a plain percentage such as 15 (got "${text}").`);
  }
  return Number(text);
}

export async function importCategoriesCsv(
  csvText: string,
  options: {
    /** The store's tax class keys (Settings → Tax); a row naming another class fails. */
    taxClasses?: ReadonlySet<string>;
  } = {},
): Promise<ImportResult> {
  const { records } = parseCsv(csvText);
  const limited = importLimitResult(records.length);
  if (limited) return limited;

  const result: ImportResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };
  const changedSlugs = new Set<string>();

  for (const { row: rowNumber, values: row } of records) {
    try {
      const requestedId = row.id || row._id;
      const requestedSlug = slugify(row.slug || row.handle || "");
      const existing =
        requestedId && mongoose.Types.ObjectId.isValid(requestedId)
          ? await Category.findById(requestedId).lean<CategoryForCsv | null>()
          : requestedSlug
            ? await Category.findOne({ slug: requestedSlug }).lean<CategoryForCsv | null>()
            : null;

      const existingId = existing?._id ? String(existing._id) : undefined;
      const name = (row.name || existing?.name || "").trim();
      if (!name) throw new Error("Name is required.");

      const baseSlug = requestedSlug || slugify(existing?.slug || name);
      if (!baseSlug) throw new Error("Slug could not be generated.");

      const slug = await uniqueCategorySlug(baseSlug, existingId);
      const parentId = await resolveParentCategoryId(row, existingId);
      const patch: Record<string, unknown> = {
        name,
        slug,
        description: row.description || existing?.description || "",
        image: row.image || existing?.image || undefined,
        icon: row.icon || existing?.icon || undefined,
        parentId,
        order: parseNumber(row.order || row.displayOrder || "", existing?.order ?? 0),
        isActive: parseBoolean(row.isActive || row.active || "", existing?.isActive ?? true),
        featured: parseBoolean(row.featured || "", existing?.featured ?? false),
        seo: {
          pageTitle: row.seoPageTitle || existing?.seo?.pageTitle || undefined,
          metaDescription:
            row.seoMetaDescription || existing?.seo?.metaDescription || undefined,
          tags: splitList(row.seoTags || ""),
        },
        // A class and a custom rate replace each other; "inherit" clears both,
        // and empty cells keep what the category has.
        ...importedTax(row.taxClass, parseTaxRateCell(row.taxRate), options.taxClasses),
      };

      if (existingId) {
        const updated = await Category.findByIdAndUpdate(
          existingId,
          { $set: patch },
          { returnDocument: "after", runValidators: true },
        ).lean<CategoryForCsv | null>();
        changedSlugs.add(String(existing?.slug || ""));
        changedSlugs.add(String(updated?.slug || slug));
        result.updated++;
      } else {
        const created = await Category.create(patch);
        changedSlugs.add(String((created as { slug?: unknown }).slug || slug));
        result.created++;
      }
    } catch (error) {
      result.failed++;
      result.errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }

  revalidateCategoryContent({ slugs: [...changedSlugs] });
  return result;
}

export async function importCollectionsCsv(csvText: string): Promise<ImportResult> {
  const { records } = parseCsv(csvText);
  const limited = importLimitResult(records.length);
  if (limited) return limited;

  const result: ImportResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };
  const changedSlugs = new Set<string>();

  for (const { row: rowNumber, values: row } of records) {
    try {
      const requestedId = row.id || row._id;
      const requestedSlug = slugify(row.slug || row.handle || "");
      // With neither an id nor a slug a row is found by its title's web
      // address, so importing the same sheet twice updates instead of adding
      // "Summer sale-2".
      const lookupSlug =
        requestedSlug ||
        (requestedId ? "" : slugify(row.title || row.name || ""));
      const existing =
        requestedId && mongoose.Types.ObjectId.isValid(requestedId)
          ? await Collection.findById(requestedId).lean<CollectionForCsv | null>()
          : lookupSlug
            ? await Collection.findOne({ slug: lookupSlug }).lean<CollectionForCsv | null>()
            : null;

      const existingId = existing?._id ? String(existing._id) : undefined;
      const oldProductIds = Array.isArray(existing?.products)
        ? existing.products.map(objectId).filter(Boolean)
        : [];
      const title = (row.title || row.name || existing?.title || "").trim();
      if (!title) throw new Error("Title is required.");

      const baseSlug = requestedSlug || slugify(existing?.slug || title);
      if (!baseSlug) throw new Error("Slug could not be generated.");

      // A blank cell keeps what the collection has, and a new one starts as a
      // manual draft.
      const requestedType = (row.collectionType || row.type || "")
        .trim()
        .toLowerCase();
      if (requestedType && requestedType !== "manual" && requestedType !== "automated") {
        throw new Error(`Collection type "${requestedType}" must be manual or automated.`);
      }
      const collectionType =
        requestedType === "automated" || requestedType === "manual"
          ? requestedType
          : existing?.collectionType || "manual";
      const requestedStatus = (row.status || "").trim().toLowerCase();
      if (requestedStatus && requestedStatus !== "active" && requestedStatus !== "draft") {
        throw new Error(`Status "${requestedStatus}" must be active or draft.`);
      }
      const status =
        requestedStatus === "active" || requestedStatus === "draft"
          ? requestedStatus
          : existing?.status || "draft";
      const sortOrder = COLLECTION_SORT_ORDERS.has(row.sortOrder as CollectionSortOrder)
        ? (row.sortOrder as CollectionSortOrder)
        : existing?.sortOrder || "manual";
      const slug = await uniqueCollectionSlug(baseSlug, existingId);
      const resolved =
        collectionType === "manual" ? await resolveProducts(row) : null;
      // A manual row that names no products leaves the collection's products
      // as they are; it takes a file with the column to change them.
      const manualProductIds = resolved
        ? resolved.named
          ? resolved.ids
          : existing?.collectionType === "manual"
            ? oldProductIds
            : []
        : [];
      if (resolved && resolved.missing.length > 0) {
        const shown = resolved.missing.slice(0, 5).join(", ");
        const more = resolved.missing.length - 5;
        result.warnings = [
          ...(result.warnings ?? []),
          `Row ${rowNumber} (${title}): no product found for ${shown}${more > 0 ? ` and ${more} more` : ""}.`,
        ];
      }
      const conditions =
        collectionType === "automated"
          ? await normalizeCollectionConditions(parseConditions(row, existing))
          : [];
      if (collectionType === "automated" && conditions.length === 0) {
        // No rules would take in every product in the store.
        throw new Error("An automated collection needs at least one condition.");
      }
      const requestedMatch = (row.conditionMatch || "").trim().toLowerCase();
      const conditionMatch =
        requestedMatch === "any" || requestedMatch === "all"
          ? requestedMatch
          : existing?.conditionMatch === "any"
            ? "any"
            : "all";

      const patch: Record<string, unknown> = {
        title,
        slug,
        handle: slug,
        description: row.description || existing?.description || "",
        descriptionHtml:
          row.descriptionHtml || row.description_html || existing?.descriptionHtml || "",
        image: row.imageUrl
          ? {
              url: row.imageUrl,
              alt: row.imageAlt || title,
            }
          : existing?.image,
        collectionType,
        products: manualProductIds,
        conditions,
        conditionMatch: collectionType === "automated" ? conditionMatch : "all",
        sortOrder,
        position: parseNumber(row.position || "", existing?.position ?? 0),
        status,
        publishing: {
          onlineStore: parseBoolean(
            row.onlineStore || row.online_store || "",
            existing?.publishing?.onlineStore ?? true,
          ),
          pointOfSale: parseBoolean(
            row.pointOfSale || row.point_of_sale || "",
            existing?.publishing?.pointOfSale ?? false,
          ),
        },
        seo: {
          pageTitle: row.seoPageTitle || existing?.seo?.pageTitle || undefined,
          metaDescription:
            row.seoMetaDescription || existing?.seo?.metaDescription || undefined,
          handle: slug,
        },
      };

      if (existingId) {
        const updated = await Collection.findByIdAndUpdate(
          existingId,
          { $set: patch },
          { returnDocument: "after", runValidators: true },
        ).lean<CollectionForCsv | null>();
        await syncManualCollectionProductRefs(existingId, oldProductIds, manualProductIds);
        await updateCollectionProductCount(existingId);
        changedSlugs.add(String(existing?.slug || ""));
        changedSlugs.add(String(updated?.slug || slug));
        result.updated++;
      } else {
        const created = await Collection.create(patch);
        const collectionId = String(created._id);
        await syncManualCollectionProductRefs(collectionId, [], manualProductIds);
        await updateCollectionProductCount(collectionId);
        changedSlugs.add(String(created.slug || slug));
        result.created++;
      }
    } catch (error) {
      result.failed++;
      result.errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : "Import failed.",
      });
    }
  }

  revalidateCollectionContent({ slugs: [...changedSlugs] });
  return result;
}
