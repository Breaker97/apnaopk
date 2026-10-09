import type { NextRequest } from "next/server";
import { User, VendorPlan } from "@/models";
import { audit, type AuditContext } from "@/lib/audit";
import { csvFileResponse, csvLine, datedCsvFilename } from "@/lib/catalog/csv";
import { fetchAdminVendorList } from "@/lib/vendors/vendor-list";
import {
  VENDOR_EXPORT_ONLY_HEADERS,
  VENDOR_TEMPLATE_COLUMNS,
} from "@/lib/vendors/vendor-import-format";

/**
 * The admin Vendors page's CSV export.
 *
 * The file is the table's current view — the same search, status tab and sort —
 * but not its current page: a marketplace of sixty sellers exported ten at a
 * time is not an export. The rows come from `fetchAdminVendorList`, so the file
 * keeps the page's rules (the store's own house vendor is left out) and its
 * figures (sales aggregated from orders, never the dead `totalSales` column).
 *
 * Its columns are the vendor import's template, so a file exported here
 * imports back unchanged — into this store or a new one — and Status, Sales
 * and Joined follow for whoever reads it; the import passes over them. No bank,
 * payout or document detail is ever written: the import never reads them back.
 */

/** Only keeps one request from reading a whole collection. */
const MAX_EXPORT_ROWS = 5000;

/** How much of a search an Activity Log row keeps. */
const MAX_FILTER_LENGTH = 60;

const VENDOR_STATUS_LABELS: Record<string, string> = {
  approved: "Approved",
  pending: "Pending",
  payment_required: "Payment required",
  suspended: "Suspended",
  rejected: "Rejected",
};

interface VendorExportItem {
  userId?: unknown;
  planId?: unknown;
  storeName?: string;
  slug?: string;
  description?: string;
  logo?: string;
  banner?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  } | null;
  status?: string;
  commission?: number;
  verified?: boolean;
  notes?: string;
  totalSales?: number;
  createdAt?: string | Date;
  user?: { name?: string; email?: string; phone?: string } | null;
}

/** What the list query does not read: owners' phones and plans' slugs, by id. */
export interface VendorExportLookups {
  ownerPhones?: Map<string, string>;
  planSlugs?: Map<string, string>;
}

function joinedOn(createdAt: VendorExportItem["createdAt"]) {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * The file's lines, header first. Commission is the percentage as a bare number
 * and Sales the store-currency total as one, so a spreadsheet can add them up.
 * A store with no stored rate leaves the cell empty: the import reads an empty
 * cell as "the normal rate", where a 0 would be a 0% deal. The plan is written
 * as its slug, which is unique where a name is not.
 */
export function vendorCsvLines(
  items: VendorExportItem[],
  lookups: VendorExportLookups = {},
): string[] {
  return [
    csvLine([
      ...VENDOR_TEMPLATE_COLUMNS.map((column) => column.header),
      ...VENDOR_EXPORT_ONLY_HEADERS,
    ]),
    ...items.map((item) => {
      const address = item.address ?? {};
      const cells: Record<string, unknown> = {
        storeName: item.storeName,
        ownerEmail: item.user?.email,
        ownerName: item.user?.name,
        ownerPhone: item.user?.phone ?? lookups.ownerPhones?.get(String(item.userId ?? "")),
        slug: item.slug,
        description: item.description,
        logoUrl: item.logo,
        bannerUrl: item.banner,
        storePhone: address.phone,
        street: address.street,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
        plan: item.planId ? lookups.planSlugs?.get(String(item.planId)) : "",
        commission: typeof item.commission === "number" ? item.commission : "",
        verified: item.verified ? "yes" : "no",
        notes: item.notes,
      };
      return csvLine([
        ...VENDOR_TEMPLATE_COLUMNS.map((column) => cells[column.field]),
        VENDOR_STATUS_LABELS[item.status ?? ""] ?? item.status,
        item.totalSales ?? 0,
        joinedOn(item.createdAt),
      ]);
    }),
  ];
}

async function readLookups(items: VendorExportItem[]): Promise<VendorExportLookups> {
  const userIds = [...new Set(items.map((item) => item.userId).filter(Boolean).map(String))];
  const planIds = [...new Set(items.map((item) => item.planId).filter(Boolean).map(String))];
  const [owners, plans] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select("phone")
          .lean<Array<{ _id: unknown; phone?: string }>>()
      : [],
    planIds.length
      ? VendorPlan.find({ _id: { $in: planIds } })
          .select("slug")
          .lean<Array<{ _id: unknown; slug?: string }>>()
      : [],
  ]);
  return {
    ownerPhones: new Map(
      owners.filter((owner) => owner.phone).map((owner) => [String(owner._id), String(owner.phone)]),
    ),
    planSlugs: new Map(plans.map((plan) => [String(plan._id), String(plan.slug ?? "")])),
  };
}

/**
 * The download for a request's `search`, `status` and `sortOrder`, with how many
 * vendors it holds and what narrowed it, which the caller records in the
 * Activity Log.
 *
 * `search` is the validated one, regex-escaped for the query; the filters handed
 * back are what the person typed, which is what the log should read.
 */
export async function buildVendorExport(
  request: NextRequest,
  query: { search?: string; status?: string; sortOrder?: "asc" | "desc" },
) {
  const list = await fetchAdminVendorList({
    page: 1,
    limit: MAX_EXPORT_ROWS,
    search: query.search,
    status: query.status,
    sortOrder: query.sortOrder,
  });
  const items = list.items as VendorExportItem[];
  const params = request.nextUrl.searchParams;
  const lookups = await readLookups(items);

  return {
    rowCount: items.length,
    filters: {
      search: params.get("search") || undefined,
      status: query.status,
    },
    response: csvFileResponse(datedCsvFilename("vendors"), vendorCsvLines(items, lookups)),
  };
}

/**
 * The marketplace's sellers — their store names, owners' emails, commission and
 * sales — leaving as a CSV file. The row is the only record that a copy was
 * taken, and by whom, so it says how many vendors the file holds and what
 * narrowed it, never the vendors themselves.
 */
export function auditVendorsExported(
  context: AuditContext,
  details: {
    rowCount: number;
    filters: { search?: string; status?: string };
  },
) {
  // The search box is free text from a query string: capped, so one row cannot
  // carry a page of it. A tab left on "all" narrowed nothing and is not listed.
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
    resource: "vendor",
    changes: {
      summary: `Exported ${details.rowCount} ${
        details.rowCount === 1 ? "vendor" : "vendors"
      } to CSV${narrowedBy.length > 0 ? ` (${narrowedBy.join(", ")})` : ""}`,
    },
    metadata: { format: "csv", rowCount: details.rowCount, filters },
  });
}
