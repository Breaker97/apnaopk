"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Package } from "lucide-react";
import { useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTableHeader } from "./data-table-header";
import { DataTableToolbar } from "./data-table-toolbar";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableRowActions } from "./data-table-row-actions";
import type { DataTableColumn, DataTableProps } from "./types";
import { Card } from "../card";

export function DataTable<T extends object>({
  data,
  columns,
  keyField,
  isLoading = false,
  loadingMode = "replace",
  loadingRows = 5,

  // Header
  title,
  titleIcon,
  tabs,
  activeTab,
  onTabChange,
  actions,

  // Selection
  selectable = false,
  selectedItems = [],
  onSelectionChange,
  bulkActions,

  // Search & Filters
  searchable = false,
  searchPlaceholder,
  searchValue = "",
  searchDebounceMs = 400,
  onSearchChange,
  onSearchSubmit,
  filters,
  filterValues = {},
  onFilterChange,
  toolbarActions,
  toolbarLayout = "default",
  toolbarDensity,
  tabsVariant = "pills",
  filtersVariant = "chips",
  appearance = "default",
  stackedTopControls,
  showToolbarSortButton = true,

  // Pagination
  pagination,
  onPageChange,
  onPageSizeChange,
  paginationLabels,
  toolbarLabels,

  // Sorting
  sortColumn,
  sortDirection,
  onSortChange,

  // Row actions
  onRowClick,
  rowActions,
  rowActionsHeader,
  rowActionsVariant = "dropdown",

  // Empty state
  emptyMessage,
  emptyIcon,

  // Customization
  className,
  dense = false,
}: DataTableProps<T>) {
  const t = useTranslations();
  const tt = useCallback(
    (key: string, fallback: string) => {
      try {
        return t(key);
      } catch {
        return fallback;
      }
    },
    [t],
  );
  const selectAllLabel = tt("ui.dataTable.selectAll", "Select all");
  const getSelectRowLabel = useCallback(
    (rowKey: string) => {
      try {
        return t("ui.dataTable.selectRow", { key: rowKey });
      } catch {
        return `Select row ${rowKey}`;
      }
    },
    [t],
  );
  const emptyText =
    emptyMessage ?? tt("ui.dataTable.noResults", "No results found");
  const resolvedToolbarDensity =
    toolbarDensity ?? (appearance === "commerce" ? "compact" : "default");

  // Filter visible columns
  const visibleColumns = useMemo(
    () => columns.filter((col) => !col.hidden),
    [columns],
  );

  // Selection handlers
  const allSelected = useMemo(
    () => data.length > 0 && selectedItems.length === data.length,
    [data.length, selectedItems.length],
  );

  const someSelected = useMemo(
    () => selectedItems.length > 0 && selectedItems.length < data.length,
    [data.length, selectedItems.length],
  );

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      onSelectionChange?.([]);
    } else {
      onSelectionChange?.(data);
    }
  }, [allSelected, data, onSelectionChange]);

  const handleSelectRow = useCallback(
    (row: T) => {
      const key = row[keyField];
      const isSelected = selectedItems.some((item) => item[keyField] === key);
      if (isSelected) {
        onSelectionChange?.(
          selectedItems.filter((item) => item[keyField] !== key),
        );
      } else {
        onSelectionChange?.([...selectedItems, row]);
      }
    },
    [keyField, selectedItems, onSelectionChange],
  );

  const isRowSelected = useCallback(
    (row: T) => selectedItems.some((item) => item[keyField] === row[keyField]),
    [keyField, selectedItems],
  );

  // Render cell content
  const renderCell = useCallback((row: T, column: DataTableColumn<T>) => {
    if (column.cell) {
      return column.cell(row);
    }
    if (column.accessorKey) {
      const value = row[column.accessorKey];
      return value != null ? String(value) : "";
    }
    return null;
  }, []);

  // Loading skeleton
  if (isLoading && loadingMode === "replace") {
    return (
      <div className={cn("space-y-0", className)}>
        {(title || tabs || actions) && (
          <DataTableHeader
            title={title}
            titleIcon={titleIcon}
            actions={actions}
            isLoading
          />
        )}
        {(searchable || filters) && (
          <DataTableToolbar
            searchable={searchable}
            searchPlaceholder={searchPlaceholder}
            searchValue={searchValue}
            searchDebounceMs={searchDebounceMs}
            onSearchChange={onSearchChange}
            onSearchSubmit={onSearchSubmit}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={onFilterChange}
            toolbarActions={toolbarActions}
            toolbarLayout={toolbarLayout}
            toolbarDensity={resolvedToolbarDensity}
            tabsVariant={tabsVariant}
            filtersVariant={filtersVariant}
            appearance={appearance}
            stackedTopControls={stackedTopControls}
            showToolbarSortButton={showToolbarSortButton}
            isLoading
            labels={toolbarLabels}
          />
        )}
        <DataTableSkeleton
          columns={
            visibleColumns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)
          }
          rows={loadingRows}
          dense={dense}
        />
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "gap-0 space-y-0 rounded-[12px] p-4",
        appearance === "commerce" &&
          "rounded-[12px] border border-border bg-card p-6 shadow-none",
        className,
      )}
    >
      {/* Header with title and actions */}
      {(title || actions) && (
        <DataTableHeader
          title={title}
          titleIcon={titleIcon}
          // Tabs are now in Toolbar
          actions={actions}
          selectedCount={selectedItems.length}
          bulkActions={bulkActions}
          selectedItems={selectedItems}
        />
      )}

      {/* Main Card with Toolbar and Table */}
      <div
        className={cn(
          "overflow-hidden rounded-[12px] border bg-card text-card-foreground shadow-sm",
          appearance === "commerce" &&
            "rounded-[12px] border-border bg-card shadow-none",
        )}
      >
        {/* Toolbar with search, filters, and tabs */}
        {(searchable || filters || tabs) && (
          <div className={cn(appearance === "commerce" ? "px-0" : "px-2")}>
            <DataTableToolbar
              searchable={searchable}
              searchPlaceholder={searchPlaceholder}
              searchValue={searchValue}
              searchDebounceMs={searchDebounceMs}
              onSearchChange={onSearchChange}
              onSearchSubmit={onSearchSubmit}
              filters={filters}
              filterValues={filterValues}
              onFilterChange={onFilterChange}
              toolbarActions={toolbarActions}
              toolbarLayout={toolbarLayout}
              toolbarDensity={resolvedToolbarDensity}
              tabsVariant={tabsVariant}
              filtersVariant={filtersVariant}
              appearance={appearance}
              stackedTopControls={stackedTopControls}
              showToolbarSortButton={showToolbarSortButton}
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={onTabChange}
              sortColumn={sortColumn}
              sortDirection={sortDirection}
              onSortChange={onSortChange}
              totalItems={pagination?.total}
              labels={toolbarLabels}
            />
          </div>
        )}

        {/* Table */}
        <Table className={cn(appearance === "commerce" && "text-[15px]")}>
          <TableHeader>
            <TableRow
              className={cn(
                "bg-muted/50 hover:bg-muted/50",
                appearance === "commerce" &&
                  "border-border bg-card hover:bg-card",
              )}
            >
              {selectable && (
                <TableHead
                  className={cn(
                    "w-[40px]",
                    appearance === "commerce" && "px-6",
                  )}
                >
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label={selectAllLabel}
                  />
                </TableHead>
              )}
              {visibleColumns.map((column) => (
                <TableHead
                  key={column.id}
                  className={cn(
                    column.className,
                    column.headerClassName,
                    column.sortable && "cursor-pointer select-none",
                    appearance === "commerce" &&
                      "h-14 px-6 text-[15px] font-medium text-muted-foreground",
                    dense && "py-2",
                  )}
                  onClick={
                    column.sortable && onSortChange
                      ? () =>
                          onSortChange(
                            column.id,
                            sortColumn === column.id && sortDirection === "asc"
                              ? "desc"
                              : "asc",
                          )
                      : undefined
                  }
                >
                  {/* Inline, not block: a flex container ignores the
                      `text-right` a numeric column puts on its header cell, so
                      the label sat over empty space while its figures hugged
                      the right edge. An inline-level box obeys text-align. */}
                  <div className="inline-flex items-center gap-1">
                    {column.header}
                    {column.sortable && sortColumn === column.id && (
                      <span className="text-xs">
                        {sortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </div>
                </TableHead>
              ))}
              {rowActions && (
                <TableHead
                  className={cn(
                    "w-[120px] pr-4 text-right",
                    appearance === "commerce" &&
                      "px-6 text-[15px] text-muted-foreground",
                  )}
                >
                  {rowActionsHeader}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && loadingMode === "rows" ? (
              Array.from({ length: loadingRows }).map((_, rowIndex) => (
                <TableRow
                  key={`loading-row-${rowIndex}`}
                  className={cn(appearance === "commerce" && "border-border")}
                >
                  {selectable && (
                    <TableCell
                      className={cn(
                        dense && "py-2",
                        appearance === "commerce" && "px-6 py-4",
                      )}
                    >
                      <Skeleton className="h-4 w-4 rounded-sm" />
                    </TableCell>
                  )}
                  {visibleColumns.map((column, colIndex) => (
                    <TableCell
                      key={`loading-cell-${column.id}-${rowIndex}`}
                      className={cn(
                        column.className,
                        dense && "py-2",
                        appearance === "commerce" && "px-6 py-4",
                      )}
                    >
                      <Skeleton
                        className={cn(
                          "h-4",
                          colIndex === 0
                            ? "w-32"
                            : colIndex === visibleColumns.length - 1
                              ? "w-20"
                              : "w-24",
                        )}
                      />
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell
                      className={cn(
                        "pr-4",
                        dense && "py-2",
                        appearance === "commerce" && "px-6 py-4",
                      )}
                    >
                      <div className="flex justify-end">
                        <Skeleton className="h-8 w-8 rounded-md" />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={
                    visibleColumns.length +
                    (selectable ? 1 : 0) +
                    (rowActions ? 1 : 0)
                  }
                  className={cn(
                    "h-32",
                    appearance === "commerce" && "px-6 py-10",
                  )}
                >
                  <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    {emptyIcon || <Package className="h-8 w-8" />}
                    <p className="text-sm">{emptyText}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => {
                const key = String(row[keyField]);
                const selected = isRowSelected(row);
                return (
                  <TableRow
                    key={key}
                    className={cn(
                      selected && "bg-muted/50",
                      onRowClick && "cursor-pointer",
                      appearance === "commerce" &&
                        "border-border bg-card hover:bg-muted/40 data-[state=selected]:bg-muted/50",
                    )}
                    onClick={() => onRowClick?.(row)}
                    data-state={selected ? "selected" : undefined}
                  >
                    {selectable && (
                      <TableCell
                        className={cn(
                          dense && "py-2",
                          appearance === "commerce" && "px-6 py-4",
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => handleSelectRow(row)}
                          aria-label={getSelectRowLabel(key)}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.map((column) => (
                      <TableCell
                        key={column.id}
                        className={cn(
                          column.className,
                          dense && "py-2",
                          appearance === "commerce" && "px-6 py-4",
                        )}
                      >
                        {renderCell(row, column)}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell
                        className={cn(
                          "cursor-default pr-4",
                          dense && "py-2",
                          appearance === "commerce" && "px-6 py-4",
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex justify-end">
                          <DataTableRowActions
                            actions={rowActions(row)}
                            variant={rowActionsVariant}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {/* Pagination */}
      {pagination && (
        <DataTablePagination
          pagination={pagination}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          labels={paginationLabels}
        />
      )}
    </Card>
  );
}

function DataTableSkeleton({
  columns,
  rows,
  dense,
}: {
  columns: number;
  rows: number;
  dense?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[12px] border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            {Array.from({ length: columns }).map((_, i) => (
              <TableHead key={i} className={cn(dense && "py-2")}>
                <Skeleton className="h-4 w-20" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <TableCell key={colIndex} className={cn(dense && "py-2")}>
                  <Skeleton
                    className={cn(
                      "h-4",
                      colIndex === 0 ? "w-8" : colIndex === 1 ? "w-32" : "w-16",
                    )}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
