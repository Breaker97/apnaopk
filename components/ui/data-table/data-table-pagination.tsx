"use client";

import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import type {
  DataTablePagination as PaginationType,
  DataTablePaginationLabels,
} from "./types";

interface DataTablePaginationProps {
  pagination: PaginationType;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  labels?: DataTablePaginationLabels;
}

export function DataTablePagination({
  pagination,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 30, 50, 100],
  labels,
}: DataTablePaginationProps) {
  const t = useTranslations();
  const tt = (key: string, fallback: string) => {
    try {
      return t(key);
    } catch {
      return fallback;
    }
  };
  const text = {
    showing: labels?.showing ?? tt("ui.dataTable.showing", "Showing"),
    to: labels?.to ?? tt("ui.dataTable.to", "to"),
    of: labels?.of ?? tt("ui.dataTable.of", "of"),
    results: labels?.results ?? tt("ui.dataTable.results", "results"),
    rowsPerPage:
      labels?.rowsPerPage ?? tt("ui.dataTable.rowsPerPage", "Rows per page"),
  };
  const { page, pageSize, total, totalPages } = pagination;
  const safeTotalPages = Math.max(totalPages || 1, 1);
  const safePage = Math.min(Math.max(page || 1, 1), safeTotalPages);
  const hasResults = total > 0;

  const startItem = hasResults ? (safePage - 1) * pageSize + 1 : 0;
  const endItem = hasResults ? Math.min(safePage * pageSize, total) : 0;

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: (number | "ellipsis")[] = [];
    const showPages = 5;

    if (safeTotalPages <= showPages + 2) {
      // Show all pages if not too many
      for (let i = 1; i <= safeTotalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (safePage > 3) {
        pages.push("ellipsis");
      }

      // Show pages around current page
      const start = Math.max(2, safePage - 1);
      const end = Math.min(safeTotalPages - 1, safePage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (safePage < safeTotalPages - 2) {
        pages.push("ellipsis");
      }

      // Always show last page
      if (safeTotalPages > 1) {
        pages.push(safeTotalPages);
      }
    }

    return pages;
  };

  return (
    <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>
          {text.showing} {startItem} {text.to} {endItem} {text.of} {total}{" "}
          {text.results}
        </span>
      </div>

      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-6">
        {/* Page size selector */}
        {onPageSizeChange && (
          <div className="flex items-center justify-between gap-2 sm:justify-start">
            <span className="text-sm text-muted-foreground">
              {text.rowsPerPage}
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Pagination controls */}
        <div className="flex items-center justify-between gap-1 sm:justify-start">
          {/* First page */}
          <Button
            variant="outline"
            size="icon"
            className="hidden h-8 w-8 sm:inline-flex"
            onClick={() => onPageChange?.(1)}
            disabled={safePage === 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          {/* Previous page */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange?.(safePage - 1)}
            disabled={safePage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Page numbers */}
          <div className="hidden items-center gap-1 sm:flex">
            {getPageNumbers().map((pageNum, index) =>
              pageNum === "ellipsis" ? (
                <span
                  key={`ellipsis-${index}`}
                  className="px-2 text-muted-foreground"
                >
                  ...
                </span>
              ) : (
                <Button
                  key={pageNum}
                  variant={safePage === pageNum ? "default" : "outline"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onPageChange?.(pageNum)}
                >
                  {pageNum}
                </Button>
              )
            )}
          </div>
          <span className="text-xs text-muted-foreground sm:hidden">
            {safePage}/{safeTotalPages}
          </span>

          {/* Next page */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange?.(safePage + 1)}
            disabled={safePage === safeTotalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Last page */}
          <Button
            variant="outline"
            size="icon"
            className="hidden h-8 w-8 sm:inline-flex"
            onClick={() => onPageChange?.(safeTotalPages)}
            disabled={safePage === safeTotalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
