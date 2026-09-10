import { NextResponse } from "next/server";
import type { QueryFilter, Model, SortOrder } from "mongoose";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { sanitizeSearchString } from "@/lib/api/validate";

/**
 * Shared parsing + execution for list endpoints that follow the app's
 * standard query contract: `page`/`limit` (both > 0 to opt into
 * pagination), `search`, `sortBy`/`sortOrder`, plus route-specific
 * filters the caller builds itself.
 */

/**
 * A page of rows plus its pagination, in the shape both the API route's
 * envelope and a page's server component hand to a DataTable. Resource-level
 * `fetch<X>List` helpers return this so the endpoint and the rendered page
 * cannot drift into different answers for the same query string.
 */
export interface ListResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function listResult<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): ListResult<T> {
  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Row count for a list query.
 *
 * An unfiltered `countDocuments` walks the whole `_id` index to produce a
 * number the pagination bar prints; `estimatedDocumentCount` reads it from
 * collection metadata instead. Only correct when the query really is empty,
 * so that is exactly when it is used.
 */
export function countForQuery(
  model: {
    countDocuments: (query: object) => Promise<number>;
    estimatedDocumentCount: () => Promise<number>;
  },
  query: Record<string, unknown>,
): Promise<number> {
  return Object.keys(query).length === 0
    ? model.estimatedDocumentCount()
    : model.countDocuments(query);
}

/**
 * Sort with a deterministic tiebreaker.
 *
 * `unique` lists fields that already order rows unambiguously (an `_id`-like
 * key, a millisecond timestamp, a uniquely-indexed code). Everything else gets
 * `_id` appended: a tied sort combined with skip/limit is how a row shows up
 * on two pages, or on none. Unique fields are left alone because they are also
 * the ones with index support, where a tiebreaker would turn an
 * index-provided ordering into a blocking sort.
 */
export function resolveListSort({
  sortBy,
  sortOrder,
  allowed,
  fallback = "createdAt",
  unique = ["createdAt"],
}: {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  allowed: Iterable<string>;
  fallback?: string;
  unique?: Iterable<string>;
}): Record<string, 1 | -1> {
  const allowedFields = new Set(allowed);
  const uniqueFields = new Set(unique);
  const field = sortBy && allowedFields.has(sortBy) ? sortBy : fallback;
  const direction: 1 | -1 = sortOrder === "asc" ? 1 : -1;

  return uniqueFields.has(field)
    ? { [field]: direction }
    : { [field]: direction, _id: direction };
}

/** Strip Mongo types (ObjectId, Date) so rows can cross the RSC boundary. */
export function serializeRows<T>(rows: unknown): T {
  return JSON.parse(JSON.stringify(rows)) as T;
}

interface ListQueryConfig {
  /** Sort fields the client may request; others fall back to defaultSort. */
  allowedSortFields?: readonly string[];
  /** Sort applied when the client doesn't request a valid one. */
  defaultSort?: Record<string, SortOrder>;
  /**
   * Secondary key(s) appended after a client-chosen sort for stable
   * ordering (skipped when it duplicates the primary key).
   */
  tieBreaker?: Record<string, SortOrder>;
  /** Upper bound for `limit`; protects against limit=100000 requests. */
  maxLimit?: number;
}

export interface ListQuery {
  page: number;
  limit: number;
  skip: number;
  /** Trimmed, regex-escaped search term, or null. */
  search: string | null;
  sort: Record<string, SortOrder>;
  /** True when the client sent page > 0 and limit > 0. */
  usePagination: boolean;
}

/**
 * Accepts the raw params rather than the request, so a page's server component
 * can read a query string exactly the way its API route does. Route handlers
 * pass `request.nextUrl.searchParams`.
 */
export function parseListQuery(
  searchParams: URLSearchParams,
  config: ListQueryConfig = {},
): ListQuery {
  const {
    allowedSortFields,
    defaultSort = { createdAt: -1 },
    tieBreaker,
    maxLimit = 100,
  } = config;

  const page = parseInt(searchParams.get("page") || "0", 10);
  const rawLimit = parseInt(searchParams.get("limit") || "0", 10);
  const limit = Math.min(rawLimit > 0 ? rawLimit : 0, maxLimit);
  const usePagination = page > 0 && limit > 0;

  const rawSearch = searchParams.get("search")?.trim();
  const search = rawSearch ? sanitizeSearchString(rawSearch) : null;

  const sortBy = searchParams.get("sortBy");
  const sortDirection: SortOrder =
    searchParams.get("sortOrder") === "asc" ? 1 : -1;

  let sort = defaultSort;
  if (sortBy && allowedSortFields?.includes(sortBy)) {
    sort = { [sortBy]: sortDirection };
    if (tieBreaker) {
      for (const [field, direction] of Object.entries(tieBreaker)) {
        if (field !== sortBy) sort[field] = direction;
      }
    }
  }

  return {
    page,
    limit,
    skip: usePagination ? (page - 1) * limit : 0,
    search,
    sort,
    usePagination,
  };
}

/**
 * Clamped `page`/`limit`/`skip` for endpoints where pagination is
 * mandatory (public or per-user lists). Unlike `parseListQuery`, there
 * is no fetch-all opt-out: malformed or out-of-range values (including
 * `limit=0`, which Mongoose treats as "no limit") fall back to safe
 * bounds so a single request can never pull an unbounded result set.
 */
export function parsePageLimit(
  searchParams: URLSearchParams,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; skip: number } {
  const { defaultLimit = 20, maxLimit = 100 } = options;
  const rawPage = parseInt(searchParams.get("page") || "1", 10);
  const rawLimit = parseInt(
    searchParams.get("limit") || String(defaultLimit),
    10,
  );
  const page = Math.max(1, Number.isNaN(rawPage) ? 1 : rawPage);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.isNaN(rawLimit) ? defaultLimit : rawLimit),
  );
  return { page, limit, skip: (page - 1) * limit };
}

interface RunListQueryOptions {
  populate?: string | string[];
  select?: string;
}

/**
 * Execute a list query: paginated (find + count in parallel) when the
 * client opted in, otherwise the full result set.
 */
export async function runListQuery<T>(
  model: Model<T>,
  filter: QueryFilter<T>,
  query: ListQuery,
  options: RunListQueryOptions = {},
): Promise<{ items: unknown[]; total: number }> {
  let find = model.find(filter).sort(query.sort);
  if (options.select) find = find.select(options.select);
  if (options.populate) {
    for (const path of Array.isArray(options.populate)
      ? options.populate
      : [options.populate]) {
      find = find.populate(path);
    }
  }

  if (!query.usePagination) {
    const items = await find.lean();
    return { items, total: items.length };
  }

  const [items, total] = await Promise.all([
    find.skip(query.skip).limit(query.limit).lean(),
    model.countDocuments(filter),
  ]);
  return { items, total };
}

/**
 * Wrap a `runListQuery` result in the standard response envelope:
 * paginated when the client asked for pages, plain list otherwise.
 */
export function listResponse(
  result: { items: unknown[]; total: number },
  query: ListQuery,
): NextResponse {
  if (query.usePagination) {
    return paginatedResponse(result.items, query.page, query.limit, result.total);
  }
  return successResponse(result.items);
}
