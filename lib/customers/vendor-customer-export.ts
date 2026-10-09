import type { NextRequest } from "next/server";
import type { Types } from "mongoose";
import { audit, type AuditContext } from "@/lib/audit";
import { csvFileResponse, csvLine, datedCsvFilename } from "@/lib/catalog/csv";
import { CustomerListQuerySchema } from "@/lib/validations/list-query";
import { parsePageQuery } from "@/lib/api/validate";
import { customerListQueryParams } from "@/lib/customers/customer-list-query";
import { fetchVendorCustomerList } from "@/lib/customers/customer-list";

/**
 * The vendor Customers page's CSV export.
 *
 * The file is the table's current view — the same search, tab, filters and
 * sort — but not its current page: a seller's customers exported ten at a time
 * is not an export. The rows come from `fetchVendorCustomerList`, the query the
 * page itself reads, so the file can never carry more than the screen does:
 * the figures are the seller's own, and there is no tag, note or loyalty column
 * to carry — the platform's CRM is not the seller's to take away.
 */

/** Only keeps one request from reading a whole collection. */
export const MAX_EXPORT_ROWS = 5000;

/** How much of a search an Activity Log row keeps. */
const MAX_FILTER_LENGTH = 60;

/** The filters a row of the Activity Log names, as the page's URL spells them. */
type ExportFilters = Partial<
  Record<"search" | "status" | "subscription" | "tag", string>
>;

export const VENDOR_CUSTOMER_CSV_HEADERS = [
  "Name",
  "Email",
  "Account",
  "Email subscription",
  "Orders",
  "Total spent",
  "Last order",
] as const;

const ACCOUNT_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  banned: "Banned",
  guest: "Guest",
};

const SUBSCRIPTION_LABELS: Record<string, string> = {
  subscribed: "Subscribed",
  pending: "Pending",
  unsubscribed: "Unsubscribed",
  not_subscribed: "Not subscribed",
  invalid: "Invalid",
  redacted: "Redacted",
};

interface VendorCustomerExportRow {
  isGuest?: boolean;
  name?: string;
  email?: string;
  user?: { name?: string; email?: string; status?: string } | null;
  emailMarketing?: { state?: string } | null;
  stats?: {
    totalOrders?: number;
    totalSpent?: number;
    lastOrderDate?: Date | string | null;
  } | null;
}

function iso(value: unknown) {
  if (!value) return "";
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * The file's lines, header first. Total spent is a bare number, so a
 * spreadsheet can add the column up; the date is ISO, which sorts as text and
 * reads the same in every locale. Name and email are read as the table reads
 * them — the account's, then a guest's own.
 */
export function vendorCustomerCsvLines(rows: VendorCustomerExportRow[]): string[] {
  return [
    csvLine([...VENDOR_CUSTOMER_CSV_HEADERS]),
    ...rows.map((row) => {
      const account = row.isGuest ? "guest" : row.user?.status || "active";
      const subscription = row.emailMarketing?.state || "not_subscribed";
      return csvLine([
        row.user?.name || row.name || "Unknown",
        row.user?.email || row.email,
        ACCOUNT_LABELS[account] ?? account,
        SUBSCRIPTION_LABELS[subscription] ?? subscription.replace(/_/g, " "),
        row.stats?.totalOrders ?? 0,
        row.stats?.totalSpent ?? 0,
        iso(row.stats?.lastOrderDate),
      ]);
    }),
  ];
}

/**
 * The download for a request's filters, with how many customers it holds and
 * what narrowed it, which the caller records in the Activity Log. `truncated`
 * is true when more customers matched than one file carries.
 *
 * The seller comes from the session, never the query, so the file is always
 * their own.
 */
export async function buildVendorCustomerExport(
  request: NextRequest,
  vendorId: Types.ObjectId | string,
) {
  const { searchParams } = request.nextUrl;
  const query = parsePageQuery(
    customerListQueryParams(Object.fromEntries(searchParams)),
    CustomerListQuerySchema,
  );

  const list = await fetchVendorCustomerList(vendorId, {
    page: 1,
    limit: MAX_EXPORT_ROWS,
    search: query.search,
    status: query.status,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    subscription: query.emailSubscription,
    tag: query.tag,
  });
  const items = list.items as VendorCustomerExportRow[];
  const truncated = list.total > items.length;

  const response = csvFileResponse(
    datedCsvFilename("vendor-customers"),
    vendorCustomerCsvLines(items),
  );
  if (truncated) response.headers.set("X-Export-Truncated", String(items.length));

  const filters: ExportFilters = {
    search: searchParams.get("search") || undefined,
    status: query.status,
    subscription: query.emailSubscription,
    tag: query.tag,
  };
  return { rowCount: items.length, truncated, filters, response };
}

/**
 * A seller's customers — their names and emails — leaving as a CSV file. The
 * row is the only record that a copy was taken, and by whom, so it says how
 * many customers the file holds and what narrowed it, never the customers
 * themselves.
 */
export function auditVendorCustomersExported(
  context: AuditContext,
  details: { rowCount: number; truncated?: boolean; filters: ExportFilters },
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
    resource: "user",
    changes: {
      summary: `Exported ${details.rowCount} ${
        details.rowCount === 1 ? "customer" : "customers"
      } to CSV${narrowedBy.length > 0 ? ` (${narrowedBy.join(", ")})` : ""}${
        details.truncated ? " — the first of more" : ""
      }`,
    },
    metadata: {
      kind: "vendor_customer_export",
      format: "csv",
      rowCount: details.rowCount,
      truncated: Boolean(details.truncated),
      filters,
    },
  });
}
