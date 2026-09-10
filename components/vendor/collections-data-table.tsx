"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Globe, Hand, Layers, Sparkles, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  ProductCell,
  StatusCell,
  NumberCell,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";

interface VendorCollection {
  _id: string;
  title: string;
  slug: string;
  description?: string;
  image?: { url: string; alt?: string };
  collectionType: "manual" | "automated";
  status: "active" | "draft";
  productCount: number;
  publishing: {
    onlineStore: boolean;
    pointOfSale: boolean;
  };
}

interface VendorCollectionsDataTableProps {
  /** Rows for the current query string, fetched by the page. */
  data: VendorCollection[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function VendorCollectionsDataTable({

  data,
  pagination,
}: VendorCollectionsDataTableProps) {
  const t = useTranslations();

  const list = useListNavigation<VendorCollection>({
    items: data,
    pagination,
    filterIds: ["type"],
  });

  const columns = useMemo<DataTableColumn<VendorCollection>[]>(
    () => [
      {
        id: "collection",
        header: t("admin.collectionsDataTable.columns.collection"),
        cell: (row) => (
          <ProductCell
            image={row.image?.url}
            title={row.title}
            subtitle={`/${row.slug}`}
          />
        ),
        className: "w-[400px]",
      },
      {
        id: "type",
        header: t("admin.collectionsDataTable.columns.type"),
        cell: (row) => (
          <Badge variant="outline" className="flex w-fit items-center gap-1">
            {row.collectionType === "automated" ? (
              <>
                <Sparkles className="h-3 w-3" />
                {t("admin.collectionsDataTable.types.automated")}
              </>
            ) : (
              <>
                <Hand className="h-3 w-3" />
                {t("admin.collectionsDataTable.types.manual")}
              </>
            )}
          </Badge>
        ),
        className: "w-[140px]",
      },
      {
        id: "products",
        header: t("admin.collectionsDataTable.columns.products"),
        cell: (row) => <NumberCell value={row.productCount} />,
        className: "w-[100px]",
      },
      {
        id: "status",
        header: t("admin.collectionsDataTable.columns.status"),
        cell: (row) => <StatusCell status={row.status} />,
        className: "w-[120px]",
      },
      {
        id: "channels",
        header: t("admin.collectionsDataTable.columns.availableIn"),
        cell: (row) => (
          <div className="flex items-center gap-2">
            {row.publishing?.pointOfSale && (
              <Badge
                variant="secondary"
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground/80"
              >
                <Store className="mr-1 h-3.5 w-3.5 text-pink-500" />
                {t("admin.collectionsDataTable.channels.inStore")}
              </Badge>
            )}
            {row.publishing?.onlineStore && (
              <Badge
                variant="secondary"
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground/80"
              >
                <Globe className="mr-1 h-3.5 w-3.5 text-teal-500" />
                {t("admin.collectionsDataTable.channels.online")}
              </Badge>
            )}
          </div>
        ),
        className: "w-[240px]",
      },
    ],
    [t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("admin.collectionsDataTable.tabs.all") },
      { id: "active", label: t("admin.collectionsDataTable.tabs.active") },
      { id: "draft", label: t("admin.collectionsDataTable.tabs.draft") },
    ],
    [t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "type",
        label: t("admin.collectionsDataTable.filters.type"),
        type: "select",
        options: [
          { label: t("admin.collectionsDataTable.filters.all"), value: "all" },
          { label: t("admin.collectionsDataTable.filters.manual"), value: "manual" },
          { label: t("admin.collectionsDataTable.filters.automated"), value: "automated" },
        ],
      },
    ],
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("vendor.collections"),
      }),
    [t],
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
      onTabChange={list.handleTabChange}
      searchable
      searchPlaceholder={t("admin.collectionsDataTable.searchPlaceholder")}
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      filters={filters}
      filterValues={list.filters}
      onFilterChange={list.handleFilterChange}
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
      emptyMessage={t("vendor.collectionsTable.empty")}
      emptyIcon={<Layers className="h-8 w-8" />}
    />
  );
}
