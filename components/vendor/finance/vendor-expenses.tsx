"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Plus, Receipt, Pencil, Ban } from "lucide-react";
import {
  DataTable,
  type DataTableColumn,
  type DataTableFilter,
} from "@/components/ui/data-table";
import { DashboardPeriodPicker } from "@/components/admin/dashboard-period-picker";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { localToday } from "@/components/admin/finance/expense-types";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, describeApiError } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";
import { expenseListRange, vendorExpenseExportQuery } from "@/lib/finance/expense-list-range";
import { useFinanceRequest } from "@/hooks/use-finance-request";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface Row {
  _id: string;
  date: string;
  category: ExpenseCategory;
  amount: number;
  currency: string;
  description: string;
  payee?: string | null;
  version?: number;
}

const API = "/api/vendor/finance/expenses";
const PAGE_SIZE = 20;

interface ListPayload {
  data: Row[];
  pagination?: { page: number; totalPages: number; total: number };
  totals: Array<{ currency: string; amount: number }>;
}

/**
 * A vendor's own costs.
 *
 * Recorded for their own records and nothing else: these never reach the
 * marketplace's books, so nothing here changes what they are owed. The subtitle
 * says so, because a seller entering a cost reasonably expects it to come off
 * something.
 *
 * The period is the dashboard's, held in the URL by its picker; the category is
 * a table filter. The totals beside the heading are computed over both, not over
 * the rows on screen.
 */
export function VendorExpenses({
  storeCurrency,
  period,
  from,
  to,
  canManage,
}: {
  storeCurrency: string;
  /** The resolved period key: one of the dashboard's, or "custom" for picked dates. */
  period: string;
  /** The period as "YYYY-MM-DD" days, "" for all time. */
  from: string;
  to: string;
  canManage: boolean;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Array<{ currency: string; amount: number }>>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [category, setCategory] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const finance = useFinanceRequest();
  const requestSequence = useRef(0);
  const [form, setForm] = useState({
    date: localToday(),
    category: "other" as ExpenseCategory,
    amount: "",
    description: "",
    payee: "",
  });

  const load = useCallback(
    (page = 1) => {
      const sequence = ++requestSequence.current;
      // Named periods are read from the viewer's own today, so an expense
      // dated today is in the list it was recorded in.
      const range = expenseListRange(period, from, to, localToday());
      return apiClient
        .get<ListPayload>(API, {
          query: {
            page,
            limit: PAGE_SIZE,
            ...(range ?? {}),
            ...(category !== "all" ? { category } : {}),
          },
        })
        .then((data) => {
          if (sequence !== requestSequence.current) return;
          setRows(data.data || []);
          setTotals(data.totals || []);
          setPagination({
            page: data.pagination?.page ?? 1,
            totalPages: data.pagination?.totalPages ?? 1,
            total: data.pagination?.total ?? 0,
          });
        })
        .catch((error) => {
          if (sequence !== requestSequence.current) return;
          toast.error(describeApiError(error, label("finance.expenses.loadFailed", "Could not load expenses")));
        })
        .finally(() => { if (sequence === requestSequence.current) setIsLoading(false); });
    },
    [category, period, from, to, label],
  );
  const reload = useCallback(() => {
    setIsLoading(true);
    return load(1);
  }, [load]);
  const changePage = useCallback(
    (page: number) => {
      setIsLoading(true);
      void load(page);
    },
    [load],
  );

  // A different period or category is a different list: back to its first page.
  useApplyOnChange([load], () => {
    setIsLoading(true);
  });
  useEffect(() => {
    void load(1);
  }, [load]);

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "category",
        label: label("finance.expenses.category", "Category"),
        type: "select",
        options: [
          { value: "all", label: label("common.all", "All") },
          ...EXPENSE_CATEGORIES.map((key) => ({
            value: key,
            label: label(
              `finance.expenseCategory.${key}`,
              EXPENSE_CATEGORY_LABELS[key],
            ),
          })),
        ],
      },
    ],
    [label],
  );

  // The "Filter" dropdown the other tables have; the screen keeps its own
  // heading, so only the table's layout is taken from the shared header.
  const tableHeader = buildAdminCommerceTableHeader({
    title: label("finance.expenses.mine", "Your expenses"),
  });

  const save = useCallback(async () => {
    if (!canManage) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(label("finance.expenses.amountRequired", "Enter an amount above zero"));
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
      };
      if (editing) {
        await apiClient.put(`${API}/${editing._id}`, payload, { headers: {
          "if-match": String(editing.version ?? 0),
          "idempotency-key": finance.key(`vendor-expense:edit:${editing._id}`, { ...payload, version: editing.version ?? 0 }),
        } });
      } else await apiClient.post(API, payload);
      finance.completed({}, editing ? label("finance.expenses.updated", "Expense updated") : label("finance.expenses.created", "Expense recorded"));
      setOpen(false);
      setEditing(null);
      setForm({ ...form, amount: "", description: "", payee: "" });
      void reload();
    } catch (error) {
      toast.error(describeApiError(error, label("finance.expenses.saveFailed", "Could not save the expense")));
    } finally {
      setIsSaving(false);
    }
  }, [form, label, reload, canManage, editing, finance]);

  const openEdit = (row: Row) => {
    setEditing(row);
    setForm({ date: row.date.slice(0, 10), category: row.category, amount: String(row.amount), description: row.description, payee: row.payee ?? "" });
    setOpen(true);
  };

  const voidExpense = async () => {
    if (!canManage || !voiding || voidReason.trim().length < 3) return;
    setIsSaving(true);
    const payload = { reason: voidReason.trim() };
    try {
      await apiClient.request("DELETE", `${API}/${voiding._id}`, payload, { headers: {
        "if-match": String(voiding.version ?? 0),
        "idempotency-key": finance.key(`vendor-expense:void:${voiding._id}`, { ...payload, version: voiding.version ?? 0 }),
      } });
      finance.completed({}, label("finance.expenses.voided", "Expense voided"));
      setVoiding(null);
      setVoidReason("");
      void reload();
    } catch (error) {
      toast.error(describeApiError(error, label("finance.expenses.saveFailed", "Could not save the expense")));
    } finally { setIsSaving(false); }
  };

  const exportQuery = vendorExpenseExportQuery(period, from, to, localToday(), category);

  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        id: "date",
        header: label("finance.expenses.date", "Date"),
        cell: (row) => (
          <span className="tabular-nums">
            {new Date(row.date).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            })}
          </span>
        ),
      },
      {
        id: "description",
        header: label("finance.expenses.description", "Description"),
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.description}</p>
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
          <Badge variant="secondary">
            {label(
              `finance.expenseCategory.${row.category}`,
              EXPENSE_CATEGORY_LABELS[row.category],
            )}
          </Badge>
        ),
      },
      {
        id: "amount",
        header: label("finance.expenses.amount", "Amount"),
        className: "text-right",
        headerClassName: "text-right",
        cell: (row) => (
          <span className="font-semibold tabular-nums">
            {formatCurrency(row.amount, row.currency)}
          </span>
        ),
      },
    ],
    [label],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            {label("finance.expenses.mine", "Your expenses")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {label(
              "finance.expenses.mineSubtitle",
              "Costs you paid yourself. Recorded for your own records — they do not affect what the marketplace owes you.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DashboardPeriodPicker
            period={period}
            from={from}
            to={to}
            defaultPeriod="month"
          />
          {totals.map((total) => (
            <span key={total.currency} className="text-sm font-semibold tabular-nums">
              {formatCurrency(total.amount, total.currency)}
            </span>
          ))}
          {/* Export the same calendar days and category as the list. */}
          <Button asChild variant="outline">
            {/* An anchor, not next/link: this is a file download, not a
                navigation. Routing it through the client router would fetch the
                CSV into memory and land on a blank screen, and it would take
                right-click-save with it. */}
            <a href={`/api/vendor/finance/export?${exportQuery}`}>
              <Download className="h-4 w-4" />
              {label("finance.expenses.export", "Export")}
            </a>
          </Button>
          {canManage ? <Button onClick={() => {
            setEditing(null);
            setForm({ date: localToday(), category: "other", amount: "", description: "", payee: "" });
            setOpen(true);
          }}>
            <Plus className="h-4 w-4" />
            {label("finance.expenses.add", "Record expense")}
          </Button> : null}
        </div>
      </div>

      <DataTable<Row>
        data={rows}
        columns={columns}
        keyField="_id"
        isLoading={isLoading}
        loadingMode="rows"
        appearance={tableHeader.appearance}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        filters={filters}
        filterValues={{ category }}
        onFilterChange={(filterId, value) => {
          if (filterId === "category") setCategory(value);
        }}
        pagination={{
          page: pagination.page,
          pageSize: PAGE_SIZE,
          total: pagination.total,
          totalPages: pagination.totalPages,
        }}
        onPageChange={changePage}
        rowActions={canManage ? row => [
          { id: "edit", label: label("common.edit", "Edit"), icon: <Pencil className="size-4" />, onClick: () => openEdit(row) },
          { id: "void", label: label("finance.expenses.void", "Void expense"), icon: <Ban className="size-4" />, variant: "destructive", onClick: () => { setVoiding(row); setVoidReason(""); } },
        ] : undefined}
        emptyIcon={<Receipt className="h-8 w-8" />}
        emptyMessage={label(
          "finance.expenses.empty",
          "No expenses recorded yet.",
        )}
      />

      <Dialog open={open} onOpenChange={value => { if (!isSaving) setOpen(value); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? label("finance.expenses.editTitle", "Edit expense") : label("finance.expenses.add", "Record expense")}
            </DialogTitle>
            <DialogDescription>
              {label(
                "finance.expenses.mineSubtitle",
                "Costs you paid yourself. Recorded for your own records — they do not affect what the marketplace owes you.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="vendor-expense-date">
                {label("finance.expenses.date", "Date")}
              </Label>
              <Input
                id="vendor-expense-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-expense-amount">
                {label("finance.expenses.amount", "Amount")}
              </Label>
              <CurrencyInput
                id="vendor-expense-amount"
                currencySymbol={editing?.currency ?? storeCurrency}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="vendor-expense-description">
                {label("finance.expenses.description", "Description")}
              </Label>
              <Input
                id="vendor-expense-description"
                value={form.description}
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
                      {label(
                        `finance.expenseCategory.${key}`,
                        EXPENSE_CATEGORY_LABELS[key],
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vendor-expense-payee">
                {label("finance.expenses.payee", "Paid to")}
              </Label>
              <Input
                id="vendor-expense-payee"
                value={form.payee}
                onChange={(e) => setForm({ ...form, payee: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
              {label("common.cancel", "Cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={isSaving}>
              {editing ? label("common.save", "Save") : label("finance.expenses.add", "Record expense")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(voiding)} onOpenChange={value => { if (!value && !isSaving) setVoiding(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{label("finance.expenses.void", "Void expense")}</DialogTitle>
            <DialogDescription>{label("finance.expenses.voidHint", "Remove this expense from your totals. Its original details and the reason will stay in your records.")}</DialogDescription>
          </DialogHeader>
          {voiding ? <p className="text-sm font-medium">{voiding.description} · {formatCurrency(voiding.amount, voiding.currency)}</p> : null}
          <div className="space-y-1.5">
            <Label htmlFor="vendor-expense-void-reason">{label("finance.expenses.voidReason", "Reason")}</Label>
            <Input id="vendor-expense-void-reason" value={voidReason} maxLength={500} onChange={event => setVoidReason(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={isSaving} onClick={() => setVoiding(null)}>{label("common.cancel", "Cancel")}</Button>
            <Button variant="destructive" disabled={isSaving || voidReason.trim().length < 3} onClick={() => void voidExpense()}>{label("finance.expenses.void", "Void expense")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
