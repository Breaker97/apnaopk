import { Suspense } from "react";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { OrdersDataTable } from "@/components/admin/orders-data-table";
import { OrdersStatsStrip } from "@/components/admin/orders-stats-strip";
import { OrdersTableSkeleton } from "@/components/admin/orders-list-skeleton";
import { fetchAdminOrderList } from "@/lib/orders/order-list";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

type SearchParams = { [key: string]: string | string[] | undefined };

interface OrdersListViewProps {
  locale: string;
  area: "admin" | "staff";
  readOnly?: boolean;
  staffScope?: StaffAccessScope | null;
  searchParams: SearchParams;
}

const ORDERS_DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/**
 * The orders list route, shared by the admin and staff areas.
 *
 * The query string is the whole state of this screen: the table navigates
 * instead of fetching (see `hooks/use-list-navigation.ts`), which re-runs this
 * component with the new params. Neither half is awaited by the page, so the
 * shell reaches the browser as soon as the access check clears and the table
 * and the stats strip stream in independently as their queries land.
 */
export function OrdersListView({
  locale,
  area,
  readOnly,
  staffScope,
  searchParams,
}: OrdersListViewProps) {
  const query = parseOrderListParams(searchParams);

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <OrdersStatsStrip locale={locale} staffScope={staffScope} />
      </Suspense>

      {/* Deliberately unkeyed. A keyed boundary would count every param change
          as a new boundary, unmount the table, and take its row selection and
          open dialogs with it. Unkeyed, React holds the current table on screen
          while the transition resolves, and the table draws its own inline
          skeleton rows under a static toolbar from `isLoading`. */}
      <Suspense fallback={<OrdersTableSkeleton />}>
        <OrdersTable
          locale={locale}
          area={area}
          readOnly={readOnly}
          staffScope={staffScope}
          query={query}
        />
      </Suspense>
    </div>
  );
}

type OrderListParams = ReturnType<typeof parseOrderListParams>;

function parseOrderListParams(searchParams: SearchParams) {
  const read = (key: string) =>
    typeof searchParams[key] === "string"
      ? (searchParams[key] as string)
      : undefined;

  const page = Number.parseInt(read("page") ?? "", 10);
  const limit = Number.parseInt(read("limit") ?? "", 10);

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit:
      Number.isFinite(limit) && limit > 0
        ? Math.min(limit, MAX_PAGE_SIZE)
        : ORDERS_DEFAULT_PAGE_SIZE,
    search: read("search"),
    view: read("view") ?? "all",
    status: read("status") ?? "all",
    paymentStatus: read("paymentStatus") ?? "all",
    channel: read("channel") ?? "all",
    sortBy: read("sortBy") ?? "createdAt",
    sortOrder: read("sortOrder") === "asc" ? ("asc" as const) : ("desc" as const),
  };
}

async function OrdersTable({
  locale,
  area,
  readOnly,
  staffScope,
  query,
}: {
  locale: string;
  area: "admin" | "staff";
  readOnly?: boolean;
  staffScope?: StaffAccessScope | null;
  query: OrderListParams;
}) {
  const list = await fetchAdminOrderList(query, staffScope);

  return (
    <OrdersDataTable
      locale={locale}
      area={area}
      readOnly={readOnly}
      data={JSON.parse(JSON.stringify(list.items))}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
    />
  );
}
