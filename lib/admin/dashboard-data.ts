import { cache } from "react";
import { connectDB } from "@/lib/db";
import { getSettings, Order, PaymentTransaction, Product, User } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";
import {
  BUCKET_KEY_FORMAT,
  buildAllTimeChartSeries,
  buildChartSeries,
  granularityForRange,
  parseBucketKey,
  queryUnitFor,
} from "@/lib/admin/order-chart-buckets";
import {
  collectedOrderExpr,
  placedOrderMatch,
} from "@/lib/orders/order-payment-status";
import {
  inStoreCurrencyExpr,
  inStoreCurrencyMatch,
} from "@/lib/intl/currency-scope";
import { previousRange, type DashboardRange } from "@/lib/admin/dashboard-period";
import {
  fetchPlausibleStats,
  resolvePlausibleSite,
  type PlausibleSite,
} from "@/lib/analytics/plausible";
import type {
  DashboardStats,
  LatestProduct,
  OrderChartSeries,
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

function addRow(target: ChannelTotals, row: ChannelTotals) {
  target.sales += row.sales;
  target.orders += row.orders;
  target.discount += row.discount;
  target.discountOrders += row.discountOrders;
}

/**
 * One pass over the orders collection, grouped by UTC month and channel.
 *
 * Every order-derived number on the unfiltered page — the all-time chart plus
 * the all-time / this-month / last-month stat cards — is a different sum of these
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

  const { collectedOnly, discountedOrderExpr } = await buildOrderSumExprs();

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
        discountOrders: { $sum: { $cond: [discountedOrderExpr, 1, 0] } },
      },
    },
  ]);
});

/**
 * The expressions every order-derived dashboard sum is built from, so the
 * all-time/monthly scan and the ranged one cannot drift apart on what counts.
 *
 * Two different questions off one scan, and they take different rows:
 * an order somebody placed is counted even while its cash is still to come
 * (COD, a pay-later pre-order), but the MONEY columns only add up what was
 * actually collected. Before this split, a shopper who reached Razorpay and
 * closed the tab added their basket to this store's sales.
 *
 * And only money held in the store's own currency, for the same reason the
 * payments overview reads it that way: these cards are printed with one
 * symbol, so adding a rupee order into them reported those rupees as
 * dollars. The COUNTS stay whole — an order is an order whatever it was
 * priced in — which is why this is a condition inside the sums rather than a
 * filter on the scan. Trade in another currency is reported by Finance, in
 * that currency.
 */
async function buildOrderSumExprs(knownStoreCurrency?: string) {
  const storeCurrency =
    knownStoreCurrency ?? ((await getSettings()).general?.defaultCurrency || "USD");
  const collected = collectedOrderExpr();
  const collectedOnly = (value: Record<string, unknown>) => ({
    $cond: [
      { $and: [collected, inStoreCurrencyExpr(storeCurrency)] },
      value,
      0,
    ],
  });
  const discountedOrderExpr = {
    $and: [collected, inStoreCurrencyExpr(storeCurrency), { $gt: ["$discount", 0] }],
  };
  return { collectedOnly, discountedOrderExpr };
}

/**
 * The money collected on orders placed in each window, by the cards' own
 * rule (`buildOrderSumExprs`: placed, not cancelled, collected, in the store's
 * currency) — what the "In-store sales" and "Website sales" cards add up to
 * for that period. The business app's Home reads today and this month with
 * the dashboard's own periods (`resolveNamedPeriod`), so its figures are the
 * dashboard's.
 *
 * One scan from the earliest window's start to the latest one's end, indexed
 * by `createdAt`. `scopeMatch` narrows it to a staff member's orders; it goes
 * into an aggregation, so cast it first (`staffOrderScopeMatch`). A caller
 * that already knows the store's currency passes it and saves the settings
 * read the scan would otherwise wait for.
 */
export async function getCollectedSales(
  ranges: readonly DashboardRange[],
  scopeMatch: Record<string, unknown> = {},
  storeCurrency?: string,
): Promise<number[]> {
  if (ranges.length === 0) return [];
  await connectDB();
  const { collectedOnly } = await buildOrderSumExprs(storeCurrency);
  const from = new Date(Math.min(...ranges.map((range) => range.from.getTime())));
  const to = new Date(Math.max(...ranges.map((range) => range.to.getTime())));

  const sums: Record<string, unknown> = {};
  ranges.forEach((range, index) => {
    sums[`w${index}`] = {
      $sum: {
        $cond: [
          {
            $and: [
              { $gte: ["$createdAt", range.from] },
              { $lte: ["$createdAt", range.to] },
            ],
          },
          collectedOnly({ $ifNull: ["$total", 0] }),
          0,
        ],
      },
    };
  });

  const [row] = await Order.aggregate<Record<string, number>>([
    {
      $match: {
        ...placedOrderMatch(),
        status: { $ne: "cancelled" },
        createdAt: { $gte: from, $lte: to },
      },
    },
    ...(Object.keys(scopeMatch).length > 0 ? [{ $match: scopeMatch }] : []),
    { $group: { _id: null, ...sums } },
  ]);
  return ranges.map((_range, index) => Number(row?.[`w${index}`] ?? 0));
}

type QueryUnit = ReturnType<typeof queryUnitFor>;

interface RangedBucketRow {
  _id: {
    /** `$dateToString` key at `unit` resolution. */
    bucket: string;
    pos: boolean;
    /** In the selected range, as opposed to the window before it. */
    current: boolean;
  };
  orders: number;
  sales: number;
  discount: number;
  discountOrders: number;
}

/**
 * One scan of the selected range AND the window before it, grouped by time
 * bucket, channel and window — the filtered dashboard's counterpart of
 * `loadOrderMetrics`.
 *
 * The cards fold it by channel and window (the previous window feeds the trend
 * badges); the chart folds the current window by bucket. Both sit in separate
 * Suspense boundaries, so this is memoised per request on primitive arguments —
 * React's `cache()` compares by identity, and two `Date`s never match — and the
 * two boundaries share one query. Bounded by `createdAt`, which the orders
 * collection indexes.
 */
const loadRangedOrderRowsCached = cache(
  async (
    fromMs: number,
    toMs: number,
    previousFromMs: number,
    unit: QueryUnit,
  ): Promise<RangedBucketRow[]> => {
    await connectDB();
    const { collectedOnly, discountedOrderExpr } = await buildOrderSumExprs();

    return Order.aggregate<RangedBucketRow>([
      {
        $match: {
          ...placedOrderMatch(),
          status: { $ne: "cancelled" },
          createdAt: { $gte: new Date(previousFromMs), $lte: new Date(toMs) },
        },
      },
      {
        $group: {
          _id: {
            bucket: {
              $dateToString: {
                format: BUCKET_KEY_FORMAT[unit],
                date: "$createdAt",
                timezone: "UTC",
              },
            },
            pos: { $eq: ["$channel", "pos"] },
            // Part of the key, not inferred from the bucket: a month bucket can
            // straddle the range start, half in each window.
            current: { $gte: ["$createdAt", new Date(fromMs)] },
          },
          orders: { $sum: 1 },
          sales: { $sum: collectedOnly({ $ifNull: ["$total", 0] }) },
          discount: { $sum: collectedOnly({ $ifNull: ["$discount", 0] }) },
          discountOrders: { $sum: { $cond: [discountedOrderExpr, 1, 0] } },
        },
      },
    ]);
  },
);

function loadRangedOrderRows(range: DashboardRange) {
  const unit = queryUnitFor(granularityForRange(range));
  return loadRangedOrderRowsCached(
    range.from.getTime(),
    range.to.getTime(),
    previousRange(range).from.getTime(),
    unit,
  ).then((rows) => ({ rows, unit }));
}

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

/**
 * The orders chart for the dashboard's selected period.
 *
 * With a range it is bucketed to suit the range (hours for a day, days for a
 * month, …) off the same rows as the cards. Without one ("All time") it covers
 * every month since the first order — matching the all-time cards beside it —
 * folded from the monthly scan the cards already ran, so it costs no query.
 */
export async function getOrderChartSeries(
  range: DashboardRange | null,
): Promise<OrderChartSeries> {
  if (range) {
    const { rows, unit } = await loadRangedOrderRows(range);
    return buildChartSeries(
      rows
        .filter((row) => row._id.current)
        .map((row) => ({
          start: parseBucketKey(row._id.bucket, unit),
          pos: row._id.pos,
          orders: row.orders,
          sales: row.sales,
        })),
      range,
      granularityForRange(range),
    );
  }

  const rows = await loadOrderMetrics();
  return buildAllTimeChartSeries(
    rows.map((row) => ({
      start: new Date(Date.UTC(row._id.year, row._id.month - 1, 1)),
      pos: row._id.pos,
      orders: row.orders,
      sales: row.sales,
    })),
    new Date(),
  );
}


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
    channel?: string;
    staffId?: string;
    customerId?: unknown;
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
        // With the customer, how a walk-in POS sale is told.
        channel: 1,
        staffId: 1,
        customerId: 1,
      },
    },
  ]);

  return rows.map((row) => ({
    _id: String(row._id),
    orderNumber: row.orderNumber || "",
    // A walk-in POS sale is filed under its cashier: no name, and a flag the
    // card turns into its own label.
    ...(isPosWalkIn(row)
      ? { walkIn: true }
      : { customerName: row.customerName || undefined }),
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

async function fetchPlausibleVisitorsTimeseries(
  site: PlausibleSite,
  range: UtcDateRange,
): Promise<PlausibleTimeseriesResult[]> {
  const dateRange = `${toUtcDateString(range.from)},${toUtcDateString(range.to)}`;
  const response = await fetchPlausibleStats(
    site,
    "timeseries",
    `period=custom&date=${dateRange}&metrics=visitors,pageviews`,
    // Served from Next's Data Cache: the same store-wide numbers are reused by
    // every admin for the window instead of one upstream call per page view.
    { next: { revalidate: VISITORS_REVALIDATE_SECONDS } },
  );

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
      const site = resolvePlausibleSite(settings.analytics);

      if (!site) {
        return {
          configured: false,
          currentTotal: 0,
          previousTotal: 0,
          data: [],
        };
      }

      const currentRange = getCurrentMonthToDateRangeUTC(new Date());
      const previousRange = getPreviousMonthComparableRangeUTC(currentRange);

      const [currentSeries, previousSeries] = await Promise.all([
        fetchPlausibleVisitorsTimeseries(site, currentRange),
        fetchPlausibleVisitorsTimeseries(site, previousRange),
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

/** Refunds sent inside the range, and inside the window before it. Same rules as `loadRefundTotals`. */
async function loadRefundTotalsInRange(
  range: DashboardRange,
  previous: DashboardRange,
): Promise<RefundTotals> {
  const refundAmount = { $ifNull: ["$grossAmount", 0] };
  const settings = await getSettings();
  const storeCurrency = settings.general?.defaultCurrency || "USD";
  const inRange = { $gte: ["$createdAt", range.from] };

  const [row] = await PaymentTransaction.aggregate<RefundTotals>([
    {
      $match: {
        $and: [
          { type: "refund", status: "succeeded" },
          inStoreCurrencyMatch(storeCurrency),
          { createdAt: { $gte: previous.from, $lte: range.to } },
        ],
      },
    },
    {
      $group: {
        _id: null,
        amount: { $sum: { $cond: [inRange, refundAmount, 0] } },
        cases: { $sum: { $cond: [inRange, 1, 0] } },
        previousAmount: { $sum: { $cond: [inRange, 0, refundAmount] } },
      },
    },
  ]);

  const amount = row?.amount ?? 0;
  return {
    amount,
    cases: row?.cases ?? 0,
    currentAmount: amount,
    previousAmount: row?.previousAmount ?? 0,
  };
}

/**
 * Customers as of the range's end, with how many of them joined inside it and
 * inside the window before it. The total keeps the card meaning "customers the
 * store has", not "customers who happened to sign up today".
 */
async function loadCustomerCountsInRange(
  range: DashboardRange,
  previous: DashboardRange,
): Promise<CustomerCounts> {
  const [row] = await User.aggregate<CustomerCounts>([
    {
      $match: {
        roles: USER_ROLES.CUSTOMER,
        createdAt: { $lte: range.to },
      },
    },
    { $project: { _id: 0, createdAt: 1 } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        currentMonth: {
          $sum: { $cond: [{ $gte: ["$createdAt", range.from] }, 1, 0] },
        },
        previousMonth: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $gte: ["$createdAt", previous.from] },
                  { $lte: ["$createdAt", previous.to] },
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


/**
 * Every card restricted to `range`, each trend measured against the window of
 * equal length before it. Same shape as the unfiltered stats so the cards need
 * no second code path.
 */
async function getRangedDashboardStats(
  range: DashboardRange,
): Promise<DashboardStats> {
  const previous = previousRange(range);

  const [{ rows: orderRows }, refunds, customers] = await Promise.all([
    loadRangedOrderRows(range),
    loadRefundTotalsInRange(range, previous),
    loadCustomerCountsInRange(range, previous),
  ]);

  // The same rows the chart draws, folded by channel and window.
  const inStore = { current: emptyTotals(), previous: emptyTotals() };
  const online = { current: emptyTotals(), previous: emptyTotals() };
  for (const row of orderRows) {
    const channel = row._id.pos ? inStore : online;
    addRow(row._id.current ? channel.current : channel.previous, row);
  }
  const orders = inStore.current.orders + online.current.orders;

  return {
    inStoreSales: {
      amount: inStore.current.sales,
      count: inStore.current.orders,
      ...buildTrend(inStore.current.sales, inStore.previous.sales),
    },
    websiteSales: {
      amount: online.current.sales,
      count: online.current.orders,
      ...buildTrend(online.current.sales, online.previous.sales),
    },
    totalOrders: {
      amount: orders,
      count: orders,
      ...buildTrend(
        orders,
        inStore.previous.orders + online.previous.orders,
      ),
    },
    discount: {
      amount: inStore.current.discount + online.current.discount,
      count: inStore.current.discountOrders + online.current.discountOrders,
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
}

/**
 * The stat cards. With no `range` they keep their original meaning — all-time
 * totals with month-on-month trends; with one, every card is scoped to it.
 */
export const getDashboardStats = cache(
  async (range: DashboardRange | null = null): Promise<DashboardStats> => {
  await connectDB();

  if (range) return getRangedDashboardStats(range);

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
  },
);
