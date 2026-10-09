"use client";
import { useFinanceRequest, type FinanceOutcome } from "@/hooks/use-finance-request";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarClock,
  CheckCircle2,
  FileText,
  ImageIcon,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  Wallet,
} from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { ExpenseFormDialog } from "@/components/admin/finance/expense-form-dialog";
import { ExpenseSettleDialog } from "@/components/admin/finance/expense-settle-dialog";
import {
  PAID_FROM,
  formatDay,
  isGeneratedCopy,
  localToday,
  type ExpenseRow,
} from "@/components/admin/finance/expense-types";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { apiClient, describeApiError } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";
import {
  expenseReceiptViewUrl,
  isPdfReceipt,
} from "@/lib/finance/expense-receipts";
import { expenseListRange } from "@/lib/finance/expense-list-range";

interface MoneyByCurrency {
  currency: string;
  amount: number;
  count: number;
}

interface ListPayload {
  data: ExpenseRow[];
  pagination: { page: number; totalPages: number; total: number };
  totals: Array<MoneyByCurrency & { unpaid: number; stock: number }>;
  /** Bills still owed across all time, whatever the period says. */
  outstanding: MoneyByCurrency[];
}

const API = "/api/admin/finance/expenses";

/**
 * Recording what the business spent.
 *
 * Every other money screen in the app reports something the system already
 * knows. This one is the only place a human tells it something — which is why
 * the form asks for a date rather than assuming today, and why the totals under
 * the table are computed over the whole filter server-side rather than summing
 * the rows on screen.
 */
export function ExpensesContent({
  multiVendor,
  storeCurrency,
  currencies,
  period,
  from,
  to,
  closedThrough,
  hasProductCosts,
  initialPaidFrom,
}: {
  multiVendor: boolean;
  storeCurrency: string;
  /** Currency codes a bill may be recorded in, the store's own first. */
  currencies: string[];
  /** The resolved period key, for the picker in this screen's own header. */
  period: string;
  /**
   * The period the page resolved, as "YYYY-MM-DD" days ("" for all time).
   * Every request is made against it: the totals are computed over the whole
   * filter, and a filter with no period at all made "total for this filter"
   * mean every expense ever recorded — under a screen that looked like it
   * was showing a month.
   */
  from: string;
  to: string;
  /** The last instant of the last closed period, ISO; null when none is. */
  closedThrough: string | null;
  hasProductCosts: boolean;
  /** "unpaid" when the page was opened from "Show bills still owed". */
  initialPaidFrom: string;
}) {
  const financeRequest = useFinanceRequest();
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { confirm } = useConfirmation();

  /**
   * Each row in the currency it was RECORDED in, never the store's current one.
   *
   * The list and its totals are grouped per currency by the API — which says in
   * its own comment that summing across them "would produce a number in no
   * currency at all" — and the screen then rendered every one of them with the
   * store default's symbol. An expense entered before the store changed
   * currency printed as dollars, and two totals in different currencies sat
   * side by side looking like the same money.
   */
  const money = useCallback(
    (amount: number, currency?: string | null) =>
      formatCurrency(amount, (currency || storeCurrency).toUpperCase()),
    [storeCurrency],
  );

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [totals, setTotals] = useState<ListPayload["totals"]>([]);
  const [outstanding, setOutstanding] = useState<ListPayload["outstanding"]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [paidFrom, setPaidFrom] = useState(initialPaidFrom);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [settling, setSettling] = useState<ExpenseRow | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      // Named periods are read from the viewer's own today, so an expense
      // dated today is in the list it was recorded in.
      const range = expenseListRange(period, from, to, localToday());
      try {
        const data = await apiClient.get<ListPayload>(API, {
          query: {
            page,
            limit: 20,
            ...(range ?? {}),
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(category !== "all" ? { category } : {}),
            ...(paidFrom !== "all" ? { paidFrom } : {}),
          },
        });
        setRows(data.data || []);
        setTotals(data.totals || []);
        setOutstanding(data.outstanding || []);
        setPagination({
          page: data.pagination?.page ?? 1,
          totalPages: data.pagination?.totalPages ?? 1,
          total: data.pagination?.total ?? 0,
        });
      } catch (error) {
        toast.error(
          describeApiError(
            error,
            label("finance.expenses.loadFailed", "Could not load expenses"),
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [search, category, paidFrom, from, to, period, label],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(1), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const refresh = useCallback(() => void load(pagination.page), [load, pagination.page]);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (row: ExpenseRow) => {
    setEditing(row);
    setDialogOpen(true);
  };

  const remove = useCallback(
    async (row: ExpenseRow) => {
      const isTemplate = Boolean(row.recurring?.enabled);
      const ok = await confirm({
        title: label("finance.expenses.deleteTitle", "Delete this expense?"),
        description: [
          label(
            "finance.expenses.deleteLedgerNote",
            "Its ledger entries are reversed, not erased. An open month simply stops showing it; a closed month keeps its figures, and the reversal is booked after the close.",
          ),
          row.settlement
            ? label(
                "finance.expenses.deletePaidNote",
                "Its recorded payment is reversed too.",
              )
            : null,
          isTemplate
            ? label(
                "finance.expenses.deleteTemplateNote",
                "This also stops the repeating schedule. Copies already made stay.",
              )
            : null,
        ]
          .filter(Boolean)
          .join(" "),
        confirmText: label("common.delete", "Delete"),
        variant: "destructive",
      });
      if (!ok) return;
      try {
        const outcome = await apiClient.delete<FinanceOutcome>(`${API}/${row._id}`, { headers: { "if-match": String(row.version ?? 0), "idempotency-key": financeRequest.key(`delete:${row._id}`, row.version) } });
        financeRequest.completed(outcome, label("finance.expenses.deleted", "Expense deleted"));
        // The last row of the last page leaves that page empty.
        const page =
          rows.length === 1 && pagination.page > 1
            ? pagination.page - 1
            : pagination.page;
        void load(page);
      } catch (error) {
        toast.error(
          describeApiError(
            error,
            label("finance.expenses.deleteFailed", "Could not delete it"),
          ),
        );
      }
    },
    [confirm, label, load, pagination.page, rows.length],
  );

  const markUnpaid = useCallback(
    async (row: ExpenseRow) => {
      const ok = await confirm({
        title: label("finance.expenses.markUnpaidTitle", "Mark as not paid?"),
        description: label(
          "finance.expenses.markUnpaidDescription",
          "The recorded payment is reversed on the day it was dated, and the bill is owed again.",
        ),
        confirmText: label("finance.expenses.markUnpaid", "Mark as not paid"),
      });
      if (!ok) return;
      try {
        const outcome = await apiClient.delete<FinanceOutcome>(`${API}/${row._id}/settle`, { headers: { "if-match": String(row.version ?? 0), "idempotency-key": financeRequest.key(`undo:${row._id}`, row.version) } });
        financeRequest.completed(outcome, label("finance.expenses.markedUnpaid", "Marked as not paid"));
        refresh();
      } catch (error) {
        toast.error(
          describeApiError(
            error,
            label("finance.expenses.settleFailed", "Could not record the payment"),
          ),
        );
      }
    },
    [confirm, label, refresh],
  );

  const categoryLabel = useCallback(
    (key: ExpenseCategory) =>
      label(`finance.expenseCategory.${key}`, EXPENSE_CATEGORY_LABELS[key]),
    [label],
  );

  const paidFromLabel = useCallback(
    (key: string) =>
      label(`finance.paidFrom.${key}`, {
        bank: "Bank",
        cash: "Cash",
        gateway: "Gateway balance",
        unpaid: "Not paid yet",
      }[key] ?? key),
    [label],
  );

  const intervalLabel = useCallback(
    (interval?: string) =>
      label(`finance.expenses.${interval || "monthly"}`, {
        weekly: "Every week",
        monthly: "Every month",
        quarterly: "Every quarter",
        yearly: "Every year",
      }[interval || "monthly"] ?? ""),
    [label],
  );

  /** What kind of row this is in a schedule, if any — shown under its title. */
  const scheduleBadge = useCallback(
    (row: ExpenseRow) => {
      const schedule = row.recurring;
      if (!schedule) return null;
      if (isGeneratedCopy(row)) {
        // A copy the schedule made. Without this nobody could tell it from
        // one somebody typed, and editing it as if it were the template
        // changed nothing that repeats.
        return (
          <Badge variant="outline" className="gap-1 text-[11px] font-normal">
            <CalendarClock className="size-3" />
            {label("finance.expenses.generatedBadge", "Auto")}
          </Badge>
        );
      }
      if (schedule.enabled) {
        // Which row is the template. Without this an admin cannot find the
        // one that keeps producing copies in order to stop it.
        return (
          <Badge variant="outline" className="gap-1 text-[11px] font-normal">
            <Repeat className="size-3" />
            {intervalLabel(schedule.interval)}
          </Badge>
        );
      }
      const ended =
        schedule.endsAt &&
        schedule.nextDueAt &&
        new Date(schedule.nextDueAt) > new Date(schedule.endsAt);
      return (
        <Badge
          variant="outline"
          className="gap-1 text-[11px] font-normal text-muted-foreground"
        >
          <Repeat className="size-3" />
          {ended
            ? label("finance.expenses.scheduleEndedBadge", "Ended")
            : label("finance.expenses.pausedBadge", "Paused")}
        </Badge>
      );
    },
    [intervalLabel, label],
  );

  const columns = useMemo<DataTableColumn<ExpenseRow>[]>(
    () => [
      {
        id: "date",
        header: label("finance.expenses.date", "Date"),
        cell: (row) => (
          <span className="tabular-nums">{formatDay(row.date, locale)}</span>
        ),
      },
      {
        id: "description",
        header: label("finance.expenses.description", "Description"),
        cell: (row) => {
          const badge = scheduleBadge(row);
          return (
            <div className="min-w-0">
              <p className="truncate font-medium">{row.description}</p>
              {/* On its own line, so a long description cannot truncate the
                  badge away with it. */}
              {row.payee || badge ? (
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                  {badge}
                  {row.payee ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {row.payee}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "category",
        header: label("finance.expenses.category", "Category"),
        cell: (row) => (
          <Badge variant="secondary">{categoryLabel(row.category)}</Badge>
        ),
      },
      {
        id: "paidFrom",
        header: label("finance.expenses.paidFrom", "Paid from"),
        cell: (row) =>
          row.settlement ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-600" />
              {label("finance.expenses.paidOnFrom", "{account} · paid {date}", {
                account: paidFromLabel(row.settlement.paidFrom),
                date: formatDay(row.settlement.paidAt, locale),
              })}
            </span>
          ) : (
            <span
              className={
                row.paidFrom === "unpaid"
                  ? "text-xs font-medium text-amber-600"
                  : "text-xs text-muted-foreground"
              }
            >
              {paidFromLabel(row.paidFrom)}
            </span>
          ),
      },
      ...(multiVendor
        ? [
            {
              id: "book",
              header: label("finance.expenses.book", "Book"),
              cell: (row: ExpenseRow) => (
                <span className="text-xs text-muted-foreground">
                  {label(
                    `finance.book.${row.book}`,
                    row.book === "own" ? "Own store" : "Marketplace",
                  )}
                </span>
              ),
            },
          ]
        : []),
      {
        // Stored on every expense and shown on none of them: the evidence
        // behind a number was reachable only by opening the row for editing,
        // which is not what anyone reviewing a month is doing.
        id: "receipt",
        header: label("finance.expenses.receipt", "Receipt"),
        cell: (row) =>
          row.receiptUrl ? (
            <a
              href={expenseReceiptViewUrl(row.receiptUrl)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {isPdfReceipt(row.receiptUrl) ? (
                <FileText className="size-3.5" />
              ) : (
                <ImageIcon className="size-3.5" />
              )}
              {label("finance.expenses.viewReceipt", "View")}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground/50">—</span>
          ),
      },
      {
        id: "amount",
        header: label("finance.expenses.amount", "Amount"),
        className: "text-right",
        headerClassName: "text-right",
        cell: (row) => (
          <span className="font-semibold tabular-nums">
            {money(row.amount, row.currency)}
          </span>
        ),
      },
    ],
    [categoryLabel, label, locale, money, multiVendor, paidFromLabel, scheduleBadge],
  );

  const showingOwed = paidFrom === "unpaid" && period === "all";

  // The "Filter" dropdown the other admin tables have. The screen keeps its own
  // heading above, so only the table's layout is taken from the shared header.
  const tableHeader = buildAdminCommerceTableHeader({
    title: label("finance.expenses.title", "Expenses"),
  });

  return (
    <div className="space-y-5">
      {/*
        The heading belongs to the screen, not to the table inside it.

        Every other finance page has one; this one let the DataTable's title
        stand in, which left the period control and "Record expense" in two
        different bands with no title over either.
      */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {label("finance.expenses.title", "Expenses")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {label(
              "finance.expenses.subtitle",
              "The costs nothing else in the app can see — rent, salaries, advertising. Everything here was typed in by someone.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The dashboard's own picker, so "this month" is worded and drawn
              the same here as there. */}
          <DashboardPeriodPicker
            period={period}
            from={from}
            to={to}
            defaultPeriod="month"
          />
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {label("finance.expenses.add", "Record expense")}
          </Button>
        </div>
      </div>

      {/* What is still owed, whatever the period. The unpaid figure in the
          totals follows the period, so an older bill dropped out of sight
          while it was still waiting to be paid. */}
      {outstanding.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Wallet className="size-4 text-amber-700 dark:text-amber-400" />
            <span className="font-medium text-amber-900 dark:text-amber-200">
              {label("finance.expenses.outstandingTitle", "Bills not yet paid")}
            </span>
            <span className="text-amber-900/80 tabular-nums dark:text-amber-200/80">
              {outstanding
                .map((row) => `${money(row.amount, row.currency)} (${row.count})`)
                .join(" · ")}
            </span>
          </div>
          {showingOwed ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPaidFrom("unpaid");
                router.push(`${pathname}?period=all&paidFrom=unpaid`);
              }}
            >
              {label("finance.expenses.showOutstanding", "Show them")}
            </Button>
          )}
        </div>
      ) : null}

      <DataTable<ExpenseRow>
        data={rows}
        columns={columns}
        keyField="_id"
        isLoading={isLoading}
        // Rows, not the whole table: replacing it would unmount the search box
        // — and its focus — on every keystroke's reload.
        loadingMode="rows"
        appearance={tableHeader.appearance}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        searchable
        searchPlaceholder={label(
          "finance.expenses.searchPlaceholder",
          "Search description or payee…",
        )}
        searchValue={search}
        onSearchChange={setSearch}
        filters={[
          {
            id: "category",
            label: label("finance.expenses.category", "Category"),
            type: "select" as const,
            options: [
              { value: "all", label: label("common.all", "All") },
              ...EXPENSE_CATEGORIES.map((key) => ({
                value: key,
                label: categoryLabel(key),
              })),
            ],
          },
          {
            // "Not paid yet" is the one anybody comes here looking for — a
            // bill recorded and not yet settled is a payment somebody still
            // has to make.
            id: "paidFrom",
            label: label("finance.expenses.paidFrom", "Paid from"),
            type: "select" as const,
            options: [
              { value: "all", label: label("common.all", "All") },
              ...PAID_FROM.map((key) => ({
                value: key,
                label: paidFromLabel(key),
              })),
            ],
          },
        ]}
        filterValues={{ category, paidFrom }}
        onFilterChange={(id, value) =>
          id === "paidFrom" ? setPaidFrom(value) : setCategory(value)
        }
        rowActions={(row) => [
          {
            id: "edit",
            label: label("common.edit", "Edit"),
            icon: <Pencil className="h-4 w-4" />,
            onClick: () => openEdit(row),
          },
          ...(row.paidFrom === "unpaid" && !row.settlement
            ? [
                {
                  id: "mark-paid",
                  label: label("finance.expenses.markPaid", "Mark as paid"),
                  icon: <CheckCircle2 className="h-4 w-4" />,
                  onClick: () => setSettling(row),
                },
              ]
            : []),
          ...(row.settlement
            ? [
                {
                  id: "mark-unpaid",
                  label: label("finance.expenses.markUnpaid", "Mark as not paid"),
                  icon: <RotateCcw className="h-4 w-4" />,
                  onClick: () => void markUnpaid(row),
                },
              ]
            : []),
          {
            id: "delete",
            label: label("common.delete", "Delete"),
            icon: <Trash2 className="h-4 w-4" />,
            variant: "destructive" as const,
            onClick: () => void remove(row),
          },
        ]}
        pagination={{
          page: pagination.page,
          pageSize: 20,
          total: pagination.total,
          totalPages: pagination.totalPages,
        }}
        onPageChange={(page) => void load(page)}
        emptyMessage={label(
          "finance.expenses.empty",
          "No expenses recorded yet. Rent, salaries and advertising are the costs nothing else in the app can see.",
        )}
      />

      {/* The filtered total, per currency — never one number across several. */}
      {totals.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <span className="text-muted-foreground">
              {label("finance.expenses.filteredTotal", "Total for this filter")}
            </span>
            <div className="flex flex-wrap items-center gap-4">
              {totals.map((row) => (
                <span key={row.currency} className="font-semibold tabular-nums">
                  {money(row.amount, row.currency)}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {label("finance.expenses.entryCount", "{count} entries", {
                      count: row.count,
                    })}
                  </span>
                </span>
              ))}
            </div>
          </div>
          {totals.some((row) => row.unpaid > 0 || row.stock > 0) ? (
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {totals
                .filter((row) => row.unpaid > 0)
                .map((row) => (
                  <span key={`unpaid-${row.currency}`}>
                    {label(
                      "finance.expenses.unpaidTotal",
                      "{amount} of it recorded but not yet paid",
                      { amount: money(row.unpaid, row.currency) },
                    )}
                  </span>
                ))}
              {/* Stock is an asset until it sells, so the profit and loss
                  leaves it out — and this total, which includes it, reads
                  higher than "costs" there by exactly this much. */}
              {totals
                .filter((row) => row.stock > 0)
                .map((row) => (
                  <span key={`stock-${row.currency}`}>
                    {label(
                      "finance.expenses.stockTotal",
                      "{amount} of it is stock bought — held as inventory, not counted as a cost",
                      { amount: money(row.stock, row.currency) },
                    )}
                  </span>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <ExpenseFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        multiVendor={multiVendor}
        storeCurrency={storeCurrency}
        currencies={currencies}
        closedThrough={closedThrough}
        hasProductCosts={hasProductCosts}
        onSaved={refresh}
      />
      <ExpenseSettleDialog
        expense={settling}
        onOpenChange={(open) => {
          if (!open) setSettling(null);
        }}
        onSettled={refresh}
      />
    </div>
  );
}
