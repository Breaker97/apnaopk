import { InventoryDataTable } from "@/components/admin/inventory-data-table";
import { serializeRows } from "@/lib/api/list-query";
import {
  fetchInventoryList,
  INVENTORY_DEFAULT_PAGE_SIZE,
  type InventoryListResult,
} from "@/lib/inventory/inventory-list";
import { fetchVendorInventoryList } from "@/lib/vendors/vendor-inventory-list";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

type SearchParams = { [key: string]: string | string[] | undefined };

interface InventoryTableSectionProps {
  locale: string;
  searchParams: SearchParams;
  readOnly?: boolean;
  title?: string;
  /** Endpoint the table's inline stock edits PATCH to. */
  apiEndpoint?: string;
  productHrefBase?: string;
  /**
   * Vendor id for the vendor dashboard. Present means "this vendor's stock
   * only", read through the vendor query; absent means the store-wide admin
   * query, narrowed by `staffScope` when the viewer is staff.
   */
  vendorId?: string;
  staffScope?: StaffAccessScope | null;
}

/**
 * Server half of the inventory table, shared by the admin, staff and vendor
 * dashboards. Each of them differs only in which query answers it and which
 * endpoint its inline edits write to.
 */
export async function InventoryTableSection({
  locale,
  searchParams,
  readOnly,
  title,
  apiEndpoint,
  productHrefBase,
  vendorId,
  staffScope,
}: InventoryTableSectionProps) {
  // Rebuilt as URLSearchParams so the page reads the query string through the
  // very same parser the API route uses.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  if (!params.get("limit")) {
    params.set("limit", String(INVENTORY_DEFAULT_PAGE_SIZE));
  }

  const list: InventoryListResult = vendorId
    ? await fetchVendorInventoryList(params, vendorId)
    : await fetchInventoryList(params, staffScope);

  return (
    <InventoryDataTable
      locale={locale}
      readOnly={readOnly}
      title={title}
      apiEndpoint={apiEndpoint}
      productHrefBase={productHrefBase}
      data={serializeRows(list.items)}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
      locations={list.locations}
    />
  );
}
