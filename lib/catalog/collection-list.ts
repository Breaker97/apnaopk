import { Collection } from "@/models";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Admin collection list query.
 *
 * Shared by `GET /api/admin/collections` and the collections page's server
 * component so the endpoint and the rendered page always agree on what a
 * given query string means.
 */

interface AdminCollectionListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  type?: string;
  kind?: string;
  channel?: string;
  sortOrder?: "asc" | "desc";
}

function buildCollectionListFilter({
  search,
  status,
  type,
  kind,
  channel,
}: Pick<
  AdminCollectionListParams,
  "search" | "status" | "type" | "kind" | "channel"
>): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  // `search` arrives regex-escaped from SafeSearchSchema.
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }
  if (status && status !== "all") query.status = status;
  if (type && type !== "all") query.collectionType = type;
  if (kind && kind !== "all") query.kind = kind;
  if (channel && channel !== "all") query[`publishing.${channel}`] = true;

  return query;
}

export async function fetchAdminCollectionList(
  params: AdminCollectionListParams,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, sortOrder } = params;
  const query = buildCollectionListFilter(params);

  const [collections, total] = await Promise.all([
    Collection.find(query)
      // `position` is the admin's manual ordering and is not unique, so
      // createdAt breaks ties; without it a row can straddle two pages.
      .sort({ position: 1, createdAt: sortOrder === "asc" ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(Collection, query),
  ]);

  return listResult(collections as unknown[], page, limit, total);
}

interface AdminCollectionStats {
  totalCollections: number;
  activeCollections: number;
  manualCollections: number;
  onlineCollections: number;
  totalProductsInCollections: number;
}

/**
 * Counters for the collections stats strip. One pass with conditional
 * accumulators rather than a five-branch `$facet`, whose sub-pipelines cannot
 * use an index and so scanned the collection once per branch.
 */
export async function fetchAdminCollectionStats(): Promise<AdminCollectionStats> {
  await connectDB();

  const [result] = await Collection.aggregate([
    {
      $group: {
        _id: null,
        totalCollections: { $sum: 1 },
        activeCollections: {
          $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] },
        },
        manualCollections: {
          $sum: { $cond: [{ $eq: ["$collectionType", "manual"] }, 1, 0] },
        },
        onlineCollections: {
          $sum: { $cond: [{ $eq: ["$publishing.onlineStore", true] }, 1, 0] },
        },
        totalProductsInCollections: {
          $sum: { $ifNull: ["$productCount", 0] },
        },
      },
    },
  ]);

  return {
    totalCollections: result?.totalCollections ?? 0,
    activeCollections: result?.activeCollections ?? 0,
    manualCollections: result?.manualCollections ?? 0,
    onlineCollections: result?.onlineCollections ?? 0,
    totalProductsInCollections: result?.totalProductsInCollections ?? 0,
  };
}
