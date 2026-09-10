import { Brand } from "@/models";
import { connectDB } from "@/lib/db";
import { BRAND_APPROVAL_STATUS, STOREFRONT_BRAND_FILTER } from "@/lib/catalog/brands";
import {
  listResult,
  parseListQuery,
  runListQuery,
  type ListQuery,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Brand list query.
 *
 * Shared by `GET /api/brands` and the admin brands page's server component so
 * the endpoint and the rendered page always read a query string the same way.
 */

const BRAND_LIST_SORT = {
  allowedSortFields: [
    "name",
    "productCount",
    "createdAt",
    "updatedAt",
    "order",
  ],
  defaultSort: { order: 1 as const, name: 1 as const },
  tieBreaker: { name: 1 as const },
};

interface BrandListContext {
  /** Admins see unapproved and archived brands; nobody else does. */
  isAdmin: boolean;
  /** Brand pickers want only brands a product may actually be assigned to. */
  assignable?: boolean;
}

function buildBrandListFilter(
  searchParams: URLSearchParams,
  listQuery: ListQuery,
  { isAdmin, assignable }: BrandListContext,
): Record<string, unknown> {
  const status = searchParams.get("status");
  const featured = searchParams.get("featured");
  const query: Record<string, unknown> = {};

  if (assignable || !isAdmin) {
    // Public / assignment view: only approved, live, non-archived brands.
    Object.assign(query, STOREFRONT_BRAND_FILTER);
  } else {
    // Admin moderation view.
    if (status === "archived") {
      query.deletedAt = { $ne: null };
    } else {
      query.deletedAt = null;
      if (status === "active") query.isActive = true;
      else if (status === "inactive") query.isActive = false;
      else if (status === "featured") query.featured = true;
      else if (status === "pending")
        query.approvalStatus = BRAND_APPROVAL_STATUS.PENDING;
      else if (status === "rejected")
        query.approvalStatus = BRAND_APPROVAL_STATUS.REJECTED;
    }
  }

  if (featured === "true") query.featured = true;
  else if (featured === "false") query.featured = { $ne: true };

  if (listQuery.search) {
    const pattern = { $regex: listQuery.search, $options: "i" };
    query.$or = [{ name: pattern }, { slug: pattern }];
  }

  return query;
}

/**
 * The table's Products column is `id: "products"`, but the sortable field is
 * `productCount`. Aliasing here rather than in the client keeps the URL
 * readable and means the API route and the page resolve it the same way — the
 * client-side `mapQuery` that used to do this only covered the former.
 */
const SORT_ALIASES: Record<string, string> = { products: "productCount" };

function withAliasedSort(searchParams: URLSearchParams): URLSearchParams {
  const sortBy = searchParams.get("sortBy");
  const aliased = sortBy ? SORT_ALIASES[sortBy] : undefined;
  if (!aliased) return searchParams;

  const next = new URLSearchParams(searchParams);
  next.set("sortBy", aliased);
  return next;
}

export async function fetchBrandList(
  searchParams: URLSearchParams,
  context: BrandListContext,
): Promise<ListResult<unknown>> {
  await connectDB();

  const listQuery = parseListQuery(withAliasedSort(searchParams), BRAND_LIST_SORT);
  const filter = buildBrandListFilter(searchParams, listQuery, context);
  const { items, total } = await runListQuery(Brand, filter, listQuery);

  return listResult(
    items,
    listQuery.page || 1,
    listQuery.limit || items.length || 1,
    total,
  );
}

interface BrandStats {
  totalBrands: number;
  activeBrands: number;
  inactiveBrands: number;
  featuredBrands: number;
  pendingBrands: number;
}

/**
 * Counters for the brands stats strip. One pass with conditional accumulators
 * rather than a five-branch `$facet`, whose sub-pipelines cannot use an index
 * and so scanned the collection once per branch.
 */
export async function fetchBrandStats(): Promise<BrandStats> {
  await connectDB();

  const [result] = await Brand.aggregate([
    { $match: { deletedAt: null } },
    {
      $group: {
        _id: null,
        totalBrands: { $sum: 1 },
        activeBrands: { $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } },
        inactiveBrands: {
          $sum: { $cond: [{ $eq: ["$isActive", false] }, 1, 0] },
        },
        featuredBrands: {
          $sum: { $cond: [{ $eq: ["$featured", true] }, 1, 0] },
        },
        pendingBrands: {
          $sum: {
            $cond: [
              { $eq: ["$approvalStatus", BRAND_APPROVAL_STATUS.PENDING] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return {
    totalBrands: result?.totalBrands ?? 0,
    activeBrands: result?.activeBrands ?? 0,
    inactiveBrands: result?.inactiveBrands ?? 0,
    featuredBrands: result?.featuredBrands ?? 0,
    pendingBrands: result?.pendingBrands ?? 0,
  };
}
