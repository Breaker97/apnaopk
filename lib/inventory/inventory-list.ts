import type { PipelineStage } from "mongoose";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import { InventoryLocation } from "@/models/inventory-location.model";
import {
  buildStaffLocationScopeFilter,
  buildStaffProductScopeFilter,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import type { BarcodeFormat, BarcodeSource } from "@/lib/barcode/standards";
import { parsePageLimit } from "@/lib/api/list-query";
import { escapeRegExp } from "@/lib/strings";
import { attachIncomingStock } from "@/lib/inventory/transfer-incoming";

/**
 * Inventory list query.
 *
 * Shared by `GET /api/admin/inventory` and the inventory page's server
 * component so the endpoint and the rendered page always read a query string
 * the same way.
 *
 * Rows are variant-level, so the pipeline unwinds products into one row per
 * sellable unit before filtering, sorting and paging — which is why paging
 * lives inside a `$facet` here rather than a plain skip/limit.
 */

interface InventoryItem {
  productId: string;
  productName: string;
  productImage: string | null;
  variantId: string | null;
  variantName: string | null;
  sku: string;
  barcode: string;
  barcodeFormat?: BarcodeFormat;
  barcodeSource?: BarcodeSource;
  price: number;
  unavailable: number;
  committed: number;
  available: number;
  onHand: number;
  /** Shipped on a transfer to this row's stock and not yet received. */
  incoming: number;
  locationInventory: Array<{
    locationId: string;
    locationName: string;
    quantity: number;
  }>;
}

type RawLocationInventoryEntry = {
  locationId?: string | { toString: () => string };
  quantity?: number;
};

function mapLocationInventory(
  entries: RawLocationInventoryEntry[] | undefined,
  locationMap: Map<string, string>,
) {
  return (entries || []).map((loc) => {
    const locationId = String(loc.locationId || "");
    return {
      locationId,
      locationName: locationMap.get(locationId) || "Unknown",
      quantity: loc.quantity || 0,
    };
  });
}

/** Row as it leaves the aggregation: location names are resolved afterwards. */
type InventoryRow = Omit<InventoryItem, "locationInventory" | "incoming"> & {
  locationInventory?: RawLocationInventoryEntry[];
};

/**
 * `a || b || fallback` in aggregation form — an empty string keeps falling
 * through, matching the JS fallback chain the rows used to be built with.
 */
function coalesceFalsy(candidates: unknown[], fallback: unknown): unknown {
  return candidates.reduceRight<unknown>(
    (next, candidate) => ({
      $cond: [{ $eq: [{ $ifNull: [candidate, ""] }, ""] }, next, candidate],
    }),
    fallback,
  );
}

/** `Array.isArray(x) ? x : []` for a field that legacy docs may not carry. */
function asArray(path: string) {
  return { $cond: [{ $isArray: path }, path, []] };
}

// product.media?.[0]?.url || product.images?.[0] || null
const PRODUCT_IMAGE_EXPR = {
  $let: {
    // $ifNull keeps the variable a document even for an empty media array, so
    // the `.url` lookup below stays a plain missing-field read.
    vars: {
      firstMedia: {
        $ifNull: [{ $arrayElemAt: [asArray("$media"), 0] }, { $literal: {} }],
      },
    },
    in: coalesceFalsy(
      ["$$firstMedia.url", { $arrayElemAt: [asArray("$images"), 0] }],
      null,
    ),
  },
};

// variant.name || variant.optionValues.map((ov) => ov.value).join(" / ")
const VARIANT_NAME_EXPR = coalesceFalsy(
  ["$variantRow.name"],
  {
    $let: {
      vars: {
        optionValues: {
          $map: {
            input: asArray("$variantRow.optionValues"),
            as: "ov",
            in: { $ifNull: ["$$ov.value", ""] },
          },
        },
      },
      in: {
        $cond: [
          { $eq: [{ $size: "$$optionValues" }, 0] },
          "",
          // Join by concatenating with a leading separator, then dropping it —
          // $reduce has no "first element" flag.
          {
            $let: {
              vars: {
                joined: {
                  $reduce: {
                    input: "$$optionValues",
                    initialValue: "",
                    in: { $concat: ["$$value", " / ", "$$this"] },
                  },
                },
              },
              in: {
                $substrCP: ["$$joined", 3, { $strLenCP: "$$joined" }],
              },
            },
          },
        ],
      },
    },
  },
);

const SORT_FIELDS: Record<string, string> = {
  productName: "productName",
  sku: "sku",
  barcode: "barcode",
  available: "available",
  onHand: "onHand",
  committed: "committed",
  unavailable: "unavailable",
};

const STRING_SORT_FIELDS = new Set(["productName", "sku", "barcode"]);

// Closest server-side equivalent of the previous
// localeCompare(…, { sensitivity: "base", numeric: true }).
const STRING_SORT_COLLATION = {
  locale: "en",
  numericOrdering: true,
  strength: 1,
} as const;

/**
 * GET /api/admin/inventory
 * Get all product variants with inventory data for admin
 */

interface InventoryLocationOption {
  _id: string;
  name: string;
  isDefault?: boolean;
}

export interface InventoryListResult {
  items: InventoryItem[];
  locations: InventoryLocationOption[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const INVENTORY_DEFAULT_PAGE_SIZE = 50;

export async function fetchInventoryList(
  searchParams: URLSearchParams,
  staffScope?: StaffAccessScope | null,
): Promise<InventoryListResult> {
  await connectDB();

  const { page, limit } = parsePageLimit(searchParams, {
    defaultLimit: 50,
    maxLimit: 100,
  });
  const search = searchParams.get("search")?.trim() || "";
  const locationId = searchParams.get("location") || "";
  const stockLevel = searchParams.get("stockLevel") || "all";
  const barcodeStatus = searchParams.get("barcodeStatus") || "all";
  const sortBy = searchParams.get("sortBy") || "";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  await connectDB();

  // Build query
  let query: Record<string, unknown> = {};

  if (search) {
    const escapedSearch = escapeRegExp(search);
    query.$or = [
      { name: { $regex: escapedSearch, $options: "i" } },
      { sku: { $regex: escapedSearch, $options: "i" } },
      { barcode: { $regex: escapedSearch, $options: "i" } },
      { "variants.sku": { $regex: escapedSearch, $options: "i" } },
      { "variants.barcode": { $regex: escapedSearch, $options: "i" } },
      { "variants.name": { $regex: escapedSearch, $options: "i" } },
    ];
  }
  query = mergeScopeFilter(
    query,
    buildStaffProductScopeFilter(staffScope),
  );

  // Mongoose casts `find()` filters against the schema but does NOT cast
  // aggregation stages. `buildStaffProductScopeFilter` emits vendor ids as
  // strings while `Product.vendorId` is an ObjectId, so handing `query`
  // straight to `$match` would match nothing and silently show a scoped staff
  // member an empty inventory.
  const matchStage = Product.find(query).cast(Product) as Record<
    string,
    unknown
  >;

  // Get locations for reference
  const locations = await InventoryLocation.find(
    mergeScopeFilter(
      { isActive: true },
      buildStaffLocationScopeFilter(staffScope),
    ),
  )
    .sort({ isDefault: -1, name: 1 })
    .lean();

  const locationMap = new Map(
    locations.map((loc) => [String(loc._id), loc.name]),
  );

  const skip = (page - 1) * limit;

  // Row-level filters. These used to run in JS over every flattened row of the
  // whole catalogue; they are plain field matches now because the row shape is
  // materialised by the pipeline before this stage.
  const rowMatch: Record<string, unknown> = {};
  if (stockLevel === "in") rowMatch.available = { $gt: 0 };
  else if (stockLevel === "low") rowMatch.available = { $gt: 0, $lte: 10 };
  else if (stockLevel === "out") rowMatch.available = { $lte: 0 };
  if (barcodeStatus === "withBarcode") rowMatch.hasBarcode = true;
  else if (barcodeStatus === "withoutBarcode") rowMatch.hasBarcode = false;
  if (locationId) rowMatch["locationInventory.locationId"] = locationId;

  const sortField = SORT_FIELDS[sortBy];
  const sortStage: Record<string, 1 | -1> = {};
  if (sortField) sortStage[sortField] = sortOrder === "asc" ? 1 : -1;
  // Tiebreakers reproduce the order the previous stable Array.sort preserved
  // underneath the sort key (products by name, variants in document order) and
  // make paging deterministic, so no row can be dropped or repeated between
  // pages when the sort key ties.
  sortStage.sortName = 1;
  sortStage.sortProductId = 1;
  sortStage.variantIndex = 1;

  const pipeline: PipelineStage[] = [
    { $match: matchStage },
    // Trim to the row inputs before the variant fan-out.
    {
      $project: {
        name: 1,
        productName: coalesceFalsy(["$title", "$name"], ""),
        productImage: PRODUCT_IMAGE_EXPR,
        sku: 1,
        barcode: 1,
        barcodeFormat: 1,
        barcodeSource: 1,
        price: 1,
        stock: 1,
        locationInventory: 1,
        // Unwound below, so the array is never carried alongside its own rows.
        variantRow: asArray("$variants"),
      },
    },
    // A product with variants yields one row per variant; a product without
    // them yields exactly one row (preserveNullAndEmptyArrays keeps it, with
    // `variantRow` missing).
    {
      $unwind: {
        path: "$variantRow",
        includeArrayIndex: "variantIndex",
        preserveNullAndEmptyArrays: true,
      },
    },
    { $addFields: { isVariantRow: { $eq: [{ $type: "$variantRow" }, "object"] } } },
    {
      $addFields: {
        variantId: {
          $cond: ["$isVariantRow", { $toString: "$variantRow._id" }, null],
        },
        variantName: { $cond: ["$isVariantRow", VARIANT_NAME_EXPR, null] },
        sku: coalesceFalsy(["$variantRow.sku", "$sku"], ""),
        barcode: coalesceFalsy(["$variantRow.barcode", "$barcode"], ""),
        barcodeFormat: coalesceFalsy(
          ["$variantRow.barcodeFormat", "$barcodeFormat"],
          "$$REMOVE",
        ),
        barcodeSource: coalesceFalsy(
          ["$variantRow.barcodeSource", "$barcodeSource"],
          "$$REMOVE",
        ),
        price: {
          $cond: [
            "$isVariantRow",
            { $ifNull: ["$variantRow.price", { $ifNull: ["$price", 0] }] },
            { $ifNull: ["$price", 0] },
          ],
        },
        onHand: {
          $cond: [
            "$isVariantRow",
            { $ifNull: ["$variantRow.stock", 0] },
            { $ifNull: ["$stock", 0] },
          ],
        },
        committed: 0, // TODO: Calculate from pending orders
        unavailable: 0, // TODO: Calculate from damaged/reserved
        locationInventory: {
          $cond: [
            "$isVariantRow",
            asArray("$variantRow.locationInventory"),
            asArray("$locationInventory"),
          ],
        },
      },
    },
    {
      $project: {
        _id: 0,
        productId: { $toString: "$_id" },
        productName: 1,
        productImage: 1,
        variantId: 1,
        variantName: 1,
        sku: 1,
        barcode: 1,
        barcodeFormat: 1,
        barcodeSource: 1,
        price: 1,
        unavailable: 1,
        committed: 1,
        available: {
          $max: [
            0,
            {
              $subtract: [
                { $subtract: ["$onHand", "$committed"] },
                "$unavailable",
              ],
            },
          ],
        },
        onHand: 1,
        locationInventory: 1,
        // Filter/sort helpers, stripped from the returned page below.
        hasBarcode: {
          $gt: [{ $strLenCP: { $trim: { input: "$barcode" } } }, 0],
        },
        sortName: "$name",
        sortProductId: "$_id",
        variantIndex: 1,
      },
    },
    ...(Object.keys(rowMatch).length > 0
      ? [{ $match: rowMatch } as PipelineStage]
      : []),
    {
      $facet: {
        rows: [
          { $sort: sortStage },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              hasBarcode: 0,
              sortName: 0,
              sortProductId: 0,
              variantIndex: 0,
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    },
  ];

  const [facet] = await Product.aggregate<{
    rows: InventoryRow[];
    total: Array<{ count: number }>;
  }>(pipeline, {
    allowDiskUse: true,
    ...(STRING_SORT_FIELDS.has(sortField)
      ? { collation: STRING_SORT_COLLATION }
      : {}),
  });

  // Location names are only resolved for the returned page.
  const paginatedItems: InventoryItem[] = await attachIncomingStock(
    (facet?.rows ?? []).map((row) => ({
      ...row,
      locationInventory: mapLocationInventory(row.locationInventory, locationMap),
    })),
    locationId || undefined,
  );
  const total = facet?.total?.[0]?.count ?? 0;
  const totalPages = Math.ceil(total / limit);

  return {
    items: paginatedItems,
    locations: locations.map((loc) => ({
      _id: String(loc._id),
      name: loc.name,
      isDefault: loc.isDefault,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, totalPages),
  };
}
