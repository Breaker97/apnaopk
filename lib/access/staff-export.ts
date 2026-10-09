import type { NextRequest } from "next/server";
import { csvFileResponse, csvLine, datedCsvFilename } from "@/lib/catalog/csv";
import { resolveMemberStatus } from "@/lib/access/staff-member-status";
import { fetchStaffList } from "@/lib/access/staff-list";

/**
 * The Team page's CSV export, shared by the admin and vendor routes.
 *
 * The file is the table's current view — the same search and status tab — but
 * not its current page: a team of thirty exported ten at a time is not an
 * export. The rows come from `fetchStaffList`, so the two dashboards keep the
 * sets they see on screen and a vendor's file can never hold platform staff.
 */

/** A team is dozens of people; this only keeps one request from reading a collection. */
const MAX_EXPORT_ROWS = 5000;

const STATUS_LABELS = {
  active: "Active",
  accessOff: "Access off",
  inactive: "Inactive",
  suspended: "Suspended",
} as const;

interface StaffExportItem {
  name?: string;
  email?: string;
  phone?: string;
  status?: string;
  role?: string;
  isOwner?: boolean;
  createdAt?: string | Date;
  staffProfile?: {
    permissions?: string[];
    department?: string;
    isActive: boolean;
  } | null;
}

function roleLabel(item: StaffExportItem) {
  if (item.isOwner) return "Owner";
  return item.role === "admin" ? "Administrator" : "Staff";
}

function joinedOn(createdAt: StaffExportItem["createdAt"]) {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

/**
 * The file's lines, header first. The vendor dashboard manages staff only, so
 * its file has no Role column, as its table has none.
 *
 * Permissions are the ids, `;`-separated: the table's short labels read "Orders"
 * for both viewing and managing them, and a file is for telling members apart.
 * An administrator holds none and is "Full access", as on the table.
 */
export function staffCsvLines(
  items: StaffExportItem[],
  area: "admin" | "vendor",
): string[] {
  const withRole = area === "admin";
  const header = [
    "Name",
    "Email",
    "Phone",
    ...(withRole ? ["Role"] : []),
    "Status",
    "Department",
    "Permissions",
    "Joined",
  ];

  return [
    csvLine(header),
    ...items.map((item) =>
      csvLine([
        item.name,
        item.email,
        item.phone,
        ...(withRole ? [roleLabel(item)] : []),
        STATUS_LABELS[resolveMemberStatus(item)],
        item.staffProfile?.department,
        item.role === "admin"
          ? "Full access"
          : (item.staffProfile?.permissions ?? []).join("; "),
        joinedOn(item.createdAt),
      ]),
    ),
  ];
}

/**
 * The download for a request's `search` and `status`, with how many members it
 * holds and what narrowed it, which the caller records in the Activity Log.
 *
 * `search` is the validated one, regex-escaped for the query; the filters
 * handed back are what the person typed, which is what the log should read.
 */
export async function buildStaffExport(
  request: NextRequest,
  query: { search?: string },
  area: "admin" | "vendor",
  vendorId?: string | { toString(): string },
) {
  const params = request.nextUrl.searchParams;
  const status = params.get("status") || undefined;
  const list = await fetchStaffList(
    { page: 1, limit: MAX_EXPORT_ROWS, search: query.search, status },
    { vendorId: vendorId ? String(vendorId) : undefined },
  );
  const items = list.items as StaffExportItem[];

  return {
    rowCount: items.length,
    filters: { search: params.get("search") || undefined, status },
    response: csvFileResponse(
      datedCsvFilename("team-members"),
      staffCsvLines(items, area),
    ),
  };
}
