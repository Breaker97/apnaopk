import { Suspense } from "react";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { ActivityLogDataTable } from "@/components/admin/activity-log/activity-log-data-table";
import { parsePageQuery } from "@/lib/api/validate";
import {
  fetchActivityLogList,
  fetchVendorLogActors,
} from "@/lib/activity-log/list";
import { pageSizeFromParams } from "@/lib/activity-log/page-size";
import { ActivityLogQuerySchema } from "@/lib/activity-log/query";
import { fetchActivityLogVendorOptions } from "@/lib/activity-log/vendor-options";
import {
  VendorActivityLogQuerySchema,
  toVendorListQuery,
} from "@/lib/activity-log/vendor-query";

type SearchParams = { [key: string]: string | string[] | undefined };

/** Who a vendor's list is for. Resolved by the page from the session, never from the URL. */
export interface VendorLogViewer {
  vendorId: string;
  ownerUserId: string;
  /** Holds `view_staff`: the "Staff activity" tab exists, and only then. */
  canViewStaff: boolean;
}

type ActivityLogListViewProps =
  | { area: "admin"; searchParams: SearchParams }
  | { area: "vendor"; searchParams: SearchParams; viewer: VendorLogViewer };

/**
 * The Activity Log's list route, for the admin and for a vendor's own team.
 *
 * The query string is the whole state of the screen: the table navigates instead
 * of fetching, which re-runs this with the new params. The page does not await
 * it, so the shell reaches the browser as soon as the access check clears and the
 * rows stream in. The boundary is deliberately unkeyed, as Orders' is: a keyed
 * one would unmount the table, and its open detail sheet, on every filter change.
 */
export function ActivityLogListView(props: ActivityLogListViewProps) {
  const staffTab = props.area === "vendor" && props.viewer.canViewStaff;

  return (
    <Suspense
      fallback={
        <AdminListSkeleton
          stats={0}
          columns={props.area === "admin" ? 6 : 4}
          tabs={staffTab ? 2 : 0}
          selectable={false}
          rowActions={false}
          thumbnail={false}
          headerActions={0}
          toolbarAction={false}
        />
      }
    >
      {props.area === "admin" ? (
        <AdminActivityLogTable searchParams={props.searchParams} />
      ) : (
        <VendorActivityLogTable searchParams={props.searchParams} viewer={props.viewer} />
      )}
    </Suspense>
  );
}

export async function AdminActivityLogTable({ searchParams }: { searchParams: SearchParams }) {
  const parsed = parsePageQuery(searchParams, ActivityLogQuerySchema);
  const query = { ...parsed, limit: pageSizeFromParams(searchParams) };

  const [list, vendorOptions] = await Promise.all([
    fetchActivityLogList(query, { kind: "admin" }),
    fetchActivityLogVendorOptions(query.vendor),
  ]);

  return (
    <ActivityLogDataTable
      area="admin"
      data={list.items}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
      vendorOptions={vendorOptions}
    />
  );
}

export async function VendorActivityLogTable({
  searchParams,
  viewer,
}: {
  searchParams: SearchParams;
  viewer: VendorLogViewer;
}) {
  // The vendor's schema names only what a vendor may filter on, so a `vendor`,
  // `vendorId` or `actorVendorId` in the URL never gets this far.
  const parsed = parsePageQuery(searchParams, VendorActivityLogQuerySchema);
  const query = toVendorListQuery({ ...parsed, limit: pageSizeFromParams(searchParams) });
  // Enforced here, not in the table: without `view_staff` the staff tab is not a
  // tab that is hidden but a list this page will not read.
  const tab = viewer.canViewStaff && parsed.tab === "staff" ? "staff" : "mine";

  const [list, actors] = await Promise.all([
    fetchActivityLogList(query, {
      kind: "vendor",
      vendorId: viewer.vendorId,
      ownerUserId: viewer.ownerUserId,
      tab,
    }),
    tab === "staff"
      ? fetchVendorLogActors(viewer.vendorId, viewer.ownerUserId, query.date)
      : Promise.resolve([]),
  ]);

  return (
    <ActivityLogDataTable
      area="vendor"
      data={list.items}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
      actors={actors}
      canViewStaff={viewer.canViewStaff}
    />
  );
}
