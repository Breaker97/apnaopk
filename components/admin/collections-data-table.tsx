"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Plus,
  ChevronsUpDown,
  Download,
  Upload,
  Pencil,
  Trash2,
  Layers,
  CheckCircle2,
  CircleDot,
  Sparkles,
  Hand,
  Globe,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  ProductCell,
  StatusCell,
  NumberCell,
  type DataTableColumn,
  type DataTableTab,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTableFilter,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";

interface Collection {
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

interface CollectionsDataTableProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: Collection[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const COLLECTION_FILTER_IDS = ["type"];

export function CollectionsDataTable({
  locale,
  data,
  pagination,
}: CollectionsDataTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [selectedCollections, setSelectedCollections] = useState<Collection[]>(
    []
  );
  const importInputId = "admin-collections-import-csv";

  const list = useListNavigation<Collection>({
    items: data,
    pagination,
    filterIds: COLLECTION_FILTER_IDS,
  });

  const buildImportExportParams = useCallback(() => {
    const params = new URLSearchParams();
    if (list.search) params.set("search", list.search);
    if (list.activeTab && list.activeTab !== "all") {
      params.set("status", list.activeTab);
    }
    if (list.filters.type && list.filters.type !== "all") {
      params.set("type", list.filters.type);
    }
    if (list.sortBy) params.set("sortBy", list.sortBy);
    if (list.sortOrder) params.set("sortOrder", list.sortOrder);
    return params;
  }, [list.activeTab, list.filters.type, list.search, list.sortBy, list.sortOrder]);

  const handleExportCollections = useCallback(async () => {
    try {
      const params = buildImportExportParams();
      const res = await fetch(
        `/api/admin/collections/import-export?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `collections-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Collections exported successfully");
    } catch {
      toast.error("Collections could not be exported");
    }
  }, [buildImportExportParams]);

  const handleImportCollections = useCallback(() => {
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
        const res = await fetch("/api/admin/collections/import-export", {
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
            : "Collections could not be imported",
        );
      }
    },
    [list],
  );

  const handleDelete = useCallback(
    async (collection: Collection) => {
      const confirmed = await confirm({
        title: t("admin.collectionsDataTable.dialogs.deleteSingle.title"),
        description: t(
          "admin.collectionsDataTable.dialogs.deleteSingle.description",
          { name: collection.title },
        ),
        confirmText: t("admin.collectionsDataTable.dialogs.deleteSingle.confirm"),
        cancelText: t("admin.collectionsDataTable.dialogs.deleteSingle.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/admin/collections/${collection._id}`);
        toast.success(t("admin.collectionsDataTable.toasts.deleteSingleSuccess"));
        list.refetch();
      } catch {
        toast.error(t("admin.collectionsDataTable.toasts.deleteSingleError"));
      }
    },
    [confirm, list, t]
  );

  const handleBulkDelete = useCallback(
    async (items: Collection[]) => {
      const confirmed = await confirm({
        title: t("admin.collectionsDataTable.dialogs.deleteBulk.title"),
        description: t("admin.collectionsDataTable.dialogs.deleteBulk.description", {
          count: items.length,
        }),
        confirmText: t("admin.collectionsDataTable.dialogs.deleteBulk.confirm"),
        cancelText: t("admin.collectionsDataTable.dialogs.deleteBulk.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await Promise.all(
          items.map((collection) =>
            apiClient.delete(`/api/admin/collections/${collection._id}`),
          )
        );
        toast.success(
          t("admin.collectionsDataTable.toasts.deleteBulkSuccess", {
            count: items.length,
          }),
        );
        setSelectedCollections([]);
        list.refetch();
      } catch {
        toast.error(t("admin.collectionsDataTable.toasts.deleteBulkError"));
      }
    },
    [confirm, list, t]
  );

  const handleBulkStatusUpdate = useCallback(
    async (items: Collection[], status: Collection["status"]) => {
      const confirmed = await confirm({
        title: t("admin.collectionsDataTable.dialogs.updateStatus.title"),
        description: t("admin.collectionsDataTable.dialogs.updateStatus.description", {
          count: items.length,
          status,
        }),
        confirmText: t("admin.collectionsDataTable.dialogs.updateStatus.confirm"),
        cancelText: t("admin.collectionsDataTable.dialogs.updateStatus.cancel"),
      });

      if (!confirmed) return;

      const results = await Promise.allSettled(
        items.map((collection) =>
          apiClient.put(`/api/admin/collections/${collection._id}`, { status }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedCollections([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(
          t("admin.collectionsDataTable.toasts.updateSuccess", {
            count: successCount,
          }),
        );
      }
      if (failCount > 0) {
        toast.error(
          t("admin.collectionsDataTable.toasts.updateError", {
            count: failCount,
          }),
        );
      }
    },
    [confirm, list, t],
  );

  const columns = useMemo<DataTableColumn<Collection>[]>(
    () => [
      {
        id: "collection",
        header: t("admin.collectionsDataTable.columns.collection"),
        cell: (row) => (
          <ProductCell
            image={row.image?.url}
            title={row.title}
            subtitle={`/${row.slug}`}
            href={`/${locale}/admin/collections/${row._id}`}
          />
        ),
        className: "w-[400px]",
      },
      {
        id: "type",
        header: t("admin.collectionsDataTable.columns.type"),
        cell: (row) => (
          <Badge variant="outline" className="flex items-center gap-1 w-fit">
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
        cell: (row) => {
          const hasInStore = row.publishing?.pointOfSale;
          const hasOnline = row.publishing?.onlineStore;

          return (
            <div className="flex items-center gap-2">
              {hasInStore && (
                <Badge
                  variant="secondary"
                  className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground/80"
                >
                  <Store className="mr-1 h-3.5 w-3.5 text-pink-500" />
                  {t("admin.collectionsDataTable.channels.inStore")}
                </Badge>
              )}
              {hasOnline && (
                <Badge
                  variant="secondary"
                  className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground/80"
                >
                  <Globe className="mr-1 h-3.5 w-3.5 text-teal-500" />
                  {t("admin.collectionsDataTable.channels.online")}
                </Badge>
              )}
            </div>
          );
        },
        className: "w-[240px]",
      },
    ],
    [locale, t]
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("admin.collectionsDataTable.tabs.all") },
      { id: "active", label: t("admin.collectionsDataTable.tabs.active") },
      { id: "draft", label: t("admin.collectionsDataTable.tabs.draft") },
    ],
    [t]
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
          {
            label: t("admin.collectionsDataTable.filters.automated"),
            value: "automated",
          },
        ],
      },
    ],
    [t]
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.collectionsDataTable.title"),
        addAction: {
          id: "add",
          label: t("admin.collectionsDataTable.actions.addCollection"),
          href: `/${locale}/admin/collections/new`,
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
              onClick: handleExportCollections,
            },
            {
              id: "toolbar-import",
              label: t("admin.collectionsDataTable.actions.import"),
              icon: <Upload className="h-4 w-4" />,
              onClick: handleImportCollections,
            },
          ],
        },
      }),
    [handleExportCollections, handleImportCollections, locale, t],
  );

  const bulkActions = useMemo<DataTableBulkAction<Collection>[]>(
    () => [
      {
        id: "set-active",
        label: t("admin.collectionsDataTable.bulkActions.setActive"),
        icon: <CheckCircle2 className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatusUpdate(items, "active"),
      },
      {
        id: "set-draft",
        label: t("admin.collectionsDataTable.bulkActions.setDraft"),
        icon: <CircleDot className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatusUpdate(items, "draft"),
      },
      {
        id: "delete",
        label: t("admin.collectionsDataTable.bulkActions.delete"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: handleBulkDelete,
      },
    ],
    [handleBulkDelete, handleBulkStatusUpdate, t]
  );

  const rowActions = useCallback(
    (row: Collection): DataTableAction[] => [
      {
        id: "edit",
        label: t("admin.collectionsDataTable.rowActions.edit"),
        icon: <Pencil className="h-4 w-4" />,
        href: `/${locale}/admin/collections/${row._id}`,
      },
      {
        id: "delete",
        label: t("admin.collectionsDataTable.rowActions.delete"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => handleDelete(row),
      },
    ],
    [locale, handleDelete, t]
  );

  return (
    <>
      <input
        id={importInputId}
        type="file"
        accept=".csv,text/csv"
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
        onTabChange={list.handleTabChange}
        actions={tableHeader.actions}
        selectable
        selectedItems={selectedCollections}
        onSelectionChange={setSelectedCollections}
        bulkActions={bulkActions}
        searchable
        searchPlaceholder={t("admin.collectionsDataTable.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={list.filters}
        onFilterChange={list.handleFilterChange}
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
        rowActionsHeader={t("admin.collectionsDataTable.rowActionsHeader")}
        rowActionsVariant="inline"
        onRowClick={(row) =>
          router.push(`/${locale}/admin/collections/${row._id}`)
        }
        emptyMessage={t("admin.collectionsDataTable.empty")}
        emptyIcon={<Layers className="h-8 w-8" />}
      />
    </>
  );
}
