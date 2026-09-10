import type { Types } from "mongoose";
import { PreordersDataTable } from "@/components/admin/preorders-data-table";
import { serializeRows } from "@/lib/api/list-query";
import { sanitizeSearchString } from "@/lib/api/validate";
import { fetchPreorderList } from "@/lib/orders/preorder-list";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

type SearchParams = { [key: string]: string | string[] | undefined };

interface PreordersTableSectionProps {
  locale: string;
  searchParams: SearchParams;
  scope?: "admin" | "vendor";
  canEditPreorder?: boolean;
  canCancelPreorder?: boolean;
  /** Present on the vendor dashboard: only orders containing its items. */
  vendorId?: Types.ObjectId | string;
  staffScope?: StaffAccessScope | null;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Server half of the pre-orders table, shared by the admin and vendor
 * dashboards.
 *
 * The table's single status control produces either a real pre-order status
 * or one of the release-date views ("due_soon"/"overdue"), so the value is
 * split back out here the way the API route does.
 */
export async function PreordersTableSection({
  locale,
  searchParams,
  scope = "admin",
  canEditPreorder,
  canCancelPreorder,
  vendorId,
  staffScope,
}: PreordersTableSectionProps) {
  const read = (key: string) =>
    typeof searchParams[key] === "string"
      ? (searchParams[key] as string)
      : undefined;

  const parsedPage = Number.parseInt(read("page") ?? "", 10);
  const parsedLimit = Number.parseInt(read("limit") ?? "", 10);
  const selected = read("status") ?? "all";
  const isView = selected === "due_soon" || selected === "overdue";

  const list = await fetchPreorderList(
    {
      page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
      limit:
        Number.isFinite(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, 100)
          : DEFAULT_PAGE_SIZE,
      search: sanitizeSearchString((read("search") ?? "").trim()) || undefined,
      status: isView ? "all" : selected,
      view: isView ? selected : "all",
    },
    { vendorId, staffScope },
  );

  return (
    <PreordersDataTable
      locale={locale}
      scope={scope}
      canEditPreorder={canEditPreorder}
      canCancelPreorder={canCancelPreorder}
      data={serializeRows(list.items)}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
    />
  );
}
