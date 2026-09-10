"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Barcode, Download, Upload, ChevronsUpDown } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { toast } from "@/components/ui/toast-notification";
import {
  DataTable,
  ProductCell,
  TextCell,
  type DataTableColumn,
  type DataTableTab,
  type DataTableFilter,
  type DataTableAction,
  type DataTableBulkAction,
} from "@/components/ui/data-table";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { InventorySaveBar } from "@/components/admin/inventory-save-bar";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import {
  BarcodeLabelStudio,
  type BarcodeLabelInventoryItem,
} from "@/components/barcode/barcode-label-studio";
import type { BarcodeFormat } from "@/lib/barcode/standards";

interface InventoryItem {
  id: string; // Added unique key for DataTable
  productId: string;
  productName: string;
  productImage: string | null;
  variantId: string | null;
  variantName: string | null;
  sku: string;
  barcode: string;
  barcodeFormat?: BarcodeFormat;
  barcodeSource?: "manufacturer" | "gs1" | "internal";
  price: number;
  unavailable: number;
  committed: number;
  available: number;
  onHand: number;
  locationInventory: Array<{
    locationId: string;
    locationName: string;
    quantity: number;
  }>;
}

interface InventoryDataTableProps {
  locale: string;
  readOnly?: boolean;
  productHrefBase?: string;
  title?: string;
  /** Endpoint the inline stock edits PATCH to. */
  apiEndpoint?: string;
  /** Rows for the current query string, fetched by the page. */
  data: InventoryItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  /** Stock locations, for the location filter. */
  locations: { _id: string; name: string; isDefault?: boolean }[];
}

const INVENTORY_FILTER_IDS = ["location", "barcodeStatus"];

export function InventoryDataTable({
  locale,
  readOnly = false,
  apiEndpoint = "/api/admin/inventory",
  productHrefBase = "admin/products",
  title,
  data,
  pagination,
  locations,
}: InventoryDataTableProps) {
  const t = useTranslations();
  const printBarcodeLabelsLabel = "Print barcode labels";

  const [isSaving, setIsSaving] = useState(false);
  const [selectedItems, setSelectedItems] = useState<InventoryItem[]>([]);
  const [labelItems, setLabelItems] = useState<InventoryItem[]>([]);
  const [labelStudioOpen, setLabelStudioOpen] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<
    Map<string, { available: number; onHand: number }>
  >(new Map());

  const list = useListNavigation<InventoryItem>({
    // Rows are variant-level, so the table's key has to combine both ids.
    items: useMemo(
      () =>
        data.map((item) => ({
          ...item,
          id: `${item.productId}-${item.variantId || "main"}`,
        })),
      [data],
    ),
    pagination,
    tabParam: "stockLevel",
    filterIds: INVENTORY_FILTER_IDS,
    defaultSortBy: "productName",
    defaultPageSize: 50,
  });

  // Overlay unsaved quantity edits on top of the fetched rows.
  const displayItems = useMemo(
    () =>
      list.items.map((item) => {
        const pending = pendingUpdates.get(item.id);
        return pending ? { ...item, ...pending } : item;
      }),
    [list.items, pendingUpdates],
  );

  const selectedLocationId =
    list.filters.location && list.filters.location !== "all"
      ? list.filters.location
      : undefined;

  const openLabelStudio = useCallback((items: InventoryItem[]) => {
    setLabelItems(items);
    setLabelStudioOpen(true);
  }, []);

  const handleLabelStudioOpenChange = useCallback((open: boolean) => {
    setLabelStudioOpen(open);
    if (!open) setLabelItems([]);
  }, []);

  const handleQuantityChange = useCallback(
    (item: InventoryItem, field: "available" | "onHand", value: number) => {
      if (readOnly) return;
      const key = `${item.productId}-${item.variantId || "main"}`;

      setPendingUpdates((prev) => {
        const existing = prev.get(key) || {
          available: item.available,
          onHand: item.onHand,
        };
        const next = new Map(prev);
        next.set(key, { ...existing, [field]: value });
        return next;
      });
    },
    [readOnly],
  );

  const discardChanges = useCallback(() => {
    setPendingUpdates(new Map());
    list.refetch();
  }, [list]);

  const saveChanges = async () => {
    if (pendingUpdates.size === 0) return;

    setIsSaving(true);
    try {
      const updates = Array.from(pendingUpdates.entries()).map(
        ([key, values]) => {
          const [productId, variantId] = key.split("-");
          return {
            productId,
            variantId: variantId === "main" ? undefined : variantId,
            quantity: values.onHand,
            locationId: selectedLocationId,
          };
        },
      );

      await apiClient.patch(apiEndpoint, { updates });

      toast.success(t("admin.inventory.updateSuccess"));
      setPendingUpdates(new Map());
      list.refetch();
    } catch (error) {
      console.error("Failed to save inventory:", error);
      toast.error(t("admin.inventory.updateError"));
    } finally {
      setIsSaving(false);
    }
  };

  const translateSystemLocationName = useCallback(
    (name: string) => {
      const normalized = name.trim().toLowerCase();
      const knownLabels: Record<string, string> = {
        online: t("admin.inventory.tabs.online"),
        "online store": t("admin.inventory.tabs.onlineStore"),
        "main warehouse": t("admin.inventory.tabs.mainWarehouse"),
        "storify warehouse": t("admin.inventory.tabs.storifyWarehouse"),
        "store front": t("admin.inventory.tabs.storeFront"),
        "secondary storage": t("admin.inventory.tabs.secondaryStorage"),
      };
      return knownLabels[normalized] || name;
    },
    [t],
  );

  const exportInventory = useCallback(() => {
    const headers = [
      t("admin.inventory.csvHeaders.product"),
      t("admin.inventory.csvHeaders.variant"),
      t("admin.inventory.csvHeaders.sku"),
      t("admin.inventory.csvHeaders.barcode"),
      t("admin.inventory.csvHeaders.available"),
      t("admin.inventory.csvHeaders.onHand"),
    ];
    const rows = displayItems.map((item) => [
      item.productName,
      item.variantName || "",
      item.sku,
      item.barcode,
      String(item.available),
      String(item.onHand),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayItems, t]);

  // Columns
  const columns = useMemo<DataTableColumn<InventoryItem>[]>(
    () => [
      {
        id: "product",
        header: t("admin.inventory.columns.product"),
        cell: (row) => (
          <ProductCell
            image={row.productImage}
            title={row.productName}
            subtitle={row.variantName || undefined}
            href={
              productHrefBase
                ? `/${locale}/${productHrefBase}/${row.productId}/edit`
                : undefined
            }
          />
        ),
      },
      {
        id: "sku",
        header: t("admin.inventory.columns.sku"),
        cell: (row) => (
          <TextCell value={row.sku} className="font-mono text-sm" />
        ),
        className: "w-[150px]",
      },
      {
        id: "barcode",
        header: t("admin.inventory.columns.barcode"),
        cell: (row) => (
          <TextCell value={row.barcode || "--"} className="font-mono text-sm" />
        ),
        className: "w-[170px]",
      },
      {
        id: "unavailable",
        header: t("admin.inventory.columns.unavailable"),
        cell: (row) => (
          <TextCell
            value={row.unavailable}
            className="text-center text-muted-foreground"
          />
        ),
        className: "text-center w-[100px]",
      },
      {
        id: "committed",
        header: t("admin.inventory.columns.committed"),
        cell: (row) => (
          <TextCell
            value={row.committed}
            className="text-center text-muted-foreground"
          />
        ),
        className: "text-center w-[100px]",
      },
      {
        id: "available",
        header: t("admin.inventory.columns.available"),
        cell: (row) => (
          <NumberInput
            min={0}
            step={1}
            value={row.available}
            disabled={readOnly}
            whenEmpty={0}
            normalize={Math.trunc}
            onValueChange={(next) =>
              handleQuantityChange(row, "available", next ?? 0)
            }
            className="h-8 w-20 text-center mx-auto"
          />
        ),
        className: "text-center w-[120px]",
      },
      {
        id: "onHand",
        header: t("admin.inventory.columns.onHand"),
        cell: (row) => (
          <NumberInput
            min={0}
            step={1}
            value={row.onHand}
            disabled={readOnly}
            whenEmpty={0}
            normalize={Math.trunc}
            onValueChange={(next) => handleQuantityChange(row, "onHand", next ?? 0)}
            className="h-8 w-20 text-center mx-auto"
          />
        ),
        className: "text-center w-[120px]",
      },
    ],
    [locale, productHrefBase, t, handleQuantityChange, readOnly],
  );

  // Tabs (Stock status)
  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("admin.inventory.tabs.all") },
      { id: "in", label: t("common.inStock") },
      { id: "low", label: t("admin.inventory.filters.lowStock") },
      { id: "out", label: t("admin.inventory.filters.outOfStock") },
    ],
    [t],
  );

  // Filters
  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "location",
        label: t("admin.inventory.stats.locations"),
        type: "select",
        options: [
          { label: t("admin.inventory.filters.all"), value: "all" },
          ...locations.map((loc) => ({
            label: translateSystemLocationName(loc.name),
            value: loc._id,
          })),
        ],
      },
      {
        id: "barcodeStatus",
        label: t("admin.inventory.columns.barcode"),
        type: "select",
        options: [
          { label: t("admin.inventory.filters.all"), value: "all" },
          { label: "Has barcode", value: "withBarcode" },
          { label: "Missing barcode", value: "withoutBarcode" },
        ],
      },
    ],
    [locations, t, translateSystemLocationName],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: title || t("admin.inventory.title"),
        secondaryActions: [
          {
            id: "print-barcode-labels",
            label: printBarcodeLabelsLabel,
            icon: <Barcode className="h-4 w-4" />,
            onClick: () => openLabelStudio(selectedItems),
            disabled: selectedItems.length === 0,
          },
        ],
        importExportAction: {
          id: "import-export",
          label: t("admin.productsDataTable.actions.importExport"),
          icon: <ChevronsUpDown className="h-4 w-4" />,
          variant: "outline",
          items: [
            {
              id: "toolbar-export",
              label: t("admin.inventory.export"),
              icon: <Download className="h-4 w-4" />,
              onClick: exportInventory,
            },
            {
              id: "toolbar-import",
              label: t("admin.inventory.import"),
              icon: <Upload className="h-4 w-4" />,
              disabled: true,
            },
          ],
        },
      }),
    [
      exportInventory,
      openLabelStudio,
      printBarcodeLabelsLabel,
      selectedItems,
      t,
      title,
    ],
  );

  const bulkActions = useMemo<DataTableBulkAction<InventoryItem>[]>(
    () => [
      {
        id: "bulk-print-barcode-labels",
        label: printBarcodeLabelsLabel,
        icon: <Barcode className="h-4 w-4" />,
        onClick: (items) => openLabelStudio(items),
      },
    ],
    [openLabelStudio, printBarcodeLabelsLabel],
  );

  const rowActions = useCallback(
    (row: InventoryItem): DataTableAction[] => [
      {
        id: "print-barcode-labels",
        label: printBarcodeLabelsLabel,
        icon: <Barcode className="h-4 w-4" />,
        onClick: () => openLabelStudio([row]),
        disabled: !row.barcode.trim(),
      },
    ],
    [openLabelStudio, printBarcodeLabelsLabel],
  );

  const hasChanges = pendingUpdates.size > 0;

  return (
    <div className="space-y-4">
      <DataTable
        data={displayItems}
        columns={columns}
        keyField="id"
        isLoading={list.isLoading}
        loadingMode="rows"
        // Header
        title={tableHeader.title}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        actions={tableHeader.actions}
        // Selection
        selectable
        selectedItems={selectedItems}
        onSelectionChange={setSelectedItems}
        bulkActions={bulkActions}
        // Search
        searchable
        searchPlaceholder={t("admin.inventory.searchPlaceholder")}
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
        // Pagination
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        // Row actions
        rowActions={rowActions}
        rowActionsHeader={t("common.actions")}
        rowActionsVariant="inline"
        // Empty state
        emptyMessage={t("admin.inventory.empty")}
      />

      <BarcodeLabelStudio
        open={labelStudioOpen}
        onOpenChange={handleLabelStudioOpenChange}
        items={labelItems as BarcodeLabelInventoryItem[]}
      />

      {/* Unsaved-changes bar */}
      <InventorySaveBar
        open={hasChanges && !readOnly}
        count={pendingUpdates.size}
        isSaving={isSaving}
        onDiscard={discardChanges}
        onSave={saveChanges}
      />
    </div>
  );
}
