import type { PipelineStage } from "mongoose";
import { connectDB, mongoose } from "@/lib/db";
import { InventoryLocation, Product } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import {
  locationOwnerFilter,
  resolveLocationScope,
} from "@/lib/inventory/inventory-location-scope";
import { escapeRegExp } from "@/lib/strings";

export interface TransferCatalogLine {
  productId: string;
  /** Empty for a product without variants, whose stock sits on the product. */
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  availableAtSource: number;
  /** On hand at the destination, when the lookup names one. */
  availableAtDestination?: number;
}

export const TRANSFER_CATALOG_PAGE_SIZE = 50;

/** `Array.isArray(x) ? x : []` for a field legacy docs may not carry. */
function asArray(path: string) {
  return { $cond: [{ $isArray: path }, path, []] };
}

/**
 * Every sellable unit with stock at one location, a page at a time.
 *
 * Stock at the location is filtered inside the database before paging. The
 * previous lookup took the 300 most recently edited products and filtered those
 * in memory, so in a larger catalogue a product with plenty of stock simply
 * never appeared; and it skipped products without variants altogether.
 */
export async function fetchTransferCatalog(
  user: Parameters<typeof resolveLocationScope>[0],
  searchParams: URLSearchParams,
): Promise<{
  items: TransferCatalogLine[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}> {
  const fromLocationId = (searchParams.get("fromLocationId") || "").trim();
  const toLocationId = (searchParams.get("toLocationId") || "").trim();
  const search = (searchParams.get("search") || "").trim();
  const page = Math.max(1, Math.trunc(Number(searchParams.get("page")) || 1));
  const limit = Math.min(
    100,
    Math.max(
      1,
      Math.trunc(Number(searchParams.get("limit")) || TRANSFER_CATALOG_PAGE_SIZE),
    ),
  );

  if (!fromLocationId) {
    throw new ValidationError("fromLocationId is required");
  }

  await connectDB();

  // Only the caller's own catalogue, and only from a location they own. This
  // answers "what can I move out of here", so an unscoped answer would
  // enumerate another merchant's stock levels.
  const scope = await resolveLocationScope(user, "read");
  const sourceLocation = await InventoryLocation.exists(
    locationOwnerFilter(scope, { _id: fromLocationId }),
  );
  if (!sourceLocation) {
    throw new ValidationError("Source location is invalid");
  }

  const heldHere = {
    $elemMatch: { locationId: fromLocationId, quantity: { $gt: 0 } },
  };
  const match: Record<string, unknown> = {
    vendorId: {
      $in: scope.readVendorIds
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
    $or: [
      { variants: { $elemMatch: { locationInventory: heldHere } } },
      { locationInventory: heldHere },
    ],
  };
  if (search) {
    const pattern = { $regex: escapeRegExp(search), $options: "i" };
    match.$and = [
      {
        $or: [
          { title: pattern },
          { name: pattern },
          { sku: pattern },
          { "variants.name": pattern },
          { "variants.sku": pattern },
        ],
      },
    ];
  }

  const quantityAt = (locationId: string, rows: unknown) => ({
    $sum: {
      $map: {
        input: {
          $filter: {
            input: rows,
            as: "row",
            cond: { $eq: [{ $toString: "$$row.locationId" }, locationId] },
          },
        },
        as: "row",
        in: { $ifNull: ["$$row.quantity", 0] },
      },
    },
  });

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $project: {
        productTitle: { $ifNull: ["$title", { $ifNull: ["$name", "Untitled"] }] },
        sku: 1,
        locationInventory: asArray("$locationInventory"),
        variantRow: asArray("$variants"),
      },
    },
    {
      $unwind: {
        path: "$variantRow",
        includeArrayIndex: "variantIndex",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        isVariantRow: { $eq: [{ $type: "$variantRow" }, "object"] },
      },
    },
    {
      $project: {
        _id: 0,
        productId: { $toString: "$_id" },
        variantId: {
          $cond: ["$isVariantRow", { $toString: "$variantRow._id" }, ""],
        },
        productTitle: 1,
        variantTitle: {
          $cond: [
            "$isVariantRow",
            { $ifNull: ["$variantRow.name", "Default"] },
            "",
          ],
        },
        sku: {
          $cond: [
            "$isVariantRow",
            { $ifNull: ["$variantRow.sku", ""] },
            { $ifNull: ["$sku", ""] },
          ],
        },
        availableAtSource: {
          $cond: [
            "$isVariantRow",
            quantityAt(fromLocationId, asArray("$variantRow.locationInventory")),
            quantityAt(fromLocationId, "$locationInventory"),
          ],
        },
        // Only the caller's own products are in the pipeline, so this reads
        // their stock at the destination and nothing of anyone else's.
        ...(toLocationId
          ? {
              availableAtDestination: {
                $cond: [
                  "$isVariantRow",
                  quantityAt(toLocationId, asArray("$variantRow.locationInventory")),
                  quantityAt(toLocationId, "$locationInventory"),
                ],
              },
            }
          : {}),
        variantIndex: 1,
      },
    },
    { $match: { availableAtSource: { $gt: 0 } } },
    {
      $facet: {
        rows: [
          { $sort: { productTitle: 1, productId: 1, variantIndex: 1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
          { $project: { variantIndex: 0 } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ];

  const [facet] = await Product.aggregate<{
    rows: TransferCatalogLine[];
    total: Array<{ count: number }>;
  }>(pipeline, { allowDiskUse: true });

  const total = facet?.total?.[0]?.count ?? 0;
  return {
    items: facet?.rows ?? [],
    page,
    limit,
    total,
    hasMore: page * limit < total,
  };
}
