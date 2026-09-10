"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  ImageIcon,
  Pencil,
  Plus,
  Repeat,
  Trash2,
} from "lucide-react";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { FinancePeriodPicker } from "@/components/admin/finance/finance-period-picker";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";

interface ExpenseRow {
  _id: string;
  date: string;
  book: "own" | "marketplace";
  category: ExpenseCategory;
  amount: number;
  currency: string;
  description: string;
  payee?: string | null;
  paidFrom: "bank" | "cash" | "gateway" | "unpaid";
  receiptUrl?: string | null;
  recurring?: {
    enabled?: boolean;
    interval?: "weekly" | "monthly" | "quarterly" | "yearly";
  } | null;
  note?: string | null;
}

interface ListPayload {
  data: ExpenseRow[];
  pagination: { page: number; totalPages: number; total: number };
  totals: Array<{
    currency: string;
    amount: number;
    count: number;
    unpaid: number;
  }>;
}

const API = "/api/admin/finance/expenses";
const PAID_FROM = ["bank", "cash", "gateway", "unpaid"] as const;

const emptyForm = () => ({
  date: new Date().toISOString().slice(0, 10),
  category: "other" as ExpenseCategory,
  amount: "",
  description: "",
  payee: "",
  paidFrom: "bank" as (typeof PAID_FROM)[number],
  book: "own" as "own" | "marketplace",
  receiptUrl: "",
  repeats: false,
  interval: "monthly" as "weekly" | "monthly" | "quarterly" | "yearly",
  note: "",
});

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
  period,
  from,
  to,
}: {
  multiVendor: boolean;
  storeCurrency: string;
  /** The resolved period key, for the picker in this screen's own header. */
  period: string;
  /**
   * The period the page resolved, in ISO. Sent with every request: the totals
   * are computed over the whole filter, and a filter with no period at all
   * made "total for this filter" mean every expense ever recorded — under a
   * screen that looked like it was showing a month.
   */
  from: string;
  to: string;
}) {
  const t = useTranslations();
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

  const label = useCallback(
    (key: string, fallback: string, values?: Record<string, string | number>) => {
      if (t.has(key)) return t(key, values);
      if (!values) return fallback;
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        fallback,
      );
    },
    [t],
  );

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [totals, setTotals] = useState<ListPayload["totals"]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [paidFrom, setPaidFrom] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      try {
        const data = await apiClient.get<ListPayload>(API, {
          query: {
            page,
            limit: 20,
            from,
            to,
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(category !== "all" ? { category } : {}),
            ...(paidFrom !== "all" ? { paidFrom } : {}),
          },
        });
        setRows(data.data || []);
        setTotals(data.totals || []);
        setPagination({
          page: data.pagination?.page ?? 1,
          totalPages: data.pagination?.totalPages ?? 1,
          total: data.pagination?.total ?? 0,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : label("finance.expenses.loadFailed", "Could not load expenses"),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [search, category, paidFrom, from, to, label],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(1), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (row: ExpenseRow) => {
    setEditing(row);
    setForm({
      date: row.date.slice(0, 10),
      category: row.category,
      amount: String(row.amount),
      description: row.description,
      payee: row.payee || "",
      paidFrom: row.paidFrom,
      book: row.book,
      receiptUrl: row.receiptUrl || "",
      repeats: Boolean(row.recurring?.enabled),
      interval: row.recurring?.interval || "monthly",
      note: row.note || "",
    });
    setDialogOpen(true);
  };

  const save = useCallback(async () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(
        label("finance.expenses.amountRequired", "Enter an amount above zero"),
      );
      return;
    }
    if (form.description.trim().length < 2) {
      toast.error(
        label("finance.expenses.descriptionRequired", "Describe what this was for"),
      );
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        date: form.date,
        category: form.category,
        amount,
        description: form.description.trim(),
        payee: form.payee.trim(),
        paidFrom: form.paidFrom,
        book: multiVendor ? form.book : "own",
        receiptUrl: form.receiptUrl.trim(),
        // Sent as a pair so turning it off is an instruction, not an omission —
        // an absent `recurring` on an edit would leave the old template running.
        recurring: { enabled: form.repeats, interval: form.interval },
        note: form.note.trim(),
      };
      if (editing) {
        await apiClient.put(`${API}/${editing._id}`, payload);
        toast.success(label("finance.expenses.updated", "Expense updated"));
      } else {
        await apiClient.post(API, payload);
        toast.success(label("finance.expenses.created", "Expense recorded"));
      }
      setDialogOpen(false);
      void load(pagination.page);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label("finance.expenses.saveFailed", "Could not save the expense"),
      );
    } finally {
      setIsSaving(false);
    }
  }, [form, editing, multiVendor, label, load, pagination.page]);

  const remove = useCallback(
    async (row: ExpenseRow) => {
      const ok = await confirm({
        title: label("finance.expenses.deleteTitle", "Delete this expense?"),
        description: label(
          "finance.expenses.deleteDescription",
          "The row goes, but its ledger entries are reversed rather than removed — so past reports still show what they showed at the time.",
        ),
        confirmText: label("common.delete", "Delete"),
        variant: "destructive",
      });
      if (!ok) return;
      try {
        await apiClient.delete(`${API}/${row._id}`);
        toast.success(label("finance.expenses.deleted", "Expense deleted"));
        void load(pagination.page);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : label("finance.expenses.deleteFailed", "Could not delete it"),
        );
      }
    },
    [confirm, label, load, pagination.page],
  );

  const categoryLabel = useCallback(
    (key: ExpenseCategory) =>
      label(`finance.expenseCategory.${key}`, EXPENSE_CATEGORY_LABELS[key]),
    [label],
  );

  const columns = useMemo<DataTableColumn<ExpenseRow>[]>(
    () => [
      {
        id: "date",
        header: label("finance.expenses.date", "Date"),
        cell: (row) => (
          <span className="tabular-nums">
            {new Date(row.date).toLocaleDateString(undefined, {
              timeZone: "UTC",
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        ),
      },
      {
        id: "description",
        header: label("finance.expenses.description", "Description"),
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium">
              {row.description}
              {/* Which row is the template. Without this an admin cannot find
                  the one that keeps producing copies in order to stop it. */}
              {row.recurring?.enabled ? (
                <Badge variant="outline" className="ml-2 align-middle text-xs">
                  <Repeat className="mr-1 h-3 w-3" />
                  {label("finance.expenses.repeats", "Repeats")}
                </Badge>
              ) : null}
            </p>
            {row.payee ? (
              <p className="truncate text-xs text-muted-foreground">{row.payee}</p>
            ) : null}
          </div>
        ),
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
        cell: (row) => (
          <span
            className={
              row.paidFrom === "unpaid"
                ? "text-xs font-medium text-amber-600"
                : "text-xs text-muted-foreground"
            }
          >
            {label(`finance.paidFrom.${row.paidFrom}`, row.paidFrom)}
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
              href={row.receiptUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {/\.pdf($|\?)/i.test(row.receiptUrl) ? (
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
    [label, categoryLabel, money, multiVendor],
  );

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
          <FinancePeriodPicker
            period={period}
            from={from}
            to={to}
            book="all"
            showBookFilter={false}
          />
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {label("finance.expenses.add", "Record expense")}
          </Button>
        </div>
      </div>

      <DataTable<ExpenseRow>
        data={rows}
        columns={columns}
        keyField="_id"
        isLoading={isLoading}
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
            // "Unpaid" is the one anybody comes here looking for — a bill
            // recorded and not yet settled is a payment somebody still has to
            // make, and it was findable only by reading down the column.
            id: "paidFrom",
            label: label("finance.expenses.paidFrom", "Paid from"),
            type: "select" as const,
            options: [
              { value: "all", label: label("common.all", "All") },
              ...PAID_FROM.map((key) => ({
                value: key,
                label: label(`finance.paidFrom.${key}`, key),
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
          {
            id: "delete",
            label: label("common.delete", "Delete"),
            icon: <Trash2 className="h-4 w-4" />,
            variant: "destructive",
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
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">
              {label("finance.expenses.filteredTotal", "Total for this filter")}
            </span>
            {totals.some((row) => row.unpaid > 0) ? (
              <span className="text-xs text-muted-foreground">
                ·{" "}
                {totals
                  .filter((row) => row.unpaid > 0)
                  .map((row) =>
                    label(
                      "finance.expenses.unpaidTotal",
                      "{amount} of it recorded but not yet paid",
                    ).replace("{amount}", money(row.unpaid, row.currency)),
                  )
                  .join(" · ")}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {totals.map((row) => (
              <span key={row.currency} className="font-semibold tabular-nums">
                {money(row.amount, row.currency)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({row.count})
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? label("finance.expenses.editTitle", "Edit expense")
                : label("finance.expenses.add", "Record expense")}
            </DialogTitle>
            <DialogDescription>
              {label(
                "finance.expenses.dialogSubtitle",
                "Costs the store pays out — rent, salaries, advertising, anything no order or payout already records.",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="expense-date">
                {label("finance.expenses.date", "Date")}
              </Label>
              <DateField
                id="expense-date"
                value={form.date}
                onChange={(value) => setForm({ ...form, date: value })}
                // A cost cannot have been paid in the future, and a date typed
                // in one posts a ledger entry into a period nobody is looking
                // at yet.
                disableAfter={new Date()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-amount">
                {label("finance.expenses.amount", "Amount")}
              </Label>
              <CurrencyInput
                id="expense-amount"
                currencySymbol={storeCurrency}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="expense-description">
                {label("finance.expenses.description", "Description")}
              </Label>
              <Input
                id="expense-description"
                value={form.description}
                placeholder={label(
                  "finance.expenses.descriptionPlaceholder",
                  "August office rent",
                )}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{label("finance.expenses.category", "Category")}</Label>
              <Select
                value={form.category}
                onValueChange={(value) =>
                  setForm({ ...form, category: value as ExpenseCategory })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((key) => (
                    <SelectItem key={key} value={key}>
                      {categoryLabel(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{label("finance.expenses.paidFrom", "Paid from")}</Label>
              <Select
                value={form.paidFrom}
                onValueChange={(value) =>
                  setForm({
                    ...form,
                    paidFrom: value as (typeof PAID_FROM)[number],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAID_FROM.map((key) => (
                    <SelectItem key={key} value={key}>
                      {label(`finance.paidFrom.${key}`, key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-payee">
                {label("finance.expenses.payee", "Paid to")}
              </Label>
              <Input
                id="expense-payee"
                value={form.payee}
                onChange={(e) => setForm({ ...form, payee: e.target.value })}
              />
            </div>
            {/* Only a marketplace has a second book to file a cost under. */}
            {multiVendor ? (
              <div className="space-y-1.5">
                <Label>{label("finance.expenses.book", "Book")}</Label>
                <Select
                  value={form.book}
                  onValueChange={(value) =>
                    setForm({ ...form, book: value as "own" | "marketplace" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">
                      {label("finance.book.own", "Own store")}
                    </SelectItem>
                    <SelectItem value="marketplace">
                      {label("finance.book.marketplace", "Marketplace")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {/* The receipt is the evidence behind the number; without it the
                row is one person's word. Uses the same upload the rest of the
                admin does, so storage provider and limits come from one place. */}
            <div className="sm:col-span-2">
              <FileUploadField
                id="expense-receipt"
                label={label("finance.expenses.receipt", "Receipt")}
                hint={label(
                  "finance.expenses.receiptHint",
                  " — optional, but it is the evidence behind the number",
                )}
                value={form.receiptUrl}
                onChange={(value) => setForm({ ...form, receiptUrl: value })}
              />
            </div>
            {/* Rent, salaries and hosting arrive on a schedule, and re-typing
                them every month is how a store's costs quietly stop being
                recorded. The engine and the daily job already existed; without
                this switch there was no way to reach them. */}
            <div className="space-y-3 rounded-md border p-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label htmlFor="expense-repeats">
                    {label("finance.expenses.repeats", "Repeats")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {label(
                      "finance.expenses.repeatsHint",
                      "Record this again automatically, dated when it falls due.",
                    )}
                  </p>
                </div>
                <Switch
                  id="expense-repeats"
                  checked={form.repeats}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, repeats: checked })
                  }
                />
              </div>
              {form.repeats ? (
                <Select
                  value={form.interval}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      interval: value as typeof form.interval,
                    })
                  }
                >
                  <SelectTrigger id="expense-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">
                      {label("finance.expenses.weekly", "Every week")}
                    </SelectItem>
                    <SelectItem value="monthly">
                      {label("finance.expenses.monthly", "Every month")}
                    </SelectItem>
                    <SelectItem value="quarterly">
                      {label("finance.expenses.quarterly", "Every quarter")}
                    </SelectItem>
                    <SelectItem value="yearly">
                      {label("finance.expenses.yearly", "Every year")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="expense-note">
                {label("finance.expenses.note", "Note")}
              </Label>
              <Textarea
                id="expense-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isSaving}
            >
              {label("common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={isSaving}>
              {editing
                ? label("common.save", "Save")
                : label("finance.expenses.add", "Record expense")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
