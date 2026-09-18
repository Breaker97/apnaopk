import { mongoose } from "@/lib/db";
import { Product, Category, Brand, Vendor } from "@/models";
import { syncProductAggregates } from "@/models/product.model";
import {
  assertCategoryAcceptsProducts,
  syncProductCategory,
} from "@/lib/catalog/categories";
import { updateAllCollectionProductCounts } from "@/lib/catalog/collections";
import {
  isProductFormatChange,
  normalizeProductShippingData,
  type ProductShippingData,
} from "@/lib/catalog/product-shipping";
import {
  csvFileResponse,
  csvLine,
  datedCsvFilename,
  parseCsv,
} from "@/lib/catalog/csv";
import { revalidateBulkProductContent } from "@/lib/cache-invalidation";
import { escapeRegExp, slugify } from "@/lib/strings";
import { isRecord } from "@/lib/utils";
import { PRODUCT_STATUS, type ProductStatus } from "@/config/app.config";
import {
  assertProductBarcodesAreUnique,
  buildBarcodeValidationPayload,
} from "@/lib/products/barcode-validation";
import { assignProductLookupCodes } from "@/lib/products/barcode-normalization";
import { inspectBarcode, type BarcodeFormat, type BarcodeSource } from "@/lib/barcode/standards";
import {
  releaseProductBarcodeRegistry,
  reserveProductBarcodeRegistry,
  syncProductBarcodeRegistry,
} from "@/lib/products/barcode-registry";
import { ValidationError } from "@/lib/api/errors";
import { audit, createAuditContext } from "@/lib/audit";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import {
  normalizeAdvancedProduct,
  parseAdvancedProductCatalog,
  toImportValues,
} from "@/lib/products/advanced-import";
import {
  assignMissingProductBarcodes,
  sanitizeOptionsForMongoose,
  sanitizeVariantsForMongoose,
} from "@/lib/products/sanitize";
import { mergeScopeFilter } from "@/lib/access/staff-scope";
import { releaseBoostInventoryIfProductWentDark } from "@/lib/boosts/boosts";
import { MediaUrlSchema } from "@/lib/validations";
import { MAX_IMPORT_ROWS } from "@/lib/products/import-limits";
import type { ProductMedia } from "@/types";

/**
 * The product file's columns, in the order the export writes them. The import
 * reads all of them except `marketplaceEligible` and `vendor`, which only
 * describe the row for whoever opens the export.
 */
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
  "isPhysicalProduct",
  "inventoryTracked",
  "digitalDownloadLimit",
  "weight",
  "weightUnit",
  "countryOfOrigin",
  "hsCode",
  "productSource",
  "vendorId",
  "vendor",
] as const;

type ProductCsvHeader = (typeof PRODUCT_CSV_HEADERS)[number];

const EXPORT_ONLY_COLUMNS = new Set<string>(["marketplaceEligible", "vendor"]);

/**
 * Every column the importer reads. `options` and `variants` carry the JSON
 * catalog's structured fields through the same row pipeline.
 */
const IMPORT_COLUMNS = [
  ...PRODUCT_CSV_HEADERS.filter((column) => !EXPORT_ONLY_COLUMNS.has(column)),
  "options",
  "variants",
];

function columnKey(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Header spelling → column. Case, spaces, `_` and `-` never matter, so
 * "Compare Price", "compare_price" and "comparePrice" are the same column; the
 * aliases cover the names other platforms' exports use.
 */
const COLUMN_BY_KEY = new Map<string, string>([
  ...IMPORT_COLUMNS.map((column): [string, string] => [columnKey(column), column]),
  ["name", "title"],
  ["handle", "slug"],
  ["image", "images"],
  ["categoryname", "category"],
  ["brandname", "brand"],
]);

const EXPORT_ONLY_KEYS = new Set([...EXPORT_ONLY_COLUMNS].map(columnKey));

/** A row needs one of these to either create (title) or find (the rest) a product. */
const ROW_KEY_COLUMNS = new Set(["title", "id", "slug", "sku"]);

/** Same cap the product form's media uploader and the product API enforce. */
const MAX_PRODUCT_MEDIA = 10;
const MAX_DOWNLOAD_LIMIT = 1000;

const PRODUCT_STATUSES = Object.values(PRODUCT_STATUS);
const BARCODE_FORMATS: readonly BarcodeFormat[] = ["ean13", "upca", "gtin14", "code128"];
const BARCODE_SOURCES: readonly BarcodeSource[] = ["manufacturer", "gs1", "internal"];
const WEIGHT_UNITS = ["g", "kg", "lb", "oz"] as const;
const PRODUCT_SOURCES = ["admin", "vendor"] as const;
const TRUE_VALUES = new Set(["true", "1", "yes", "y", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "n", "off"]);

// ============================================
// Export
// ============================================

type ProductForCsv = {
  _id?: unknown;
  title?: string;
  name?: string;
  slug?: string;
  sku?: string;
  barcode?: string;
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
  media?: { url?: string; type?: string; position?: number }[];
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
  inventory?: { tracked?: boolean };
  digitalDelivery?: { downloadLimit?: number };
  productSource?: string;
  vendorId?: { _id?: unknown; storeName?: string } | string | null;
};

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

/** The product's pictures in gallery order — videos and 3D models have no column. */
function imageUrls(product: ProductForCsv) {
  if (!Array.isArray(product.media) || product.media.length === 0) {
    return product.images || [];
  }
  return [...product.media]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .filter((item) => (item.type || "image") === "image")
    .map((item) => item.url || "")
    .filter(Boolean);
}

function numberCell(value: number | undefined) {
  return value == null ? "" : String(value);
}

function buildCsvRow(product: ProductForCsv): Record<ProductCsvHeader, string> {
  const barcodeInspection = product.barcode
    ? inspectBarcode(product.barcode, {
        format: product.barcodeFormat,
        source: product.barcodeSource,
      })
    : null;
  const isPhysicalProduct = product.shipping?.isPhysicalProduct !== false;

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
    price: numberCell(product.price),
    comparePrice: numberCell(product.comparePrice),
    cost: numberCell(product.cost),
    stock: numberCell(product.stock),
    status: product.status || "",
    category: getDisplayName(product.category),
    categoryId: getObjectId(product.category),
    brand: getDisplayName(product.brand),
    brandId: getObjectId(product.brand),
    tags: joinList(product.tags),
    images: joinList(imageUrls(product)),
    onlineStore: String(product.publishing?.onlineStore ?? true),
    pointOfSale: String(product.publishing?.pointOfSale ?? false),
    featured: String(product.featured ?? false),
    productType: product.productType || "",
    isPhysicalProduct: String(isPhysicalProduct),
    inventoryTracked: String(isPhysicalProduct && product.inventory?.tracked !== false),
    digitalDownloadLimit: isPhysicalProduct
      ? ""
      : String(product.digitalDelivery?.downloadLimit ?? 0),
    weight: numberCell(product.shipping?.weight),
    weightUnit: product.shipping?.weightUnit || "",
    countryOfOrigin: product.shipping?.countryOfOrigin || "",
    hsCode: product.shipping?.hsCode || "",
    productSource: product.productSource || "",
    vendorId: getObjectId(product.vendorId),
    vendor: getVendorName(product.vendorId),
  };
}

export function productsCsvResponse(products: ProductForCsv[], prefix: string) {
  return csvFileResponse(datedCsvFilename(prefix), [
    PRODUCT_CSV_HEADERS.join(","),
    ...products.map((product) => {
      const record = buildCsvRow(product);
      return csvLine(PRODUCT_CSV_HEADERS.map((header) => record[header]));
    }),
  ]);
}

// ============================================
// Import
// ============================================

type ProductImportResult = {
  created: number;
  updated: number;
  failed: number;
  /** `row` is the spreadsheet row (CSV) or product number (JSON); 0 = the file itself. */
  errors: { row: number; message: string }[];
  warnings: string[];
};

export type ProductImportContext = {
  /** Vendor a new row is filed under when it names none. */
  defaultVendorId: string;
  productSource: "admin" | "vendor";
  /** Vendors this caller may write to; absent means any (platform admin). */
  allowedVendorIds?: string[];
  /** A staff member's product scope; every matched product must satisfy it. */
  productScopeFilter?: Record<string, unknown>;
  /** Set when the caller may not create products — rows that would create fail with it. */
  createRefusal?: string;
  /** Set when the caller may not edit products — rows that match one fail with it. */
  updateRefusal?: string;
  /** Honour the `vendorId` and `productSource` columns (platform admin only). */
  allowVendorColumn?: boolean;
  allowFeatured?: boolean;
  /**
   * Create the categories a JSON catalog names that do not exist yet. Category
   * creation is admin-only everywhere else, so only an admin's import may.
   */
  createMissingCategories?: boolean;
  /** The vendor plan's product cap, when one applies. */
  productLimit?: { limit: number; current: number };
  countryAvailability: unknown;
};

type ImportRecord =
  | { row: number; values: Record<string, string> }
  | { row: number; error: string };

function fileError(message: string, failed = 0): ProductImportResult {
  return {
    created: 0,
    updated: 0,
    failed,
    errors: [{ row: 0, message }],
    warnings: [],
  };
}

export function buildImportedCategorySeed(input: string) {
  const name = input.trim();
  const slug = slugify(name);
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

// --- Reading cells -------------------------------------------------------
//
// A cell left empty means "no value": a new product takes the default and an
// existing one keeps what it has. A cell with a value that does not parse is
// an error for that row — never a silent default. That is what used to turn
// "1,299.00" into a price of 0 on a live product.

type Cells = Record<string, string>;

function cellText(cells: Cells, column: string): string | undefined {
  const value = cells[column]?.trim();
  return value ? value : undefined;
}

function cellNumber(
  cells: Cells,
  column: string,
  example: string,
): number | undefined {
  const value = cellText(cells, column);
  if (value === undefined) return undefined;
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(value)) {
    throw new Error(
      `${column} must be a plain number such as ${example}, without currency symbols or thousands separators (got "${value}").`,
    );
  }
  return Number(value);
}

function cellCount(cells: Cells, column: string, max?: number): number | undefined {
  const value = cellText(cells, column);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || (max !== undefined && Number(value) > max)) {
    throw new Error(
      max === undefined
        ? `${column} must be a whole number of 0 or more (got "${value}").`
        : `${column} must be a whole number from 0 to ${max} (got "${value}").`,
    );
  }
  return Number(value);
}

function cellFlag(cells: Cells, column: string): boolean | undefined {
  const value = cellText(cells, column);
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new Error(`${column} must be true or false (got "${value}").`);
}

function cellChoice<T extends string>(
  cells: Cells,
  column: string,
  choices: readonly T[],
  aliases: Record<string, T> = {},
): T | undefined {
  const value = cellText(cells, column);
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  const match = choices.find((choice) => choice === normalized) ?? aliases[normalized];
  if (!match) {
    throw new Error(
      `${column} must be one of ${[...choices, ...Object.keys(aliases)].join(", ")} (got "${value}").`,
    );
  }
  return match;
}

function cellTags(cells: Cells): string[] | undefined {
  const value = cellText(cells, "tags");
  if (value === undefined) return undefined;
  return [
    ...new Set(
      value
        .split(/[|,]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Image URLs are separated by `|`. A comma separates them only when every
 * piece is itself a URL: image CDNs put commas inside URLs (`w_400,h_400`),
 * and splitting one of those would import two broken images.
 */
function splitImageUrls(value: string): string[] {
  if (value.includes("|")) {
    return value.split("|").map((url) => url.trim()).filter(Boolean);
  }
  const pieces = value.split(",").map((url) => url.trim()).filter(Boolean);
  return pieces.length > 1 && pieces.every((url) => /^(https?:\/\/|\/(?!\/))/i.test(url))
    ? pieces
    : [value];
}

function cellImages(cells: Cells): string[] | undefined {
  const value = cellText(cells, "images");
  if (value === undefined) return undefined;
  const urls = [...new Set(splitImageUrls(value))];
  // The rule the product API applies: http(s) or a path on this site — never
  // javascript:, data: or a bare file name.
  const invalid = urls.find((url) => !MediaUrlSchema.safeParse(url).success);
  if (invalid) {
    throw new Error(`images: "${invalid}" is not a link to an image. Use a public https:// URL.`);
  }
  if (urls.length > MAX_PRODUCT_MEDIA) {
    throw new Error(
      `images: a product can have at most ${MAX_PRODUCT_MEDIA} images (got ${urls.length}).`,
    );
  }
  return urls;
}

function cellJsonArray(cells: Cells, column: string): unknown[] | undefined {
  const value = cellText(cells, column);
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${column} must be valid JSON.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${column} must be a JSON array.`);
  return parsed;
}

function readRow(cells: Cells) {
  return {
    id: cellText(cells, "id"),
    title: cellText(cells, "title"),
    slug: cellText(cells, "slug"),
    sku: cellText(cells, "sku"),
    barcode: cellText(cells, "barcode"),
    barcodeFormat: cellChoice(cells, "barcodeFormat", BARCODE_FORMATS),
    barcodeSource: cellChoice(cells, "barcodeSource", BARCODE_SOURCES),
    description: cellText(cells, "description"),
    shortDescription: cellText(cells, "shortDescription"),
    price: cellNumber(cells, "price", "24.99"),
    comparePrice: cellNumber(cells, "comparePrice", "29.99"),
    cost: cellNumber(cells, "cost", "12.50"),
    stock: cellCount(cells, "stock"),
    // The dashboard calls the "unlisted" status Archived, so accept both.
    status: cellChoice<ProductStatus>(cells, "status", PRODUCT_STATUSES, {
      archived: PRODUCT_STATUS.UNLISTED,
    }),
    category: cellText(cells, "category"),
    categoryId: cellText(cells, "categoryId"),
    brand: cellText(cells, "brand"),
    brandId: cellText(cells, "brandId"),
    tags: cellTags(cells),
    images: cellImages(cells),
    onlineStore: cellFlag(cells, "onlineStore"),
    pointOfSale: cellFlag(cells, "pointOfSale"),
    featured: cellFlag(cells, "featured"),
    productType: cellText(cells, "productType"),
    isPhysicalProduct: cellFlag(cells, "isPhysicalProduct"),
    inventoryTracked: cellFlag(cells, "inventoryTracked"),
    digitalDownloadLimit: cellCount(cells, "digitalDownloadLimit", MAX_DOWNLOAD_LIMIT),
    weight: cellNumber(cells, "weight", "0.5"),
    weightUnit: cellChoice(cells, "weightUnit", WEIGHT_UNITS),
    countryOfOrigin: cellText(cells, "countryOfOrigin"),
    hsCode: cellText(cells, "hsCode"),
    productSource: cellChoice(cells, "productSource", PRODUCT_SOURCES),
    vendorId: cellText(cells, "vendorId"),
    options: cellJsonArray(cells, "options"),
    variants: cellJsonArray(cells, "variants"),
  };
}

type ProductRow = ReturnType<typeof readRow>;

type BarcodePayload = Record<string, unknown> & { variants?: Record<string, unknown>[] };

// --- Stored products ------------------------------------------------------

type StoredVariant = Record<string, unknown> & {
  _id?: unknown;
  optionValues?: unknown;
  barcode?: string;
  locationInventory?: unknown[];
};

type ExistingProduct = {
  _id: unknown;
  vendorId?: unknown;
  slug?: string;
  status?: string;
  category?: unknown;
  images?: string[];
  media?: ProductMedia[];
  publishing?: { onlineStore?: boolean } | null;
  shipping?: ProductShippingData;
  variants?: StoredVariant[];
};

/**
 * The product a row describes: by `id`, then `slug`, then `sku`. The first key
 * that finds something wins, so a row that names an id is never re-routed to
 * whichever product happens to share its SKU.
 *
 * Ids and slugs are unique across the store and are looked up across every
 * vendor the caller may write to; a SKU only means something inside one
 * vendor's catalog.
 */
async function findExistingProduct(
  row: ProductRow,
  vendorId: string,
  context: ProductImportContext,
): Promise<ExistingProduct | null> {
  const access = mergeScopeFilter(
    context.allowedVendorIds ? { vendorId: { $in: context.allowedVendorIds } } : {},
    context.productScopeFilter ?? {},
  );

  if (row.id && mongoose.Types.ObjectId.isValid(row.id)) {
    const byId = await Product.findOne(
      mergeScopeFilter({ _id: row.id }, access),
    ).lean<ExistingProduct | null>();
    if (byId) return byId;
  }

  const slug = row.slug ? slugify(row.slug) : "";
  if (slug) {
    const bySlug = await Product.findOne(
      mergeScopeFilter({ slug }, access),
    ).lean<ExistingProduct | null>();
    if (bySlug) return bySlug;
  }

  if (row.sku) {
    const bySku = await Product.find(
      mergeScopeFilter({ vendorId, sku: row.sku }, access),
    )
      .limit(2)
      .lean<ExistingProduct[]>();
    if (bySku.length > 1) {
      throw new Error(
        `SKU "${row.sku}" is used by more than one product. Add the id column from an export to say which one to update.`,
      );
    }
    if (bySku[0]) return bySku[0];
  }

  return null;
}

/**
 * A slug no other product uses — checked across every vendor, not just this
 * one: the storefront finds a product by slug alone, so two vendors sharing
 * one would leave one of the products unreachable.
 */
async function uniqueProductSlug(base: string, excludeId?: unknown): Promise<string> {
  const taken = await Product.find({
    slug: { $regex: `^${escapeRegExp(base)}(-\\d+)?$` },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select("slug")
    .lean<{ slug?: string }[]>();
  const used = new Set(taken.map((product) => product.slug));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix++;
  return `${base}-${suffix}`;
}

function assertCountryAllowed(
  country: string | undefined,
  current: string | undefined,
  context: ProductImportContext,
) {
  if (!country) return;
  if (current && areCountryValuesEquivalent(country, current)) return;
  if (!isCountryAllowed(country, context.countryAvailability)) {
    throw new Error(
      `countryOfOrigin "${country}" is not one of the countries this store sells from.`,
    );
  }
}

/**
 * The media list for an images column, or `null` when it would change nothing.
 *
 * An image the file lists again keeps its entry — the id a variant points at,
 * its alt text, its fit — and media the column cannot describe (videos, 3D
 * models) stays after the images. Rebuilding every entry from bare URLs is
 * what used to give a re-imported export fresh ids, broken variant images and
 * videos relabelled as pictures.
 */
function mergeImageMedia(
  existing: ProductMedia[] | undefined,
  urls: string[],
): ProductMedia[] | null {
  const media = Array.isArray(existing)
    ? [...existing].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : [];
  const images = media.filter((item) => (item.type || "image") === "image");
  const others = media.filter((item) => (item.type || "image") !== "image");
  if (
    images.length === urls.length &&
    images.every((item, index) => item.url === urls[index])
  ) {
    return null;
  }

  const byUrl = new Map(images.map((item) => [item.url, item]));
  const next: ProductMedia[] = [
    ...urls.map(
      (url) => byUrl.get(url) ?? { _id: crypto.randomUUID(), type: "image" as const, url },
    ),
    ...others,
  ];
  if (next.length > MAX_PRODUCT_MEDIA) {
    throw new Error(
      `images: this product also has ${others.length} video or 3D media, and a product can hold at most ${MAX_PRODUCT_MEDIA} media files in total.`,
    );
  }
  return next.map((item, position) => ({ ...item, position }));
}

function prepareVariants(input: unknown[], isPhysicalProduct: boolean) {
  return sanitizeVariantsForMongoose(input).map((variant) => ({
    ...variant,
    stock: isPhysicalProduct ? Math.max(0, Number(variant.stock) || 0) : 0,
    requiresShipping: isPhysicalProduct,
  }));
}

function variantKey(optionValues: unknown) {
  if (!Array.isArray(optionValues)) return "";
  return optionValues
    .map((optionValue) =>
      isRecord(optionValue)
        ? `${String(optionValue.optionName ?? "").trim().toLowerCase()}=${String(optionValue.value ?? "").trim().toLowerCase()}`
        : "",
    )
    .sort()
    .join("|");
}

/**
 * Keep the identity of every variant a re-import describes again (same option
 * values). Carts, orders and per-location stock all point at a variant's id;
 * replacing the array wholesale would orphan them and hand every variant a new
 * barcode on each import.
 */
function carryVariantIdentity(
  next: Record<string, unknown>[],
  existing: StoredVariant[] | undefined,
) {
  if (!Array.isArray(existing) || existing.length === 0) return next;
  const byKey = new Map(existing.map((variant) => [variantKey(variant.optionValues), variant]));
  return next.map((variant) => {
    const previous = byKey.get(variantKey(variant.optionValues));
    if (!previous) return variant;
    const carried: Record<string, unknown> = { ...variant, _id: String(previous._id) };
    if (!variant.barcode && previous.barcode) {
      carried.barcode = previous.barcode;
      carried.barcodeFormat = previous.barcodeFormat;
      carried.barcodeSource = previous.barcodeSource;
    }
    for (const field of ["locationInventory", "inventory", "preorder", "mediaId", "image"]) {
      if (previous[field] !== undefined && variant[field] === undefined) {
        carried[field] = previous[field];
      }
    }
    return carried;
  });
}

function describeImportError(error: unknown): string {
  if (error instanceof ValidationError) {
    const messages = Object.entries(error.errors).flatMap(([field, list]) =>
      list.map((message) => (field === "_error" ? message : `${field}: ${message}`)),
    );
    return messages.join(" ") || error.message;
  }
  if (error instanceof mongoose.Error.ValidationError) {
    return Object.values(error.errors)
      .map((detail) => detail.message)
      .join(" ");
  }
  if (error instanceof mongoose.Error.CastError) {
    return `${error.path}: "${String(error.value)}" is not a valid value.`;
  }
  if (isRecord(error) && error.code === 11000) {
    return "Another product was saved with the same slug at the same moment. Import the row again.";
  }
  return error instanceof Error ? error.message : "Import failed.";
}

// --- One import run -------------------------------------------------------

type CategoryNode = { id: string; name: string; slug: string; parentId: string | null };

/**
 * Everything one file's rows share: the category tree (loaded once — a store
 * has hundreds of categories at most, and a thousand-row file names the same
 * few dozen over and over), memoised brand/vendor/leaf checks, and what the
 * run touched, so counts and caches are refreshed once at the end instead of
 * once per row.
 */
function createImportRun(context: ProductImportContext) {
  let categoryNodes: Promise<CategoryNode[]> | undefined;
  const leafChecks = new Map<string, Promise<void>>();
  const brands = new Map<string, Promise<string>>();
  const vendors = new Map<string, Promise<void>>();
  const touchedSlugs = new Set<string>();
  const touchedCategoryIds = new Set<string>();
  let created = 0;

  function loadCategories() {
    categoryNodes ??= Category.find({})
      .select("_id name slug parentId")
      .lean<Array<{ _id: unknown; name?: string; slug?: string; parentId?: unknown }>>()
      .then((rows) =>
        rows.map((category) => ({
          id: String(category._id),
          name: String(category.name ?? ""),
          slug: String(category.slug ?? ""),
          parentId: category.parentId ? String(category.parentId) : null,
        })),
      );
    return categoryNodes;
  }

  function categoryPath(node: CategoryNode, nodes: CategoryNode[]) {
    const names = [node.name];
    let parentId = node.parentId;
    while (parentId && names.length < 5) {
      const parent = nodes.find((candidate) => candidate.id === parentId);
      if (!parent) break;
      names.unshift(parent.name);
      parentId = parent.parentId;
    }
    return names.join(" > ");
  }

  /**
   * A category by id, name, slug or path ("Women > Dresses"). A name several
   * branches share is refused rather than guessed: filing the product under
   * the wrong "Accessories" is invisible until a shopper can't find it.
   */
  async function resolveCategory(row: ProductRow): Promise<string> {
    const nodes = await loadCategories();
    if (row.categoryId) {
      if (nodes.some((node) => node.id === row.categoryId)) return row.categoryId;
      // An export from another store carries ids this one never had; its
      // category name still resolves.
      if (!row.category) throw new Error(`categoryId "${row.categoryId}" was not found.`);
    }
    const value = row.category ?? "";

    if (value.includes(">")) {
      let parentId: string | null = null;
      for (const part of value.split(">").map((name) => name.trim().toLowerCase())) {
        const match = nodes.find(
          (node) => node.parentId === parentId && node.name.trim().toLowerCase() === part,
        );
        if (!match) {
          throw new Error(`Category "${value}" was not found. Check each level of the path.`);
        }
        parentId = match.id;
      }
      if (parentId) return parentId;
    }

    const named = nodes.filter((node) => node.name.trim().toLowerCase() === value.toLowerCase());
    if (named.length === 1) return named[0].id;
    // Slugs are unique, so a value that is exactly one settles a shared name —
    // including a top-level category, which has no longer path to write.
    const exactSlug = nodes.find((node) => node.slug === value);
    if (exactSlug) return exactSlug.id;
    if (named.length > 1) {
      throw new Error(
        `Several categories are named "${value}": ${named
          .map((node) => `${categoryPath(node, nodes)} (slug: ${node.slug})`)
          .join(", ")}. Write the full path or the slug instead.`,
      );
    }

    const bySlug = nodes.find(
      (node) => node.slug === value.toLowerCase() || node.slug === slugify(value),
    );
    if (bySlug) return bySlug.id;

    if (!context.createMissingCategories) {
      throw new Error(
        `Category "${value}" was not found. Create it under Categories first, or use an existing category's name.`,
      );
    }
    const seed = buildImportedCategorySeed(value);
    const createdCategory = await Category.findOneAndUpdate(
      { slug: seed.slug },
      { $setOnInsert: seed },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    )
      .select("_id")
      .lean<{ _id: unknown } | null>();
    if (!createdCategory) throw new Error(`Category "${value}" could not be created.`);
    const node = { id: String(createdCategory._id), name: seed.name, slug: seed.slug, parentId: null };
    nodes.push(node);
    return node.id;
  }

  /** The one leaf rule, asked once per category however many rows use it. */
  function assertLeafCategory(categoryId: string) {
    let check = leafChecks.get(categoryId);
    if (!check) {
      check = assertCategoryAcceptsProducts(categoryId);
      leafChecks.set(categoryId, check);
    }
    return check;
  }

  function resolveBrand(row: ProductRow): Promise<string> {
    const key = `${row.brandId ?? ""}|${(row.brand ?? "").toLowerCase()}`;
    let pending = brands.get(key);
    if (!pending) {
      pending = (async () => {
        if (row.brandId && mongoose.Types.ObjectId.isValid(row.brandId)) {
          const byId = await Brand.findOne({ _id: row.brandId, deletedAt: null })
            .select("_id")
            .lean<{ _id: unknown } | null>();
          if (byId) return String(byId._id);
        }
        if (!row.brand) throw new Error(`brandId "${row.brandId}" was not found.`);
        const byName = await Brand.findOne({
          deletedAt: null,
          $or: [
            { slug: slugify(row.brand) },
            { name: { $regex: `^${escapeRegExp(row.brand)}$`, $options: "i" } },
          ],
        })
          .select("_id")
          .lean<{ _id: unknown } | null>();
        if (!byName) {
          throw new Error(
            `Brand "${row.brand}" was not found. Create it under Brands first, or leave the brand empty.`,
          );
        }
        return String(byName._id);
      })();
      brands.set(key, pending);
    }
    return pending;
  }

  function assertVendorExists(vendorId: string) {
    let check = vendors.get(vendorId);
    if (!check) {
      check = Vendor.exists({ _id: vendorId }).then((exists) => {
        if (!exists) {
          throw new Error(
            `Vendor "${vendorId}" was not found. Leave vendorId empty to import the product into your own store.`,
          );
        }
      });
      vendors.set(vendorId, check);
    }
    return check;
  }

  function assertPlanAllowsAnother() {
    const limit = context.productLimit;
    if (limit && limit.current + created >= limit.limit) {
      throw new Error(
        `Your plan allows up to ${limit.limit} products. Upgrade your plan to import more.`,
      );
    }
  }

  function touch(slugs: Array<string | undefined>, categoryIds: Array<unknown>) {
    for (const slug of slugs) if (slug) touchedSlugs.add(slug);
    for (const id of categoryIds) if (id) touchedCategoryIds.add(String(id));
  }

  async function finish() {
    if (touchedSlugs.size === 0) return;
    for (const categoryId of touchedCategoryIds) {
      await syncProductCategory(categoryId, null);
    }
    // Automated collections match on tags, price and status — any imported
    // row can change what they hold.
    await updateAllCollectionProductCounts().catch((error) =>
      console.error("[product-import] collection counts:", error),
    );
    revalidateBulkProductContent([...touchedSlugs]);
  }

  return {
    context,
    resolveCategory,
    assertLeafCategory,
    resolveBrand,
    assertVendorExists,
    assertPlanAllowsAnother,
    touch,
    finish,
    countCreated: () => {
      created++;
    },
  };
}

type ImportRun = ReturnType<typeof createImportRun>;

async function createProduct(
  row: ProductRow,
  vendorId: string,
  run: ImportRun,
): Promise<void> {
  const { context } = run;
  if (context.createRefusal) throw new Error(context.createRefusal);
  if (context.allowedVendorIds && !context.allowedVendorIds.includes(vendorId)) {
    throw new Error("You do not have access to this vendor's products.");
  }
  if (!row.title) {
    throw new Error("No product matches this row's id, slug or SKU, and a new product needs a title.");
  }

  const isPhysicalProduct = row.isPhysicalProduct !== false;
  const variants = row.variants ? prepareVariants(row.variants, isPhysicalProduct) : [];
  if (row.price === undefined && variants.length === 0) {
    throw new Error("price is required for a new product.");
  }
  if (!row.category && !row.categoryId) {
    throw new Error("category is required for a new product.");
  }

  run.assertPlanAllowsAnother();
  if (context.allowVendorColumn && vendorId !== context.defaultVendorId) {
    await run.assertVendorExists(vendorId);
  }
  assertCountryAllowed(row.countryOfOrigin, undefined, context);
  const categoryId = await run.resolveCategory(row);
  await run.assertLeafCategory(categoryId);
  const brandId = row.brand || row.brandId ? await run.resolveBrand(row) : null;

  // A title in a script slugify drops (বাংলা, العربية, 中文) still needs a URL.
  const productId = new mongoose.Types.ObjectId();
  const slug = await uniqueProductSlug(
    slugify(row.slug || row.title) || slugify(row.sku || "") || `product-${String(productId).slice(-8)}`,
  );
  const images = row.images ?? [];

  const document: Record<string, unknown> = {
    _id: productId,
    vendorId,
    // Only a row that names its vendor carries that product's own source —
    // the round trip of a vendor's product through an admin export.
    productSource:
      context.allowVendorColumn && row.vendorId && row.productSource
        ? row.productSource
        : context.productSource,
    name: row.title,
    title: row.title,
    slug,
    handle: slug,
    seo: { handle: slug },
    // The model requires a description; the title is a neutral stand-in the
    // merchant can replace, unlike invented copy.
    description: row.description ?? row.shortDescription ?? row.title,
    shortDescription: row.shortDescription,
    price: row.price ?? 0,
    comparePrice: row.comparePrice,
    cost: row.cost,
    sku: row.sku,
    barcode: row.barcode,
    barcodeFormat: row.barcodeFormat,
    barcodeSource: row.barcodeSource,
    stock: isPhysicalProduct ? (row.stock ?? 0) : 0,
    status: row.status ?? PRODUCT_STATUS.DRAFT,
    category: categoryId,
    brand: brandId,
    tags: row.tags ?? [],
    images,
    media: images.map((url, position) => ({
      _id: crypto.randomUUID(),
      type: "image",
      url,
      position,
    })),
    productType: row.productType,
    featured: context.allowFeatured ? (row.featured ?? false) : false,
    publishing: {
      onlineStore: row.onlineStore ?? true,
      pointOfSale: row.pointOfSale ?? false,
    },
    shipping: {
      isPhysicalProduct,
      weight: row.weight,
      weightUnit: row.weightUnit ?? "kg",
      countryOfOrigin: row.countryOfOrigin,
      hsCode: row.hsCode,
    },
    inventory: {
      tracked: isPhysicalProduct ? (row.inventoryTracked ?? true) : false,
      continueSellingWhenOutOfStock: false,
    },
    ...(row.digitalDownloadLimit !== undefined
      ? { digitalDelivery: { downloadLimit: row.digitalDownloadLimit } }
      : {}),
    options: row.options ? sanitizeOptionsForMongoose(row.options) : [],
    variants,
  };

  assignMissingProductBarcodes(document);
  assignProductLookupCodes(document as BarcodePayload);
  await assertProductBarcodesAreUnique(Product, document as BarcodePayload);

  // Same order as the product create routes: validate (which runs the model's
  // derived-field hook), reserve the barcodes, save, then settle the registry.
  const product = new Product(document);
  await product.validate();
  try {
    await reserveProductBarcodeRegistry(
      String(product._id),
      product.toObject() as unknown as Record<string, unknown>,
    );
    await product.save();
    await syncProductBarcodeRegistry(
      String(product._id),
      product.toObject() as unknown as Record<string, unknown>,
    );
  } catch (error) {
    await releaseProductBarcodeRegistry(String(product._id));
    throw error;
  }

  run.countCreated();
  run.touch([product.slug], [categoryId]);
}

async function updateProduct(
  row: ProductRow,
  existing: ExistingProduct,
  run: ImportRun,
): Promise<void> {
  const { context } = run;
  if (context.updateRefusal) throw new Error(context.updateRefusal);
  const productId = String(existing._id);

  if (
    context.allowVendorColumn &&
    row.vendorId &&
    row.vendorId !== getObjectId(existing.vendorId)
  ) {
    throw new Error(
      "vendorId does not match the product this row updates. An import cannot move a product to another vendor.",
    );
  }
  if (
    row.isPhysicalProduct !== undefined &&
    isProductFormatChange(existing.shipping, { isPhysicalProduct: row.isPhysicalProduct })
  ) {
    throw new Error(
      "isPhysicalProduct cannot change after a product is created. Create a new product instead.",
    );
  }
  const isPhysicalProduct = existing.shipping?.isPhysicalProduct !== false;
  assertCountryAllowed(row.countryOfOrigin, existing.shipping?.countryOfOrigin, context);

  // Only what the row actually fills in is written, and nested objects by
  // path: `$set: { shipping: {...} }` would replace the whole object and wipe
  // the parcel size and customs text a file has no columns for.
  const set: Record<string, unknown> = {};
  const assign = (path: string, value: unknown) => {
    if (value !== undefined) set[path] = value;
  };

  if (row.title) {
    set.title = row.title;
    set.name = row.title;
  }
  assign("description", row.description);
  assign("shortDescription", row.shortDescription);
  assign("price", row.price);
  assign("comparePrice", row.comparePrice);
  assign("cost", row.cost);
  assign("sku", row.sku);
  assign("barcode", row.barcode);
  assign("barcodeFormat", row.barcodeFormat);
  assign("barcodeSource", row.barcodeSource);
  if (row.stock !== undefined) set.stock = isPhysicalProduct ? row.stock : 0;
  assign("status", row.status);
  assign("tags", row.tags);
  assign("productType", row.productType);
  assign("publishing.onlineStore", row.onlineStore);
  assign("publishing.pointOfSale", row.pointOfSale);
  if (context.allowFeatured) assign("featured", row.featured);
  if (isPhysicalProduct) assign("inventory.tracked", row.inventoryTracked);
  assign("digitalDelivery.downloadLimit", row.digitalDownloadLimit);

  const shippingChanges = Object.entries({
    weight: row.weight,
    weightUnit: row.weightUnit,
    countryOfOrigin: row.countryOfOrigin,
    hsCode: row.hsCode,
  }).filter(([, value]) => value !== undefined);
  if (shippingChanges.length > 0) {
    // Normalized the way the create hook does it (country codes upper-cased,
    // HS codes reduced to digits), then written field by field.
    const normalized = normalizeProductShippingData({
      ...existing.shipping,
      ...(Object.fromEntries(shippingChanges) as ProductShippingData),
    });
    for (const [field] of shippingChanges) {
      assign(`shipping.${field}`, normalized[field as keyof ProductShippingData]);
    }
  }

  const requestedSlug = row.slug ? slugify(row.slug) : "";
  if (requestedSlug && requestedSlug !== existing.slug) {
    const slug = await uniqueProductSlug(requestedSlug, existing._id);
    set.slug = slug;
    set.handle = slug;
    set["seo.handle"] = slug;
  }

  const oldCategoryId = existing.category ? String(existing.category) : "";
  if (row.category || row.categoryId) {
    const categoryId = await run.resolveCategory(row);
    if (categoryId !== oldCategoryId) {
      // Only a move has to satisfy the leaf rule, as in the product PUT routes.
      await run.assertLeafCategory(categoryId);
      set.category = categoryId;
    }
  }
  if (row.brand || row.brandId) set.brand = await run.resolveBrand(row);

  if (row.images) {
    const media = mergeImageMedia(existing.media, row.images);
    if (media) {
      set.media = media;
      set.images = row.images;
    }
  }

  if (row.options !== undefined) set.options = sanitizeOptionsForMongoose(row.options);
  if (row.variants !== undefined) {
    set.variants = carryVariantIdentity(
      prepareVariants(row.variants, isPhysicalProduct),
      existing.variants,
    );
  }

  if (Object.keys(set).length === 0) return;

  if ((Array.isArray(set.variants) && set.variants.length > 0) || "barcode" in set) {
    assignMissingProductBarcodes(set);
  }
  assignProductLookupCodes(set as BarcodePayload);
  const barcodePayload = buildBarcodeValidationPayload(
    existing as unknown as BarcodePayload,
    set as BarcodePayload,
  );
  await assertProductBarcodesAreUnique(Product, barcodePayload, {
    excludeProductId: productId,
  });

  let updated: ExistingProduct | null;
  try {
    await reserveProductBarcodeRegistry(productId, barcodePayload);
    updated = await Product.findOneAndUpdate(
      { _id: existing._id },
      { $set: set },
      { returnDocument: "after", runValidators: true },
    ).lean<ExistingProduct | null>();
  } catch (error) {
    await syncProductBarcodeRegistry(productId, existing as unknown as Record<string, unknown>);
    throw error;
  }
  if (!updated) {
    await syncProductBarcodeRegistry(productId, existing as unknown as Record<string, unknown>);
    throw new Error("This product was deleted while the file was importing.");
  }

  await syncProductBarcodeRegistry(productId, updated as unknown as Record<string, unknown>);
  // `findOneAndUpdate` skips the validate hook, so price ranges, the stock
  // roll-up and the search block are recomputed exactly as the PUT routes do.
  await syncProductAggregates(productId);
  // Archiving or unpublishing a boosted product frees its booked positions,
  // the same as saving that change from the product form.
  await releaseBoostInventoryIfProductWentDark(productId, existing, updated);

  run.touch([existing.slug, updated.slug], [oldCategoryId, updated.category]);
}

async function importProductRecords(
  records: ImportRecord[],
  context: ProductImportContext,
  warnings: string[] = [],
): Promise<ProductImportResult> {
  if (records.length > MAX_IMPORT_ROWS) {
    return fileError(
      `A file can import up to ${MAX_IMPORT_ROWS} products at a time; this one has ${records.length}. Split it into smaller files.`,
      records.length,
    );
  }

  const result: ProductImportResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    warnings,
  };
  const run = createImportRun(context);

  for (const record of records) {
    try {
      if ("error" in record) throw new Error(record.error);
      const row = readRow(record.values);
      const vendorId =
        context.allowVendorColumn && row.vendorId ? row.vendorId : context.defaultVendorId;
      if (!mongoose.Types.ObjectId.isValid(vendorId)) {
        throw new Error(`vendorId "${vendorId}" is not a valid id.`);
      }

      const existing = await findExistingProduct(row, vendorId, context);
      if (existing) {
        await updateProduct(row, existing, run);
        result.updated++;
      } else {
        await createProduct(row, vendorId, run);
        result.created++;
      }
    } catch (error) {
      result.failed++;
      result.errors.push({ row: record.row, message: describeImportError(error) });
    }
  }

  await run.finish();
  return result;
}

async function importProductsCsv(
  csvText: string,
  context: ProductImportContext,
): Promise<ProductImportResult> {
  const { headers, records } = parseCsv(csvText);
  if (headers.length === 0) return fileError("The file is empty.");

  const columns = headers.map((header) => COLUMN_BY_KEY.get(columnKey(header)));
  if (!columns.some((column) => column && ROW_KEY_COLUMNS.has(column))) {
    return fileError(
      `The first row must hold the column names from the sample file (title, price, category, …). This file starts with: ${headers
        .slice(0, 4)
        .join(", ")}.`,
    );
  }

  const ignored = headers.filter(
    (header, index) => header && !columns[index] && !EXPORT_ONLY_KEYS.has(columnKey(header)),
  );
  const warnings = ignored.length
    ? [`These columns were not recognised and were ignored: ${ignored.join(", ")}.`]
    : [];

  return importProductRecords(
    records.map(({ row, values }) => {
      const cells: Cells = {};
      headers.forEach((header, index) => {
        const column = columns[index];
        const value = values[header] ?? "";
        // Two spellings of one column ("name" and "title"): a filled cell wins.
        if (column && (value || !(column in cells))) cells[column] = value;
      });
      return { row, values: cells };
    }),
    // A spreadsheet has no way to say where in the tree a new category would
    // go, so CSV rows only ever file products under categories that exist.
    { ...context, createMissingCategories: false },
    warnings,
  );
}

export async function importProductsJson(
  jsonText: string,
  context: ProductImportContext,
): Promise<ProductImportResult> {
  let products: unknown[];
  try {
    products = parseAdvancedProductCatalog(jsonText);
  } catch (error) {
    return fileError(error instanceof Error ? error.message : "Advanced product import failed.");
  }

  return importProductRecords(
    products.map((raw, index) => {
      try {
        return { row: index + 1, values: toImportValues(normalizeAdvancedProduct(raw)) };
      } catch (error) {
        return { row: index + 1, error: describeImportError(error) };
      }
    }),
    context,
  );
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

/**
 * One audit entry per import that changed the catalog — who ran it, which
 * file, and what it did. The product routes audit every single write; a
 * thousand of them arriving in one request should not be the one path that
 * leaves no trace. A file whose every row was refused changed nothing.
 */
export async function auditProductImport(
  request: Parameters<typeof createAuditContext>[0],
  session: Parameters<typeof createAuditContext>[1],
  fileName: string,
  result: ProductImportResult,
) {
  if (result.created === 0 && result.updated === 0) return;
  await audit(createAuditContext(request, session), {
    action: "BULK_ACTION",
    resource: "product",
    changes: {
      summary: `Imported "${fileName}": ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    },
    metadata: {
      fileName,
      created: result.created,
      updated: result.updated,
      failed: result.failed,
    },
  });
}
