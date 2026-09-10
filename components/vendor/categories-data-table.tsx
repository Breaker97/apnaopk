"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronsUpDown,
  Download,
  Eye,
  FolderTree,
  Upload,
} from "lucide-react";
import {
  DataTable,
  ProductCell,
  StatusCell,
  NumberCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableTab,
} from "@/components/ui/data-table";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";

interface VendorCategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parentId?: string | null;
  parentName?: string | null;
  isActive: boolean;
  featured?: boolean;
  productCount: number;
}

interface VendorCategoriesDataTableProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: VendorCategory[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function VendorCategoriesDataTable({
  locale,
  data,
  pagination,
}: VendorCategoriesDataTableProps) {
  const t = useTranslations();
  const router = useRouter();

  const list = useListNavigation<VendorCategory>({
    items: data,
    pagination,
  });

  const columns = useMemo<DataTableColumn<VendorCategory>[]>(
    () => [
      {
        id: "category",
        header: t("admin.categoriesDataTable.columns.category"),
        cell: (row) => (
          <ProductCell
            image={row.image}
            title={row.name}
            subtitle={`/${row.slug}`}
          />
        ),
        className: "w-[420px]",
      },
      {
        id: "products",
        header: t("admin.categoriesDataTable.columns.products"),
        cell: (row) => <NumberCell value={row.productCount} />,
        className: "w-[100px]",
      },
      {
        id: "featured",
        header: "Featured",
        cell: (row) =>
          row.featured ? (
            <span className="text-sm">Featured</span>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
        className: "w-[130px]",
      },
      {
        id: "status",
        header: t("admin.categoriesDataTable.columns.status"),
        cell: (row) => (
          <StatusCell
            status={row.isActive ? "active" : "inactive"}
            statusMap={{
              active: {
                label: t("admin.categoriesDataTable.status.active"),
                variant: "default",
              },
              inactive: {
                label: t("admin.categoriesDataTable.status.inactive"),
                variant: "outline",
              },
            }}
          />
        ),
        className: "w-[120px]",
      },
    ],
    [t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("admin.categoriesDataTable.tabs.all") },
      { id: "active", label: t("admin.categoriesDataTable.tabs.active") },
      { id: "featured", label: "Featured" },
      { id: "inactive", label: t("admin.categoriesDataTable.tabs.inactive") },
    ],
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.categoriesDataTable.title"),
        importExportAction: {
          id: "import-export",
          label: t("admin.productsDataTable.actions.importExport"),
          icon: <ChevronsUpDown className="h-4 w-4" />,
          variant: "outline",
          items: [
            {
              id: "toolbar-export",
              label: t("admin.categoriesDataTable.actions.export"),
              icon: <Download className="h-4 w-4" />,
              disabled: true,
            },
            {
              id: "toolbar-import",
              label: t("admin.categoriesDataTable.actions.import"),
              icon: <Upload className="h-4 w-4" />,
              disabled: true,
            },
          ],
        },
      }),
    [t],
  );

  const rowActions = useCallback(
    (row: VendorCategory): DataTableAction[] => [
      {
        id: "view-products",
        label: t("admin.productsDataTable.rowActions.view"),
        icon: <Eye className="h-4 w-4" />,
        href: `/${locale}/vendor/products?search=${encodeURIComponent(row.name)}`,
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
      onTabChange={list.handleTabChange}
      actions={tableHeader.actions}
      searchable
      searchPlaceholder={t("admin.categoriesDataTable.searchPlaceholder")}
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      toolbarLayout={tableHeader.toolbarLayout}
      toolbarActions={tableHeader.toolbarActions}
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
      rowActions={rowActions}
      rowActionsHeader={t("admin.categoriesDataTable.rowActionsHeader")}
      rowActionsVariant="inline"
      onRowClick={(row) =>
        router.push(`/${locale}/vendor/products?search=${encodeURIComponent(row.name)}`)
      }
      emptyMessage={t("admin.categoriesDataTable.empty")}
      emptyIcon={<FolderTree className="h-8 w-8" />}
    />
  );
}
