import type { OrderChartPoint } from "@/lib/admin/dashboard-types";

/**
 * Shapes exchanged between `GET /api/vendor/analytics` and the vendor
 * dashboard. Kept in a runtime-free module so the client component never pulls
 * the Mongoose-backed loader (`lib/vendors/vendor-order-metrics.ts`) into its
 * bundle graph.
 */

/**
 * The vendor's order counters and money, defined once for the dashboard cards
 * and the orders page's stats strip so the two cannot disagree.
 */
export interface VendorOrderTotals {
  /** Every order holding this vendor's consignment, cancelled ones included — the list's "All" tab. */
  totalOrders: number;
  /** Consignments on the list's "Open" tab: pending, processing or shipped. */
  openOrders: number;
  /** Live consignments whose payment has been collected. */
  paidOrders: number;
  /** Gross value (before commission) of the paid consignments. */
  totalRevenue: number;
  /** The vendor's share of `totalRevenue`, after commission. */
  netEarnings: number;
  /** Gross value of live consignments still waiting to be paid — the "Unpaid" tab. */
  awaitingPayment: number;
}

/** One card in the dashboard's recent orders, read from the vendor's own consignment. */
export interface VendorRecentOrder {
  _id: string;
  orderNumber: string;
  customerName?: string;
  paymentMethod?: string;
  /** The consignment's status — the list's Fulfillment column. */
  status: string;
  /** Set when the consignment is collected in person; shown in place of `status`, as the list does. */
  pickupStatus?: string;
  /** Units on this vendor's lines only. */
  itemCount: number;
  primaryItemName?: string;
  primaryItemImage?: string;
  /** The vendor's earnings on this consignment — the list's "Net sales" column. */
  netSales: number;
}

export interface VendorDashboardData {
  stats: VendorOrderTotals & { activeProducts: number };
  chart: OrderChartPoint[];
  recentOrders: VendorRecentOrder[];
}
