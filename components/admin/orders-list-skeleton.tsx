import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";

/**
 * Placeholders for the admin orders list.
 *
 * The counts live here rather than in the route so `loading.tsx` (shown while
 * navigating to the route) and the page's own `<Suspense>` fallback (shown
 * while the order query streams) cannot drift apart and swap one layout for a
 * differently-shaped one mid-load.
 *
 * Mirrors components/admin/orders-data-table.tsx: 5 tabs, 10 columns of which
 * ~8 are visible on a typical admin viewport, no row thumbnail, one "Create
 * order" header button and the Import/Export toolbar pill.
 */

const ORDERS_TABLE_SHAPE = {
  columns: 8,
  tabs: 5,
  thumbnail: false,
  headerActions: 1,
  toolbarAction: true,
} as const;

/** Table card only — the stats strip streams on its own boundary. */
export function OrdersTableSkeleton() {
  return <AdminListSkeleton {...ORDERS_TABLE_SHAPE} stats={0} />;
}

/** Whole route: stats strip + table card. */
export function OrdersListSkeleton() {
  return <AdminListSkeleton {...ORDERS_TABLE_SHAPE} stats={5} />;
}
