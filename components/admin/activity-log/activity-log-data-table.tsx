"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { History } from "lucide-react";
import Link from "@/components/language/link";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { startOfDay, type DateRangePreset } from "@/components/ui/date-range-picker";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { periodPickerConfig } from "@/components/admin/period-picker-config";
import {
  ActivityActionBadge,
  FailedMarker,
} from "@/components/admin/activity-log/activity-action";
import { ActivityLogDetailSheet } from "@/components/admin/activity-log/activity-log-detail-sheet";
import { ActivityTime } from "@/components/admin/activity-log/activity-time";
import { useActivityLabels } from "@/components/admin/activity-log/activity-labels";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/config/audit.config";
import {
  ALL_TIME,
  LAST_30_DAYS,
  dateParamToFilterValue,
  filterValueToDateParam,
} from "@/lib/activity-log/date-param";
import type { ActivityLogActor, ActivityLogRow } from "@/lib/activity-log/list";
import { ACTIVITY_LOG_PAGE_SIZE } from "@/lib/activity-log/page-size";
import { ACTIVITY_LOG_ROLES } from "@/lib/activity-log/query";
import {
  resourceHref,
  type ActivityLogArea,
} from "@/lib/activity-log/resource-links";
import type { ActivityLogVendorOption } from "@/lib/activity-log/vendor-options";

/**
 * The Activity Log list, for the admin and — with `area="vendor"` — for a store's
 * own team, the way the customers table serves the admin and the vendor.
 *
 * The query string is the whole state (see `useListNavigation`). The filters are
 * written through `navigate` below, not through the hook's `handleFilterChange`,
 * for two reasons that are this screen's own: a bare list is the last 30 days
 * and `date=all` is a real value that must stay in the URL (the hook drops
 * "all"), and several filters can be cleared in one click (the Filters menu's
 * "Clear all filters" calls once per filter, and each call there would start from
 * a query string that has not caught up with the one before).
 */

interface ActivityLogDataTableProps {
  area: ActivityLogArea;
  data: ActivityLogRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  /** Admin: stores for the Vendor filter. Empty when there are none. */
  vendorOptions?: ActivityLogVendorOption[];
  /** Vendor: who acted on "Staff activity", for the team-member picker. */
  actors?: ActivityLogActor[];
  /** Vendor: whether the Staff activity tab is offered at all. */
  canViewStaff?: boolean;
}

const ADMIN_FILTER_PARAMS = ["role", "vendor", "action", "resource", "outcome", "actor"];
const VENDOR_FILTER_PARAMS = ["action", "resource", "actor"];
/** A window other than the default or "all time" narrows the list, so it counts as a filter. */
const narrowsList = (dateValue: string) => dateValue !== LAST_30_DAYS && dateValue !== ALL_TIME;

export function ActivityLogDataTable({
  area,
  data,
  pagination,
  vendorOptions = [],
  actors = [],
  canViewStaff = false,
}: ActivityLogDataTableProps) {
  const t = useTranslations("admin.activityLogPage");
  const tVendor = useTranslations("vendor.activityLog");
  const tRoot = useTranslations();
  const tOr = useFallbackTranslator(tRoot);
  const locale = useLocale();
  const labels = useActivityLabels();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isVendorArea = area === "vendor";

  const list = useListNavigation<ActivityLogRow>({
    items: data,
    pagination,
    tabParam: "tab",
    filterIds: [],
    defaultPageSize: ACTIVITY_LOG_PAGE_SIZE,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const openEntry = useCallback((row: ActivityLogRow) => {
    setSelectedId(row._id);
    setSheetOpen(true);
  }, []);

  // The query string as the last change left it. A second change in the same
  // event builds on this, not on `searchParams`, which lags a render behind.
  const pending = useRef<{ from: string; params: URLSearchParams } | null>(null);
  const [isFiltering, startFiltering] = useTransition();
  const navigate = useCallback(
    (updates: Record<string, string | undefined>) => {
      const from = searchParams.toString();
      if (pending.current?.from !== from) {
        pending.current = { from, params: new URLSearchParams(from) };
      }
      const params = pending.current.params;
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      params.delete("page");
      const query = params.toString();
      startFiltering(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  const handleFilterChange = useCallback(
    (filterId: string, value: string) => {
      if (filterId === "date") {
        navigate({ date: filterValueToDateParam(value) });
        return;
      }
      navigate({ [filterId]: value === "all" ? undefined : value });
    },
    [navigate],
  );

  const filterParams = isVendorArea ? VENDOR_FILTER_PARAMS : ADMIN_FILTER_PARAMS;
  const dateValue = dateParamToFilterValue(searchParams.get("date"));
  const isFiltered =
    narrowsList(dateValue) ||
    filterParams.some((param) => Boolean(searchParams.get(param)));

  const clearFilters = useCallback(() => {
    navigate(Object.fromEntries(["date", ...filterParams].map((param) => [param, undefined])));
  }, [filterParams, navigate]);

  const activeTab = isVendorArea && canViewStaff && searchParams.get("tab") === "staff" ? "staff" : "mine";

  const columns = useMemo<DataTableColumn<ActivityLogRow>[]>(() => {
    // A phone gets Time and Summary, with the failure marker; everything else is
    // in the detail sheet. The admin's own Outcome column takes the marker over
    // from `lg`; a vendor's table has no such column, so its marker stays inline.
    const inlineMarker = isVendorArea ? "" : "lg:hidden";

    const all: DataTableColumn<ActivityLogRow>[] = [
      {
        id: "time",
        header: t("columns.time"),
        className: "w-[120px]",
        cell: (row) => (
          <ActivityTime
            iso={row.createdAt}
            openLabel={t("viewDetails")}
            onOpen={() => openEntry(row)}
          />
        ),
      },
      {
        id: "actor",
        header: t("columns.actor"),
        className: "hidden w-[220px] lg:table-cell",
        cell: (row) => {
          const name =
            row.userEmail || (row.userRole === "system" ? t("system") : t("unknownActor"));
          return (
            <div className="min-w-0 max-w-[220px]">
              <p className="truncate font-medium" title={name}>
                {name}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {row.userRole ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[11px] font-normal">
                    {labels.role(row.userRole)}
                  </Badge>
                ) : null}
                {row.actorVendorName ? (
                  <span className="truncate" title={row.actorVendorName}>
                    {row.actorVendorName}
                  </span>
                ) : null}
              </p>
            </div>
          );
        },
      },
      {
        id: "action",
        header: t("columns.action"),
        className: "hidden w-[170px] sm:table-cell",
        cell: (row) => <ActivityActionBadge action={row.action} resource={row.resource} />,
      },
      {
        id: "resource",
        header: t("columns.resource"),
        className: "hidden w-[200px] lg:table-cell",
        cell: (row) => {
          const href = resourceHref(row, area);
          const name = row.resourceName || row.resourceId || "—";
          return (
            <div className="min-w-0 max-w-[200px]">
              <p className="text-xs text-muted-foreground">{labels.resource(row.resource)}</p>
              {href ? (
                <Link
                  href={href}
                  // The row opens the entry; the link opens the record.
                  onClick={(event) => event.stopPropagation()}
                  className="block truncate font-medium text-primary hover:underline"
                  title={name}
                >
                  {name}
                </Link>
              ) : (
                <p className="truncate font-medium" title={name}>
                  {name}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "summary",
        header: t("columns.summary"),
        className: "min-w-[220px] max-w-[460px] whitespace-normal",
        cell: (row) => (
          <div className="min-w-0 space-y-1">
            <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]">
              {row.summary || row.fields?.join(", ") || "—"}
            </p>
            {!row.success ? (
              <span className={inlineMarker}>
                <FailedMarker label={t("failed")} />
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "ip",
        header: t("columns.ip"),
        className: "hidden w-[140px] 2xl:table-cell",
        cell: (row) => (
          <span className="font-mono text-xs text-muted-foreground">{row.ip || "—"}</span>
        ),
      },
      ...(isVendorArea
        ? []
        : [
            {
              id: "outcome",
              header: t("columns.outcome"),
              className: "hidden w-[110px] lg:table-cell",
              cell: (row: ActivityLogRow) =>
                row.success ? null : <FailedMarker label={t("failed")} />,
            },
          ]),
    ];
    return all;
  }, [area, isVendorArea, labels, openEntry, t]);

  const filters = useMemo<DataTableFilter[]>(() => {
    const allOption = { label: t("all"), value: "all" };
    const byLabel = (a: { label: string }, b: { label: string }) =>
      a.label.localeCompare(b.label, locale);

    // Built on every render, like Orders': "today" and the last day the calendar
    // allows move at midnight, and this tab can outlive it. The picker's period
    // names and footer are the dashboard's; the default window and "all time"
    // are this screen's, because a bare list is not "all time" here.
    const now = new Date();
    const today = startOfDay(now);
    const picker = periodPickerConfig(tOr, locale, now);
    const presets: DateRangePreset[] = [
      ...picker.presets.filter((preset) => preset.id !== "all"),
      {
        id: LAST_30_DAYS,
        label: t("dates.last30"),
        range: {
          from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29),
          to: today,
        },
      },
      { id: ALL_TIME, label: t("dates.allTime"), range: { from: today, to: today } },
    ];

    const dateFilter: DataTableFilter = {
      id: "date",
      label: t("filters.date"),
      type: "date",
      defaultValue: LAST_30_DAYS,
      date: { locale, ...picker, presets, maxDate: now },
    };

    const actionFilter: DataTableFilter = {
      id: "action",
      label: t("filters.action"),
      type: "select",
      options: [
        allOption,
        ...AUDIT_ACTIONS.map((action) => ({ label: labels.action(action), value: action })).sort(
          byLabel,
        ),
      ],
    };
    const resourceFilter: DataTableFilter = {
      id: "resource",
      label: t("filters.resource"),
      type: "select",
      options: [
        allOption,
        ...AUDIT_RESOURCES.map((resource) => ({
          label: labels.resource(resource),
          value: resource,
        })).sort(byLabel),
      ],
    };

    if (isVendorArea) {
      const memberFilter: DataTableFilter = {
        id: "actor",
        label: t("filters.teamMember"),
        type: "select",
        options: [
          allOption,
          ...actors.map((actor) => ({
            value: actor.userId,
            label: actor.email || tVendor("memberFallback"),
          })),
        ],
      };
      return [dateFilter, actionFilter, resourceFilter, ...(activeTab === "staff" ? [memberFilter] : [])];
    }

    return [
      dateFilter,
      {
        id: "role",
        label: t("filters.role"),
        type: "select",
        options: [
          allOption,
          ...ACTIVITY_LOG_ROLES.map((role) => ({ label: labels.role(role), value: role })),
        ],
      },
      ...(vendorOptions.length > 0
        ? [
            {
              id: "vendor",
              label: t("filters.vendor"),
              type: "select" as const,
              options: [allOption, ...vendorOptions],
            },
          ]
        : []),
      actionFilter,
      resourceFilter,
      {
        id: "outcome",
        label: t("filters.outcome"),
        type: "select",
        options: [
          allOption,
          { label: t("outcomes.success"), value: "success" },
          { label: t("outcomes.failed"), value: "failed" },
        ],
      },
    ];
  }, [actors, activeTab, isVendorArea, labels, locale, t, tOr, tVendor, vendorOptions]);

  const filterValues = useMemo<Record<string, string>>(
    () => ({
      date: dateValue,
      ...Object.fromEntries(
        ["role", "vendor", "action", "resource", "outcome", "actor"].map((param) => [
          param,
          searchParams.get(param) ?? "all",
        ]),
      ),
    }),
    [dateValue, searchParams],
  );

  const tabs = useMemo<DataTableTab[] | undefined>(
    () =>
      isVendorArea && canViewStaff
        ? [
            { id: "mine", label: tVendor("tabs.mine") },
            { id: "staff", label: tVendor("tabs.staff") },
          ]
        : undefined,
    [canViewStaff, isVendorArea, tVendor],
  );

  const tableHeader = useMemo(
    () => buildAdminCommerceTableHeader({ title: isVendorArea ? tVendor("title") : t("title") }),
    [isVendorArea, t, tVendor],
  );

  const emptyDescription = isFiltered
    ? t("empty.noMatchDescription")
    : isVendorArea
      ? activeTab === "staff"
        ? tVendor("emptyStaffDescription")
        : tVendor("emptyMineDescription")
      : t("empty.noActivityDescription");

  return (
    <>
      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        isLoading={list.isLoading || isFiltering}
        loadingMode="rows"
        title={tableHeader.title}
        tabs={tabs}
        activeTab={activeTab}
        // The staff tab is `?tab=staff`; "My activity" is the bare list. The
        // team-member pick belongs to the staff tab, so leaving it clears it.
        onTabChange={(tab) =>
          navigate({ tab: tab === "staff" ? "staff" : undefined, actor: undefined })
        }
        actions={tableHeader.actions}
        // The admin's actor filter: an email, which the server resolves to a
        // user (or to the email their rows kept, for one who was deleted).
        searchable={!isVendorArea}
        searchPlaceholder={t("searchPlaceholder")}
        searchValue={searchParams.get("actor") ?? ""}
        onSearchChange={(value) => navigate({ actor: value.trim() || undefined })}
        filters={filters}
        filterValues={filterValues}
        onFilterChange={handleFilterChange}
        toolbarActions={tableHeader.toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-xs"
        onRowClick={openEntry}
        emptyIcon={<History className="h-8 w-8 text-muted-foreground/50" />}
        emptyMessage={isFiltered ? t("empty.noMatchTitle") : t("empty.noActivityTitle")}
        emptyDescription={emptyDescription}
        emptyAction={
          isFiltered ? (
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              {t("empty.clearFilters")}
            </Button>
          ) : undefined
        }
      />

      <ActivityLogDetailSheet
        entryId={selectedId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        area={area}
      />
    </>
  );
}
