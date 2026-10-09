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
import {
  getPreorderBalanceDue,
  resolveVendorPaymentDisplayStatus,
} from "@/lib/orders/order-payment-status";
import { getFulfillmentPaymentBlock } from "@/lib/orders/fulfillment-payment-gate";
import { readinessSummary } from "@/lib/orders/preorder-scope";

type ListOrder = Record<string, unknown> & {
  _id: unknown;
  status?: string;
  paymentStatus?: string;
  preorderCollection?: { state?: string; chargeNotBefore?: Date; attentionReason?: string } | null;
  preorderRelease?: {
    state?: string;
    reason?: string;
    lastAttemptAt?: Date;
    nextAttemptAt?: Date;
    attempts?: number;
  } | null;
  items?: Array<Record<string, unknown> & { vendorId?: unknown }>;
  subOrders?: Array<Record<string, unknown> & { vendorId?: unknown; status?: string; items?: Array<Record<string, unknown>> }>;
};

/**
 * One pre-order as a seller may see it: their own consignment, their own
 * lines and terms, and only counts and states for the rest of the order —
 * never another seller's goods, stock or money, and not the order's balance
 * figures, which are the whole order's. The decisions the table needs
 * (is a balance owed, is fulfilment blocked) arrive as answers.
 */
export function toVendorPreorderRow(order: ListOrder, vendorId: string) {
  const own = (order.subOrders || []).filter((sub) => String(sub.vendorId) === vendorId);
  const ownLines = (order.items || []).filter((item) => String(item.vendorId) === vendorId);
  const preorderLines = ownLines.filter((item) => item.purchaseType === PURCHASE_TYPE.PREORDER);
  const sum = (field: string) =>
    preorderLines.reduce((total, item) => total + (Number(item[field]) || 0), 0);
  const dates = preorderLines
    .map((item) => (item.preorderReleaseDate ? new Date(item.preorderReleaseDate as string) : null))
    .filter((date): date is Date => Boolean(date) && !Number.isNaN(date!.getTime()));
  const latest = dates.length
    ? new Date(Math.max(...dates.map((date) => date.getTime())))
    : order.preorderReleaseDate;
  const summary = readinessSummary(order as never, vendorId);
  const paymentModes = new Set(preorderLines.map((item) => item.preorderPaymentMode));
  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    customerId: order.customerId,
    status: own[0]?.status || order.status,
    preorderStatus: undefined,
    preorderReleaseDate: latest,
    preorderPaymentMode: paymentModes.size === 1 ? [...paymentModes][0] : order.preorderPaymentMode,
    preorderDepositAmount: sum("preorderDepositAmount"),
    preorderOutstandingAmount: sum("preorderOutstandingAmount"),
    paymentStatus: resolveVendorPaymentDisplayStatus(order as never, own[0] as never),
    hasPreorder: true,
    total: Number(own[0]?.subtotal || 0),
    items: ownLines,
    subOrders: own.map((sub) => ({
      _id: sub._id,
      vendorId: sub.vendorId,
      status: sub.status,
      paymentStatus: sub.paymentStatus,
      subtotal: sub.subtotal,
      items: sub.items,
      preorderReadiness: sub.preorderReadiness
        ? { declaredAt: (sub.preorderReadiness as { declaredAt?: Date }).declaredAt }
        : undefined,
    })),
    // Answers, not the figures behind them.
    balanceOwed: getPreorderBalanceDue(order as never) > 0,
    fulfillmentBlocked: Boolean(
      getFulfillmentPaymentBlock(order as never, (own[0] ?? null) as never),
    ),
    readiness: { ownReady: summary.ownReady, othersWaiting: summary.othersWaiting },
    collection: order.preorderCollection?.state
      ? {
          state: order.preorderCollection.state,
          chargeNotBefore: order.preorderCollection.chargeNotBefore,
        }
      : undefined,
    release: order.preorderRelease?.state
      ? {
          state: order.preorderRelease.state,
          reason: order.preorderRelease.reason,
          lastAttemptAt: order.preorderRelease.lastAttemptAt,
          nextAttemptAt: order.preorderRelease.nextAttemptAt,
        }
      : undefined,
  };
}

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
      // A delayed reservation counts against its new date, as the sweep does.
      preorderStatus: {
        $in: [PREORDER_ITEM_STATUS.RESERVED, PREORDER_ITEM_STATUS.DELAYED],
      },
      preorderReleaseDate: { $lt: new Date() },
    };
  }
  if (view === "due_soon") {
    return {
      preorderStatus: {
        $in: [PREORDER_ITEM_STATUS.RESERVED, PREORDER_ITEM_STATUS.DELAYED],
      },
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

  // A seller sees their own consignment of each order and nothing else.
  const rows = context.vendorId
    ? (orders as unknown as ListOrder[]).map((order) =>
        toVendorPreorderRow(order, String(context.vendorId)),
      )
    : orders;
  return listResult(rows as unknown[], page, limit, total);
}

/** The columns of a seller's pre-order file — their consignment, not the order. */
export const VENDOR_PREORDER_CSV_HEADERS = [
  "Order",
  "Customer",
  "Email",
  "Preorder status",
  "Fulfillment status",
  "Payment status",
  "Expected release",
  "Subtotal",
  "Created",
] as const;

/**
 * The pre-order stage of a seller's own consignment, read the way the table
 * reads it: goods that have left are "fulfilled", otherwise the stage its lines
 * share, and "partially_ready" while they disagree and some are past reserved.
 */
function vendorPreorderStage(row: ReturnType<typeof toVendorPreorderRow>) {
  const own = row.subOrders[0];
  if (own?.status === "shipped" || own?.status === "delivered") return "fulfilled";

  const stages = (own?.items || [])
    .filter((item) => item.purchaseType === PURCHASE_TYPE.PREORDER)
    .map((item) => item.preorderStatus)
    .filter((stage): stage is string => Boolean(stage));
  if (stages.length === 0) {
    if (row.status === "processing") return "ready";
    if (row.status === "cancelled") return "cancelled";
    return "reserved";
  }
  if (stages.every((stage) => stage === stages[0])) return stages[0];
  return stages.some(
    (stage) =>
      stage === PREORDER_ITEM_STATUS.READY ||
      stage === PREORDER_ITEM_STATUS.PAYMENT_DUE,
  )
    ? "partially_ready"
    : "reserved";
}

/**
 * A seller's pre-orders as file rows.
 *
 * Goes through `toVendorPreorderRow`, the same reduction the list uses, so the
 * file can never carry more than the screen does: their own consignment's
 * status and subtotal, not the order's balance figures or another seller's goods.
 */
export function vendorPreorderCsvRows(
  orders: unknown[],
  vendorId: string,
): Array<Array<unknown>> {
  const iso = (value: unknown) => {
    if (!value) return "";
    const date = new Date(value as string);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  };
  return (orders as ListOrder[]).map((order) => {
    const row = toVendorPreorderRow(order, vendorId);
    const customer = row.customerId as
      | { name?: string; email?: string }
      | undefined;
    return [
      row.orderNumber,
      customer?.name || "Customer",
      customer?.email || "",
      vendorPreorderStage(row),
      row.status,
      row.paymentStatus,
      iso(row.preorderReleaseDate),
      row.total,
      iso(row.createdAt),
    ];
  });
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
