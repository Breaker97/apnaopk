import type { Types } from "mongoose";
import { DiscountsContent } from "@/components/admin/discounts-content";
import { parsePageQuery } from "@/lib/api/validate";
import { serializeRows } from "@/lib/api/list-query";
import { AdminListQuerySchema } from "@/lib/validations/list-query";
import { fetchCouponList } from "@/lib/catalog/coupon-list";

type SearchParams = { [key: string]: string | string[] | undefined };

interface DiscountsTableSectionProps {
  locale: string;
  searchParams: SearchParams;
  /** Endpoint the table's mutations write to. */
  apiBasePath?: string;
  /** Present on the vendor dashboard: list only this seller's discounts. */
  vendorId?: Types.ObjectId | string;
}

/**
 * Server half of the discounts table, shared by the admin and vendor
 * dashboards. They differ only in scope and in which endpoint their mutations
 * write to.
 */
export async function DiscountsTableSection({
  locale,
  searchParams,
  apiBasePath,
  vendorId,
}: DiscountsTableSectionProps) {
  // Parsed with the schema the API routes use, so a page and its endpoint can
  // never read one query string two different ways.
  const query = parsePageQuery(searchParams, AdminListQuerySchema);
  const list = await fetchCouponList(query, { vendorId });

  return (
    <DiscountsContent
      locale={locale}
      apiBasePath={apiBasePath}
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
