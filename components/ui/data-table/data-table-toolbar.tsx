"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  ArrowUpDown,
  LayoutList,
  ChevronDown,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  DataTableAction,
  DataTableFilter,
  DataTableTab,
  DataTableToolbarLabels,
} from "./types";

interface DataTableToolbarProps {
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  searchDebounceMs?: number;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: () => void;
  filters?: DataTableFilter[];
  filterValues?: Record<string, string>;
  onFilterChange?: (filterId: string, value: string) => void;
  tabs?: DataTableTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  totalItems?: number;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSortChange?: (column: string, direction: "asc" | "desc") => void;
  toolbarActions?: DataTableAction[];
  toolbarLayout?: "default" | "stacked";
  toolbarDensity?: "default" | "compact";
  tabsVariant?: "pills" | "underline";
  filtersVariant?: "chips" | "dropdown";
  appearance?: "default" | "commerce";
  stackedTopControls?: ("focus-search" | "view-options" | "sort")[];
  showToolbarSortButton?: boolean;
  isLoading?: boolean;
  labels?: DataTableToolbarLabels;
}

function useDebouncedCallback(callback: (value: string) => void, delay: number) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef<string | null>(null);
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debounced = useCallback(
    (value: string) => {
      latestValueRef.current = value;
      if (timerRef.current) clearTimeout(timerRef.current);

      if (delay <= 0) {
        timerRef.current = null;
        callbackRef.current(value);
        return;
      }

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        callbackRef.current(value);
      }, delay);
    },
    [delay],
  );

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const flush = useCallback(() => {
    if (!timerRef.current) return;

    clearTimeout(timerRef.current);
    timerRef.current = null;

    if (latestValueRef.current !== null) {
      callbackRef.current(latestValueRef.current);
    }
  }, []);

  return { debounced, cancel, flush };
}

function ToolbarActionButton({
  action,
  appearance,
  density,
}: {
  action: DataTableAction;
  appearance: "default" | "commerce";
  density: "default" | "compact";
}) {
  const isCompact = density === "compact";
  const commerceButtonClassName =
    appearance === "commerce"
      ? cn(
          "rounded-[10px] border-border bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-muted/60",
          isCompact
            ? "h-8 px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5"
            : "h-9 px-3 text-sm",
        )
      : undefined;

  if (action.items?.length) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={action.variant || "outline"}
            size="sm"
            disabled={action.disabled}
            className={cn("rounded-xl px-3.5", commerceButtonClassName, action.className)}
          >
            {action.icon}
            <span>{action.label}</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {action.items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onClick={item.onClick}
              disabled={item.disabled}
              asChild={Boolean(item.href)}
            >
              {item.href ? (
                <Link href={item.href}>
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              ) : (
                <>
                  {item.icon}
                  <span>{item.label}</span>
                </>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (action.href) {
    return (
      <Button
        variant={action.variant || "outline"}
        size="sm"
        asChild
        disabled={action.disabled}
        className={cn("rounded-xl px-3.5", commerceButtonClassName, action.className)}
      >
        <Link href={action.href}>
          {action.icon}
          <span>{action.label}</span>
        </Link>
      </Button>
    );
  }

  return (
    <Button
      variant={action.variant || "outline"}
      size="sm"
      onClick={action.onClick}
      disabled={action.disabled}
      className={cn("rounded-xl px-3.5", commerceButtonClassName, action.className)}
    >
      {action.icon}
      <span>{action.label}</span>
    </Button>
  );
}

function ToolbarFilterButton({
  activeFilterCount,
}: {
  activeFilterCount: number;
}) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground px-1.5 text-[10px] font-semibold leading-none text-background">
      {activeFilterCount}
    </span>
  );
}

export function DataTableToolbar({
  searchable = false,
  searchPlaceholder,
  searchValue = "",
  searchDebounceMs = 400,
  onSearchChange,
  onSearchSubmit,
  filters = [],
  filterValues = {},
  onFilterChange,
  tabs = [],
  activeTab,
  onTabChange,
  sortColumn,
  sortDirection = "desc",
  onSortChange,
  toolbarActions = [],
  toolbarLayout = "default",
  toolbarDensity = "default",
  tabsVariant = "pills",
  filtersVariant = "chips",
  appearance = "default",
  stackedTopControls = [],
  showToolbarSortButton = true,
  isLoading = false,
  labels,
}: DataTableToolbarProps) {
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
  const text = {
    cancel: labels?.cancel ?? tt("ui.dataTable.cancel", "Cancel"),
    search: labels?.search ?? tt("ui.dataTable.search", "Search"),
    sort: labels?.sort ?? tt("ui.dataTable.sort", "Sort"),
    sortedAscending:
      labels?.sortedAscending ??
      tt("ui.dataTable.sortedAscending", "Sorted ascending"),
    sortedDescending:
      labels?.sortedDescending ??
      tt("ui.dataTable.sortedDescending", "Sorted descending"),
    viewOptions:
      labels?.viewOptions ?? tt("ui.dataTable.viewOptions", "View options"),
    focusSearch:
      labels?.focusSearch ?? tt("ui.dataTable.focusSearch", "Focus search"),
    filter: labels?.filter ?? tt("ui.dataTable.filter", "Filter"),
    filters: labels?.filters ?? tt("ui.dataTable.filters", "Filters"),
    clearAll: labels?.clearAll ?? tt("ui.dataTable.clearAll", "Clear all"),
    clearAllFilters:
      labels?.clearAllFilters ??
      tt("ui.dataTable.clearAllFilters", "Clear all filters"),
  };
  const [isExpanded, setIsExpanded] = useState(
    toolbarLayout === "stacked" ? true : Boolean(searchValue),
  );
  const [localSearch, setLocalSearch] = useState(() => ({
    propValue: searchValue,
    value: searchValue,
  }));
  const inputRef = useRef<HTMLInputElement>(null);
  const isCompact = toolbarDensity === "compact";
  const localValue =
    localSearch.propValue === searchValue ? localSearch.value : searchValue;
  const setLocalValue = useCallback(
    (value: string) => {
      setLocalSearch({ propValue: searchValue, value });
    },
    [searchValue],
  );

  const {
    debounced: debouncedSearch,
    cancel: cancelDebouncedSearch,
    flush: flushDebouncedSearch,
  } = useDebouncedCallback(
    useCallback(
      (value: string) => {
        onSearchChange?.(value);
      },
      [onSearchChange],
    ),
    searchDebounceMs,
  );

  useEffect(() => {
    cancelDebouncedSearch();
  }, [cancelDebouncedSearch, searchValue]);

  useEffect(() => {
    if ((isExpanded || toolbarLayout === "stacked") && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded, toolbarLayout]);

  const handleInputChange = (value: string) => {
    setLocalValue(value);
    debouncedSearch(value);
  };

  const handleClearSearch = () => {
    cancelDebouncedSearch();
    setLocalValue("");
    onSearchChange?.("");
  };

  const handleCancel = () => {
    handleClearSearch();
    setIsExpanded(false);
  };

  const handleSearchSubmit = () => {
    flushDebouncedSearch();
    onSearchSubmit?.();
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearchSubmit();
      return;
    }

    if (event.key === "Escape" && toolbarLayout !== "stacked") {
      handleCancel();
    }
  };

  const activeFilterCount = filters.reduce((count, filter) => {
    const val = filterValues[filter.id];
    return val && val !== "all" ? count + 1 : count;
  }, 0);
  const hasActiveSearch = localValue.length > 0;
  const hasActiveFilters = activeFilterCount > 0;
  const canSort = Boolean(sortColumn && onSortChange);

  const handleSortClick = () => {
    if (!sortColumn || !onSortChange) return;
    onSortChange(sortColumn, sortDirection === "asc" ? "desc" : "asc");
  };

  const focusSearchInput = () => {
    inputRef.current?.focus();
  };

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center justify-between border-b px-4 py-3",
          appearance === "commerce" && "border-border px-5 py-4",
        )}
      >
        <Skeleton className="h-6 w-56" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    );
  }

  if (toolbarLayout === "stacked") {
    return (
      <div
        className={cn(
          "border-b bg-background",
          appearance === "commerce" && "border-border bg-card",
        )}
      >
        {tabs.length > 0 && (
          <div
            className={cn(
              "flex items-center justify-between gap-5 px-4 pt-4",
              appearance === "commerce" && "px-5 pt-5",
            )}
          >
            <div className="flex items-center gap-5">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={cn(
                    "relative pb-3 text-sm font-medium transition-colors",
                    tabsVariant === "underline" &&
                      (activeTab === tab.id
                        ? "text-foreground after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:rounded-full after:bg-foreground"
                        : "text-muted-foreground hover:text-foreground"),
                    tabsVariant !== "underline" &&
                      (activeTab === tab.id
                        ? "rounded-md bg-background px-3 py-1.5 text-foreground shadow-sm"
                        : "rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"),
                    appearance === "commerce" &&
                      "pb-4 text-[15px] font-medium",
                    appearance === "commerce" &&
                      tabsVariant === "underline" &&
                      (activeTab === tab.id
                        ? "after:h-[2px] after:bg-foreground"
                        : "text-muted-foreground hover:text-foreground"),
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {stackedTopControls.length > 0 && (
              <div className="flex items-center gap-3">
                {stackedTopControls.includes("focus-search") && searchable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "rounded-md text-muted-foreground hover:text-foreground",
                      appearance === "commerce" &&
                        "size-8 rounded-md text-muted-foreground hover:bg-transparent hover:text-foreground",
                    )}
                    onClick={focusSearchInput}
                    title={text.focusSearch}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                )}
                {stackedTopControls.includes("view-options") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "rounded-md text-muted-foreground hover:text-foreground",
                      appearance === "commerce" &&
                        "size-8 rounded-md text-muted-foreground hover:bg-transparent hover:text-foreground",
                    )}
                    title={text.viewOptions}
                  >
                    <LayoutList className="h-4 w-4" />
                  </Button>
                )}
                {stackedTopControls.includes("sort") && canSort && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "rounded-md text-muted-foreground hover:text-foreground",
                      appearance === "commerce" &&
                        "size-8 rounded-md text-muted-foreground hover:bg-transparent hover:text-foreground",
                    )}
                    onClick={handleSortClick}
                    title={
                      sortDirection === "asc"
                        ? text.sortedAscending
                        : text.sortedDescending
                    }
                  >
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div
          className={cn(
            "border-t px-4 py-4",
            appearance === "commerce" && "border-border px-5 py-4",
            appearance === "commerce" && isCompact && "px-4 py-3",
          )}
        >
          <div
            className={cn(
              "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
              isCompact && "gap-2",
            )}
          >
            {searchable && (
              <div
                className={cn(
                  "relative w-full lg:max-w-[620px]",
                  appearance === "commerce" && "lg:max-w-[618px]",
                  appearance === "commerce" && isCompact && "lg:max-w-[520px]",
                )}
              >
                <Search
                  className={cn(
                    "absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500",
                    appearance === "commerce" &&
                      "left-[14px] h-4 w-4 text-muted-foreground",
                    appearance === "commerce" &&
                      isCompact &&
                      "left-3 h-3.5 w-3.5",
                  )}
                />
                <Input
                  ref={inputRef}
                  placeholder={searchPlaceholder ?? text.search}
                  value={localValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  className={cn(
                    "h-11 rounded-md border-0 bg-slate-100 pl-11 pr-11 shadow-none placeholder:text-slate-500 focus-visible:border-ring",
                    hasActiveSearch && "pr-12",
                    appearance === "commerce" &&
                      "h-10 rounded-md border border-border bg-muted/40 pl-10 pr-10 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-0",
                    appearance === "commerce" &&
                      isCompact &&
                      "h-9 rounded-md pl-9 pr-9 text-sm",
                  )}
                />
                {hasActiveSearch && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className={cn(
                      "absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-foreground",
                      appearance === "commerce" &&
                        "right-3.5 text-muted-foreground hover:text-foreground",
                      appearance === "commerce" && isCompact && "right-3",
                    )}
                  >
                    <X className={cn("h-4 w-4", isCompact && "h-3.5 w-3.5")} />
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {toolbarActions.map((action) => (
                <ToolbarActionButton
                  key={action.id}
                  action={action}
                  appearance={appearance}
                  density={toolbarDensity}
                />
              ))}

              {filters.length > 0 && filtersVariant === "dropdown" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "rounded-xl px-3.5",
                        appearance === "commerce" &&
                          "rounded-[10px] border-border bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-muted/60",
                        appearance === "commerce" &&
                          (isCompact
                            ? "h-8 px-2.5 text-xs [&_svg]:h-3.5 [&_svg]:w-3.5"
                            : "h-9 px-3 text-sm"),
                      )}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      <span>{text.filter}</span>
                      {activeFilterCount > 0 && (
                        <ToolbarFilterButton activeFilterCount={activeFilterCount} />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>{text.filters}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {filters.map((filter) => {
                      if (filter.type !== "select" || !filter.options) return null;
                      const currentValue = filterValues[filter.id] || "all";
                      return (
                        <DropdownMenuSub key={filter.id}>
                          <DropdownMenuSubTrigger>
                            <span>{filter.label}</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-52">
                            {filter.options.map((option) => (
                              <DropdownMenuCheckboxItem
                                key={option.value}
                                checked={currentValue === option.value}
                                onCheckedChange={() =>
                                  onFilterChange?.(
                                    filter.id,
                                    currentValue === option.value ? "all" : option.value,
                                  )
                                }
                              >
                                {option.label}
                              </DropdownMenuCheckboxItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      );
                    })}
                    {hasActiveFilters && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            filters.forEach((filter) =>
                              onFilterChange?.(filter.id, "all"),
                            );
                          }}
                        >
                          {text.clearAllFilters}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {canSort && showToolbarSortButton && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="rounded-xl"
                  title={text.sort}
                  onClick={handleSortClick}
                >
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isExpanded) {
    return (
      <div className="rounded-t-sm border-b bg-background">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder={searchPlaceholder ?? text.search}
              value={localValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleInputKeyDown}
              className={cn(
                "h-9 border-primary bg-background pl-9",
                hasActiveSearch && "pr-9",
              )}
            />
            {hasActiveSearch && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            {text.cancel}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={text.sort}
            onClick={handleSortClick}
            disabled={!canSort}
          >
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>

        {filters.length > 0 && filtersVariant === "chips" && (
          <div className="flex items-center gap-2 border-t bg-muted/30 px-2 py-2">
            {filters.map((filter) => {
              if (filter.type === "select" && filter.options) {
                const currentValue = filterValues[filter.id];
                const hasValue = currentValue && currentValue !== "all";
                const selectedOption = filter.options.find(
                  (option) => option.value === currentValue,
                );

                return (
                  <div key={filter.id} className="flex items-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-7 gap-1 text-xs",
                            hasValue &&
                              "rounded-r-none border-primary/50 bg-primary/10 text-primary",
                          )}
                        >
                          {hasValue
                            ? `${filter.label}: ${selectedOption?.label ?? currentValue}`
                            : filter.label}
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {filter.options.map((option) => (
                          <DropdownMenuCheckboxItem
                            key={option.value}
                            checked={currentValue === option.value}
                            onCheckedChange={() =>
                              onFilterChange?.(
                                filter.id,
                                currentValue === option.value ? "all" : option.value,
                              )
                            }
                          >
                            {option.label}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {hasValue && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-l-none border-l-0 border-primary/50 bg-primary/10 px-1.5 text-primary hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onFilterChange?.(filter.id, "all")}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              }
              return null;
            })}

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  filters.forEach((filter) => onFilterChange?.(filter.id, "all"));
                }}
              >
                {text.clearAll}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between bg-transparent px-0 py-2">
      <div className="flex items-center gap-1">
        {tabs.length > 0 && (
          <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {searchable && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={text.search}
            onClick={() => setIsExpanded(true)}
          >
            <Search className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={text.viewOptions}
        >
          <LayoutList className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title={text.sort}
          onClick={handleSortClick}
          disabled={!canSort}
        >
          <ArrowUpDown className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
