"use client";

import { ReactNode } from "react";
import type {
  AppliedDateRange,
  DateRangePreset,
} from "@/components/ui/date-range-picker";

export interface DataTableColumn<T> {
  id: string;
  header: string | ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  hidden?: boolean;
}

export interface DataTableTab {
  id: string;
  label: string;
  count?: number;
  filter?: Record<string, unknown>;
}

export interface DataTableAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  items?: DataTableAction[];
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
  /** Short secondary line under the label, e.g. why the action is disabled. */
  hint?: string;
  className?: string;
}

export interface DataTableBulkAction<T> {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: (selectedItems: T[]) => void | Promise<void>;
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DataTablePaginationLabels {
  showing?: string;
  to?: string;
  of?: string;
  results?: string;
  rowsPerPage?: string;
}

export interface DataTableToolbarLabels {
  cancel?: string;
  search?: string;
  sort?: string;
  sortedAscending?: string;
  sortedDescending?: string;
  viewOptions?: string;
  focusSearch?: string;
  filter?: string;
  clearAll?: string;
  clearAllFilters?: string;
}

/**
 * What a `type: "date"` filter needs to draw its picker.
 *
 * The filter's value is a preset's id, or two days joined by `_` for a picked
 * range (see `lib/date-filter.ts`); "all" is no filter, so a preset with that
 * id clears it. The table supplies the presets because what "this week" means
 * belongs to the screen, not to the generic toolbar.
 */
export interface DataTableDateFilter {
  locale: string;
  presets: DateRangePreset[];
  presetsTitle?: string;
  customLabel: string;
  cancelLabel: string;
  applyLabel: string;
  /** Footer text beside Apply, given the range currently drafted. */
  summary?: (draft: AppliedDateRange | null) => ReactNode;
  /** Days after this one cannot be picked. */
  maxDate?: Date;
}

export interface DataTableFilter {
  id: string;
  label: string;
  type: "select" | "search" | "date";
  options?: { label: string; value: string }[];
  placeholder?: string;
  /** Required for `type: "date"`. */
  date?: DataTableDateFilter;
  /**
   * The value a bare list stands for when it is not "all", e.g. a date filter
   * whose default window is the last 30 days. It is shown on the row but not
   * counted as an active filter, and clearing a filter returns to it.
   */
  defaultValue?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  keyField: keyof T;
  isLoading?: boolean;
  loadingMode?: "replace" | "rows";
  loadingRows?: number;

  // Header
  title?: string;
  titleIcon?: ReactNode;
  tabs?: DataTableTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  actions?: DataTableAction[];

  // Selection
  selectable?: boolean;
  selectedItems?: T[];
  onSelectionChange?: (items: T[]) => void;
  bulkActions?: DataTableBulkAction<T>[];

  // Search & Filters
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  searchDebounceMs?: number;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
  filters?: DataTableFilter[];
  filterValues?: Record<string, string>;
  onFilterChange?: (filterId: string, value: string) => void;
  toolbarActions?: DataTableAction[];
  toolbarLayout?: "default" | "stacked";
  toolbarDensity?: "default" | "compact";
  tabsVariant?: "pills" | "underline";
  filtersVariant?: "chips" | "dropdown";
  appearance?: "default" | "commerce";
  stackedTopControls?: ("focus-search" | "view-options" | "sort")[];
  showToolbarSortButton?: boolean;

  // Pagination
  pagination?: DataTablePagination;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  paginationLabels?: DataTablePaginationLabels;

  // Sorting
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSortChange?: (column: string, direction: "asc" | "desc") => void;

  // Row actions
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => DataTableAction[];
  rowActionsHeader?: string | ReactNode;
  rowActionsVariant?: "dropdown" | "inline" | "inline-soft" | "split";

  // Labels
  toolbarLabels?: DataTableToolbarLabels;

  // Empty state
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** A line under the message: what to do about it. */
  emptyDescription?: string;
  /** Under the message, e.g. a "Clear filters" button. */
  emptyAction?: ReactNode;

  // Customization
  className?: string;
  dense?: boolean;
}
