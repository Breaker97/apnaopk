"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronsUpDown,
  Download,
  Eye,
  Globe,
  Pencil,
  Plus,
  Rocket,
  ShoppingBag,
  Trash2,
  Upload,
} from "lucide-react";
import { useAppSettings as usePublicAppSettings } from "@/providers/app-settings-provider";
import { BoostPurchaseDialog } from "@/components/vendor/boost-purchase-dialog";
import {
  DataTable,
  ProductCell,
  StatusCell,
  TextCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { useCurrency } from "@/providers/currency-provider";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import type { ProductListItem as Product } from "@/types/product-list";


interface VendorProductsTableProps {
  locale: string;
  canCreateProduct?: boolean;
  canEditProduct?: boolean;
  canDeleteProduct?: boolean;
  /** Vendor may purchase boosts (manage_boosts). */
  canBoostProduct?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function normalizeStatus(value?: string) {
  if (value === "archived") return "unlisted";
  return value || "all";
}

export function VendorProductsTable({
  locale,
  canCreateProduct = false,
  canEditProduct = false,
  canDeleteProduct = false,
  canBoostProduct = false,
  data,
  pagination,
}: VendorProductsTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const { confirm } = useConfirmation();
  const { boostingEnabled } = usePublicAppSettings();
  const importInputId = "vendor-products-import-csv";

  // Boost row action target: opens the purchase dialog with the product
  // preselected. Active products only — the server enforces the same rule.
  const [boostTarget, setBoostTarget] = useState<{
    _id: string;
    name: string;
    image?: string | null;
  } | null>(null);

  const list = useListNavigation<Product>({
    items: data,
    pagination,
  });

  // The "statuses" dropdown filter mirrors the active tab.
  const handleStatusChange = useCallback(
    (value: string) => {
      list.handleTabChange(normalizeStatus(value));
    },
    [list],
  );

  const handleDelete = useCallback(
    async (productId: string, productName: string) => {
      const confirmed = await confirm({
        title: t("common.delete"),
        description: t("vendor.productsTable.deleteConfirm", {
          name: productName,
        }),
        confirmText: t("common.delete"),
        cancelText: t("common.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/vendor/products/${productId}`);
        toast.success(
          t("vendor.productsTable.productDeleted"),
        );
        list.refetch();
      } catch {
        toast.error(
          t("vendor.productsTable.deleteFailed"),
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
    if (list.sortBy) params.set("sortBy", list.sortBy);
    if (list.sortOrder) params.set("sortOrder", list.sortOrder);
    return params;
  }, [list.activeTab, list.search, list.sortBy, list.sortOrder]);

  const handleExportProducts = useCallback(async () => {
    try {
      const params = buildImportExportParams();
      const res = await fetch(
        `/api/vendor/products/import-export?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vendor-products-${new Date().toISOString().slice(0, 10)}.csv`;
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
        const res = await fetch("/api/vendor/products/import-export", {
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

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("vendor.myProducts"),
        addAction: canCreateProduct
          ? {
              id: "add-product",
              label: t("vendor.addProduct"),
              href: `/${locale}/vendor/products/new`,
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
            }
          : undefined,
        importExportAction: {
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
              disabled: !canCreateProduct && !canEditProduct,
            },
          ],
        },
      }),
    [
      canCreateProduct,
      canEditProduct,
      handleExportProducts,
      handleImportProducts,
      locale,
      t,
    ],
  );

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
      {
        id: "statuses",
        label: t("admin.productsDataTable.filters.statuses"),
        type: "select",
        options: [
          { label: t("admin.productsDataTable.filters.all"), value: "all" },
          { label: t("admin.productsDataTable.filters.active"), value: "active" },
          { label: t("admin.productsDataTable.filters.draft"), value: "draft" },
          { label: t("admin.productsDataTable.filters.archived"), value: "unlisted" },
        ],
      },
    ],
    [t],
  );

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
              href={`/${locale}/vendor/products/${row._id}/edit`}
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
          <TextCell value={`${row.stock} in stock`} className="text-sm font-medium" />
        ),
        className: "w-[120px]",
      },
      {
        id: "price",
        header: t("admin.productsDataTable.columns.price"),
        cell: (row) => <span className="text-sm font-medium">{formatPrice(row.price)}</span>,
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
    [formatPrice, locale, t],
  );

  const rowActions = useCallback(
    (row: Product): DataTableAction[] => {
      const actions: DataTableAction[] = [
        {
          id: "view",
          label: t("admin.productsDataTable.rowActions.view"),
          icon: <Eye className="h-4 w-4" />,
          href: `/${locale}/products/${row.slug}`,
        },
      ];

      if (canEditProduct) {
        actions.push({
          id: "edit",
          label: t("admin.productsDataTable.rowActions.edit"),
          icon: <Pencil className="h-4 w-4" />,
          href: `/${locale}/vendor/products/${row._id}/edit`,
        });
      }

      if (boostingEnabled && canBoostProduct && row.status === "active") {
        actions.push({
          id: "boost",
          label: t.has("boosts.addAction")
            ? t("boosts.addAction")
            : "Boost a product",
          icon: <Rocket className="h-4 w-4" />,
          onClick: () =>
            setBoostTarget({
              _id: String(row._id),
              name: row.name,
              image: row.images?.[0] || null,
            }),
        });
      }

      if (canDeleteProduct) {
        actions.push({
          id: "delete",
          label: t("admin.productsDataTable.rowActions.delete"),
          icon: <Trash2 className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handleDelete(row._id, row.name),
        });
      }
      return actions;
    },
    [
      boostingEnabled,
      canBoostProduct,
      canDeleteProduct,
      canEditProduct,
      handleDelete,
      locale,
      t,
    ],
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
        title={tableHeader.title}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={handleStatusChange}
        actions={tableHeader.actions}
        searchable
        searchPlaceholder={t("common.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={{ statuses: list.activeTab }}
        onFilterChange={(filterId, value) => {
          if (filterId !== "statuses") return;
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
        rowActions={rowActions}
        rowActionsHeader={t("admin.productsDataTable.rowActionsHeader")}
        rowActionsVariant="inline"
        onRowClick={(row) =>
          router.push(
            canEditProduct
              ? `/${locale}/vendor/products/${row._id}/edit`
              : `/${locale}/products/${row.slug}`,
          )
        }
        emptyMessage={t("common.noResults")}
      />
      {boostingEnabled ? (
        <BoostPurchaseDialog
          open={Boolean(boostTarget)}
          onOpenChange={(open) => {
            if (!open) setBoostTarget(null);
          }}
          locale={locale}
          preselectedProduct={boostTarget}
        />
      ) : null}
    </>
  );
}
