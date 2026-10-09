"use client";

import type { DataTableAction } from "@/components/ui/data-table";

interface AdminCommerceTableHeaderConfig {
  title: string;
  actions: DataTableAction[];
  toolbarActions: DataTableAction[];
  toolbarLayout: "stacked";
  tabsVariant: "underline";
  filtersVariant: "dropdown";
  appearance: "commerce";
  stackedTopControls: "sort"[];
  showToolbarSortButton: false;
}

interface BuildAdminCommerceTableHeaderParams {
  title: string;
  addAction?: DataTableAction;
  importExportAction?: DataTableAction;
  secondaryActions?: DataTableAction[];
}

export function buildAdminCommerceTableHeader({
  title,
  addAction,
  importExportAction,
  secondaryActions,
}: BuildAdminCommerceTableHeaderParams): AdminCommerceTableHeaderConfig {
  const primaryAction = addAction
    ? {
        ...addAction,
        className: ["h-9 px-4 text-sm font-bold capitalize", addAction.className]
          .filter(Boolean)
          .join(" "),
      }
    : undefined;

  const styledSecondary = (secondaryActions ?? []).map((action) => ({
    ...action,
    variant: action.variant ?? "outline",
    className: ["h-9 px-3 text-sm font-medium", action.className]
      .filter(Boolean)
      .join(" "),
  }));

  const actions: DataTableAction[] = [
    ...styledSecondary,
    ...(primaryAction ? [primaryAction] : []),
  ];

  return {
    title,
    actions,
    toolbarActions: importExportAction ? [importExportAction] : [],
    toolbarLayout: "stacked",
    tabsVariant: "underline",
    filtersVariant: "dropdown",
    appearance: "commerce",
    stackedTopControls: ["sort"],
    showToolbarSortButton: false,
  };
}
