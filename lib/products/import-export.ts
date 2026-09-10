import { NextResponse } from "next/server";
import { mongoose } from "@/lib/db";
import { Product, Category, Brand } from "@/models";
import { syncProductCategory } from "@/lib/catalog/categories";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { escapeRegExp } from "@/lib/strings";
import { PRODUCT_STATUS } from "@/config/app.config";
import {
  assertProductBarcodesAreUnique,
  buildBarcodeValidationPayload,
} from "@/lib/products/barcode-validation";
import { assignProductLookupCodes } from "@/lib/products/barcode-normalization";
import { inspectBarcode, type BarcodeFormat, type BarcodeSource } from "@/lib/barcode/standards";
import { syncProductBarcodeRegistry } from "@/lib/products/barcode-registry";
import { ValidationError } from "@/lib/api/errors";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import {
  flattenAdvancedProductCatalog,
  parseAdvancedProductCatalog,
} from "@/lib/products/advanced-import";
import {
  sanitizeOptionsForMongoose,
  sanitizeVariantsForMongoose,
} from "@/lib/products/sanitize";

const PRODUCT_CSV_HEADERS = [
  "id",
  "title",
  "slug",
  "sku",
  "barcode",
  "barcodeFormat",
  "barcodeSource",
  "marketplaceEligible",
  "description",
  "shortDescription",
  "price",
  "comparePrice",
  "cost",
  "stock",
  "status",
  "category",
  "categoryId",
  "brand",
  "brandId",
  "tags",
  "images",
  "onlineStore",
  "pointOfSale",
  "featured",
  "productType",
  "weight",
  "weightUnit",
  "countryOfOrigin",
  "hsCode",
  "productSource",
  "vendorId",
  "vendor",
] as const;

type ProductCsvHeader = (typeof PRODUCT_CSV_HEADERS)[number];

type ProductCsvRow = Record<string, string>;

type ProductForCsv = {
  _id?: unknown;
  title?: string;
  name?: string;
  slug?: string;
  sku?: string;
  skuNormalized?: string;
  barcode?: string;
  barcodeNormalized?: string;
  barcodeFormat?: BarcodeFormat;
  barcodeSource?: BarcodeSource;
  description?: string;
  shortDescription?: string;
  price?: number;
  comparePrice?: number;
  cost?: number;
  stock?: number;
  status?: string;
  category?: { _id?: unknown; name?: string } | string | null;
  brand?: { _id?: unknown; name?: string } | string | null;
  tags?: string[];
  images?: string[];
  media?: { url?: string }[];
  publishing?: { onlineStore?: boolean; pointOfSale?: boolean };
  featured?: boolean;
  productType?: string;
  shipping?: {
    isPhysicalProduct?: boolean;
    weight?: number;
    weightUnit?: string;
    countryOfOrigin?: string;
    hsCode?: string;
  };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  digitalDelivery?: { downloadLimit?: number };
  productSource?: string;
  vendorId?: { _id?: unknown; storeName?: string } | string | null;
  variants?: Array<Record<string, unknown>>;
};

type ProductImportResult = {
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
};

type ProductImportContext = {
  defaultVendorId: string;
  productSource: "admin" | "vendor";
  allowedVendorIds?: string[];
  forceVendorId?: string;
  allowVendorColumn?: boolean;
  allowFeatured?: boolean;
  createMissingCategories?: boolean;
  countryAvailability: unknown;
};

const STATUS_VALUES = new Set(Object.values(PRODUCT_STATUS));
const MAX_IMPORT_ROWS = 1000;

function normalizeProductStatus(value: string) {
  return STATUS_VALUES.has(value as (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS])
    ? (value as (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS])
    : PRODUCT_STATUS.DRAFT;
}

function toHandle(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function buildImportedCategorySeed(input: string) {
  const name = input.trim();
  const slug = toHandle(name);
  if (!name || !slug) {
    throw new Error("Category name must contain letters or numbers.");
  }

  return {
    name,
    slug,
    description: `Imported category: ${name}`,
    isActive: true,
    featured: false,
    productCount: 0,
  };
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function getObjectId(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id?: unknown })._id || "");
  }
  return String(value);
}

function getDisplayName(value: unknown) {
  if (!value) return "";
  if (typeof value === "object" && "name" in value) {
    return String((value as { name?: unknown }).name || "");
  }
  return "";
}

function getVendorName(value: unknown) {
  if (!value) return "";
  if (typeof value === "object" && "storeName" in value) {
    return String((value as { storeName?: unknown }).storeName || "");
  }
  return "";
}

function joinList(values?: string[]) {
  return Array.isArray(values) ? values.filter(Boolean).join("|") : "";
}

function splitList(value: string) {
  return value
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string, fallback?: boolean) {
  const text = value.trim().toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function parseOptionalNumber(value?: string) {
  const text = value?.trim();
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
}

function parseRequiredNumber(value: string, fallback?: number) {
  const parsed = parseOptionalNumber(value);
  return parsed ?? fallback ?? 0;
}

function submittedCountryOfOrigin(row: ProductCsvRow) {
  const hasCountryColumn =
    Object.prototype.hasOwnProperty.call(row, "countryOfOrigin") ||
    Object.prototype.hasOwnProperty.call(row, "country_of_origin");
  return hasCountryColumn
    ? (row.countryOfOrigin || row.country_of_origin || "").trim()
    : undefined;
}

function parseCsv(text: string): ProductCsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  const [rawHeaders, ...bodyRows] = rows.filter((items) =>
    items.some((item) => item.trim()),
  );
  if (!rawHeaders) return [];

  const headers = rawHeaders.map((header) => header.trim());
  return bodyRows.map((items) => {
    const record: ProductCsvRow = {};
    headers.forEach((header, index) => {
      record[header] = (items[index] || "").trim();
    });
    return record;
  });
}

function buildCsvRow(product: ProductForCsv): Record<ProductCsvHeader, string> {
  const images =
    Array.isArray(product.media) && product.media.length > 0
      ? product.media.map((item) => item.url || "").filter(Boolean)
      : product.images || [];

  const barcodeInspection = product.barcode
    ? inspectBarcode(product.barcode, {
        format: product.barcodeFormat,
        source: product.barcodeSource,
      })
    : null;

  return {
    id: getObjectId(product._id),
    title: product.title || product.name || "",
    slug: product.slug || "",
    sku: product.sku || "",
    barcode: product.barcode || "",
    barcodeFormat: product.barcodeFormat || "",
    barcodeSource: product.barcodeSource || "",
    marketplaceEligible: String(barcodeInspection?.marketplaceEligible ?? false),
    description: product.description || "",
    shortDescription: product.shortDescription || "",
    price: product.price == null ? "" : String(product.price),
    comparePrice:
      product.comparePrice == null ? "" : String(product.comparePrice),
    cost: product.cost == null ? "" : String(product.cost),
    stock: product.stock == null ? "" : String(product.stock),
    status: product.status || "",
    category: getDisplayName(product.category),
    categoryId: getObjectId(product.category),
    brand: getDisplayName(product.brand),
    brandId: getObjectId(product.brand),
    tags: joinList(product.tags),
    images: joinList(images),
    onlineStore: String(product.publishing?.onlineStore ?? true),
    pointOfSale: String(product.publishing?.pointOfSale ?? false),
    featured: String(product.featured ?? false),
    productType: product.productType || "",
    weight: product.shipping?.weight == null ? "" : String(product.shipping.weight),
    weightUnit: product.shipping?.weightUnit || "",
    countryOfOrigin: product.shipping?.countryOfOrigin || "",
    hsCode: product.shipping?.hsCode || "",
    productSource: product.productSource || "",
    vendorId: getObjectId(product.vendorId),
    vendor: getVendorName(product.vendorId),
  };
}

function buildProductsCsv(products: ProductForCsv[]) {
  const rows = products.map((product) => {
    const record = buildCsvRow(product);
    return PRODUCT_CSV_HEADERS.map((header) => csvEscape(record[header])).join(",");
  });

  return [PRODUCT_CSV_HEADERS.join(","), ...rows].join("\n");
}

export function productsCsvResponse(products: ProductForCsv[], prefix: string) {
  return new NextResponse(buildProductsCsv(products), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${prefix}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}

/**
 * Category/brand lookups repeat for most rows of an import (a thousand-row
 * file usually spans a few dozen categories), so each run memoizes them by
 * the row's identifier. Promises are cached, so concurrent rows with the
 * same key share one lookup and a missing category is created once.
 */
type ResolutionCache<T> = Map<string, Promise<T>>;

function categoryCacheKey(row: ProductCsvRow): string {
  const id = row.categoryId || row.category_id || "";
  const name = (row.category || row.categoryName || row.category_name || "")
    .trim()
    .toLowerCase();
  return id || name ? `${id}|${name}` : "";
}

function brandCacheKey(row: ProductCsvRow): string {
  const id = row.brandId || row.brand_id || "";
  const name = (row.brand || row.brandName || row.brand_name || "")
    .trim()
    .toLowerCase();
  return id || name ? `${id}|${name}` : "";
}

function resolveCategory(
  row: ProductCsvRow,
  createMissingCategory = false,
  cache?: ResolutionCache<string | undefined>,
): Promise<string | undefined> {
  const key = cache ? categoryCacheKey(row) : "";
  if (!cache || !key) return resolveCategoryUncached(row, createMissingCategory);
  let pending = cache.get(key);
  if (!pending) {
    pending = resolveCategoryUncached(row, createMissingCategory);
    cache.set(key, pending);
  }
  return pending;
}

function resolveBrand(
  row: ProductCsvRow,
  cache?: ResolutionCache<string | null>,
): Promise<string | null> {
  const key = cache ? brandCacheKey(row) : "";
  if (!cache || !key) return resolveBrandUncached(row);
  let pending = cache.get(key);
  if (!pending) {
    pending = resolveBrandUncached(row);
    cache.set(key, pending);
  }
  return pending;
}

async function resolveCategoryUncached(
  row: ProductCsvRow,
  createMissingCategory = false,
) {
  const categoryId = row.categoryId || row.category_id;
  if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
    const byId = await Category.findById(categoryId).select("_id").lean();
    if (byId) return String(byId._id);
  }

  const category = row.category || row.categoryName || row.category_name;
  if (!category) return undefined;

  const slug = toHandle(category);
  const byName = await Category.findOne({
    $or: [
      { slug },
      { name: { $regex: `^${escapeRegExp(category)}$`, $options: "i" } },
    ],
  })
    .select("_id")
    .lean();

  if (byName) return String(byName._id);
  if (!createMissingCategory) return undefined;

  const importedCategory = buildImportedCategorySeed(category);
  const created = await Category.findOneAndUpdate(
    { slug: importedCategory.slug },
    { $setOnInsert: importedCategory },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
    .select("_id")
    .lean();

  return created ? String(created._id) : undefined;
}

async function resolveBrandUncached(row: ProductCsvRow) {
  const brandId = row.brandId || row.brand_id;
  if (brandId && mongoose.Types.ObjectId.isValid(brandId)) {
    const byId = await Brand.findById(brandId).select("_id").lean();
    if (byId) return String(byId._id);
  }

  const brand = row.brand || row.brandName || row.brand_name;
  if (!brand) return null;

  const slug = toHandle(brand);
  const byName = await Brand.findOne({
    deletedAt: null,
    $or: [
      { slug },
      { name: { $regex: `^${escapeRegExp(brand)}$`, $options: "i" } },
    ],
  })
    .select("_id")
    .lean();

  return byName ? String(byName._id) : null;
}

function hasColumn(row: ProductCsvRow, column: string) {
  return Object.prototype.hasOwnProperty.call(row, column);
}

function parseJsonArrayColumn(row: ProductCsvRow, column: string): unknown[] | undefined {
  if (!hasColumn(row, column)) return undefined;
  const value = row[column]?.trim();
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error(`${column} must be a JSON array.`);
    }
    return parsed;
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.endsWith("must be a JSON array.")
        ? error.message
        : `${column} must be valid JSON.`,
    );
  }
}

function buildProductPatch(
  row: ProductCsvRow,
  existing: ProductForCsv | null,
  categoryId?: string,
  brandId?: string | null,
) {
  const title = (row.title || row.name || existing?.title || existing?.name || "").trim();
  const slugSource = row.slug || row.handle || title;
  const status = (row.status || existing?.status || PRODUCT_STATUS.DRAFT).trim();
  const images = splitList(row.images || row.image || "");
  const importedCountryOfOrigin = submittedCountryOfOrigin(row);
  const isPhysicalProduct = parseBoolean(
    row.isPhysicalProduct,
    existing?.shipping?.isPhysicalProduct ?? true,
  );
  const optionInput = parseJsonArrayColumn(row, "options");
  const variantInput = parseJsonArrayColumn(row, "variants");

  const barcodeFormatValues = new Set<BarcodeFormat>([
    "ean13",
    "upca",
    "gtin14",
    "code128",
  ]);
  const barcodeSourceValues = new Set<BarcodeSource>([
    "manufacturer",
    "gs1",
    "internal",
  ]);
  const barcodeFormat = barcodeFormatValues.has(row.barcodeFormat as BarcodeFormat)
    ? (row.barcodeFormat as BarcodeFormat)
    : undefined;
  const barcodeSource = barcodeSourceValues.has(row.barcodeSource as BarcodeSource)
    ? (row.barcodeSource as BarcodeSource)
    : undefined;

  const patch: Record<string, unknown> = {
    name: title,
    title,
    description:
      row.description ||
      existing?.description ||
      `${title} product description`,
    shortDescription: row.shortDescription || row.short_description || undefined,
    price: parseRequiredNumber(row.price, existing?.price),
    comparePrice: parseOptionalNumber(row.comparePrice || row.compare_price),
    cost: parseOptionalNumber(row.cost),
    sku: row.sku || existing?.sku || "",
    barcode: row.barcode || undefined,
    barcodeFormat,
    barcodeSource,
    stock: isPhysicalProduct ? parseRequiredNumber(row.stock, existing?.stock) : 0,
    status: normalizeProductStatus(status),
    tags: splitList(row.tags || ""),
    productType: row.productType || row.product_type || undefined,
    publishing: {
      onlineStore: parseBoolean(
        row.onlineStore || row.online_store,
        existing?.publishing?.onlineStore ?? true,
      ),
      pointOfSale: parseBoolean(
        row.pointOfSale || row.point_of_sale,
        existing?.publishing?.pointOfSale ?? false,
      ),
    },
    shipping: {
      isPhysicalProduct,
      weight: parseOptionalNumber(row.weight),
      weightUnit: row.weightUnit || row.weight_unit || "kg",
      countryOfOrigin:
        importedCountryOfOrigin === undefined
          ? existing?.shipping?.countryOfOrigin
          : importedCountryOfOrigin || undefined,
      hsCode: row.hsCode || row.hs_code || undefined,
    },
  };

  if (optionInput !== undefined) {
    patch.options = sanitizeOptionsForMongoose(optionInput);
  }
  if (variantInput !== undefined) {
    patch.variants = sanitizeVariantsForMongoose(variantInput).map((variant) => ({
      ...variant,
      stock: isPhysicalProduct ? Number(variant.stock) || 0 : 0,
      requiresShipping: isPhysicalProduct,
    }));
  }
  if (hasColumn(row, "inventoryTracked") || !isPhysicalProduct) {
    patch.inventory = {
      tracked: isPhysicalProduct
        ? parseBoolean(
            row.inventoryTracked,
            existing?.inventory?.tracked ?? true,
          )
        : false,
      continueSellingWhenOutOfStock: false,
    };
  }
  if (hasColumn(row, "digitalDownloadLimit")) {
    patch.digitalDelivery = {
      downloadLimit: Math.min(1000, parseRequiredNumber(row.digitalDownloadLimit)),
    };
  }

  if (slugSource) {
    const slug = toHandle(slugSource);
    patch.slug = slug;
    patch.handle = slug;
    patch.seo = { ...(existing as { seo?: object } | null)?.seo, handle: slug };
  }

  if (images.length > 0) {
    patch.images = images;
    patch.media = images.map((url, index) => ({
      _id: crypto.randomUUID(),
      type: "image",
      url,
      position: index,
    }));
  }

  if (categoryId) patch.category = categoryId;
  if (brandId !== undefined) patch.brand = brandId;

  Object.keys(patch).forEach((key) => {
    if (patch[key] === undefined) delete patch[key];
  });

  return patch;
}

function buildMatch(row: ProductCsvRow, vendorId: string) {
  const conditions: Record<string, unknown>[] = [];
  const id = row.id || row._id;
  if (id && mongoose.Types.ObjectId.isValid(id)) {
    conditions.push({ _id: id, vendorId });
  }
  if (row.slug) conditions.push({ slug: toHandle(row.slug), vendorId });
  if (row.sku) conditions.push({ sku: row.sku, vendorId });
  return conditions;
}

function canUseVendor(vendorId: string, allowedVendorIds?: string[]) {
  if (!allowedVendorIds || allowedVendorIds.length === 0) return true;
  return allowedVendorIds.includes(vendorId);
}

async function importProductRows(
  rows: ProductCsvRow[],
  context: ProductImportContext,
): Promise<ProductImportResult> {
  const result: ProductImportResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ...result,
      failed: rows.length,
      errors: [
        {
          row: 0,
          message: `Import supports up to ${MAX_IMPORT_ROWS} rows at a time.`,
        },
      ],
    };
  }

  const categoryCache: ResolutionCache<string | undefined> = new Map();
  const brandCache: ResolutionCache<string | null> = new Map();

  for (let index = 0; index < rows.length; index++) {
    const rowNumber = index + 2;
    const row = rows[index];

    try {
      const title = (row.title || row.name || "").trim();
      if (!title) throw new Error("Title is required.");

      const requestedVendorId =
        context.allowVendorColumn && row.vendorId && mongoose.Types.ObjectId.isValid(row.vendorId)
          ? row.vendorId
          : undefined;
      const vendorId = context.forceVendorId || requestedVendorId || context.defaultVendorId;
      if (!canUseVendor(vendorId, context.allowedVendorIds)) {
        throw new Error("You do not have access to this product vendor.");
      }

      const existingConditions = buildMatch(row, vendorId);
      const existing =
        existingConditions.length > 0
          ? await Product.findOne({ $or: existingConditions }).lean<ProductForCsv | null>()
          : null;

      const importedCountryOfOrigin = submittedCountryOfOrigin(row);
      if (
        importedCountryOfOrigin &&
        (!existing ||
          !areCountryValuesEquivalent(
            importedCountryOfOrigin,
            existing.shipping?.countryOfOrigin,
          )) &&
        !isCountryAllowed(
          importedCountryOfOrigin,
          context.countryAvailability,
        )
      ) {
        throw new ValidationError({
          "shipping.countryOfOrigin": ["Selected country is not available"],
        });
      }

      const categoryId = await resolveCategory(
        row,
        Boolean(context.createMissingCategories),
        categoryCache,
      );
      if (!existing && !categoryId) {
        throw new Error("Category is required and must match an existing category.");
      }

      const oldCategoryId = getObjectId(existing?.category);
      const brandId = await resolveBrand(row, brandCache);
      const patch = buildProductPatch(row, existing, categoryId, brandId);
      if (!context.allowFeatured) delete patch.featured;
      else if (row.featured) patch.featured = parseBoolean(row.featured, false);
      assignProductLookupCodes(
        patch as Record<string, unknown> & {
          variants?: Record<string, unknown>[];
        },
      );

      if (existing?._id) {
        const currentSlug = existing.slug;
        const nextSlug = typeof patch.slug === "string" ? patch.slug : currentSlug;
        if (nextSlug && nextSlug !== currentSlug) {
          const conflict = await Product.exists({
            vendorId,
            slug: nextSlug,
            _id: { $ne: existing._id },
          });
          if (conflict) {
            patch.slug = `${nextSlug}-${Date.now()}`;
            patch.handle = patch.slug;
            patch.seo = { ...(patch.seo || {}), handle: patch.slug };
          }
        }

        await assertProductBarcodesAreUnique(
          Product,
          buildBarcodeValidationPayload(
            existing as Record<string, unknown> & {
              variants?: Record<string, unknown>[];
            },
            patch as Record<string, unknown> & {
              variants?: Record<string, unknown>[];
            },
          ),
          { excludeProductId: String(existing._id) },
        );

        const updated = await Product.findOneAndUpdate(
          { _id: existing._id, vendorId },
          { $set: patch },
          { new: true, runValidators: true },
        ).lean<ProductForCsv | null>();

        if (updated) {
          await syncProductBarcodeRegistry(
            String(updated._id),
            updated as unknown as Record<string, unknown>,
          );
        }

        const newCategoryId = getObjectId(updated?.category);
        if (oldCategoryId !== newCategoryId) {
          await syncProductCategory(oldCategoryId || null, newCategoryId || null);
        }
        revalidateProductContent({ slugs: [currentSlug, updated?.slug] });
        result.updated++;
      } else {
        const slug = String(patch.slug || toHandle(title));
        const conflict = await Product.exists({ vendorId, slug });
        const finalSlug = conflict ? `${slug}-${Date.now()}` : slug;
        const createPayload = {
          ...patch,
          vendorId,
          productSource:
            context.allowVendorColumn && row.productSource === "vendor"
              ? "vendor"
              : context.productSource,
          slug: finalSlug,
          handle: finalSlug,
          seo: { ...((patch.seo as object | undefined) || {}), handle: finalSlug },
          category: categoryId,
        };
        await assertProductBarcodesAreUnique(Product, createPayload);
        const created = await Product.create(createPayload);

        await syncProductBarcodeRegistry(
          String(created._id),
          created.toObject() as unknown as Record<string, unknown>,
        );

        await syncProductCategory(null, String(created.category));
        revalidateProductContent({ slugs: [created.slug] });
        result.created++;
      }
    } catch (error) {
      const countryErrors =
        error instanceof ValidationError
          ? error.errors["shipping.countryOfOrigin"]
          : undefined;
      result.failed++;
      result.errors.push({
        row: rowNumber,
        message: countryErrors?.[0]
          ? `shipping.countryOfOrigin: ${countryErrors[0]}`
          : error instanceof Error
            ? error.message
            : "Import failed.",
      });
    }
  }

  return result;
}

async function importProductsCsv(
  csvText: string,
  context: ProductImportContext,
): Promise<ProductImportResult> {
  return importProductRows(parseCsv(csvText), context);
}

export async function importProductsJson(
  jsonText: string,
  context: ProductImportContext,
): Promise<ProductImportResult> {
  try {
    return await importProductRows(
      flattenAdvancedProductCatalog(parseAdvancedProductCatalog(jsonText)),
      { ...context, createMissingCategories: true },
    );
  } catch (error) {
    return {
      created: 0,
      updated: 0,
      failed: 1,
      errors: [
        {
          row: 0,
          message:
            error instanceof Error ? error.message : "Advanced product import failed.",
        },
      ],
    };
  }
}

export function importProductsFile(
  filename: string,
  content: string,
  context: ProductImportContext,
): Promise<ProductImportResult> {
  return filename.trim().toLowerCase().endsWith(".json")
    ? importProductsJson(content, context)
    : importProductsCsv(content, context);
}
