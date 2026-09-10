import { Order } from "@/models";
import { connectDB } from "@/lib/db";
import type { StaffAccessScope } from "@/lib/access/staff-scope";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";

/**
 * Admin order list query.
 *
 * Shared by `GET /api/admin/orders` (the table's paging/filtering calls) and
 * the orders page server component, which runs the same query for page 1 and
 * hands the result to the table as `initialData` — so landing on the route
 * costs zero client round-trips.
 *
 * Keeping both callers on one builder is what makes that safe: the server
 * prefetch and the first client refetch have to produce the same rows for the
 * same params, or the table would flicker between two different result sets.
 */

interface AdminOrderListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  paymentStatus?: string;
  channel?: string;
  view?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface AdminOrderListResult<T = AdminOrderListItem> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface AdminOrderListItem {
  _id: string;
  orderNumber: string;
  customerId?: { _id?: string; name?: string; email?: string } | null;
  total: number;
  status: string;
  paymentStatus: string;
  channel?: string;
  createdAt: string;
  items: { name: string; quantity: number; productId?: string | null }[];
}

/**
 * Only the fields the orders table actually renders (plus its CSV export).
 * Orders carry shipping/billing addresses, sub-orders, payment gateway ids and
 * full line items; shipping all of that for a 10-row page is most of the
 * response weight and none of the value.
 */
const LIST_PROJECTION =
  "orderNumber total status paymentStatus channel createdAt customerId items.name items.quantity items.productId";

const ALLOWED_SORT_FIELDS = new Set([
  "createdAt",
  "total",
  "orderNumber",
  "status",
  "paymentStatus",
]);

/**
 * Sort fields that need no `_id` tiebreaker.
 *
 * `createdAt` is a millisecond timestamp and `orderNumber` carries a unique
 * index, so ties are effectively impossible — and these two are the fields
 * with index support, where appending `_id` would only turn an index-provided
 * ordering into a blocking sort. The rest (total, status, paymentStatus) tie
 * constantly, and a tied sort combined with skip/limit is how a row shows up
 * on two pages, or on none.
 */
const UNIQUE_SORT_FIELDS = new Set(["createdAt", "orderNumber"]);

function buildAdminOrderListFilter(
  params: Pick<
    AdminOrderListParams,
    "search" | "status" | "paymentStatus" | "channel" | "view"
  >,
  staffScope?: StaffAccessScope | null,
): Record<string, unknown> {
  const { search, status, paymentStatus, channel, view } = params;
  const andConditions: Record<string, unknown>[] = [];

  if (view && view !== "all") {
    if (view === "unfulfilled") {
      andConditions.push({ status: { $in: ["pending", "processing"] } });
    } else if (view === "unpaid") {
      andConditions.push({
        paymentStatus: { $in: ["pending", "partially_paid"] },
      });
    } else if (view === "open") {
      andConditions.push({ status: { $nin: ["delivered", "cancelled"] } });
    } else if (view === "archived") {
      andConditions.push({ status: { $in: ["delivered", "cancelled"] } });
    }
  }

  if (status && status !== "all") andConditions.push({ status });
  if (paymentStatus && paymentStatus !== "all") {
    andConditions.push({ paymentStatus });
  }
  if (channel && channel !== "all") andConditions.push({ channel });

  // `search` reaches here already escaped by SafeSearchSchema, so the value is
  // a literal — no regex injection, no user-supplied backtracking.
  if (search) {
    andConditions.push({
      $or: [{ orderNumber: { $regex: search, $options: "i" } }],
    });
  }

  const baseQuery: Record<string, unknown> =
    andConditions.length > 0 ? { $and: andConditions } : {};

  return mergeScopeFilter(baseQuery, buildStaffOrderScopeFilter(staffScope));
}

function resolveAdminOrderListSort(
  sortBy?: string,
  sortOrder?: "asc" | "desc",
): Record<string, 1 | -1> {
  const field = sortBy && ALLOWED_SORT_FIELDS.has(sortBy) ? sortBy : "createdAt";
  const direction: 1 | -1 = sortOrder === "asc" ? 1 : -1;

  if (UNIQUE_SORT_FIELDS.has(field)) return { [field]: direction };
  return { [field]: direction, _id: direction };
}

interface AdminOrderStats {
  totalOrders: number;
  openOrders: number;
  paidOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
}

/**
 * Counters for the orders stats strip, scoped the same way the list is.
 *
 * One pass with conditional accumulators. The `$facet` shape this replaced ran
 * four sub-pipelines, and `$facet` sub-pipelines cannot use an index, so it was
 * four full collection scans to produce five numbers.
 */
export async function fetchAdminOrderStats(
  staffScope?: StaffAccessScope | null,
): Promise<AdminOrderStats> {
  await connectDB();

  const scopeFilter = buildStaffOrderScopeFilter(staffScope);
  const [result] = await Order.aggregate([
    ...(Object.keys(scopeFilter).length > 0 ? [{ $match: scopeFilter }] : []),
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        openOrders: {
          $sum: {
            $cond: [{ $in: ["$status", ["delivered", "cancelled"]] }, 0, 1],
          },
        },
        paidOrders: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] },
        },
        totalRevenue: {
          $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$total", 0] },
        },
      },
    },
  ]);

  const totalOrders = result?.totalOrders ?? 0;
  const openOrders = result?.openOrders ?? 0;
  const paidOrders = result?.paidOrders ?? 0;
  const totalRevenue = result?.totalRevenue ?? 0;

  return {
    totalOrders,
    openOrders,
    paidOrders,
    totalRevenue,
    averageOrderValue: paidOrders > 0 ? totalRevenue / paidOrders : 0,
  };
}

export async function fetchAdminOrderList(
  params: AdminOrderListParams,
  staffScope?: StaffAccessScope | null,
): Promise<AdminOrderListResult> {
  await connectDB();

  const { page, limit } = params;
  const query = buildAdminOrderListFilter(params, staffScope);
  const sort = resolveAdminOrderListSort(params.sortBy, params.sortOrder);
  const isUnfiltered = Object.keys(query).length === 0;

  const [orders, total] = await Promise.all([
    Order.find(query)
      .select(LIST_PROJECTION)
      .populate("customerId", "name email")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    // The default view has no filter at all, and there `countDocuments` walks
    // the whole _id index just to produce a number the pagination bar prints.
    // `estimatedDocumentCount` reads it from collection metadata instead.
    isUnfiltered
      ? Order.estimatedDocumentCount()
      : Order.countDocuments(query),
  ]);

  return {
    items: orders as unknown as AdminOrderListItem[],
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
