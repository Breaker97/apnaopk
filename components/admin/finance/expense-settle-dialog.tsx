"use client";

import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast-notification";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { apiClient, ApiClientError, describeApiError } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import {
  dayOf,
  formatDay,
  localToday,
  type ExpenseRow,
  type SettledFrom,
} from "@/components/admin/finance/expense-types";

const SETTLED_FROM: SettledFrom[] = ["bank", "cash", "gateway"];

/**
 * Recording that a bill entered as "not yet paid" has been paid.
 *
 * Asks the two things the books need and the old way — editing "Paid from" —
 * could not say: the day the money left, and which account it left. The bill
 * itself is not touched.
 */
export function ExpenseSettleDialog({
  expense,
  onOpenChange,
  onSettled,
}: {
  /** The bill being paid; null when the dialog is closed. */
  expense: ExpenseRow | null;
  onOpenChange: (open: boolean) => void;
  onSettled: () => void;
}) {
  const t = useTranslations();
  const text = useFallbackTranslator(t);
  const locale = useLocale();

  const [paidAt, setPaidAt] = useState(localToday());
  const [paidFrom, setPaidFrom] = useState<SettledFrom>("bank");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useApplyOnChange([expense], () => {
    if (!expense) return;
    // Today, unless the bill is dated later than today in the admin's own
    // calendar — it cannot be paid before it existed.
    const billDay = dayOf(expense.date);
    const today = localToday();
    setPaidAt(billDay > today ? billDay : today);
    setPaidFrom("bank");
    setError(null);
  });

  const submit = useCallback(async () => {
    if (!expense || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.post(`/api/admin/finance/expenses/${expense._id}/settle`, {
        paidAt,
        paidFrom,
      });
      toast.success(text("finance.expenses.markedPaid", "Marked as paid"));
      onOpenChange(false);
      onSettled();
    } catch (failure) {
      const fieldMessage =
        failure instanceof ApiClientError ? failure.errors?.paidAt?.[0] : null;
      setError(
        fieldMessage ||
          describeApiError(
            failure,
            text("finance.expenses.settleFailed", "Could not record the payment"),
          ),
      );
    } finally {
      setIsSaving(false);
    }
  }, [expense, isSaving, onOpenChange, onSettled, paidAt, paidFrom, text]);

  const billDay = expense ? dayOf(expense.date) : null;

  return (
    <Dialog open={Boolean(expense)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {text("finance.expenses.markPaidTitle", "Mark as paid")}
            </DialogTitle>
            <DialogDescription>
              {expense
                ? text(
                    "finance.expenses.markPaidDescription",
                    "{description} · {amount}, dated {date}. The cost stays on that day; the payment is recorded on the day the money left.",
                    {
                      description: expense.description,
                      amount: formatCurrency(expense.amount, expense.currency),
                      date: formatDay(expense.date, locale),
                    },
                  )
                : null}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="expense-paid-at">
                {text("finance.expenses.paidOn", "Paid on")}
              </Label>
              <DateField
                id="expense-paid-at"
                value={paidAt}
                onChange={setPaidAt}
                disableAfter={new Date()}
                disableBefore={
                  billDay
                    ? new Date(
                        Number(billDay.slice(0, 4)),
                        Number(billDay.slice(5, 7)) - 1,
                        Number(billDay.slice(8, 10)),
                      )
                    : undefined
                }
                invalid={Boolean(error)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense-settled-from">
                {text("finance.expenses.paidFrom", "Paid from")}
              </Label>
              <Select
                value={paidFrom}
                onValueChange={(value) => setPaidFrom(value as SettledFrom)}
              >
                <SelectTrigger id="expense-settled-from" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SETTLED_FROM.map((key) => (
                    <SelectItem key={key} value={key}>
                      {text(`finance.paidFrom.${key}`, {
                        bank: "Bank",
                        cash: "Cash",
                        gateway: "Gateway balance",
                      }[key])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {text("common.cancel", "Cancel")}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? text("finance.expenses.saving", "Saving…")
                : text("finance.expenses.markPaid", "Mark as paid")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
