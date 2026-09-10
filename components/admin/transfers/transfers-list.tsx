"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, ChevronsUpDown, Download, Plus, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { TransferStatusBadge, type TransferStatus } from "@/components/admin/transfers/transfer-status-badge";
import {
  DataTable,
  TextCell,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import type { TransferStatusCounters } from "@/lib/inventory/transfer-list";

interface TransferRow {
  _id: string;
  transferNumber: string;
  status: TransferStatus;
  fromLocationName: string;
  toLocationName: string;
  itemCount: number;
  totalLines: number;
  createdAt: string;
  updatedAt: string;
}

interface TransfersListProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: TransferRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  /** Per-status totals rendered in the tab labels. */
  counters: TransferStatusCounters;
}

export function TransfersList({
  locale,
  data,
  pagination,
  counters,
}: TransfersListProps) {
  const t = useTranslations();
  const router = useRouter();

  const list = useListNavigation<TransferRow>({
    items: data,
    pagination,
    defaultPageSize: 20,
  });

  // The status dropdown filter mirrors the active tab.
  const handleStatusChange = useCallback(
    (value: string) => list.handleTabChange(value),
    [list],
  );

  const exportTransfers = useCallback(() => {
    const headers = ["Transfer", "From", "To", "Status", "Units", "Lines", "Updated"];
    const rows = list.items.map((row) => [
      row.transferNumber,
      row.fromLocationName,
      row.toLocationName,
      row.status,
      String(row.itemCount),
      String(row.totalLines),
      new Date(row.updatedAt).toLocaleString(),
    ]);
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transfers-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [list.items]);

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.transfers.list.title"),
        addAction: {
          id: "create-transfer",
          label: t("admin.transfers.list.createTransfer"),
          href: `/${locale}/admin/transfers/new`,
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
        },
        importExportAction: {
          id: "import-export",
          label: t("admin.productsDataTable.actions.importExport"),
          icon: <ChevronsUpDown className="h-4 w-4" />,
          variant: "outline",
          items: [
            {
              id: "toolbar-export",
              label: t("admin.collectionsDataTable.actions.export"),
              icon: <Download className="h-4 w-4" />,
              onClick: exportTransfers,
            },
            {
              id: "toolbar-import",
              label: t("admin.collectionsDataTable.actions.import"),
              icon: <Upload className="h-4 w-4" />,
              disabled: true,
            },
          ],
        },
      }),
    [exportTransfers, locale, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      {
        id: "all",
        label: `${t("admin.transfers.tabs.all")} (${counters.all ?? 0})`,
      },
      {
        id: "draft",
        label: `${t("admin.transfers.status.draft")} (${counters.draft ?? 0})`,
      },
      {
        id: "ready_to_ship",
        label: `${t("admin.transfers.status.ready_to_ship")} (${counters.ready_to_ship ?? 0})`,
      },
      {
        id: "in_transit",
        label: `${t("admin.transfers.status.in_transit")} (${counters.in_transit ?? 0})`,
      },
      {
        id: "completed",
        label: `${t("admin.transfers.status.completed")} (${counters.completed ?? 0})`,
      },
      {
        id: "cancelled",
        label: `${t("admin.transfers.status.cancelled")} (${counters.cancelled ?? 0})`,
      },
    ],
    [counters, t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "statusFilter",
        label: t("common.status"),
        type: "select",
        options: [
          { label: t("admin.transfers.tabs.all"), value: "all" },
          { label: t("admin.transfers.status.draft"), value: "draft" },
          { label: t("admin.transfers.status.ready_to_ship"), value: "ready_to_ship" },
          { label: t("admin.transfers.status.in_transit"), value: "in_transit" },
          { label: t("admin.transfers.status.completed"), value: "completed" },
          { label: t("admin.transfers.status.cancelled"), value: "cancelled" },
        ],
      },
    ],
    [t],
  );

  const columns = useMemo<DataTableColumn<TransferRow>[]>(
    () => [
      {
        id: "transfer",
        header: t("admin.transfers.list.columns.transfer"),
        cell: (row) => (
          <Link
            href={`/${locale}/admin/transfers/${row._id}`}
            className="font-medium text-primary hover:underline"
          >
            {row.transferNumber}
          </Link>
        ),
        className: "w-[180px]",
      },
      {
        id: "fromLocationName",
        header: t("admin.transfers.list.columns.from"),
        cell: (row) => <TextCell value={row.fromLocationName} />,
        className: "w-[200px]",
      },
      {
        id: "toLocationName",
        header: t("admin.transfers.list.columns.to"),
        cell: (row) => <TextCell value={row.toLocationName} />,
        className: "w-[200px]",
      },
      {
        id: "items",
        header: t("admin.transfers.list.columns.items"),
        cell: (row) => (
          <TextCell
            value={t("admin.transfers.list.itemsSummary", {
              units: row.itemCount,
              lines: row.totalLines,
            })}
          />
        ),
        className: "w-[220px]",
      },
      {
        id: "status",
        header: t("admin.transfers.list.columns.status"),
        cell: (row) => <TransferStatusBadge status={row.status} />,
        className: "w-[150px]",
      },
      {
        id: "updatedAt",
        header: t("admin.transfers.list.columns.updated"),
        cell: (row) => <TextCell value={new Date(row.updatedAt).toLocaleString()} />,
        className: "w-[220px]",
      },
    ],
    [locale, t],
  );

  return (
    <DataTable
      data={list.items}
      columns={columns}
      keyField="_id"
      isLoading={list.isLoading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={list.activeTab}
      onTabChange={handleStatusChange}
      actions={tableHeader.actions}
      searchable
      searchPlaceholder={t("admin.transfers.list.searchPlaceholder")}
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      filters={filters}
      filterValues={{ statusFilter: list.activeTab }}
      onFilterChange={(filterId, value) => {
        if (filterId !== "statusFilter") return;
        handleStatusChange(value);
      }}
      toolbarActions={tableHeader.toolbarActions}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      appearance={tableHeader.appearance}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
      sortColumn={list.sortBy}
      sortDirection={list.sortOrder}
      onSortChange={list.handleSortChange}
      pagination={list.pagination}
      onPageChange={list.handlePageChange}
      onPageSizeChange={list.handlePageSizeChange}
      onRowClick={(row) => router.push(`/${locale}/admin/transfers/${row._id}`)}
      emptyMessage={t("admin.transfers.list.empty")}
      emptyIcon={<ArrowRightLeft className="h-8 w-8" />}
    />
  );
}
