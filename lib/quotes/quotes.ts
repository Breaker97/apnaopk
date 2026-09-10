import { connectDB } from "@/lib/db";
import { QuoteRequest } from "@/models";
import {
  listResult,
  parseListQuery,
  runListQuery,
  serializeRows,
  type ListResult,
} from "@/lib/api/list-query";
import {
  hasStaffScope,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import {
  isQuoteRequestStatus,
  type QuoteRequestStatus,
} from "@/lib/quotes/quote-status";

/**
 * Reading side of the quote inbox, shared by `/api/admin/quotes` and the
 * admin Quotes page's server component so the endpoint and the rendered
 * first page can never answer the same query differently.
 */

export type QuoteRequestRow = {
  _id: string;
  productId: string;
  productName: string;
  productSlug?: string;
  variantName?: string;
  quantity: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message?: string;
  status: QuoteRequestStatus;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Staff see only the vendors they are scoped to. A quote carries the product's
 * vendor, so the same scope that hides a product from a staff member hides the
 * requests about it — an unscoped staff member (no vendorIds) sees everything,
 * exactly as they do on the product list.
 */
function buildQuoteScopeFilter(scope?: StaffAccessScope | null) {
  if (!hasStaffScope(scope) || scope!.vendorIds.length === 0) return {};
  return { vendorId: { $in: scope!.vendorIds } };
}

export async function fetchQuoteRequestList(
  searchParams: URLSearchParams,
  context: { staffScope?: StaffAccessScope | null } = {},
): Promise<ListResult<QuoteRequestRow>> {
  await connectDB();

  const query = parseListQuery(searchParams, {
    allowedSortFields: ["createdAt", "status", "quantity", "name"],
    defaultSort: { createdAt: -1 },
    tieBreaker: { _id: -1 },
  });

  const filter: Record<string, unknown> = {};

  const status = searchParams.get("status");
  if (status && isQuoteRequestStatus(status)) filter.status = status;

  if (query.search) {
    // `search` is already regex-escaped by parseListQuery.
    const term = new RegExp(query.search, "i");
    filter.$or = [
      { name: term },
      { email: term },
      { company: term },
      { productName: term },
    ];
  }

  const scoped = mergeScopeFilter(filter, buildQuoteScopeFilter(context.staffScope));

  const { items, total } = await runListQuery(QuoteRequest, scoped, query);

  return listResult(
    serializeRows<QuoteRequestRow[]>(items),
    query.usePagination ? query.page : 1,
    query.usePagination ? query.limit : total || 1,
    total,
  );
}

/** Unanswered requests, for the sidebar/page badge. */
export async function countNewQuoteRequests(
  scope?: StaffAccessScope | null,
): Promise<number> {
  await connectDB();
  return QuoteRequest.countDocuments(
    mergeScopeFilter({ status: "new" }, buildQuoteScopeFilter(scope)),
  );
}
