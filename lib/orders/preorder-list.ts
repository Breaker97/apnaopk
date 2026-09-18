import type { Types } from "mongoose";
import { Order } from "@/models";
import { connectDB } from "@/lib/db";
import {
  PREORDER_ALLOCATION_SORT,
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
} from "@/lib/orders/preorders";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Pre-order list query.
 *
 * Shared by `GET /api/admin/preorders`, `GET /api/vendor/preorders` and the
 * pre-orders pages' server components so every caller reads a query string the
 * same way.
 *
 * `status` and `view` both narrow the list but are not the same thing: status
 * is the pre-order's own state, while "overdue" and "due_soon" are windows
 * around its release date. The table surfaces them in one control, which is
 * why they arrive as separate params.
 */

/** How far ahead "due soon" looks. */
const DUE_SOON_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

interface PreorderListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  view?: string;
}

interface PreorderListContext {
  /** Present for the vendor dashboard: only orders containing its items. */
  vendorId?: Types.ObjectId | string;
  /** Narrows the admin list to a scoped staff member's orders. */
  staffScope?: StaffAccessScope | null;
}

function releaseWindowCondition(view: string): Record<string, unknown> | null {
  if (view === "overdue") {
    return {
      preorderStatus: PREORDER_ITEM_STATUS.RESERVED,
      preorderReleaseDate: { $lt: new Date() },
    };
  }
  if (view === "due_soon") {
    return {
      preorderStatus: PREORDER_ITEM_STATUS.RESERVED,
      preorderReleaseDate: {
        $gte: new Date(),
        $lte: new Date(Date.now() + DUE_SOON_WINDOW_MS),
      },
    };
  }
  return null;
}

function buildPreorderListFilter(
  { search, status = "all", view = "all" }: Omit<PreorderListParams, "page" | "limit">,
  { vendorId, staffScope }: PreorderListContext = {},
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [{ hasPreorder: true }];

  if (vendorId) {
    // A vendor sees an order only through its own sub-order, and the status
    // filter has to match inside that sub-order rather than order-wide.
    const elemMatch: Record<string, unknown> = { vendorId };
    if (status !== "all") {
      elemMatch.items = {
        $elemMatch: {
          purchaseType: PURCHASE_TYPE.PREORDER,
          preorderStatus: status,
        },
      };
    }
    conditions.push({ subOrders: { $elemMatch: elemMatch } });
  } else if (status !== "all") {
    conditions.push({ preorderStatus: status });
  }

  const window = releaseWindowCondition(view);
  if (window) conditions.push(window);

  // `search` arrives regex-escaped from the caller.
  if (search) {
    conditions.push({
      $or: [
        { orderNumber: { $regex: search, $options: "i" } },
        { "items.name": { $regex: search, $options: "i" } },
      ],
    });
  }

  return mergeScopeFilter(
    { $and: conditions },
    buildStaffOrderScopeFilter(staffScope),
  );
}

export async function fetchPreorderList(
  params: PreorderListParams,
  context: PreorderListContext = {},
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit } = params;
  const query = buildPreorderListFilter(params, context);

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate("customerId", "name email")
      // Soonest release first, then oldest commitment first. This is the
      // allocation queue, not a display preference — see the constant.
      .sort(PREORDER_ALLOCATION_SORT)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(Order, query),
  ]);

  return listResult(orders as unknown[], page, limit, total);
}

/** Rows for the CSV export, which is unpaginated but otherwise identical. */
export async function fetchPreorderExportRows(
  params: Omit<PreorderListParams, "page" | "limit">,
  context: PreorderListContext = {},
  limit = 5000,
) {
  await connectDB();

  return Order.find(buildPreorderListFilter(params, context))
    .populate("customerId", "name email")
    .sort(PREORDER_ALLOCATION_SORT)
    .limit(limit)
    .lean();
}
