import { vendorPayoutDto } from "@/lib/finance/payout-dto";
import type { Types } from "mongoose";
import { Payout, Vendor } from "@/models";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  resolveListSort,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Vendor payout list query.
 *
 * Shared by `GET /api/admin/payouts`, `GET /api/vendor/payouts` and the
 * payouts pages' server components so every caller reads a query string the
 * same way. The two views differ only in scope: pass `vendorId` to restrict
 * the list to one seller's payouts.
 */

export const PAYOUTS_DEFAULT_PAGE_SIZE = 20;

const SORT_FIELDS = [
  "createdAt",
  "payoutNumber",
  "status",
  "netAmount",
  "periodStart",
  "periodEnd",
];

interface PayoutListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  vendorId?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface PayoutListContext {
  /** Present for the vendor dashboard; absent lists every vendor's payouts. */
  vendorId?: Types.ObjectId | string;
}

async function buildPayoutListFilter(
  { search, status, vendorId: vendorFilter }: PayoutListParams,
  { vendorId }: PayoutListContext = {},
): Promise<Record<string, unknown>> {
  const query: Record<string, unknown> = {};

  // The vendor dashboard is hard-scoped; the admin list may filter by vendor.
  if (vendorId) query.vendorId = vendorId;
  else if (vendorFilter && vendorFilter !== "all") query.vendorId = vendorFilter;

  const normalizedStatus = (status || "all").trim().toLowerCase();
  if (normalizedStatus !== "all") query.status = normalizedStatus;

  if (search) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escaped) {
      const byNumber = { payoutNumber: { $regex: escaped, $options: "i" } };
      // The admin list also finds a seller by name: its vendor filter lists
      // only the newest sellers, so an older one was reachable no other way.
      const sellers = vendorId
        ? []
        : await Vendor.find({ storeName: { $regex: escaped, $options: "i" } })
            .select("_id")
            .limit(50)
            .lean<Array<{ _id: Types.ObjectId }>>();
      if (sellers.length > 0) {
        query.$or = [byNumber, { vendorId: { $in: sellers.map((seller) => seller._id) } }];
      } else {
        Object.assign(query, byNumber);
      }
    }
  }

  return query;
}

export async function fetchPayoutList(
  params: PayoutListParams,
  context: PayoutListContext = {},
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, sortBy, sortOrder } = params;
  const query = await buildPayoutListFilter(params, context);
  const sort = resolveListSort({
    sortBy,
    sortOrder,
    allowed: SORT_FIELDS,
    // `payoutNumber` is unique per payout; the rest (status, amounts, period
    // bounds) tie constantly and need the `_id` tiebreaker to page cleanly.
    unique: ["payoutNumber"],
  });

  const [rows, total] = await Promise.all([
    Payout.find(query)
      .populate("vendorId", "storeName slug")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(Payout, query),
  ]);

  return listResult(context.vendorId ? rows.map((row) => vendorPayoutDto(row)) : rows as unknown[], page, limit, total);
}
