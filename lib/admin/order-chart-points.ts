import type { OrderChartPoint } from "@/lib/admin/dashboard-types";

const ORDER_CHART_MONTHS = 12;

/** One UTC month of one sales channel, as the dashboards' `$group` emits it. */
interface OrderChartRow {
  year: number;
  /** 1-based, as Mongo's `$month` returns it. */
  month: number;
  pos: boolean;
  orders: number;
  sales: number;
}

/**
 * The trailing twelve UTC months ending with `now`'s, orders and sales split by
 * sales channel. Months with no orders stay in the series as zeros, and rows
 * outside the window are dropped.
 *
 * Shared by the admin and vendor dashboards so both charts bucket a month the
 * same way; the vendor chart used to carry its own copy, which had drifted to
 * counting days with orders instead of orders.
 */
export function buildOrderChartPoints(
  rows: Iterable<OrderChartRow>,
  now: Date,
): OrderChartPoint[] {
  const points: OrderChartPoint[] = Array.from(
    { length: ORDER_CHART_MONTHS },
    (_, index) => {
      const date = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() - (ORDER_CHART_MONTHS - 1) + index,
          1,
        ),
      );

      return {
        year: date.getUTCFullYear(),
        monthIndex: date.getUTCMonth(),
        inStoreOrders: 0,
        onlineOrders: 0,
        inStoreSales: 0,
        onlineSales: 0,
      };
    },
  );

  const pointByKey = new Map(
    points.map((point) => [`${point.year}-${point.monthIndex + 1}`, point]),
  );

  for (const row of rows) {
    const point = pointByKey.get(`${row.year}-${row.month}`);
    if (!point) continue;

    if (row.pos) {
      point.inStoreOrders += row.orders;
      point.inStoreSales += row.sales;
    } else {
      point.onlineOrders += row.orders;
      point.onlineSales += row.sales;
    }
  }

  return points;
}
