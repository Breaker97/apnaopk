import { cache } from "react";
import { connectDB } from "@/lib/db";
import { getSettings, Order, PaymentTransaction, Product, User } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { buildOrderChartPoints } from "@/lib/admin/order-chart-points";
import {
  collectedOrderExpr,
  placedOrderMatch,
} from "@/lib/orders/order-payment-status";
import {
  inStoreCurrencyExpr,
  inStoreCurrencyMatch,
} from "@/lib/intl/currency-scope";
import type {
  DashboardStats,
  LatestProduct,
  OrderChartPoint,
  RecentOrder,
  VisitorsChartMetrics,
} from "@/lib/admin/dashboard-types";

const RECENT_ORDERS_LIMIT = 5;
const LATEST_PRODUCTS_LIMIT = 4;
/**
 * Plausible aggregates its own numbers on a delay, so a fresh call per admin
 * page view buys nothing. Five minutes keeps the card current while collapsing
 * every admin's dashboard load into one upstream request.
 */
const VISITORS_REVALIDATE_SECONDS = 300;
/** Plausible is a third party on the critical path of a section; never wait forever. */
const PLAUSIBLE_TIMEOUT_MS = 6000;

interface MonthlyChannelRow {
  _id: { year: number; month: number; pos: boolean };
  orders: number;
  sales: number;
  discount: number;
  discountOrders: number;
}

interface ChannelTotals {
  sales: number;
  orders: number;
  discount: number;
  discountOrders: number;
}

function emptyTotals(): ChannelTotals {
  return { sales: 0, orders: 0, discount: 0, discountOrders: 0 };
}

function addRow(target: ChannelTotals, row: MonthlyChannelRow) {
  target.sales += row.sales;
  target.orders += row.orders;
  target.discount += row.discount;
  target.discountOrders += row.discountOrders;
}

/**
 * One pass over the orders collection, grouped by UTC month and channel.
 *
 * Every order-derived number on this page — the 12-month chart plus the
 * all-time / this-month / last-month stat cards — is a different sum of these
 * same rows, so they are folded in memory instead of asking Mongo again. The
 * previous shape ran a `$facet` with three sub-pipelines *and* a separate
 * ranged aggregation: four scans of the same documents (and `$facet`
 * sub-pipelines cannot use an index) to produce numbers one scan already
 * contains. The result set is bounded by months × 2 channels, so the grouping
 * itself stays tiny regardless of order volume.
 *
 * `cache()` is React's per-request memo: the stats card and the chart both call
 * this while streaming in separate Suspense boundaries and share one query.
 */
const loadOrderMetrics = cache(async (): Promise<MonthlyChannelRow[]> => {
  await connectDB();

  // Two different questions off one scan, and they take different rows:
  // an order somebody placed is counted even while its cash is still to come
  // (COD, a pay-later pre-order), but the MONEY columns only add up what was
  // actually collected. Before this split, a shopper who reached Razorpay and
  // closed the tab added their basket to this store's sales.
  //
  // And only money held in the store's own currency, for the same reason the
  // payments overview reads it that way: these cards are printed with one
  // symbol, so adding a rupee order into them reported those rupees as
  // dollars. The COUNTS stay whole — an order is an order whatever it was
  // priced in — which is why this is a condition inside the sums rather than a
  // filter on the scan. Trade in another currency is reported by Finance, in
  // that currency.
  const settings = await getSettings();
  const storeCurrency = settings.general?.defaultCurrency || "USD";
  const collected = collectedOrderExpr();
  const collectedOnly = (value: Record<string, unknown>) => ({
    $cond: [
      { $and: [collected, inStoreCurrencyExpr(storeCurrency)] },
      value,
      0,
    ],
  });

  return Order.aggregate<MonthlyChannelRow>([
    { $match: { ...placedOrderMatch(), status: { $ne: "cancelled" } } },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          // Collapse null/"online"/legacy values into a single non-POS bucket
          // here so no channel normalization is needed downstream.
          pos: { $eq: ["$channel", "pos"] },
        },
        orders: { $sum: 1 },
        sales: { $sum: collectedOnly({ $ifNull: ["$total", 0] }) },
        discount: { $sum: collectedOnly({ $ifNull: ["$discount", 0] }) },
        // Counted on the same terms as the amount it labels, or the card
        // would read "1,240.00 from 9 orders" with three of those nine
        // contributing nothing to the figure.
        discountOrders: {
          $sum: {
            $cond: [
              {
                $and: [
                  collected,
                  inStoreCurrencyExpr(storeCurrency),
                  { $gt: ["$discount", 0] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
});

function getMonthBoundaries(now: Date) {
  const currentMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const previousMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );

  return {
    currentMonthStart,
    previousMonthStart,
    // `$month` is 1-based; the aggregation groups in UTC, so these keys line up
    // with the boundaries above.
    currentKey: `${currentMonthStart.getUTCFullYear()}-${currentMonthStart.getUTCMonth() + 1}`,
    previousKey: `${previousMonthStart.getUTCFullYear()}-${previousMonthStart.getUTCMonth() + 1}`,
  };
}

/** Trailing 12 UTC months of orders/sales split by sales channel. */
export const getOrderChartMetrics = cache(async (): Promise<OrderChartPoint[]> => {
  const rows = await loadOrderMetrics();
  return buildOrderChartPoints(
    rows.map((row) => ({ ...row._id, orders: row.orders, sales: row.sales })),
    new Date(),
  );
});

/**
 * The five most recent orders, shaped for the card that renders them: Mongo
 * returns the line total and the first line's name/image rather than the whole
 * `items` array, which on a large order is most of the document.
 */
export const getRecentOrders = cache(async (): Promise<RecentOrder[]> => {
  await connectDB();

  const rows = await Order.aggregate<{
    _id: unknown;
    orderNumber?: string;
    customerName?: string | null;
    total?: number;
    status?: string;
    paymentMethod?: string;
    itemCount?: number;
    primaryItemName?: string | null;
    primaryItemImage?: string | null;
  }>([
    // A gateway checkout nobody completed is not one of the store's five most
    // recent orders — on a quiet shop it was all five of them.
    { $match: placedOrderMatch() },
    { $sort: { createdAt: -1 } },
    { $limit: RECENT_ORDERS_LIMIT },
    {
      $lookup: {
        from: User.collection.name,
        localField: "customerId",
        foreignField: "_id",
        as: "customer",
      },
    },
    {
      $project: {
        orderNumber: 1,
        total: 1,
        status: 1,
        paymentMethod: 1,
        itemCount: { $sum: "$items.quantity" },
        primaryItemName: { $arrayElemAt: ["$items.name", 0] },
        primaryItemImage: { $arrayElemAt: ["$items.image", 0] },
        customerName: { $arrayElemAt: ["$customer.name", 0] },
      },
    },
  ]);

  return rows.map((row) => ({
    _id: String(row._id),
    orderNumber: row.orderNumber || "",
    customerName: row.customerName || undefined,
    total: typeof row.total === "number" ? row.total : 0,
    status: row.status || "pending",
    paymentMethod: row.paymentMethod,
    itemCount: typeof row.itemCount === "number" ? row.itemCount : 0,
    primaryItemName: row.primaryItemName || undefined,
    primaryItemImage: row.primaryItemImage || undefined,
  }));
});

export const getLatestProducts = cache(async (): Promise<LatestProduct[]> => {
  await connectDB();

  const products = await Product.find({})
    .sort({ createdAt: -1 })
    .limit(LATEST_PRODUCTS_LIMIT)
    .select("name title price images media")
    .lean<
      {
        _id: unknown;
        name?: string;
        title?: string;
        price?: number;
        images?: string[];
        media?: { type?: string; url?: string }[];
      }[]
    >();

  return products.map((product, index) => {
    const mediaImage = product.media?.find(
      (item) => (item?.type || "image") === "image" && item?.url,
    )?.url;

    return {
      _id: String(product._id ?? `latest-product-${index}`),
      name: product.name || product.title || `Product ${index + 1}`,
      price: typeof product.price === "number" ? product.price : 0,
      image: mediaImage || product.images?.[0],
    };
  });
});

interface PlausibleTimeseriesResult {
  date?: string;
  visitors?: number;
  pageviews?: number;
}

interface UtcDateRange {
  from: Date;
  to: Date;
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDayDifferenceInclusive(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / msPerDay) + 1);
}

function getCurrentMonthToDateRangeUTC(now: Date): UtcDateRange {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return { from, to };
}

function getPreviousMonthComparableRangeUTC(currentRange: UtcDateRange): UtcDateRange {
  const daysInCurrentRange = getDayDifferenceInclusive(
    currentRange.from,
    currentRange.to,
  );
  const previousMonthStart = new Date(
    Date.UTC(
      currentRange.from.getUTCFullYear(),
      currentRange.from.getUTCMonth() - 1,
      1,
    ),
  );
  const previousMonthLastDay = new Date(
    Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth() + 1,
      0,
    ),
  );
  const previousMonthComparableEnd = new Date(
    Date.UTC(
      previousMonthStart.getUTCFullYear(),
      previousMonthStart.getUTCMonth(),
      daysInCurrentRange,
    ),
  );

  return {
    from: previousMonthStart,
    to:
      previousMonthComparableEnd <= previousMonthLastDay
        ? previousMonthComparableEnd
        : previousMonthLastDay,
  };
}

async function fetchPlausibleVisitorsTimeseries({
  baseUrl,
  domain,
  apiKey,
  range,
}: {
  baseUrl: string;
  domain: string;
  apiKey: string;
  range: UtcDateRange;
}): Promise<PlausibleTimeseriesResult[]> {
  const site = encodeURIComponent(domain);
  const dateRange = `${toUtcDateString(range.from)},${toUtcDateString(range.to)}`;
  const url =
    `${baseUrl}/api/v1/stats/timeseries?site_id=${site}` +
    `&period=custom&date=${dateRange}&metrics=visitors,pageviews`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // Served from Next's Data Cache: the same store-wide numbers are reused by
    // every admin for the window instead of one upstream call per page view.
    next: { revalidate: VISITORS_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(PLAUSIBLE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Plausible timeseries request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { results?: PlausibleTimeseriesResult[] };
  return Array.isArray(payload.results) ? payload.results : [];
}

export const getVisitorsChartMetrics = cache(
  async (): Promise<VisitorsChartMetrics> => {
    try {
      const settings = await getSettings();
      const analyticsSettings = settings.analytics;
      const domain = analyticsSettings?.plausibleDomain
        ? analyticsSettings.plausibleDomain
            .replace(/^https?:\/\//, "")
            .replace(/\/$/, "")
        : undefined;
      const apiKey = analyticsSettings?.plausibleApiKey;

      if (!domain || !apiKey) {
        return {
          configured: false,
          currentTotal: 0,
          previousTotal: 0,
          data: [],
        };
      }

      const baseUrl =
        analyticsSettings?.plausibleSelfHosted && analyticsSettings?.plausibleBaseUrl
          ? analyticsSettings.plausibleBaseUrl.replace(/\/$/, "")
          : "https://plausible.io";

      const currentRange = getCurrentMonthToDateRangeUTC(new Date());
      const previousRange = getPreviousMonthComparableRangeUTC(currentRange);

      const [currentSeries, previousSeries] = await Promise.all([
        fetchPlausibleVisitorsTimeseries({
          baseUrl,
          domain,
          apiKey,
          range: currentRange,
        }),
        fetchPlausibleVisitorsTimeseries({
          baseUrl,
          domain,
          apiKey,
          range: previousRange,
        }),
      ]);

      let currentTotal = 0;
      let previousTotal = 0;

      const data = currentSeries.map((point, index) => {
        const visitors = typeof point.visitors === "number" ? point.visitors : 0;
        currentTotal += visitors;

        return {
          day: point.date || String(index + 1),
          current: visitors,
          previous: typeof point.pageviews === "number" ? point.pageviews : 0,
        };
      });

      for (const point of previousSeries) {
        previousTotal += typeof point.visitors === "number" ? point.visitors : 0;
      }

      return { configured: true, currentTotal, previousTotal, data };
    } catch {
      return {
        configured: false,
        currentTotal: 0,
        previousTotal: 0,
        data: [],
      };
    }
  },
);

function buildTrend(
  current: number,
  previous: number,
): { value: number | null; direction: "up" | "down" | "neutral" } {
  if (previous <= 0) {
    return {
      value: current > 0 ? 100 : null,
      direction: current > 0 ? "up" : "neutral",
    };
  }
  const change = ((current - previous) / previous) * 100;
  return {
    value: Math.abs(change),
    direction: change > 0 ? "up" : change < 0 ? "down" : "neutral",
  };
}

interface RefundTotals {
  amount: number;
  cases: number;
  currentAmount: number;
  previousAmount: number;
}

/**
 * All-time, this-month and last-month refunds in one pass. Conditional
 * accumulators replace the previous three-branch `$facet`, whose sub-pipelines
 * each re-scanned the matched set.
 *
 * Counted from the refund TRANSACTIONS, not from return requests.
 *
 * A return is one way money goes back and not the common one: an admin
 * refunding an order outright, a cancelled pre-order's deposit, a chargeback
 * the bank took, a Pesapal reversal — none of those raise a ReturnRequest, and
 * reading that collection made every one of them invisible. On a real store
 * that is not an understatement, it is a zero: the card read "0" beside a
 * Payments screen showing eleven thousand.
 *
 * `createRefundTransaction` is the one door all of them go through, so this
 * agrees with the Payments screen and with what the ledger was posted from.
 * Matched on `{type, status, createdAt}`, which the collection already indexes.
 *
 * And in the store's own currency only, like every figure it sits beside. The
 * sales cards above were narrowed and this was not, so a refund sent back in
 * rupees was subtracted from a card printed with the store's own symbol —
 * exactly the arithmetic `lib/intl/currency-scope.ts` exists to stop. The
 * count goes the same way: "3 cases" beside an amount that only covers two of
 * them is the kind of disagreement nobody can explain afterwards.
 */
async function loadRefundTotals(
  currentMonthStart: Date,
  previousMonthStart: Date,
): Promise<RefundTotals> {
  const refundAmount = { $ifNull: ["$grossAmount", 0] };
  const settings = await getSettings();
  const storeCurrency = settings.general?.defaultCurrency || "USD";

  const [row] = await PaymentTransaction.aggregate<RefundTotals>([
    {
      $match: {
        $and: [
          { type: "refund", status: "succeeded" },
          inStoreCurrencyMatch(storeCurrency),
        ],
      },
    },
    {
      $group: {
        _id: null,
        amount: { $sum: refundAmount },
        cases: { $sum: 1 },
        currentAmount: {
          $sum: {
            $cond: [
              { $gte: ["$createdAt", currentMonthStart] },
              refundAmount,
              0,
            ],
          },
        },
        previousAmount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$createdAt", previousMonthStart] },
                  { $lt: ["$createdAt", currentMonthStart] },
                ],
              },
              refundAmount,
              0,
            ],
          },
        },
      },
    },
  ]);

  return {
    amount: row?.amount ?? 0,
    cases: row?.cases ?? 0,
    currentAmount: row?.currentAmount ?? 0,
    previousAmount: row?.previousAmount ?? 0,
  };
}

interface CustomerCounts {
  total: number;
  currentMonth: number;
  previousMonth: number;
}

/**
 * Three counts from one index scan. `$project` keeps the pipeline to fields the
 * `{ roles, createdAt }` index already carries, so the documents themselves
 * never have to be fetched.
 */
async function loadCustomerCounts(
  currentMonthStart: Date,
  previousMonthStart: Date,
): Promise<CustomerCounts> {
  const [row] = await User.aggregate<CustomerCounts>([
    { $match: { roles: USER_ROLES.CUSTOMER } },
    { $project: { _id: 0, createdAt: 1 } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        currentMonth: {
          $sum: { $cond: [{ $gte: ["$createdAt", currentMonthStart] }, 1, 0] },
        },
        previousMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$createdAt", previousMonthStart] },
                  { $lt: ["$createdAt", currentMonthStart] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return {
    total: row?.total ?? 0,
    currentMonth: row?.currentMonth ?? 0,
    previousMonth: row?.previousMonth ?? 0,
  };
}

export const getDashboardStats = cache(async (): Promise<DashboardStats> => {
  await connectDB();

  const { currentMonthStart, previousMonthStart, currentKey, previousKey } =
    getMonthBoundaries(new Date());

  const [orderRows, refunds, customers] = await Promise.all([
    loadOrderMetrics(),
    loadRefundTotals(currentMonthStart, previousMonthStart),
    loadCustomerCounts(currentMonthStart, previousMonthStart),
  ]);

  const inStore = {
    all: emptyTotals(),
    current: emptyTotals(),
    previous: emptyTotals(),
  };
  const online = {
    all: emptyTotals(),
    current: emptyTotals(),
    previous: emptyTotals(),
  };

  for (const row of orderRows) {
    const channel = row._id.pos ? inStore : online;
    addRow(channel.all, row);

    const key = `${row._id.year}-${row._id.month}`;
    if (key === currentKey) addRow(channel.current, row);
    else if (key === previousKey) addRow(channel.previous, row);
  }

  const ordersAll = inStore.all.orders + online.all.orders;

  return {
    inStoreSales: {
      amount: inStore.all.sales,
      count: inStore.all.orders,
      ...buildTrend(inStore.current.sales, inStore.previous.sales),
    },
    websiteSales: {
      amount: online.all.sales,
      count: online.all.orders,
      ...buildTrend(online.current.sales, online.previous.sales),
    },
    totalOrders: {
      amount: ordersAll,
      count: ordersAll,
      ...buildTrend(
        inStore.current.orders + online.current.orders,
        inStore.previous.orders + online.previous.orders,
      ),
    },
    discount: {
      amount: inStore.all.discount + online.all.discount,
      count: inStore.all.discountOrders + online.all.discountOrders,
      ...buildTrend(
        inStore.current.discount + online.current.discount,
        inStore.previous.discount + online.previous.discount,
      ),
    },
    refunds: {
      amount: refunds.amount,
      count: refunds.cases,
      ...buildTrend(refunds.currentAmount, refunds.previousAmount),
    },
    customers: {
      amount: customers.total,
      count: customers.currentMonth,
      ...buildTrend(customers.currentMonth, customers.previousMonth),
    },
  };
});
