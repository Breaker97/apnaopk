"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { DataTableAction, DataTableBulkAction } from "./types";

interface DataTableHeaderProps<T> {
  title?: string;
  titleIcon?: ReactNode;
  actions?: DataTableAction[];
  selectedCount?: number;
  bulkActions?: DataTableBulkAction<T>[];
  selectedItems?: T[];
  isLoading?: boolean;
}

export function DataTableHeader<T>({
  title,
  titleIcon,
  actions = [],
  selectedCount = 0,
  bulkActions,
  selectedItems = [],
  isLoading = false,
}: DataTableHeaderProps<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-between pb-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-32" />
          <div className="flex items-center gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-16" />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-20" />
          ))}
        </div>
      </div>
    );
  }

  // Group actions: primary (with variant default) and secondary
  const primaryAction = actions.find(
    (a) => a.variant === "default" || (!a.variant && actions.indexOf(a) === actions.length - 1)
  );
  const secondaryActions = actions.filter((a) => a !== primaryAction);

  return (
    <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Left side: Title */}
      <div className="flex items-center gap-4">
        {title && (
          <h1 className="text-xl font-semibold flex items-center gap-2">
            {titleIcon}
            {title}
          </h1>
        )}
      </div>

      {/* Right side: Actions or Bulk Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {selectedCount > 0 && bulkActions && bulkActions.length > 0 ? (
          // Bulk actions when items are selected
          <>
            <span className="text-sm text-muted-foreground mr-2">
              {selectedCount} selected
            </span>
            {bulkActions.map((action) => (
              <Button
                key={action.id}
                variant={action.variant || "outline"}
                size="sm"
                onClick={() => action.onClick(selectedItems)}
                disabled={action.disabled}
              >
                {action.icon}
                <span className={action.icon ? "ml-2" : ""}>{action.label}</span>
              </Button>
            ))}
          </>
        ) : (
          // Normal actions
          <>
            {secondaryActions.map((action) =>
              action.href ? (
                <Button
                  key={action.id}
                  variant={action.variant || "outline"}
                  size="sm"
                  asChild
                  disabled={action.disabled}
                >
                  <Link href={action.href}>
                    {action.icon}
                    <span className={action.icon ? "ml-2" : ""}>{action.label}</span>
                  </Link>
                </Button>
              ) : (
                <Button
                  key={action.id}
                  variant={action.variant || "outline"}
                  size="sm"
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {action.icon}
                  <span className={action.icon ? "ml-2" : ""}>{action.label}</span>
                </Button>
              )
            )}

            {/* More actions dropdown if there are many secondary actions */}
            {secondaryActions.length > 3 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    More actions
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {secondaryActions.slice(3).map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      onClick={action.onClick}
                      disabled={action.disabled}
                    >
                      {action.icon}
                      <span className={action.icon ? "ml-2" : ""}>{action.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Primary action button */}
            {primaryAction &&
              (primaryAction.href ? (
                <Button size="sm" asChild disabled={primaryAction.disabled} className={primaryAction.className}>
                  <Link href={primaryAction.href}>
                    {primaryAction.icon}
                    <span className={primaryAction.icon ? "ml-2" : ""}>
                      {primaryAction.label}
                    </span>
                  </Link>
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={primaryAction.onClick}
                  disabled={primaryAction.disabled}
                  className={primaryAction.className}
                >
                  {primaryAction.icon}
                  <span className={primaryAction.icon ? "ml-2" : ""}>
                    {primaryAction.label}
                  </span>
                </Button>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
