import type { Types } from "mongoose";
import { StaffDataTable } from "@/components/admin/staff-data-table";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { AdminListQuerySchema } from "@/lib/validations/list-query";
import { fetchStaffList } from "@/lib/access/staff-list";

type SearchParams = { [key: string]: string | string[] | undefined };

interface StaffTableSectionProps {
  locale: string;
  searchParams: SearchParams;
  area?: "admin" | "vendor";
  /** Present on the vendor dashboard: list only this store's staff. */
  vendorId?: Types.ObjectId | string;
}

/**
 * Server half of the staff table, shared by the admin and vendor dashboards.
 * They see disjoint sets — see `lib/staff-list.ts` — and differ in nothing
 * else.
 */
export async function StaffTableSection({
  locale,
  searchParams,
  area = "admin",
  vendorId,
}: StaffTableSectionProps) {
  // Parsed with the schema the API routes use, so a page and its endpoint can
  // never read one query string two different ways.
  const query = parsePageQuery(searchParams, AdminListQuerySchema);
  const list = await fetchStaffList(query, { vendorId });

  return (
    <StaffDataTable
      locale={locale}
      area={area}
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
