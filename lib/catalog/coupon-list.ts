import type { Types } from "mongoose";
import { Coupon } from "@/models";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Coupon (discount) list query.
 *
 * Shared by `GET /api/admin/coupons`, `GET /api/vendor/coupons` and the
 * discounts pages' server components so every caller reads a query string the
 * same way. The admin and vendor views differ only in scope: pass `vendorId`
 * to restrict the list to one seller's discounts.
 */

interface CouponListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
}

interface CouponListContext {
  /** Present for the vendor dashboard; absent lists every discount. */
  vendorId?: Types.ObjectId | string;
}

function buildCouponListFilter(
  { search, status }: Pick<CouponListParams, "search" | "status">,
  { vendorId }: CouponListContext = {},
): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (vendorId) query.vendorId = vendorId;
  if (status && status !== "all") query.status = status;

  // `search` arrives regex-escaped from SafeSearchSchema.
  if (search) {
    query.$or = [
      { code: { $regex: search, $options: "i" } },
      { label: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  return query;
}

export async function fetchCouponList(
  params: CouponListParams,
  context: CouponListContext = {},
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit } = params;
  const query = buildCouponListFilter(params, context);

  const [coupons, total] = await Promise.all([
    Coupon.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(Coupon, query),
  ]);

  return listResult(coupons as unknown[], page, limit, total);
}
