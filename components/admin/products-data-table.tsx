"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useCallback, useMemo } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import {
  Plus,
  Download,
  Upload,
  ChevronsUpDown,
  Eye,
  Pencil,
  Trash2,
  Archive,
  CheckCircle2,
  CircleDot,
  ShoppingBag,
  Globe,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  ProductCell,
  StatusCell,
  TextCell,
  type DataTableColumn,
  type DataTableTab,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTableFilter,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import type { ProductListItem as Product } from "@/types/product-list";


interface ProductsDataTableProps {
  locale: string;
  area?: "admin" | "staff";
  readOnly?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  /** Vendors present in the result set, for the vendor filter. */
  vendorOptions?: { label: string; value: string }[];
  isMultiVendor?: boolean;
}

const PRODUCT_FILTER_IDS = ["vendor", "source", "tag"];

/** The status dropdown offers "archived"; the tab it drives is "unlisted". */
function normalizeStatus(status?: string) {
  if (status === "archived") return "unlisted";
  return status || "all";
}

export function ProductsDataTable({
  locale,
  area = "admin",
  readOnly = false,
  data,
  pagination,
  vendorOptions = [],
  isMultiVendor = false,
}: ProductsDataTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { formatPrice: formatCurrency } = useCurrency();

  const [selectedProducts, setSelectedProducts] = useState<Product[]>([]);
  const basePath = `/${locale}/${area}`;
  const importInputId = "admin-products-import-csv";

  const list = useListNavigation<Product>({
    items: data,
    pagination,
    filterIds: PRODUCT_FILTER_IDS,
  });

  const tagOptions = useMemo(
    () =>
      Array.from(
        new Set(list.items.flatMap((p) => (Array.isArray(p.tags) ? p.tags : []))),
      ).map((tag) => ({ label: tag, value: tag })),
    [list.items],
  );

  // The "statuses" dropdown filter mirrors the active tab.
  const handleStatusChange = useCallback(
    (value: string) => {
      list.handleTabChange(normalizeStatus(value));
    },
    [list],
  );

  const handleDelete = useCallback(
    async (product: Product) => {
      const confirmed = await confirm({
        title: t("admin.productsDataTable.dialogs.deleteSingle.title"),
        description: t(
          "admin.productsDataTable.dialogs.deleteSingle.description",
          { name: product.title || product.name },
        ),
        confirmText: t("admin.productsDataTable.dialogs.deleteSingle.confirm"),
        cancelText: t("admin.productsDataTable.dialogs.deleteSingle.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/admin/products/${product._id}`);
        toast.success(
          t("admin.productsDataTable.toasts.deleteSingleSuccess"),
        );
        list.refetch();
      } catch {
        toast.error(t("admin.productsDataTable.toasts.deleteSingleError"));
      }
    },
    [confirm, list, t],
  );

  const handleBulkDelete = useCallback(
    async (items: Product[]) => {
      const confirmed = await confirm({
        title: t("admin.productsDataTable.dialogs.deleteBulk.title"),
        description: t(
          "admin.productsDataTable.dialogs.deleteBulk.description",
          {
            count: items.length,
          },
        ),
        confirmText: t("admin.productsDataTable.dialogs.deleteBulk.confirm"),
        cancelText: t("admin.productsDataTable.dialogs.deleteBulk.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await Promise.all(
          items.map((product) =>
            apiClient.delete(`/api/admin/products/${product._id}`),
          ),
        );
        toast.success(
          t("admin.productsDataTable.toasts.deleteBulkSuccess", {
            count: items.length,
          }),
        );
        setSelectedProducts([]);
        list.refetch();
      } catch {
        toast.error(t("admin.productsDataTable.toasts.deleteBulkError"));
      }
    },
    [confirm, list, t],
  );

  const handleBulkStatusUpdate = useCallback(
    async (items: Product[], status: Product["status"]) => {
      const confirmed = await confirm({
        title: t("admin.productsDataTable.dialogs.updateStatus.title"),
        description: t(
          "admin.productsDataTable.dialogs.updateStatus.description",
          {
            count: items.length,
            status,
          },
        ),
        confirmText: t("admin.productsDataTable.dialogs.updateStatus.confirm"),
        cancelText: t("admin.productsDataTable.dialogs.updateStatus.cancel"),
      });

      if (!confirmed) return;

      const results = await Promise.allSettled(
        items.map((product) =>
          apiClient.put(`/api/admin/products/${product._id}`, { status }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedProducts([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(
          t("admin.productsDataTable.toasts.updateSuccess", {
            count: successCount,
          }),
        );
      }
      if (failCount > 0) {
        toast.error(
          t("admin.productsDataTable.toasts.updateError", {
            count: failCount,
          }),
        );
      }
    },
    [confirm, list, t],
  );

  const buildImportExportParams = useCallback(() => {
    const params = new URLSearchParams();
    if (list.search) params.set("search", list.search);
    if (list.activeTab && list.activeTab !== "all") {
      params.set("status", list.activeTab);
    }
    if (isMultiVendor && list.filters.vendor && list.filters.vendor !== "all") {
      params.set("vendor", list.filters.vendor);
    }
    if (isMultiVendor && list.filters.source && list.filters.source !== "all") {
      params.set("source", list.filters.source);
    }
    if (list.filters.tag && list.filters.tag !== "all") {
      params.set("tag", list.filters.tag);
    }
    if (list.sortBy) params.set("sortBy", list.sortBy);
    if (list.sortOrder) params.set("sortOrder", list.sortOrder);
    return params;
  }, [
    isMultiVendor,
    list.activeTab,
    list.filters.source,
    list.filters.tag,
    list.filters.vendor,
    list.search,
    list.sortBy,
    list.sortOrder,
  ]);

  const handleExportProducts = useCallback(async () => {
    try {
      const params = buildImportExportParams();
      const res = await fetch(
        `/api/admin/products/import-export?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Products exported successfully");
    } catch {
      toast.error("Products could not be exported");
    }
  }, [buildImportExportParams]);

  const handleImportProducts = useCallback(() => {
    document.getElementById(importInputId)?.click();
  }, []);

  const handleImportFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/admin/products/import-export", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Import failed");
        }

        const result = data.data as {
          created: number;
          updated: number;
          failed: number;
          errors?: { row: number; message: string }[];
        };
        const summary = `Imported ${result.created} created, ${result.updated} updated`;
        if (result.failed > 0) {
          toast.error(
            `${summary}. ${result.failed} failed${
              result.errors?.[0]
                ? `: row ${result.errors[0].row} ${result.errors[0].message}`
                : "."
            }`,
          );
        } else {
          toast.success(summary);
        }
        list.handlePageChange(1);
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Products could not be imported",
        );
      }
    },
    [list],
  );

  // Price display helper
  const formatPrice = useCallback(
    (row: Product) => {
      const variantPrices = row.variants
        ?.map((v) => v.price)
        .filter((p): p is number => p != null && p > 0);

      if (variantPrices && variantPrices.length > 1) {
        const min = Math.min(...variantPrices);
        const max = Math.max(...variantPrices);
        if (min !== max) {
          return `${formatCurrency(min)} – ${formatCurrency(max)}`;
        }
      }

      return formatCurrency(row.price);
    },
    [formatCurrency],
  );

  const getSourceLabel = useCallback((row: Product) => {
    return row.productSource === "vendor" ? "Vendor" : "Admin";
  }, []);

  // Column definitions
  const columns = useMemo<DataTableColumn<Product>[]>(
    () => [
      {
        id: "product",
        header: t("admin.productsDataTable.columns.product"),
        cell: (row) => (
          <div className="max-w-[240px] text-sm">
            <ProductCell
              image={row.images?.[0] || row.media?.[0]?.url}
              title={row.title || row.name}
              titleWordLimit={4}
              href={
                readOnly
                  ? `/${locale}/products/${row.slug}`
                  : `${basePath}/products/${row._id}/edit`
              }
              hoverStyle="blueUnderline"
            />
          </div>
        ),
        className: "w-[280px]",
      },
      {
        id: "category",
        header: t("admin.productsDataTable.columns.category"),
        cell: (row) => (
          <TextCell
            value={row.category?.name}
            fallback={t("admin.productsDataTable.columns.uncategorized")}
            truncate
            maxWidth="140px"
            wordLimit={4}
            className="text-sm"
          />
        ),
        className: "w-[140px] max-w-[140px]",
      },
      ...(isMultiVendor
        ? [
            {
              id: "vendor",
              header: "StoreName",
              cell: (row: Product) => (
                <TextCell
                  value={row.vendorId?.storeName}
                  fallback="Default store"
                  truncate
                  maxWidth="150px"
                  wordLimit={3}
                  className="text-sm"
                />
              ),
              className: "w-[160px] max-w-[160px]",
            },
            {
              id: "source",
              header: "Source",
              cell: (row: Product) => (
                <Badge
                  variant={
                    row.productSource === "vendor" ? "outline" : "secondary"
                  }
                  className={
                    row.productSource === "vendor"
                      ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300"
                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }
                >
                  {getSourceLabel(row)}
                </Badge>
              ),
              className: "w-[110px]",
            },
          ]
        : []),
      {
        id: "status",
        header: t("admin.productsDataTable.columns.status"),
        cell: (row) => <StatusCell status={row.status} />,
        className: "w-[100px]",
      },
      {
        id: "inventory",
        header: t("admin.productsDataTable.columns.inventory"),
        cell: (row) => (
          <TextCell
            value={`${row.stock} in stock`}
            className="text-sm font-medium"
          />
        ),
        className: "w-[120px]",
      },
      {
        id: "price",
        header: t("admin.productsDataTable.columns.price"),
        cell: (row) => (
          <span className="text-sm font-medium">{formatPrice(row)}</span>
        ),
        className: "w-[130px]",
      },
      {
        id: "channels",
        header: t("admin.productsDataTable.columns.availableIn"),
        cell: (row) => {
          const pos = row.publishing?.pointOfSale ?? false;
          const online = row.publishing?.onlineStore ?? true;
          return (
            <div className="flex items-center gap-1.5">
              {pos && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80">
                  <ShoppingBag className="h-3.5 w-3.5 text-pink-500" />
                  {t("admin.productsDataTable.channels.inStore")}
                </span>
              )}
              {online && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground/80">
                  <Globe className="h-3.5 w-3.5 text-teal-500" />
                  {t("admin.productsDataTable.channels.online")}
                </span>
              )}
            </div>
          );
        },
        className: "w-[220px]",
      },
    ],
    [basePath, formatPrice, getSourceLabel, isMultiVendor, locale, readOnly, t],
  );

  // Tabs
  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("admin.productsDataTable.tabs.all") },
      { id: "active", label: t("admin.productsDataTable.tabs.active") },
      { id: "draft", label: t("admin.productsDataTable.tabs.draft") },
      { id: "unlisted", label: t("admin.productsDataTable.tabs.archived") },
    ],
    [t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      ...(isMultiVendor
        ? [
            {
              id: "vendor",
              label: "Vendor",
              type: "select" as const,
              options: [
                { label: "All vendors", value: "all" },
                ...vendorOptions,
              ],
            },
            {
              id: "source",
              label: "Source",
              type: "select" as const,
              options: [
                { label: "All sources", value: "all" },
                { label: "Admin products", value: "admin" },
                { label: "Vendor products", value: "vendor" },
              ],
            },
          ]
        : []),
      {
        id: "tag",
        label: t("admin.productsDataTable.filters.tag"),
        type: "select",
        options:
          tagOptions.length > 0
            ? tagOptions
            : [
                {
                  label: t("admin.productsDataTable.filters.all"),
                  value: "all",
                },
              ],
      },
      {
        id: "statuses",
        label: t("admin.productsDataTable.filters.statuses"),
        type: "select",
        options: [
          { label: t("admin.productsDataTable.filters.all"), value: "all" },
          {
            label: t("admin.productsDataTable.filters.active"),
            value: "active",
          },
          { label: t("admin.productsDataTable.filters.draft"), value: "draft" },
          {
            label: t("admin.productsDataTable.filters.archived"),
            value: "unlisted",
          },
        ],
      },
    ],
    [isMultiVendor, vendorOptions, tagOptions, t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.productsDataTable.title"),
        addAction: readOnly
          ? undefined
          : {
              id: "add",
              label: t("admin.productsDataTable.actions.addProduct"),
              href: `${basePath}/products/new`,
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
            },
        importExportAction: readOnly
          ? {
              id: "export",
              label: t("admin.productsDataTable.actions.export"),
              icon: <Download className="h-4 w-4" />,
              variant: "outline",
              onClick: handleExportProducts,
            }
          : {
              id: "import-export",
              label: t("admin.productsDataTable.actions.importExport"),
              icon: <ChevronsUpDown className="h-4 w-4" />,
              variant: "outline",
              items: [
                {
                  id: "toolbar-export",
                  label: t("admin.productsDataTable.actions.export"),
                  icon: <Download className="h-4 w-4" />,
                  onClick: handleExportProducts,
                },
                {
                  id: "toolbar-import",
                  label: t("admin.productsDataTable.actions.import"),
                  icon: <Upload className="h-4 w-4" />,
                  onClick: handleImportProducts,
                },
              ],
            },
      }),
    [basePath, handleExportProducts, handleImportProducts, readOnly, t],
  );

  // Bulk actions
  const bulkActions = useMemo<DataTableBulkAction<Product>[]>(
    () =>
      readOnly
        ? []
        : [
            {
              id: "set-active",
              label: t("admin.productsDataTable.bulkActions.setActive"),
              icon: <CheckCircle2 className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkStatusUpdate(items, "active"),
            },
            {
              id: "set-draft",
              label: t("admin.productsDataTable.bulkActions.setDraft"),
              icon: <CircleDot className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkStatusUpdate(items, "draft"),
            },
            {
              id: "set-archived",
              label: t("admin.productsDataTable.bulkActions.setArchived"),
              icon: <Archive className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkStatusUpdate(items, "unlisted"),
            },
            {
              id: "delete",
              label: t("admin.productsDataTable.bulkActions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: handleBulkDelete,
            },
          ],
    [handleBulkDelete, handleBulkStatusUpdate, readOnly, t],
  );

  // Row actions
  const rowActions = useCallback(
    (row: Product): DataTableAction[] =>
      readOnly
        ? [
            {
              id: "view",
              label: t("admin.productsDataTable.rowActions.view"),
              icon: <Eye className="h-4 w-4" />,
              href: `/${locale}/products/${row.slug}`,
            },
          ]
        : [
            {
              id: "view",
              label: t("admin.productsDataTable.rowActions.view"),
              icon: <Eye className="h-4 w-4" />,
              href: `/${locale}/products/${row.slug}`,
            },
            {
              id: "edit",
              label: t("admin.productsDataTable.rowActions.edit"),
              icon: <Pencil className="h-4 w-4" />,
              href: `${basePath}/products/${row._id}/edit`,
            },
            {
              id: "delete",
              label: t("admin.productsDataTable.rowActions.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: () => handleDelete(row),
            },
          ],
    [basePath, handleDelete, locale, readOnly, t],
  );

  return (
    <>
      <input
        id={importInputId}
        type="file"
        accept=".csv,text/csv,.json,application/json"
        className="hidden"
        onChange={handleImportFileChange}
      />
      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        isLoading={list.isLoading}
        loadingMode="rows"
        // Header
        title={tableHeader.title}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={handleStatusChange}
        actions={tableHeader.actions}
        // Selection
        selectable
        selectedItems={selectedProducts}
        onSelectionChange={setSelectedProducts}
        bulkActions={bulkActions}
        // Search
        searchable
        searchPlaceholder={t("admin.productsDataTable.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={{ ...list.filters, statuses: list.activeTab }}
        onFilterChange={(filterId, value) => {
          if (filterId === "statuses") {
            handleStatusChange(value);
            return;
          }
          list.handleFilterChange(filterId, value);
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
        // Pagination
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        // Row actions
        rowActions={rowActions}
        rowActionsHeader={t("admin.productsDataTable.rowActionsHeader")}
        rowActionsVariant="inline"
        onRowClick={(row) =>
          router.push(
            readOnly
              ? `/${locale}/products/${row.slug}`
              : `${basePath}/products/${row._id}/edit`,
          )
        }
        // Empty state
        emptyMessage={t("admin.productsDataTable.empty")}
      />
    </>
  );
}
