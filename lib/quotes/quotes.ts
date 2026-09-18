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
  type QuoteOfferState,
  type QuoteRequestStatus,
} from "@/lib/quotes/quote-status";
import { resolveOfferStates } from "@/lib/quotes/quote-offer";

/**
 * Reading side of the quote inbox behind `/api/admin/quotes`. The admin page
 * is a client table that fetches through that route, so filtering, scoping and
 * pagination all live here rather than being restated at the boundary.
 */

/** The price the merchant sent back, as the admin table reads it. */
export type QuoteOfferRow = {
  unitPrice: number;
  quantity: number;
  note?: string;
  expiresAt?: string;
  offeredAt: string;
  withdrawnAt?: string;
};

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
  offer?: QuoteOfferRow;
  /**
   * Whether that offer is still open, and if not why — derived from its expiry
   * and the order it was spent on, never stored. See lib/quotes/quote-offer.ts.
   */
  offerState: QuoteOfferState;
  /** The order the offer was spent on, when one was placed. */
  orderId?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Staff see only the vendors they are scoped to. A quote carries the product's
 * vendor, so the same scope that hides a product from a staff member hides the
 * requests about it — an unscoped staff member (no vendorIds) sees everything,
 * exactly as they do on the product list.
 */
export function buildQuoteScopeFilter(scope?: StaffAccessScope | null) {
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

  // One batched read of the bound orders decides every row's offer state; the
  // alternative is a per-row lookup on a page of fifty.
  const offerStates = await resolveOfferStates(
    items as unknown as Parameters<typeof resolveOfferStates>[0],
  );
  const rows = serializeRows<QuoteRequestRow[]>(items).map((row) => ({
    ...row,
    offerState: offerStates.get(row._id) ?? "none",
  }));

  return listResult(
    rows,
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


/**
 * The shopper's own quotes, for /account/quotes.
 *
 * Same rows the merchant works from, minus the parts that are none of the
 * shopper's business: the internal note is never selected, so it cannot leak
 * through a serializer that spreads whatever it was handed. Capped rather than
 * paginated — a shopper with more than fifty open quotes is not a page-two
 * problem, and the list is a follow-up tool, not a report.
 */
export async function fetchCustomerQuotes(
  userId: string,
  limit = 50,
): Promise<QuoteRequestRow[]> {
  await connectDB();

  const items = await QuoteRequest.find({ userId })
    .select(
      "productId productName productSlug variantName quantity name email phone company message status offer orderId createdAt updatedAt",
    )
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const offerStates = await resolveOfferStates(
    items as unknown as Parameters<typeof resolveOfferStates>[0],
  );

  return serializeRows<QuoteRequestRow[]>(items).map((row) => ({
    ...row,
    offerState: offerStates.get(row._id) ?? "none",
  }));
}
