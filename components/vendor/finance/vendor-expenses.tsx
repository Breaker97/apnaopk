"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Plus, Receipt } from "lucide-react";
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
import { apiClient } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";
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
}

const API = "/api/vendor/finance/expenses";

/**
 * A vendor's own costs.
 *
 * Recorded for their own records and nothing else: these never reach the
 * marketplace's books, so nothing here changes what they are owed. The subtitle
 * says so, because a seller entering a cost reasonably expects it to come off
 * something.
 */
export function VendorExpenses({ storeCurrency }: { storeCurrency: string }) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Array<{ currency: string; amount: number }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: "other" as ExpenseCategory,
    amount: "",
    description: "",
    payee: "",
  });

  const load = useCallback(
    () =>
      apiClient
        .get<{
          data: Row[];
          totals: Array<{ currency: string; amount: number }>;
        }>(API)
        .then((data) => {
          setRows(data.data || []);
          setTotals(data.totals || []);
        })
        .catch(() => {
          // A vendor without the permission simply sees nothing here.
        })
        .finally(() => setIsLoading(false)),
    [],
  );
  const reload = useCallback(() => {
    setIsLoading(true);
    return load();
  }, [load]);

  useApplyOnChange([load], () => {
    setIsLoading(true);
  });
  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
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
      await apiClient.post(API, {
        date: form.date,
        category: form.category,
        amount,
        description: form.description.trim(),
        payee: form.payee.trim(),
      });
      toast.success(label("finance.expenses.created", "Expense recorded"));
      setOpen(false);
      setForm({ ...form, amount: "", description: "", payee: "" });
      void reload();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label("finance.expenses.saveFailed", "Could not save the expense"),
      );
    } finally {
      setIsSaving(false);
    }
  }, [form, label, reload]);

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
        <div className="flex items-center gap-3">
          {totals.map((total) => (
            <span key={total.currency} className="text-sm font-semibold tabular-nums">
              {formatCurrency(total.amount, total.currency)}
            </span>
          ))}
          {/* Their own costs, in the same file format as their statement —
              an accountant wants both halves or neither. `ytd` rather than the
              statement's 30 days: a cost list is filed once a year. */}
          <Button asChild variant="outline">
            {/* An anchor, not next/link: this is a file download, not a
                navigation. Routing it through the client router would fetch the
                CSV into memory and land on a blank screen, and it would take
                right-click-save with it. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/vendor/finance/export?type=expenses&period=ytd">
              <Download className="h-4 w-4" />
              {label("finance.statement.download", "Download")}
            </a>
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {label("finance.expenses.add", "Record expense")}
          </Button>
        </div>
      </div>

      <DataTable<Row>
        data={rows}
        columns={columns}
        keyField="_id"
        isLoading={isLoading}
        emptyIcon={<Receipt className="h-8 w-8" />}
        emptyMessage={label(
          "finance.expenses.empty",
          "No expenses recorded yet.",
        )}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {label("finance.expenses.add", "Record expense")}
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
                currencySymbol={storeCurrency}
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
              {label("finance.expenses.add", "Record expense")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
