import type { NextRequest } from "next/server";
import { audit, type AuditContext } from "@/lib/audit";
import { csvFileResponse, csvLine, datedCsvFilename } from "@/lib/catalog/csv";
import { abandonedAtOf } from "@/lib/orders/abandoned-checkout-row";
import { fetchAbandonedCheckoutExport } from "@/lib/orders/abandoned-checkout-list";

/**
 * The Abandoned checkouts page's CSV export.
 *
 * The file is the table's current view — the same search, tab, email status and
 * date filter, in the same order — but not its current page: abandoned
 * checkouts exported ten at a time is not an export. The rows come from
 * `fetchAbandonedCheckoutExport`, the query the page itself reads, so the file
 * can never hold a checkout the screen would not show.
 */

/** Only keeps one request from writing an unbounded file. */
export const MAX_EXPORT_ROWS = 5000;

/** How much of a search an Activity Log row keeps. */
const MAX_FILTER_LENGTH = 60;

/** The filters a row of the Activity Log names, as the table's URL spells them. */
const FILTER_PARAMS = ["search", "view", "emailStatus", "date"] as const;

export const ABANDONED_CHECKOUT_CSV_HEADERS = [
  "Abandoned at",
  "Customer",
  "Email",
  "Phone",
  "Products",
  "Items",
  "Total",
  "Email status",
  "Recovery status",
  "Unsubscribed",
] as const;

const EMAIL_STATUS_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  failed: "Failed",
  not_applicable: "No email",
};

const RECOVERY_STATUS_LABELS: Record<string, string> = {
  not_recovered: "Not recovered",
  recovered: "Recovered",
};

interface AbandonedCheckoutExportRow {
  abandonedAt?: Date | string | null;
  checkoutStartedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  customerName?: string;
  email?: string;
  phone?: string;
  items?: Array<{ name?: string; quantity?: number }>;
  itemCount?: number;
  totalPrice?: number;
  subtotalPrice?: number;
  recoveryEmailStatus?: string;
  recoveryStatus?: string;
  unsubscribedAt?: Date | string | null;
}

/**
 * The file's lines, header first. Total is a bare number, so a spreadsheet can
 * add the column up, and the date is ISO, which sorts as text and reads the same
 * in every locale. A shopper who left no name is a guest, as in the table.
 */
export function abandonedCheckoutCsvLines(
  rows: AbandonedCheckoutExportRow[],
): string[] {
  return [
    csvLine([...ABANDONED_CHECKOUT_CSV_HEADERS]),
    ...rows.map((row) => {
      const emailStatus = row.recoveryEmailStatus || "not_sent";
      const recoveryStatus = row.recoveryStatus || "not_recovered";
      return csvLine([
        abandonedAtOf(row)?.toISOString() ?? "",
        row.customerName || "Guest",
        row.email,
        row.phone,
        (row.items ?? [])
          .map((item) => item.name)
          .filter(Boolean)
          .join("; "),
        row.itemCount ??
          (row.items ?? []).reduce((sum, item) => sum + (item.quantity || 0), 0),
        row.totalPrice || row.subtotalPrice || 0,
        EMAIL_STATUS_LABELS[emailStatus] ?? emailStatus.replace(/_/g, " "),
        RECOVERY_STATUS_LABELS[recoveryStatus] ?? recoveryStatus.replace(/_/g, " "),
        row.unsubscribedAt ? "Yes" : "",
      ]);
    }),
  ];
}

/**
 * The download for a request's filters, with how many checkouts it holds and
 * what narrowed it, which the caller records in the Activity Log. `truncated`
 * is true when more checkouts matched than one file carries.
 */
export async function buildAbandonedCheckoutExport(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const { rows, total } = await fetchAbandonedCheckoutExport(
    searchParams,
    MAX_EXPORT_ROWS,
  );
  const truncated = total > rows.length;

  const response = csvFileResponse(
    datedCsvFilename("abandoned-checkouts"),
    abandonedCheckoutCsvLines(rows as AbandonedCheckoutExportRow[]),
  );
  if (truncated) response.headers.set("X-Export-Truncated", String(rows.length));

  return {
    rowCount: rows.length,
    truncated,
    filters: Object.fromEntries(
      FILTER_PARAMS.map((name) => [name, searchParams.get(name) || undefined]),
    ) as Partial<Record<(typeof FILTER_PARAMS)[number], string>>,
    response,
  };
}

/**
 * Shoppers' names, emails and phone numbers leaving as a CSV file. The row is
 * the only record that a copy was taken, and by whom, so it says how many
 * checkouts the file holds and what narrowed it, never the shoppers themselves.
 */
export function auditAbandonedCheckoutsExported(
  context: AuditContext,
  details: {
    rowCount: number;
    truncated?: boolean;
    filters: Partial<Record<(typeof FILTER_PARAMS)[number], string>>;
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
    // There is no resource of their own; a checkout is an order that has not
    // been paid for yet, and `metadata.list` says which list the file was.
    resource: "order",
    changes: {
      summary: `Exported ${details.rowCount} abandoned ${
        details.rowCount === 1 ? "checkout" : "checkouts"
      } to CSV${narrowedBy.length > 0 ? ` (${narrowedBy.join(", ")})` : ""}${
        details.truncated ? " — the first of more" : ""
      }`,
    },
    metadata: {
      format: "csv",
      list: "abandonedCheckouts",
      rowCount: details.rowCount,
      truncated: Boolean(details.truncated),
      filters,
    },
  });
}
