import type { Types } from "mongoose";
import { Order } from "@/models";
import { connectDB } from "@/lib/db";
import { listResult, type ListResult } from "@/lib/api/list-query";
import { subOrderPaymentStatusFilter } from "@/lib/orders/order-payment-status";

/**
 * Vendor order list query.
 *
 * Shared by `GET /api/vendor/orders` and the vendor orders page's server
 * component so the endpoint and the rendered page always agree on what a
 * given query string means.
 *
 * A vendor reaches an order only through its own sub-order, so both the scope
 * and the status filter match inside `subOrders[]` rather than order-wide,
 * and each returned order is narrowed to that vendor's sub-order before it
 * leaves here.
 */

type ViewType = "all" | "unfulfilled" | "unpaid" | "open" | "archived";

function getStatusesForView(view: ViewType): string[] | null {
  switch (view) {
    case "unfulfilled":
      return ["pending", "processing"];
    case "open":
      return ["pending", "processing", "shipped"];
    case "archived":
      return ["delivered", "cancelled"];
    default:
      return null;
  }
}

interface VendorOrderListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  paymentStatus?: string;
  view?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export async function fetchVendorOrderList(
  {
    page,
    limit,
    search,
    status,
    paymentStatus,
    view,
    sortBy,
    sortOrder,
  }: VendorOrderListParams,
  vendorId: Types.ObjectId | string,
): Promise<ListResult<unknown>> {
  await connectDB();

  const skip = (page - 1) * limit;

  const andConditions: Record<string, unknown>[] = [];

  const statusFromView = getStatusesForView((view || "all") as ViewType);
  let subOrderStatusCondition: Record<string, unknown> | undefined;

  if (status && status !== "all") {
    if (statusFromView && !statusFromView.includes(status)) {
      return listResult([], page, limit, 0);
    }
    subOrderStatusCondition = { status };
  } else if (statusFromView) {
    subOrderStatusCondition = { status: { $in: statusFromView } };
  }

  const vendorSubOrderMatch = {
    vendorId,
    ...(subOrderStatusCondition || {}),
  };

  andConditions.push({ subOrders: { $elemMatch: vendorSubOrderMatch } });

  // A vendor asks about THEIR consignment's money. Reading the order-level
  // field showed a vendor whose own cash was still outstanding as paid the
  // moment a co-vendor on the same order collected theirs, so orders they
  // still had to chase fell out of their own "unpaid" worklist.
  const paymentStatuses =
    paymentStatus && paymentStatus !== "all"
      ? [paymentStatus]
      : view === "unpaid"
        ? ["pending", "partially_paid"]
        : null;

  if (paymentStatuses) {
    andConditions.push(
      subOrderPaymentStatusFilter(vendorSubOrderMatch, paymentStatuses),
    );
  }

  if (search) {
    andConditions.push({
      $or: [{ orderNumber: { $regex: search, $options: "i" } }],
    });
  }

  const query: Record<string, unknown> =
    andConditions.length > 0 ? { $and: andConditions } : {};

  const allowedSortFields = new Set([
    "createdAt",
    "orderNumber",
    "paymentStatus",
    "total",
  ]);
  const effectiveSortBy =
    sortBy && allowedSortFields.has(sortBy) ? sortBy : "createdAt";
  const sortDirection = sortOrder === "asc" ? 1 : -1;

  const [orders, total] = await Promise.all([
    Order.find(query)
      // The vendor list renders order-level fields + this vendor's sub-order
      // (its counts/status come from subOrders[].items). The top-level items[]
      // array (all vendors' lines) is never read here — exclude it so we don't
      // ship a second, larger copy of every line per row.
      .select("-items")
      .populate("customerId", "name email")
      .sort({ [effectiveSortBy]: sortDirection })
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(query),
  ]);

  const vendorOrders = orders.map((order) => ({
    ...order,
    subOrders: order.subOrders.filter(
      (sub: { vendorId?: { toString: () => string } }) =>
        sub.vendorId?.toString() === String(vendorId),
    ),
  }));

  return listResult(vendorOrders as unknown[], page, limit, total);
}
