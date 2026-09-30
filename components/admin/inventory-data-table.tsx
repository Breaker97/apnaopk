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
import {
  figuresForStock,
  stockAdjustment,
  targetStockForEdit,
  type StockEditField,
} from "@/lib/inventory/stock-edit";
import {
  InventoryUnavailableDialog,
  type UnavailableStockTarget,
} from "@/components/admin/inventory-unavailable-dialog";

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
  /** What the store can still sell. */
  available: number;
  /** Sold and still on the premises — not shipped, collected or called off. */
  committed: number;
  /** Returned damaged, incomplete or unusable, not yet restocked or written off. */
  unavailable: number;
  /** Available + committed + unavailable: what a shelf count finds. */
  onHand: number;
  /** Shipped on a transfer and not yet received. */
  incoming?: number;
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
  // Unsaved edits, as the stock each edited row asks for (see
  // lib/inventory/stock-edit.ts — Available and On hand are one number).
  const [pendingStock, setPendingStock] = useState<Map<string, number>>(
    new Map(),
  );
  const [unavailableTarget, setUnavailableTarget] =
    useState<UnavailableStockTarget | null>(null);

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

  // The rows as fetched, which every edit and save measures against.
  const fetchedRows = useMemo(
    () => new Map(list.items.map((item) => [item.id, item])),
    [list.items],
  );

  // Overlay unsaved quantity edits on top of the fetched rows.
  const displayItems = useMemo(
    () =>
      list.items.map((item) => {
        const pending = pendingStock.get(item.id);
        return pending === undefined
          ? item
          : { ...item, ...figuresForStock(item, pending) };
      }),
    [list.items, pendingStock],
  );

  const selectedLocationId =
    list.filters.location && list.filters.location !== "all"
      ? list.filters.location
      : undefined;

  const openUnavailable = useCallback((row: InventoryItem) => {
    setUnavailableTarget({
      productId: row.productId,
      variantId: row.variantId,
      productName: row.productName,
      variantName: row.variantName,
    });
  }, []);

  const openLabelStudio = useCallback((items: InventoryItem[]) => {
    setLabelItems(items);
    setLabelStudioOpen(true);
  }, []);

  const handleLabelStudioOpenChange = useCallback((open: boolean) => {
    setLabelStudioOpen(open);
    if (!open) setLabelItems([]);
  }, []);

  const handleQuantityChange = useCallback(
    (item: InventoryItem, field: StockEditField, value: number) => {
      if (readOnly) return;
      const fetched = fetchedRows.get(item.id) || item;
      const target = targetStockForEdit(fetched, field, value);

      setPendingStock((prev) => {
        const next = new Map(prev);
        // Typing the figure back to what it was leaves nothing to save.
        if (stockAdjustment(fetched, target) === 0) next.delete(item.id);
        else next.set(item.id, target);
        return next;
      });
    },
    [fetchedRows, readOnly],
  );

  const discardChanges = useCallback(() => {
    setPendingStock(new Map());
    list.refetch();
  }, [list]);

  const saveChanges = async () => {
    if (pendingStock.size === 0) return;

    setIsSaving(true);
    try {
      // Sent as adjustments: a sale that landed since the page loaded is kept,
      // and with a location selected the change lands on that location rather
      // than writing the store-wide figure into it.
      const updates = Array.from(pendingStock.entries()).flatMap(
        ([key, target]) => {
          const row = fetchedRows.get(key);
          if (!row) return [];
          const adjustment = stockAdjustment(row, target);
          if (adjustment === 0) return [];
          return [
            {
              productId: row.productId,
              variantId: row.variantId || undefined,
              quantity: adjustment,
              adjustment: true,
              locationId: selectedLocationId,
            },
          ];
        },
      );

      if (updates.length > 0) await apiClient.patch(apiEndpoint, { updates });

      toast.success(t("admin.inventory.updateSuccess"));
      setPendingStock(new Map());
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
      t("admin.inventory.csvHeaders.unavailable"),
      t("admin.inventory.csvHeaders.committed"),
      t("admin.inventory.csvHeaders.available"),
      t("admin.inventory.csvHeaders.onHand"),
    ];
    const rows = displayItems.map((item) => [
      item.productName,
      item.variantName || "",
      item.sku,
      item.barcode,
      String(item.unavailable),
      String(item.committed),
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
        // Takes the width the fixed columns leave; ProductCell truncates the
        // title to it, so a long name no longer pushes the table sideways.
        className: "w-full max-w-0",
      },
      {
        id: "sku",
        header: t("admin.inventory.columns.sku"),
        cell: (row) => (
          <TextCell
            value={row.sku}
            truncate
            maxWidth="160px"
            className="font-mono text-sm"
          />
        ),
        // Column visibility steps with the viewport, like the Orders table,
        // so the Product column always keeps ~270px without a sideways scroll.
        className: "w-[208px] hidden xl:table-cell",
        headerClassName: "hidden xl:table-cell",
      },
      {
        id: "barcode",
        header: t("admin.inventory.columns.barcode"),
        cell: (row) => (
          <TextCell value={row.barcode || "--"} className="font-mono text-sm" />
        ),
        // Wide screens only: the stock breakdown columns come first.
        className: "w-[170px] hidden min-[1700px]:table-cell",
        headerClassName: "hidden min-[1700px]:table-cell",
      },
      {
        id: "unavailable",
        header: (
          <span title={t("admin.inventory.columns.unavailableHint")}>
            {t("admin.inventory.columns.unavailable")}
          </span>
        ),
        cell: (row) => (
          <UnavailableCount row={row} onOpen={openUnavailable} />
        ),
        className: "text-center w-[100px] hidden min-[1400px]:table-cell",
        headerClassName: "text-center hidden min-[1400px]:table-cell",
      },
      {
        id: "committed",
        header: (
          <span title={t("admin.inventory.columns.committedHint")}>
            {t("admin.inventory.columns.committed")}
          </span>
        ),
        cell: (row) => (
          <TextCell
            value={row.committed}
            className={
              row.committed
                ? "text-center font-medium"
                : "text-center text-muted-foreground"
            }
          />
        ),
        className: "text-center w-[100px] hidden min-[1400px]:table-cell",
        headerClassName: "text-center hidden min-[1400px]:table-cell",
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
          <div className="flex flex-col items-center gap-1">
            <NumberInput
              // Committed and unavailable units are on the shelf whatever the
              // stock is, so On hand never goes below them.
              min={row.committed + row.unavailable}
              step={1}
              value={row.onHand}
              disabled={readOnly}
              whenEmpty={row.committed + row.unavailable}
              normalize={Math.trunc}
              onValueChange={(next) => handleQuantityChange(row, "onHand", next ?? 0)}
              className="h-8 w-20 text-center mx-auto"
            />
            {/* Below the width that shows the breakdown columns, the parts of
                On hand that are not Available are named under it. */}
            {row.committed > 0 || row.unavailable > 0 ? (
              <span className="flex flex-wrap justify-center gap-x-1.5 text-[11px] leading-tight text-muted-foreground min-[1400px]:hidden">
                {row.committed > 0 ? (
                  <span>{t("admin.inventory.breakdown.committed", { count: row.committed })}</span>
                ) : null}
                {row.unavailable > 0 ? (
                  <button
                    type="button"
                    className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    onClick={() => openUnavailable(row)}
                  >
                    {t("admin.inventory.breakdown.unavailable", { count: row.unavailable })}
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        ),
        className: "text-center w-[120px]",
      },
      {
        id: "incoming",
        header: t("admin.inventory.columns.incoming"),
        cell: (row) => (
          <TextCell
            value={row.incoming || 0}
            className={
              row.incoming
                ? "text-center font-medium text-blue-600 dark:text-blue-400"
                : "text-center text-muted-foreground"
            }
          />
        ),
        className: "text-center w-[100px] hidden 2xl:table-cell",
        headerClassName: "text-center hidden 2xl:table-cell",
      },
    ],
    [locale, productHrefBase, t, handleQuantityChange, readOnly, openUnavailable],
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

  const hasChanges = pendingStock.size > 0;

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
        rowActionsVariant="dropdown"
        // Empty state
        emptyMessage={t("admin.inventory.empty")}
      />

      <InventoryUnavailableDialog
        target={unavailableTarget}
        onOpenChange={(open) => {
          if (!open) setUnavailableTarget(null);
        }}
        apiEndpoint={apiEndpoint}
        readOnly={readOnly}
        onChanged={list.refetch}
      />

      <BarcodeLabelStudio
        open={labelStudioOpen}
        onOpenChange={handleLabelStudioOpenChange}
        items={labelItems as BarcodeLabelInventoryItem[]}
      />

      {/* Unsaved-changes bar */}
      <InventorySaveBar
        open={hasChanges && !readOnly}
        count={pendingStock.size}
        isSaving={isSaving}
        onDiscard={discardChanges}
        onSave={saveChanges}
      />
    </div>
  );
}

/** The Unavailable figure; a count above zero opens what makes it up. */
function UnavailableCount({
  row,
  onOpen,
}: {
  row: InventoryItem;
  onOpen: (row: InventoryItem) => void;
}) {
  if (!row.unavailable) {
    return <TextCell value={0} className="text-center text-muted-foreground" />;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="mx-auto block font-medium text-amber-700 underline decoration-dotted underline-offset-4 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
    >
      {row.unavailable}
    </button>
  );
}
