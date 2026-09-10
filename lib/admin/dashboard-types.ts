/**
 * Shapes exchanged between the dashboard's server loaders
 * (`lib/admin/dashboard-data.ts`) and its client sections. Kept in a
 * runtime-free module so the client components never pull the Mongoose-backed
 * loader into their bundle graph.
 */

export interface RecentOrder {
  _id: string;
  orderNumber: string;
  customerName?: string;
  total: number;
  status: string;
  paymentMethod?: string;
  /** Sum of every line's quantity, computed in Mongo so the items array stays server-side. */
  itemCount: number;
  primaryItemName?: string;
  primaryItemImage?: string;
}

export interface OrderChartPoint {
  year: number;
  monthIndex: number;
  inStoreOrders: number;
  onlineOrders: number;
  inStoreSales: number;
  onlineSales: number;
}

export interface LatestProduct {
  _id: string;
  name: string;
  price: number;
  image?: string;
}

interface VisitorsChartPoint {
  day: string;
  current: number;
  previous: number;
}

export interface VisitorsChartMetrics {
  configured: boolean;
  currentTotal: number;
  previousTotal: number;
  data: VisitorsChartPoint[];
}

export interface DashboardStatMetric {
  /** Primary value: currency amount for sales/discount/refunds, count for orders/customers. */
  amount: number;
  /** Secondary count shown in the sub-label (orders, cases, or new customers). */
  count: number;
  /** Percent change vs the previous month, or null when there is no trend to show. */
  value: number | null;
  direction: "up" | "down" | "neutral";
}

export interface DashboardStats {
  inStoreSales: DashboardStatMetric;
  websiteSales: DashboardStatMetric;
  totalOrders: DashboardStatMetric;
  discount: DashboardStatMetric;
  refunds: DashboardStatMetric;
  customers: DashboardStatMetric;
}
