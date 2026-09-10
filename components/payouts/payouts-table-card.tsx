"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useCurrency } from "@/providers/currency-provider";
import {
  DataTable,
  TextCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTablePaginationType,
  type DataTableTab,
} from "@/components/ui/data-table";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";

export type PayoutTableRow = {
  _id: string;
  payoutNumber: string;
  status: string;
  currency: string;
  netAmount: number;
  periodStart: string;
  periodEnd: string;
  vendorId?: { _id?: string; storeName?: string };
  createdAt: string;
};

interface PayoutsTableCardProps {
  locale: string;
  data: PayoutTableRow[];
  isLoading: boolean;
  title: string;
  detailHref: (row: PayoutTableRow) => string;
  onRowOpen: (row: PayoutTableRow) => void;
  showVendorColumn?: boolean;
  actions?: DataTableAction[];
  tabs: DataTableTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filters?: DataTableFilter[];
  filterValues?: Record<string, string>;
  onFilterChange?: (filterId: string, value: string) => void;
  pagination: DataTablePaginationType;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onSortChange: (column: string, direction: "asc" | "desc") => void;
  emptyMessage: string;
  rowActionsHeader: string;
}

const PAYOUT_STATUS_OPTIONS = [
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
] as const;

function toReadablePayoutLabel(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toKeyToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function getPayoutStatusClassName(status: string) {
  const map: Record<string, string> = {
    pending:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    processing:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
    paid:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    failed:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
    cancelled:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
  };

  return map[status] || map.pending;
}

export function usePayoutStatusTabs() {
  const t = useTranslations();

  return useMemo<DataTableTab[]>(
    () => [
      {
        id: "all",
        label: t("admin.payoutsPage.listSection.allStatuses"),
      },
      ...PAYOUT_STATUS_OPTIONS.map((statusOption) => ({
        id: statusOption,
        label: t(`admin.payoutsPage.statuses.${statusOption}`, {
          defaultMessage: toReadablePayoutLabel(statusOption),
        }),
      })),
    ],
    [t],
  );
}

export function PayoutsTableCard({
  locale,
  data,
  isLoading,
  title,
  detailHref,
  onRowOpen,
  showVendorColumn = false,
  actions,
  tabs,
  activeTab,
  onTabChange,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filters,
  filterValues,
  onFilterChange,
  pagination,
  onPageChange,
  onPageSizeChange,
  sortColumn,
  sortDirection,
  onSortChange,
  emptyMessage,
  rowActionsHeader,
}: PayoutsTableCardProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );

  const translatePayoutStatus = useCallback(
    (statusValue: string) =>
      t(`admin.payoutsPage.statuses.${toKeyToken(statusValue)}`, {
        defaultMessage: toReadablePayoutLabel(statusValue),
      }),
    [t],
  );

  const formatDate = useCallback(
    (value: string) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
    },
    [dateFormatter],
  );

  const columns = useMemo<DataTableColumn<PayoutTableRow>[]>(
    () => [
      {
        id: "payoutNumber",
        header: t("admin.payoutsPage.listSection.columns.payout"),
        sortable: true,
        cell: (row) => (
          <Link
            href={detailHref(row)}
            className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
            onClick={(event) => event.stopPropagation()}
          >
            {row.payoutNumber}
          </Link>
        ),
        className: "w-[210px]",
      },
      {
        id: "vendor",
        header: t("admin.payoutsPage.listSection.columns.vendor"),
        hidden: !showVendorColumn,
        cell: (row) => (
          <TextCell
            value={row.vendorId?.storeName}
            fallback="-"
            truncate
            maxWidth="220px"
          />
        ),
        className: "w-[240px]",
      },
      {
        id: "status",
        header: t("admin.payoutsPage.listSection.columns.status"),
        sortable: true,
        cell: (row) => (
          <Badge
            variant="outline"
            className={getPayoutStatusClassName(row.status)}
          >
            {translatePayoutStatus(row.status)}
          </Badge>
        ),
        className: "w-[150px]",
      },
      {
        id: "netAmount",
        header: t("admin.payoutsPage.listSection.columns.amount"),
        sortable: true,
        cell: (row) => (
          <span className="block font-medium">
            {formatPrice(row.netAmount)}
          </span>
        ),
        className: "w-[160px]",
      },
      {
        id: "periodStart",
        header: t("admin.payoutsPage.listSection.columns.period"),
        sortable: true,
        cell: (row) => (
          <span className="text-muted-foreground">
            {formatDate(row.periodStart)} - {formatDate(row.periodEnd)}
          </span>
        ),
        className: "w-[260px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
      },
    ],
    [detailHref, formatDate, formatPrice, showVendorColumn, t, translatePayoutStatus],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title,
        addAction: actions?.[0],
        importExportAction: actions?.[1],
      }),
    [actions, title],
  );

  const rowActions = useCallback(
    (row: PayoutTableRow): DataTableAction[] => [
      {
        id: "view",
        label: t("common.viewDetails"),
        icon: <Eye className="h-4 w-4" />,
        href: detailHref(row),
      },
    ],
    [detailHref, t],
  );

  return (
    <DataTable
      data={data}
      columns={columns}
      keyField="_id"
      isLoading={isLoading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      actions={tableHeader.actions}
      searchable
      searchPlaceholder={searchPlaceholder}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      filters={filters}
      filterValues={filterValues}
      onFilterChange={onFilterChange}
      toolbarActions={tableHeader.toolbarActions}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      appearance={tableHeader.appearance}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
      pagination={pagination}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSortChange={onSortChange}
      rowActions={rowActions}
      rowActionsHeader={rowActionsHeader}
      rowActionsVariant="inline"
      className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-sm"
      onRowClick={onRowOpen}
      emptyMessage={emptyMessage}
    />
  );
}
