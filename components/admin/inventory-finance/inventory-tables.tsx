"use client";

import { useMemo, useState } from "react";
import {
  Coins,
  FileText,
  History as HistoryIcon,
  PackagePlus,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DataTable } from "@/components/ui/data-table";
import { ProductCell } from "@/components/ui/data-table/cell-renderers";
import type {
  DataTableAction,
  DataTableColumn,
  DataTableFilter,
  DataTableTab,
} from "@/components/ui/data-table/types";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { periodPickerConfig } from "@/components/admin/period-picker-config";
import { cn } from "@/lib/utils";
import {
  LedgerBadge,
  type Action,
  type History,
  type Label,
  type Money,
  type Movement,
  type Position,
} from "./shared";

export type InventoryTab = "stock" | "history";
export type StockFilters = { location: string; cost: string };
export type HistoryFilters = { date: string; reason: string };
export const EMPTY_STOCK_FILTERS: StockFilters = { location: "all", cost: "all" };
export const EMPTY_HISTORY_FILTERS: HistoryFilters = { date: "all", reason: "all" };

export const REASONS = [
  "opening",
  "received",
  "count",
  "correction",
  "damaged",
  "theft_loss",
  "promotion_donation",
  "reserve",
  "release",
  "sale_costed",
  "return_restock",
  "transfer",
  "return_received",
  "cost_revaluation",
  "historical_reconciliation",
] as const;

// Orders' table: the commerce frame, 12px cells, ⋮ row menus.
const TABLE_HEADER = buildAdminCommerceTableHeader({ title: "" });
const TABLE_CLASS =
  "border-0 bg-transparent p-0 shadow-none [&_thead_th]:text-xs [&_tbody_td]:text-xs";
const NUMERIC = "text-right";

/**
 * Stock and its history, in the admin's one table. The two tabs are two views
 * of the same stock, so they share the frame, the toolbar and the menus — and
 * nothing here is a hand-built table that drifts from Orders.
 */
export function InventoryTables({
  tab,
  onTabChange,
  currency,
  positions,
  historical,
  allowFinance,
  allowAdjust,
  onAction,
  stockFilters,
  onStockFilterChange,
  history,
  historyLoading,
  historyError,
  historyFilters,
  onHistoryFilterChange,
  historySearch,
  onHistorySearchChange,
  historyPage,
  historyPageSize,
  onHistoryPageChange,
  onHistoryPageSizeChange,
  onReloadHistory,
  onCorrect,
  locale,
  label,
  tOr,
  money,
}: {
  tab: InventoryTab;
  onTabChange: (tab: InventoryTab) => void;
  currency: string;
  positions: Position[];
  /** A past "as of" day is showing above; stock rows are today's and read-only. */
  historical: boolean;
  allowFinance: boolean;
  allowAdjust: boolean;
  onAction: (position: Position, action: Action) => void;
  stockFilters: StockFilters;
  onStockFilterChange: (id: keyof StockFilters, value: string) => void;
  history: History | null;
  historyLoading: boolean;
  historyError: string;
  historyFilters: HistoryFilters;
  onHistoryFilterChange: (id: keyof HistoryFilters, value: string) => void;
  historySearch: string;
  onHistorySearchChange: (value: string) => void;
  historyPage: number;
  historyPageSize: number;
  onHistoryPageChange: (page: number) => void;
  onHistoryPageSizeChange: (size: number) => void;
  onReloadHistory: () => void;
  onCorrect: (movement: Movement) => void;
  locale: string;
  label: Label;
  /** Full-key translator, for the copy this table shares with Orders. */
  tOr: Label;
  money: Money;
}) {
  const [search, setSearch] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(20);
  const [detail, setDetail] = useState<Movement | null>(null);

  const tabs: DataTableTab[] = [
    { id: "stock", label: label("stockTab", "Stock") },
    { id: "history", label: label("historyTab", "History") },
  ];
  const reasonLabel = (reason: string) =>
    label(`reasonLabel.${reason}`, reason.replaceAll("_", " "));
  const dateTime = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const day = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value),
    );
  const time = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(
      new Date(value),
    );
  const signed = (value: number, text: string) =>
    value > 0 ? `+${text}` : text;
  const dash = <span className="text-muted-foreground/50">—</span>;
  const canAct = allowFinance || allowAdjust;

  // The report returns a bounded set of stock rows, so they are searched and paged here.
  const locations = useMemo(
    () =>
      [
        ...new Set(
          positions.map(
            (position) =>
              position.locationName ?? label("unassigned", "Unassigned location"),
          ),
        ),
      ].sort(),
    [positions, label],
  );
  const term = search.trim().toLocaleLowerCase();
  const filteredStock = positions.filter((position) => {
    const location =
      position.locationName ?? label("unassigned", "Unassigned location");
    if (stockFilters.location !== "all" && location !== stockFilters.location)
      return false;
    if (stockFilters.cost === "missing" && position.missingCostQuantity === 0)
      return false;
    if (stockFilters.cost === "costed" && position.missingCostQuantity > 0)
      return false;
    return (
      !term ||
      [position.productName, position.sku, position.variantName, location].some(
        (value) => value?.toLocaleLowerCase().includes(term),
      )
    );
  });
  const stockPages = Math.max(1, Math.ceil(filteredStock.length / stockPageSize));
  const page = Math.min(stockPage, stockPages);
  const stockRows = filteredStock.slice(
    (page - 1) * stockPageSize,
    page * stockPageSize,
  );
  const stockFiltered =
    Boolean(term) ||
    stockFilters.location !== "all" ||
    stockFilters.cost !== "all";

  const stockColumns: DataTableColumn<Position>[] = [
    {
      id: "product",
      header: label("product", "Product"),
      cell: (row) => (
        <div className="max-w-[300px]">
          <ProductCell
            image={row.image ?? undefined}
            title={row.productName}
            subtitle={
              [row.variantName, row.sku].filter(Boolean).join(" · ") ||
              label("mainSku", "Main SKU")
            }
          />
        </div>
      ),
      className: "w-[320px]",
    },
    {
      id: "location",
      header: label("location", "Location"),
      cell: (row) => (
        <span className="block max-w-[200px] truncate" title={row.locationName ?? undefined}>
          {row.locationName ?? label("unassigned", "Unassigned location")}
        </span>
      ),
      className: "hidden w-[200px] md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      id: "onHand",
      header: label("onHand", "On hand"),
      cell: (row) => <span className="font-medium tabular-nums">{row.quantity}</span>,
      className: cn("w-[90px]", NUMERIC),
      headerClassName: NUMERIC,
    },
    {
      id: "reserved",
      header: label("reservedShort", "Reserved"),
      cell: (row) =>
        row.reservedUncosted ? (
          <span className="tabular-nums">{row.reservedUncosted}</span>
        ) : (
          dash
        ),
      className: cn("hidden w-[90px] lg:table-cell", NUMERIC),
      headerClassName: cn("hidden lg:table-cell", NUMERIC),
    },
    {
      id: "held",
      header: label("held", "Held"),
      cell: (row) =>
        row.unavailableOwned ? (
          <span className="tabular-nums">{row.unavailableOwned}</span>
        ) : (
          dash
        ),
      className: cn("hidden w-[80px] lg:table-cell", NUMERIC),
      headerClassName: cn("hidden lg:table-cell", NUMERIC),
    },
    {
      id: "unitCost",
      header: label("unitCost", "Unit cost"),
      cell: (row) =>
        row.unitCost == null ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm bg-amber-100 px-2 py-1 text-[12px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
            {label("noCost", "No cost")}
          </span>
        ) : (
          <span className="flex flex-col items-end">
            <span className="tabular-nums">{money(row.unitCost, row.currency)}</span>
            {row.missingCostQuantity > 0 ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                {label("unitsWithoutCost", "{count} without a cost", {
                  count: row.missingCostQuantity,
                })}
              </span>
            ) : null}
          </span>
        ),
      className: cn("w-[120px]", NUMERIC),
      headerClassName: NUMERIC,
    },
    {
      id: "value",
      header: label("value", "Value"),
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {money(row.carryingValue, row.currency)}
        </span>
      ),
      className: cn("w-[130px]", NUMERIC),
      headerClassName: NUMERIC,
    },
  ];

  const stockActions = (row: Position): DataTableAction[] => {
    const disabledHint = historical
      ? label("switchToToday", "Switch “As of” to today to make changes")
      : undefined;
    return [
      ...(allowFinance
        ? [
            {
              id: "receive",
              label: label("receive", "Add stock"),
              icon: <PackagePlus className="size-4" />,
              disabled: historical,
              hint: disabledHint,
              onClick: () => onAction(row, "receipts"),
            },
          ]
        : []),
      ...(allowAdjust
        ? [
            {
              id: "adjust",
              label: label("adjust", "Adjust count"),
              icon: <SlidersHorizontal className="size-4" />,
              disabled: historical,
              hint: disabledHint,
              onClick: () => onAction(row, "adjustments"),
            },
          ]
        : []),
      ...(allowFinance
        ? [
            {
              id: "revalue",
              label: label("revalue", "Change cost"),
              icon: <Coins className="size-4" />,
              disabled: historical,
              hint: disabledHint,
              onClick: () => onAction(row, "valuation-changes"),
            },
          ]
        : []),
    ];
  };

  const historyColumns: DataTableColumn<Movement>[] = [
    {
      id: "date",
      header: label("date", "Date"),
      cell: (row) => (
        <div className="whitespace-nowrap">
          <p>{day(row.occurredAt)}</p>
          <p className="text-muted-foreground">{time(row.occurredAt)}</p>
        </div>
      ),
      className: "w-[130px]",
    },
    {
      id: "product",
      header: label("product", "Product"),
      cell: (row) => (
        <div className="max-w-[280px]">
          <ProductCell
            image={row.image ?? undefined}
            title={row.productName}
            subtitle={
              [row.variantName, row.sku].filter(Boolean).join(" · ") ||
              label("mainSku", "Main SKU")
            }
          />
        </div>
      ),
      className: "w-[300px]",
    },
    {
      id: "what",
      header: label("whatHappened", "What happened"),
      cell: (row) => (
        <div className="max-w-[240px]">
          <p className="truncate">{reasonLabel(row.reason)}</p>
          {row.source?.reference ? (
            <p className="truncate text-muted-foreground" title={row.source.reference}>
              {row.source.reference}
            </p>
          ) : null}
        </div>
      ),
      className: "hidden w-[240px] md:table-cell",
      headerClassName: "hidden md:table-cell",
    },
    {
      id: "units",
      header: label("units", "Units"),
      cell: (row) =>
        row.physicalQuantityDelta !== 0 ? (
          <span className="font-medium tabular-nums">
            {signed(row.physicalQuantityDelta, String(row.physicalQuantityDelta))}
          </span>
        ) : row.physicalUnavailableDelta !== 0 ? (
          <span className="whitespace-nowrap tabular-nums">
            {label("unitsHeld", "{count} held", {
              count: row.physicalUnavailableDelta,
            })}
          </span>
        ) : (
          dash
        ),
      className: cn("w-[100px]", NUMERIC),
      headerClassName: NUMERIC,
    },
    {
      id: "value",
      header: label("value", "Value"),
      cell: (row) => (
        <span
          className={cn(
            "whitespace-nowrap tabular-nums",
            row.valueDelta === 0 && "text-muted-foreground",
          )}
        >
          {signed(row.valueDelta, money(row.valueDelta, row.currency))}
        </span>
      ),
      className: cn("w-[130px]", NUMERIC),
      headerClassName: NUMERIC,
    },
    {
      id: "ledger",
      header: label("ledger", "Ledger"),
      cell: (row) => <LedgerBadge state={row.bookkeepingState} label={label} />,
      className: "hidden w-[150px] lg:table-cell",
      headerClassName: "hidden lg:table-cell",
    },
  ];

  const historyActions = (row: Movement): DataTableAction[] => [
    {
      id: "details",
      label: label("details", "Details"),
      icon: <FileText className="size-4" />,
      onClick: () => setDetail(row),
    },
    ...(allowFinance && row.reason === "received" && !historical
      ? [
          {
            id: "correct",
            label: label("reverseReceipt", "Correct unused receipt"),
            icon: <RotateCcw className="size-4" />,
            onClick: () => onCorrect(row),
          },
        ]
      : []),
  ];

  const now = new Date();
  const historyFilterDefs: DataTableFilter[] = [
    {
      id: "date",
      label: label("date", "Date"),
      type: "date",
      date: {
        locale,
        ...periodPickerConfig(tOr, locale, now),
        maxDate: now,
      },
    },
    {
      id: "reason",
      label: label("whatHappened", "What happened"),
      type: "select",
      options: [
        { label: tOr("admin.ordersPage.tabs.all", "All"), value: "all" },
        ...REASONS.map((reason) => ({ label: reasonLabel(reason), value: reason })),
      ],
    },
  ];
  const stockFilterDefs: DataTableFilter[] = [
    ...(locations.length > 1
      ? [
          {
            id: "location",
            label: label("location", "Location"),
            type: "select" as const,
            options: [
              { label: tOr("admin.ordersPage.tabs.all", "All"), value: "all" },
              ...locations.map((location) => ({ label: location, value: location })),
            ],
          },
        ]
      : []),
    {
      id: "cost",
      label: label("costFilter", "Cost"),
      type: "select",
      options: [
        { label: tOr("admin.ordersPage.tabs.all", "All"), value: "all" },
        { label: label("noCost", "No cost"), value: "missing" },
        { label: label("hasCost", "Has a cost"), value: "costed" },
      ],
    },
  ];
  const historyFiltered =
    Boolean(historySearch.trim()) ||
    historyFilters.date !== "all" ||
    historyFilters.reason !== "all";

  const common = {
    tabs,
    activeTab: tab,
    onTabChange: (id: string) => onTabChange(id as InventoryTab),
    toolbarLayout: TABLE_HEADER.toolbarLayout,
    tabsVariant: TABLE_HEADER.tabsVariant,
    filtersVariant: TABLE_HEADER.filtersVariant,
    appearance: TABLE_HEADER.appearance,
    stackedTopControls: [] as never[],
    rowActionsHeader: tOr("common.actions", "Actions"),
    rowActionsVariant: "dropdown" as const,
    className: TABLE_CLASS,
    paginationLabels: {
      showing: tOr("admin.ordersPage.pagination.showing", "Showing"),
      to: tOr("admin.ordersPage.pagination.to", "to"),
      of: tOr("admin.ordersPage.pagination.of", "of"),
      results: tOr("admin.ordersPage.pagination.results", "results"),
      rowsPerPage: tOr("admin.ordersPage.pagination.rowsPerPage", "Rows per page"),
    },
  };

  return (
    <>
      {tab === "stock" ? (
        <DataTable<Position>
          {...common}
          data={stockRows}
          columns={stockColumns}
          keyField="key"
          searchable
          searchPlaceholder={label("searchStock", "Search product, SKU or location")}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setStockPage(1);
          }}
          filters={stockFilterDefs}
          filterValues={stockFilters}
          onFilterChange={(id, value) => {
            onStockFilterChange(id as keyof StockFilters, value);
            setStockPage(1);
          }}
          rowActions={canAct ? stockActions : undefined}
          pagination={
            filteredStock.length > 0
              ? {
                  page,
                  pageSize: stockPageSize,
                  total: filteredStock.length,
                  totalPages: stockPages,
                }
              : undefined
          }
          onPageChange={setStockPage}
          onPageSizeChange={(size) => {
            setStockPageSize(size);
            setStockPage(1);
          }}
          emptyMessage={
            stockFiltered
              ? label("noSearchResults", "No matching stock positions")
              : label("noPositionsIn", "No stock positions in {currency} yet", {
                  currency,
                })
          }
          emptyDescription={
            stockFiltered
              ? undefined
              : label("noPositionsHint", "Stock you receive or move in shows up here.")
          }
          emptyAction={
            stockFiltered ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch("");
                  onStockFilterChange("location", "all");
                  onStockFilterChange("cost", "all");
                }}
              >
                {label("clearFilters", "Clear filters")}
              </Button>
            ) : undefined
          }
        />
      ) : historyError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-destructive/30 bg-destructive/5 p-4"
        >
          <p className="text-sm text-destructive">{historyError}</p>
          <Button variant="outline" size="sm" onClick={onReloadHistory}>
            {label("tryAgain", "Try again")}
          </Button>
        </div>
      ) : (
        <DataTable<Movement>
          {...common}
          data={history?.items ?? []}
          columns={historyColumns}
          keyField="_id"
          isLoading={historyLoading || !history}
          loadingMode="rows"
          loadingRows={5}
          searchable
          searchPlaceholder={label("searchHistory", "Search product, SKU or order")}
          searchValue={historySearch}
          searchDebounceMs={300}
          onSearchChange={onHistorySearchChange}
          filters={historyFilterDefs}
          filterValues={historyFilters}
          onFilterChange={(id, value) =>
            onHistoryFilterChange(id as keyof HistoryFilters, value)
          }
          rowActions={historyActions}
          pagination={
            history && (history.total ?? 0) > 0
              ? {
                  page: historyPage,
                  pageSize: historyPageSize,
                  total: history.total ?? 0,
                  totalPages: Math.max(
                    1,
                    Math.ceil((history.total ?? 0) / historyPageSize),
                  ),
                }
              : undefined
          }
          onPageChange={onHistoryPageChange}
          onPageSizeChange={onHistoryPageSizeChange}
          emptyIcon={<HistoryIcon className="h-8 w-8" />}
          emptyMessage={
            historyFiltered
              ? label("noMovementsFiltered", "No stock changes match these filters")
              : label("noMovements", "No stock changes yet")
          }
          emptyDescription={
            historyFiltered
              ? undefined
              : label(
                  "noMovementsHint",
                  "Receipts, counts, sales and returns show up here as they happen.",
                )
          }
          emptyAction={
            historyFiltered ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onHistorySearchChange("");
                  onHistoryFilterChange("date", "all");
                  onHistoryFilterChange("reason", "all");
                }}
              >
                {label("clearFilters", "Clear filters")}
              </Button>
            ) : undefined
          }
        />
      )}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="grid-cols-1 sm:max-w-md">
          {detail ? (
            <>
              <DialogHeader className="text-left">
                <DialogTitle>{reasonLabel(detail.reason)}</DialogTitle>
                <DialogDescription>
                  {[detail.productName, detail.sku].filter(Boolean).join(" · ")}
                </DialogDescription>
              </DialogHeader>
              <dl className="divide-y rounded-xl border text-sm">
                {[
                  [label("date", "Date"), dateTime(detail.occurredAt)],
                  ...(dateTime(detail.accountingAt) !== dateTime(detail.occurredAt)
                    ? [[label("accountingDate", "Accounting date"), dateTime(detail.accountingAt)]]
                    : []),
                  [
                    label("quantityBeforeAfter", "Quantity"),
                    `${detail.quantityBefore} → ${detail.quantityAfter}`,
                  ],
                  [
                    label("valueBeforeAfter", "Value"),
                    `${money(detail.valueBefore, detail.currency)} → ${money(detail.valueAfter, detail.currency)}`,
                  ],
                  ...(detail.paymentDisposition
                    ? [
                        [
                          label("detailPayment", "Payment"),
                          label(
                            detail.paymentDisposition === "already_recorded"
                              ? "alreadyRecorded"
                              : detail.paymentDisposition,
                            detail.paymentDisposition,
                          ),
                        ],
                      ]
                    : []),
                  [
                    label("reference", "Reference"),
                    detail.source?.reference ?? detail.source?.kind ?? "—",
                  ],
                  [label("doneBy", "Done by"), detail.actorId],
                  ...(detail.note ? [[label("detailNote", "Note"), detail.note]] : []),
                ].map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-4 px-4 py-2.5">
                    <dt className="shrink-0 text-muted-foreground">{term}</dt>
                    <dd className="min-w-0 break-words text-right tabular-nums">{value}</dd>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <dt className="text-muted-foreground">{label("ledger", "Ledger")}</dt>
                  <dd>
                    <LedgerBadge state={detail.bookkeepingState} label={label} />
                  </dd>
                </div>
              </dl>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
