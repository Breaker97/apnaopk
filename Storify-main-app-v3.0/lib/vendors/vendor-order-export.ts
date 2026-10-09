import type { NextRequest } from "next/server";
import type { Types } from "mongoose";
import { audit, type AuditContext } from "@/lib/audit";
import { csvFileResponse, csvLine, datedCsvFilename } from "@/lib/catalog/csv";
import { fetchVendorOrderList } from "@/lib/vendors/vendor-order-list";

/**
 * The vendor Orders page's CSV export.
 *
 * The file is the table's current view — the same search, tab, filters and sort
 * — but not its current page: a seller's orders exported ten at a time is not an
 * export. The rows come from `fetchVendorOrderList`, the query the page itself
 * reads, so the file can never carry more than the screen does: this seller's
 * own consignment and payment state, and the same `netSales` the column shows,
 * never another seller's lines or the shopper's billing details.
 */

/** Only keeps one request from reading a whole collection. */
export const MAX_EXPORT_ROWS = 5000;

/** How much of a search an Activity Log row keeps. */
const MAX_FILTER_LENGTH = 60;

export const VENDOR_ORDER_CSV_HEADERS = [
  "Order number",
  "Date",
  "Customer",
  "Email",
  "Payment",
  "Fulfillment",
  "Method",
  "Items",
  "Currency",
  "Net sales",
] as const;

const PAYMENT_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  partially_paid: "Partially paid",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
  expired: "Expired",
};

const FULFILLMENT_LABELS: Record<string, string> = {
  preordered: "Preordered",
  pending: "Pending",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

interface VendorOrderExportRow {
  orderNumber?: string;
  createdAt?: string | Date;
  currency?: string;
  customerId?: { name?: string; email?: string } | null;
  /** A walk-in POS sale: no customer is sent (lib/vendors/vendor-order-view.ts). */
  posWalkIn?: boolean;
  paymentStatus?: string;
  netSales?: number;
  subOrders?: Array<{
    status?: string;
    fulfillment?: { method?: string };
    items?: Array<{ quantity?: number }>;
  }>;
}

function placedAt(createdAt: VendorOrderExportRow["createdAt"]) {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * The file's lines, header first. Net sales is a bare number beside its
 * currency, so a spreadsheet can add a column up; the date is ISO, which sorts
 * as text and reads the same in every locale.
 */
export function vendorOrderCsvLines(orders: VendorOrderExportRow[]): string[] {
  return [
    csvLine([...VENDOR_ORDER_CSV_HEADERS]),
    ...orders.map((order) => {
      const subOrder = order.subOrders?.[0];
      const payment = order.paymentStatus ?? "";
      const fulfillment = subOrder?.status ?? "pending";
      return csvLine([
        order.orderNumber,
        placedAt(order.createdAt),
        // As the table names them: a walk-in sale has no customer, and an order
        // with none on file is a guest's.
        order.posWalkIn ? "Walk-in customer" : order.customerId?.name || "Guest",
        order.posWalkIn ? "" : order.customerId?.email,
        PAYMENT_LABELS[payment] ?? payment,
        FULFILLMENT_LABELS[fulfillment] ?? fulfillment,
        subOrder?.fulfillment?.method === "pickup" ? "Pickup" : "Delivery",
        (subOrder?.items ?? []).reduce((sum, item) => sum + (item.quantity || 0), 0),
        order.currency,
        order.netSales ?? 0,
      ]);
    }),
  ];
}

export interface VendorOrderExportQuery {
  search?: string;
  status?: string;
  paymentStatus?: string;
  view?: string;
  /** A named period or a picked day range; see `lib/date-filter.ts`. */
  date?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * The download for a request's filters, with how many orders it holds and what
 * narrowed it, which the caller records in the Activity Log.
 *
 * `search` is the validated one, regex-escaped for the query; the filters handed
 * back are what the person typed, which is what the log should read. `truncated`
 * is true when more orders matched than one file carries.
 */
export async function buildVendorOrderExport(
  request: NextRequest,
  query: VendorOrderExportQuery,
  vendorId: Types.ObjectId | string,
) {
  const list = await fetchVendorOrderList(
    { ...query, page: 1, limit: MAX_EXPORT_ROWS },
    vendorId,
  );
  const items = list.items as VendorOrderExportRow[];
  const truncated = list.total > items.length;

  const response = csvFileResponse(
    datedCsvFilename("vendor-orders"),
    vendorOrderCsvLines(items),
  );
  if (truncated) response.headers.set("X-Export-Truncated", String(items.length));

  return {
    rowCount: items.length,
    truncated,
    filters: {
      search: request.nextUrl.searchParams.get("search") || undefined,
      status: query.status,
      paymentStatus: query.paymentStatus,
      view: query.view,
      date: query.date,
    },
    response,
  };
}

/**
 * A seller's orders — their customers' names and emails — leaving as a CSV file.
 * The row is the only record that a copy was taken, and by whom, so it says how
 * many orders the file holds and what narrowed it, never the orders themselves.
 */
export function auditVendorOrdersExported(
  context: AuditContext,
  details: {
    rowCount: number;
    truncated?: boolean;
    filters: Pick<
      VendorOrderExportQuery,
      "search" | "status" | "paymentStatus" | "view" | "date"
    >;
  },
) {
  // The search box is free text from a query string: capped, so one row cannot
  // carry a page of it. A tab or select left on "all" narrowed nothing and is
  // not listed.
  const filters = Object.fromEntries(
    Object.entries(details.filters)
      .filter(
        (entry): entry is [string, string] =>
          Boolean(entry[1]) && entry[1] !== "all",
      )
      .map(([key, value]) => [key, value.slice(0, MAX_FILTER_LENGTH)]),
  );
  const narrowedBy = Object.entries(filters).map(
    ([key, value]) => `${key} "${value}"`,
  );

  return audit(context, {
    action: "EXPORT",
    resource: "order",
    changes: {
      summary: `Exported ${details.rowCount} ${
        details.rowCount === 1 ? "order" : "orders"
      } to CSV${narrowedBy.length > 0 ? ` (${narrowedBy.join(", ")})` : ""}${
        details.truncated ? " — the first of more" : ""
      }`,
    },
    metadata: {
      format: "csv",
      rowCount: details.rowCount,
      truncated: Boolean(details.truncated),
      filters,
    },
  });
}
