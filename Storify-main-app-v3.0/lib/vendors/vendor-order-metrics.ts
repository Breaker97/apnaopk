import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, Product } from "@/models";
import {
  ORDER_STATUS,
  PAYMENT_STATUS,
  PRODUCT_STATUS,
} from "@/config/app.config";
import {
  BUCKET_KEY_FORMAT,
  buildAllTimeChartSeries,
  buildChartSeries,
  granularityForRange,
  parseBucketKey,
  queryUnitFor,
} from "@/lib/admin/order-chart-buckets";
import type { DashboardRange } from "@/lib/admin/dashboard-period";
import { SETTLED_PAYMENT_STATUSES } from "@/lib/orders/order-payment-status";
import { VENDOR_OPEN_ORDER_STATUSES } from "@/lib/vendors/vendor-order-list";
import {
  fetchVendorOrderSettlements,
  PAYABLE_ORDER_PROJECTION,
  type PayableOrderLike,
} from "@/lib/vendors/vendor-earnings";
import type {
  VendorDashboardData,
  VendorOrderTotals,
  VendorRecentOrder,
} from "@/lib/vendors/vendor-dashboard-types";
import { placedOrderMatch } from "@/lib/orders/order-payment-status";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";

/**
 * A vendor's order numbers, defined once.
 *
 * The vendor dashboard and the vendor orders page each used to compute their
 * own, and they disagreed on the same order: the dashboard's "Total Revenue"
 * summed every order placed, the orders page's summed net earnings of paid
 * orders under a "gross paid order value" label, and the recent-orders card
 * dropped the customer, items and payment method on the way out of the API.
 * Both now read this module.
 *
 * - **Counts** are order records, as the order list counts its rows:
 *   `totalOrders` is the "All" tab (cancelled included) and `openOrders` the
 *   "Open" tab.
 * - **Money is collected money.** A pending order is either cash on delivery
 *   not yet handed over or a gateway checkout the shopper may have abandoned —
 *   and no job cancels an abandoned one — so counting it as revenue overstates
 *   what the vendor made. The payouts and the finance statement also only
 *   count a sale once it is paid. What is still outstanding is reported as
 *   `awaitingPayment` rather than dropped.
 * - **Payment is asked per consignment** (see `order-payment-status.ts`): on a
 *   split order one vendor collects while another waits. A refund, though, is
 *   recorded on the order alone, so a refunded order is excluded explicitly.
 * - **A cancelled consignment earns nothing** even while the order lives on
 *   for the other vendors — a vendor can cancel their own share of it.
 * - The chart's **sales** are the value of every live consignment, paid or
 *   not: what was sold in the month. That is the admin's "Total sales" for the
 *   vendor (`lib/vendors/vendor-sales.ts`).
 */

const RECENT_ORDERS_LIMIT = 5;

/** Payment states a live consignment is still waiting on — the "Unpaid" tab. */
const AWAITING_PAYMENT_STATUSES = [
  PAYMENT_STATUS.PENDING,
  PAYMENT_STATUS.PARTIALLY_PAID,
];

interface VendorOrderMetricRow {
  /** `$dateToString` key at the scan's bucket size (`BUCKET_KEY_FORMAT`). */
  _id: { bucket: string; pos: boolean };
  orders: number;
  openOrders: number;
  paidOrders: number;
  sales: number;
  revenue: number;
  earnings: number;
  awaitingPayment: number;
}

/** Which orders a scan reads, and how finely it groups them. */
interface VendorMetricsScope {
  /** Only orders placed from then on (the business app's today and this month). */
  from?: Date;
  /** Only orders placed up to then. */
  to?: Date;
  /** Bucket size of the grouped rows; months unless a ranged chart needs finer. */
  unit?: keyof typeof BUCKET_KEY_FORMAT;
}

/** `createdAt` bounds for a scope, empty when it reads every order. */
function createdAtMatch({ from, to }: Pick<VendorMetricsScope, "from" | "to">) {
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    },
  };
}

/**
 * One pass over the vendor's orders, grouped by UTC time bucket and sales
 * channel — the admin dashboard's shape. Every card, the orders page's strip
 * and the chart are different sums of these rows, which are bounded by buckets
 * × 2 however many orders the vendor has.
 */
async function loadVendorOrderMetrics(
  vendorId: Types.ObjectId,
  scope: VendorMetricsScope = {},
): Promise<VendorOrderMetricRow[]> {
  await connectDB();

  return Order.aggregate<VendorOrderMetricRow>([
    // Index-backed by { "subOrders.vendorId": 1, createdAt: -1 }.
    {
      $match: {
        "subOrders.vendorId": vendorId,
        ...createdAtMatch(scope),
      },
    },
    // A checkout abandoned at a gateway is not one of this vendor's orders.
    // Their money columns already ignored it (nothing is `collected` while the
    // payment is pending), but the order and open-order COUNTS did not, so a
    // vendor's dashboard showed work waiting that nobody had ever ordered.
    { $match: placedOrderMatch() },
    {
      $project: {
        // Kept for the refund lookup below; the grouping replaces it.
        _id: 1,
        total: 1,
        createdAt: 1,
        channel: 1,
        status: 1,
        paymentStatus: 1,
        // One consignment per vendor per order (`buildVendorSubOrders` groups
        // the lines by vendor), picked out the way the order list narrows a row.
        consignment: {
          $arrayElemAt: [
            {
              $filter: {
                input: "$subOrders",
                as: "sub",
                cond: { $eq: ["$$sub.vendorId", vendorId] },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        live: {
          $and: [
            { $ne: ["$status", ORDER_STATUS.CANCELLED] },
            { $ne: ["$consignment.status", ORDER_STATUS.CANCELLED] },
          ],
        },
        // `resolveSubOrderPaymentStatus` in query form: the consignment's own
        // state, falling back to the order's on rows written before the split.
        payment: {
          $ifNull: [
            "$consignment.paymentStatus",
            { $ifNull: ["$paymentStatus", PAYMENT_STATUS.PENDING] },
          ],
        },
        subtotal: { $ifNull: ["$consignment.subtotal", 0] },
      },
    },
    // What of THIS vendor's goods has been refunded. A part-refunded order
    // still counts as collected, and counted whole, a split order whose other
    // seller refunded a sock showed this seller's fully returned goods as
    // revenue. Each refund row names its split per seller; one that recorded
    // none is shared by what each consignment sold for.
    {
      $lookup: {
        from: "paymenttransactions",
        localField: "_id",
        foreignField: "orderId",
        pipeline: [
          { $match: { type: "refund", status: "succeeded" } },
          { $project: { _id: 0, grossAmount: 1, refundAllocation: 1 } },
        ],
        as: "refunds",
      },
    },
    {
      $addFields: {
        refundedGoods: {
          $sum: {
            $map: {
              input: "$refunds",
              as: "refund",
              in: {
                $cond: [
                  {
                    $gt: [
                      { $size: { $ifNull: ["$$refund.refundAllocation", []] } },
                      0,
                    ],
                  },
                  {
                    $sum: {
                      $map: {
                        input: {
                          $filter: {
                            input: "$$refund.refundAllocation",
                            as: "share",
                            cond: { $eq: ["$$share.vendorId", vendorId] },
                          },
                        },
                        as: "share",
                        in: { $ifNull: ["$$share.merchandise", 0] },
                      },
                    },
                  },
                  {
                    $multiply: [
                      { $ifNull: ["$$refund.grossAmount", 0] },
                      {
                        $cond: [
                          { $gt: [{ $ifNull: ["$total", 0] }, 0] },
                          { $divide: ["$subtotal", "$total"] },
                          0,
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
    {
      $addFields: {
        keptGoods: {
          $max: [0, { $subtract: ["$subtotal", "$refundedGoods"] }],
        },
        keptShare: {
          $cond: [
            { $gt: ["$subtotal", 0] },
            {
              $max: [
                0,
                {
                  $subtract: [1, { $divide: ["$refundedGoods", "$subtotal"] }],
                },
              ],
            },
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        collected: {
          $and: [
            "$live",
            { $in: ["$payment", SETTLED_PAYMENT_STATUSES] },
            { $ne: ["$paymentStatus", PAYMENT_STATUS.REFUNDED] },
          ],
        },
        awaiting: {
          $and: ["$live", { $in: ["$payment", AWAITING_PAYMENT_STATUSES] }],
        },
      },
    },
    {
      $group: {
        _id: {
          bucket: {
            $dateToString: {
              format: BUCKET_KEY_FORMAT[scope.unit ?? "month"],
              date: "$createdAt",
              timezone: "UTC",
            },
          },
          // null/"online"/legacy values all land in the one non-POS bucket.
          pos: { $eq: ["$channel", "pos"] },
        },
        orders: { $sum: 1 },
        openOrders: {
          $sum: {
            $cond: [
              {
                $in: [
                  { $ifNull: ["$consignment.status", ""] },
                  VENDOR_OPEN_ORDER_STATUSES,
                ],
              },
              1,
              0,
            ],
          },
        },
        paidOrders: { $sum: { $cond: ["$collected", 1, 0] } },
        sales: { $sum: { $cond: ["$live", "$subtotal", 0] } },
        revenue: { $sum: { $cond: ["$collected", "$keptGoods", 0] } },
        earnings: {
          $sum: {
            $cond: [
              "$collected",
              {
                $multiply: [
                  { $ifNull: ["$consignment.vendorEarnings", 0] },
                  "$keptShare",
                ],
              },
              0,
            ],
          },
        },
        awaitingPayment: { $sum: { $cond: ["$awaiting", "$subtotal", 0] } },
      },
    },
  ]);
}

export function summarizeVendorOrderMetrics(
  rows: readonly VendorOrderMetricRow[],
): VendorOrderTotals {
  const totals: VendorOrderTotals = {
    totalOrders: 0,
    openOrders: 0,
    paidOrders: 0,
    totalRevenue: 0,
    netEarnings: 0,
    awaitingPayment: 0,
  };

  for (const row of rows) {
    totals.totalOrders += row.orders;
    totals.openOrders += row.openOrders;
    totals.paidOrders += row.paidOrders;
    totals.totalRevenue += row.revenue;
    totals.netEarnings += row.earnings;
    totals.awaitingPayment += row.awaitingPayment;
  }

  return totals;
}

/** The orders page's stats strip. */
export async function getVendorOrderTotals(
  vendorId: Types.ObjectId | string,
): Promise<VendorOrderTotals> {
  const rows = await loadVendorOrderMetrics(
    new Types.ObjectId(String(vendorId)),
  );
  return summarizeVendorOrderMetrics(rows);
}

/**
 * What the vendor collected on orders placed since `since`: the dashboard's
 * "Total Revenue" rule (`totalRevenue`), over those orders only. The business
 * app's Home reads it for today and this month (UTC, as the rows' months are).
 */
export async function getVendorCollectedSince(
  vendorId: Types.ObjectId | string,
  since: Date,
): Promise<number> {
  const rows = await loadVendorOrderMetrics(
    new Types.ObjectId(String(vendorId)),
    { from: since },
  );
  return summarizeVendorOrderMetrics(rows).totalRevenue;
}

/** Seven-day Home graph: one bounded aggregation, using the same refund/payment rule. */
export async function getVendorCollectedByDay(
  vendorId: Types.ObjectId | string,
  range: { from: Date; to: Date },
): Promise<Map<string, number>> {
  const rows = await loadVendorOrderMetrics(
    new Types.ObjectId(String(vendorId)),
    { from: range.from, to: range.to, unit: "day" },
  );
  // A day's bucket key is already its UTC date (`BUCKET_KEY_FORMAT.day`).
  const days = new Map<string, number>();
  for (const row of rows) {
    days.set(row._id.bucket, (days.get(row._id.bucket) ?? 0) + row.revenue);
  }
  return days;
}

/** A recent order as `Order.find` returns it under the projection below. */
export interface VendorRecentOrderRow {
  _id: unknown;
  orderNumber?: string;
  paymentMethod?: string;
  customerId?: { _id?: unknown; name?: string } | null;
  channel?: string;
  staffId?: string;
  subOrders?: Array<{
    vendorId?: unknown;
    status?: string;
    fulfillment?: { method?: string; pickup?: { status?: string } | null };
    items?: Array<{ name?: string; image?: string; quantity?: number }>;
  }>;
}

/**
 * One recent-orders card, read from THIS vendor's consignment: its lines and
 * its status — the same fields, and the same fallbacks, as the vendor order
 * list's row. The order's top-level `items` hold every vendor's lines, so they
 * are never read here.
 *
 * `netSales` is what a payout would pay for the consignment
 * (`fetchVendorOrderSettlements`), the figure the list's column shows.
 */
export function toVendorRecentOrder(
  order: VendorRecentOrderRow,
  vendorId: string,
  netSales: number,
): VendorRecentOrder {
  const consignment = order.subOrders?.find(
    (sub) => String(sub.vendorId) === vendorId,
  );
  const items = consignment?.items ?? [];
  const pickup =
    consignment?.fulfillment?.method === "pickup"
      ? consignment.fulfillment.pickup
      : undefined;

  return {
    _id: String(order._id),
    orderNumber: order.orderNumber || "",
    // Guest orders point `customerId` at the guest's cart, which populates to
    // nothing; the list shows those as guests too. A walk-in POS sale is filed
    // under its cashier, so it names nobody and the card labels it.
    ...(isPosWalkIn(order)
      ? { walkIn: true }
      : { customerName: order.customerId?.name || undefined }),
    paymentMethod: order.paymentMethod,
    status: consignment?.status || ORDER_STATUS.PENDING,
    pickupStatus: pickup?.status || undefined,
    itemCount: items.reduce((sum, item) => sum + (item.quantity || 0), 0),
    primaryItemName: items[0]?.name || undefined,
    primaryItemImage: items[0]?.image || undefined,
    netSales,
  };
}

/** The newest orders, in the order list's default scope and sort. */
async function getVendorRecentOrders(
  vendorId: Types.ObjectId,
): Promise<VendorRecentOrder[]> {
  await connectDB();

  const orders = await Order.find({ subOrders: { $elemMatch: { vendorId } } })
    .sort({ createdAt: -1 })
    .limit(RECENT_ORDERS_LIMIT)
    // Whole consignments: the payout arithmetic behind each card's net sales
    // needs their money fields, and Mongo refuses a projection naming both a
    // path and its children. Only five orders are read.
    .select(`orderNumber customerId staffId ${PAYABLE_ORDER_PROJECTION}`)
    .populate("customerId", "name")
    .lean<Array<VendorRecentOrderRow & PayableOrderLike>>();

  const vendorKey = String(vendorId);
  const settlements = await fetchVendorOrderSettlements(orders, vendorId);
  return orders.map((order) =>
    toVendorRecentOrder(
      order,
      vendorKey,
      settlements.get(String(order._id))?.netAmount ?? 0,
    ),
  );
}

/**
 * What the vendor actually earned on their collected sales, in the store's
 * currency — the payout arithmetic, not the stored figure.
 *
 * A consignment's `vendorEarnings` is written at checkout, before the coupon
 * that came off it, before any refund, and without the delivery charge the
 * vendor earns for carrying it. Summing that showed a 100%-off order as full
 * earnings and a half-refunded one as whole, so the dashboard promised money
 * no payout would ever pay. The same sales are counted — live, collected, not
 * fully refunded — but each is valued the way a payout values it.
 *
 * Read in batches so a vendor with years of orders does not load them at once.
 * Sales in another currency are left out rather than added at face value: a
 * figure in the store's currency cannot honestly contain them.
 *
 * With a `range`, only orders placed in it, as the cards beside it count them.
 */
async function sumVendorSettledEarnings(
  vendorId: Types.ObjectId,
  storeCurrency: string,
  range: DashboardRange | null,
): Promise<number> {
  type Row = PayableOrderLike & {
    _id: unknown;
    paymentStatus?: string;
    subOrders?: Array<{
      vendorId?: unknown;
      status?: string;
      paymentStatus?: string;
    }>;
  };
  const currency = storeCurrency.toUpperCase();
  const vendorKey = String(vendorId);
  const PAGE = 500;
  let total = 0;
  let after: unknown = null;

  for (;;) {
    const page: Row[] = await Order.find({
      ...(range ? createdAtMatch(range) : {}),
      status: { $ne: ORDER_STATUS.CANCELLED },
      paymentStatus: { $ne: PAYMENT_STATUS.REFUNDED },
      subOrders: {
        $elemMatch: { vendorId, status: { $ne: ORDER_STATUS.CANCELLED } },
      },
      $or: [
        { currency },
        { currency: { $exists: false } },
        { currency: null },
        { currency: "" },
      ],
      ...(after ? { _id: { $gt: after } } : {}),
    })
      .sort({ _id: 1 })
      .limit(PAGE)
      .select(`${PAYABLE_ORDER_PROJECTION} paymentStatus status`)
      .lean<Row[]>();
    if (!page || page.length === 0) break;

    // Only the consignments the dashboard counts as collected.
    const collected = page.filter((order) => {
      const mine = (order.subOrders || []).find(
        (sub) => String(sub.vendorId) === vendorKey,
      );
      const payment =
        mine?.paymentStatus || order.paymentStatus || PAYMENT_STATUS.PENDING;
      return (SETTLED_PAYMENT_STATUSES as readonly string[]).includes(payment);
    });
    const settlements = await fetchVendorOrderSettlements(
      collected.map((order) => ({
        ...order,
        currency: order.currency || currency,
      })),
      vendorId,
    );
    for (const settled of settlements.values()) total += settled.netAmount;

    if (page.length < PAGE) break;
    after = page[page.length - 1]!._id;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Everything `GET /api/vendor/analytics` returns to the dashboard.
 *
 * `range` is the dashboard's period (`resolveDashboardPeriod`, the admin
 * dashboard's own): the cards and the chart cover orders placed in it, and
 * null is "All time". The active-product count and the recent orders are the
 * store as it is now, so they ignore it.
 */
export async function getVendorDashboardData(
  vendorId: Types.ObjectId | string,
  range: DashboardRange | null = null,
): Promise<VendorDashboardData> {
  await connectDB();
  const id = new Types.ObjectId(String(vendorId));

  const granularity = range ? granularityForRange(range) : null;
  const unit = granularity ? queryUnitFor(granularity) : "month";

  const { getStoreCurrency } = await import("@/lib/intl/server-currency");
  const storeCurrency = await getStoreCurrency();
  const [rows, recentOrders, activeProducts, netEarnings] = await Promise.all([
    loadVendorOrderMetrics(id, { from: range?.from, to: range?.to, unit }),
    getVendorRecentOrders(id),
    Product.countDocuments({ vendorId: id, status: PRODUCT_STATUS.ACTIVE }),
    sumVendorSettledEarnings(id, String(storeCurrency.code), range),
  ]);

  const sourceRows = rows.map((row) => ({
    start: parseBucketKey(row._id.bucket, unit),
    pos: row._id.pos,
    orders: row.orders,
    sales: row.sales,
  }));

  return {
    stats: { ...summarizeVendorOrderMetrics(rows), netEarnings, activeProducts },
    chart:
      range && granularity
        ? buildChartSeries(sourceRows, range, granularity)
        : buildAllTimeChartSeries(sourceRows, new Date()),
    recentOrders,
  };
}
