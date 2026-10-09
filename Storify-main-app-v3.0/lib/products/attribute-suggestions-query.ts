import "server-only";

import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Product } from "@/models";
import {
  mergeAttributeSuggestions,
  type AttributeCountRow,
  type AttributeSuggestion,
} from "@/lib/products/attribute-suggestions";

/** Enough raw pairs for any real catalogue; bounds the worst case. */
const MAX_PAIRS = 5000;

/**
 * The specification labels and values already in use — the whole catalogue
 * for the store's own staff, only the vendor's products for a vendor. A
 * vendor's suggestions must not show another seller's specifications.
 */
export async function listProductAttributeSuggestions(options: {
  vendorId?: Types.ObjectId | string;
}): Promise<AttributeSuggestion[]> {
  await connectDB();
  const rows = await Product.aggregate<AttributeCountRow>([
    {
      $match: {
        ...(options.vendorId ? { vendorId: options.vendorId } : {}),
        "attributes.0": { $exists: true },
      },
    },
    { $unwind: "$attributes" },
    {
      $group: {
        _id: {
          name: { $trim: { input: { $ifNull: ["$attributes.name", ""] } } },
          value: { $trim: { input: { $ifNull: ["$attributes.value", ""] } } },
        },
        count: { $sum: 1 },
      },
    },
    { $match: { "_id.name": { $ne: "" } } },
    { $sort: { count: -1 } },
    { $limit: MAX_PAIRS },
    { $project: { _id: 0, name: "$_id.name", value: "$_id.value", count: 1 } },
  ]);
  return mergeAttributeSuggestions(rows);
}
