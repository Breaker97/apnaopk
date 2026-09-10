import type { Types } from "mongoose";
import { Product } from "@/models";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  resolveListSort,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Vendor product list query.
 *
 * Shared by `GET /api/vendor/products` and the vendor products page's server
 * component so the endpoint and the rendered page always agree on what a
 * given query string means.
 *
 * Separate from `lib/product-list.ts`: the admin list spans every vendor,
 * carries the vendor/source filters and builds the vendor filter options,
 * none of which apply to a seller looking at its own catalogue.
 */

const SORT_FIELDS = [
  "createdAt",
  "updatedAt",
  "name",
  "price",
  "stock",
  "status",
];

/**
 * List views render neither long-form copy nor SEO metadata, and products
 * carry a lot of both.
 *
 * NOTE: this narrows what `GET /api/vendor/products` returns — the admin
 * equivalent has always excluded these, the vendor one did not. The endpoint's
 * only caller is the vendor products table, which reads none of them, but any
 * new client (a mobile app) should fetch a single product for the full record.
 */
const LIST_EXCLUDE = "-description -shortDescription -seo -attributes";

interface VendorProductListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function fetchVendorProductList(
  params: VendorProductListParams,
  vendorId: Types.ObjectId | string,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, search, status, sortBy, sortOrder } = params;
  const query: Record<string, unknown> = { vendorId };

  // `search` arrives regex-escaped from SafeSearchSchema.
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { sku: { $regex: search, $options: "i" } },
    ];
  }
  if (status && status !== "all") query.status = status;

  const sort = resolveListSort({
    sortBy,
    sortOrder,
    allowed: SORT_FIELDS,
    // Price, stock, status and name all repeat across a catalogue, so they
    // need the `_id` tiebreaker to page deterministically.
    unique: ["createdAt", "updatedAt"],
  });

  const [products, total] = await Promise.all([
    Product.find(query)
      .select(LIST_EXCLUDE)
      .populate("category", "name slug")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(Product, query),
  ]);

  return listResult(products as unknown[], page, limit, total);
}
