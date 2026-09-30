"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Info, Lock, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DateField } from "@/components/ui/date-field";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { apiClient, ApiClientError, describeApiError } from "@/lib/api/client";
import { currencyPriceScale } from "@/lib/intl/money";
import { CURRENCIES, resolveCurrency } from "@/lib/intl/currencies";
import { cn } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_KEYWORDS,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
} from "@/lib/finance/expense-categories";
import {
  EXPENSE_RECEIPT_ACCEPT,
  EXPENSE_RECEIPT_MAX_SIZE_MB,
  EXPENSE_RECEIPT_ROUTE,
  expenseReceiptViewUrl,
} from "@/lib/finance/expense-receipts";
import {
  firstOccurrenceOnOrAfter,
  pastDueOccurrences,
  type RecurringInterval,
} from "@/lib/finance/recurring-schedule";
import {
  INTERVALS,
  PAID_FROM,
  dayOf,
  formatDay,
  isGeneratedCopy,
  localToday,
  storedDay,
  type ExpenseRow,
  type PaidFrom,
} from "@/components/admin/finance/expense-types";

const API = "/api/admin/finance/expenses";

/** How many copies the daily job makes per template per run. */
const COPIES_PER_RUN = 12;

interface ExpenseForm {
  date: string;
  category: ExpenseCategory | "";
  amount: string;
  currency: string;
  description: string;
  payee: string;
  paidFrom: PaidFrom;
  book: "own" | "marketplace";
  receiptUrl: string;
  repeats: boolean;
  interval: RecurringInterval;
  endsAt: string;
  backfill: boolean;
  note: string;
}

type Field =
  | "date"
  | "amount"
  | "currency"
  | "description"
  | "category"
  | "book"
  | "paidFrom"
  | "payee"
  | "receipt"
  | "endsAt"
  | "repeats"
  | "note";

/** Top to bottom, so the first error found is the first one on screen. */
const FIELD_ORDER: Field[] = [
  "date",
  "amount",
  "currency",
  "description",
  "category",
  "book",
  "paidFrom",
  "payee",
  "receipt",
  "repeats",
  "endsAt",
  "note",
];

/** Where each field's error sends the focus. */
const FIELD_INPUT_ID: Record<Field, string> = {
  date: "expense-date",
  amount: "expense-amount",
  currency: "expense-currency",
  description: "expense-description",
  category: "expense-category",
  book: "expense-book",
  paidFrom: "expense-paid-from",
  payee: "expense-payee",
  receipt: "expense-receipt",
  repeats: "expense-repeats",
  endsAt: "expense-ends",
  note: "expense-note",
};

/** The server's names for the same fields. */
const SERVER_FIELD: Record<string, Field> = {
  date: "date",
  amount: "amount",
  currency: "currency",
  description: "description",
  category: "category",
  book: "book",
  paidFrom: "paidFrom",
  payee: "payee",
  receiptUrl: "receipt",
  recurring: "repeats",
  "recurring.endsAt": "endsAt",
  note: "note",
};

const LIMITS = { description: 300, payee: 200, note: 1000 } as const;

function emptyForm(currency: string): ExpenseForm {
  return {
    // The viewer's own today. It was `toISOString()`, which is UTC: east of
    // Greenwich the form opened on yesterday for the first hours of every day.
    date: localToday(),
    // No default. "Other" was preselected, so every expense nobody thought
    // about was filed under it.
    category: "",
    amount: "",
    currency,
    description: "",
    payee: "",
    paidFrom: "bank",
    book: "own",
    receiptUrl: "",
    repeats: false,
    interval: "monthly",
    endsAt: "",
    backfill: false,
    note: "",
  };
}

function formFromRow(row: ExpenseRow): ExpenseForm {
  return {
    date: dayOf(row.date),
    category: row.category,
    amount: String(row.amount),
    currency: row.currency,
    description: row.description,
    payee: row.payee || "",
    paidFrom: row.paidFrom,
    book: row.book,
    receiptUrl: row.receiptUrl || "",
    repeats: Boolean(row.recurring?.enabled),
    interval: row.recurring?.interval || "monthly",
    endsAt: row.recurring?.endsAt ? dayOf(row.recurring.endsAt) : "",
    backfill: false,
    note: row.note || "",
  };
}

/** Decimal places typed into an amount. */
function decimalsOf(amount: string): number {
  const [, fraction = ""] = amount.trim().split(".");
  return fraction.length;
}

/**
 * Recording, or correcting, one expense.
 *
 * A form a person fills in about money, so it says what it will do before it
 * does it: which day a closed month's cost is booked on, that stock is not a
 * cost, what a repeating expense will create and when. It keeps what was
 * typed — a receipt still uploading is waited for, closing asks first — and
 * says what is wrong next to the field that is wrong.
 */
export function ExpenseFormDialog({
  open,
  onOpenChange,
  editing,
  multiVendor,
  storeCurrency,
  currencies,
  closedThrough,
  hasProductCosts,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The row being corrected; null to record a new one. */
  editing: ExpenseRow | null;
  multiVendor: boolean;
  storeCurrency: string;
  /** Currency codes a bill may be recorded in, the store's own first. */
  currencies: string[];
  /** The last instant of the last closed period, ISO; null when none is. */
  closedThrough: string | null;
  /** Whether any product has a cost price — see the stock purchase note. */
  hasProductCosts: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations();
  const text = useFallbackTranslator(t);
  const locale = useLocale();
  const { confirm } = useConfirmation();

  const [form, setForm] = useState<ExpenseForm>(() => emptyForm(storeCurrency));
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  /** What the form held when it opened — the yardstick for "unsaved". */
  const [initial, setInitial] = useState("");

  // A fresh form each time it opens, filled from the row when correcting one.
  useApplyOnChange([open, editing, storeCurrency], () => {
    if (!open) return;
    const next = editing ? formFromRow(editing) : emptyForm(storeCurrency);
    setForm(next);
    setErrors({});
    setFormError(null);
    setIsUploading(false);
    setInitial(JSON.stringify(next));
  });

  // Functional updates only. The receipt upload finishes after the admin has
  // typed on, and an update built from the form as it was when the upload
  // started put the amount and description back to what they were then.
  const set = useCallback(
    <K extends keyof ExpenseForm>(key: K, value: ExpenseForm[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
      // Changing a field clears what was said about it.
      const field = (key === "receiptUrl" ? "receipt" : key) as Field;
      if (field in FIELD_INPUT_ID) {
        setErrors((current) =>
          current[field] ? { ...current, [field]: undefined } : current,
        );
      }
    },
    [],
  );

  const isCopy = Boolean(editing && isGeneratedCopy(editing));
  const settlement = editing?.settlement ?? null;
  const wasRepeating = Boolean(editing?.recurring?.enabled);
  const dirty = open && JSON.stringify(form) !== initial;

  const today = localToday();
  const todayDate = useMemo(() => storedDay(today), [today]);
  const decimals = currencyPriceScale(form.currency);
  const currency = resolveCurrency(form.currency);

  const categoryLabel = useCallback(
    (key: ExpenseCategory) =>
      text(`finance.expenseCategory.${key}`, EXPENSE_CATEGORY_LABELS[key]),
    [text],
  );
  const categoryOptions = useMemo(
    () =>
      EXPENSE_CATEGORIES.map((key) => ({
        value: key,
        label: categoryLabel(key),
        keywords: EXPENSE_CATEGORY_KEYWORDS[key],
      })),
    [categoryLabel],
  );
  const currencyOptions = useMemo(
    () =>
      currencies.map((code) => {
        const known = CURRENCIES.find((entry) => entry.code === code);
        return {
          value: code,
          label: known ? `${code} — ${known.name}` : code,
          keywords: known?.name,
        };
      }),
    [currencies],
  );
  const paidFromLabel = useCallback(
    (key: PaidFrom) =>
      text(`finance.paidFrom.${key}`, {
        bank: "Bank",
        cash: "Cash",
        gateway: "Gateway balance",
        unpaid: "Not paid yet",
      }[key]),
    [text],
  );

  /** A cost dated in a closed month is booked just after the close. */
  const closedNote = useMemo(() => {
    if (!closedThrough || !form.date) return null;
    const closedEnd = new Date(closedThrough);
    if (storedDay(form.date) > closedEnd) return null;
    const bookedOn = new Date(closedEnd.getTime() + 1000);
    return text(
      "finance.expenses.closedPeriodNote",
      "Everything up to {closed} is closed. This will be booked on {booked}, so the closed period keeps its figures.",
      {
        closed: formatDay(closedEnd, locale),
        booked: formatDay(bookedOn, locale),
      },
    );
  }, [closedThrough, form.date, locale, text]);

  /**
   * What switching the schedule on would do. Only asked when it is being
   * switched on now: an already-running template carries its own clock.
   */
  const schedule = useMemo(() => {
    if (!form.repeats || isCopy || !form.date) return null;
    const date = storedDay(form.date);
    const endsAt = form.endsAt ? storedDay(form.endsAt) : null;
    const turningOn = !wasRepeating;
    const owed = turningOn
      ? pastDueOccurrences(
          {
            date,
            recurring: {
              interval: form.interval,
              // Resuming a paused template picks up where it stopped.
              nextDueAt:
                editing?.recurring && !editing.recurring.enabled
                  ? (editing.recurring.nextDueAt ?? null)
                  : null,
              endsAt,
            },
          },
          todayDate,
        )
      : [];
    const next = form.backfill && owed.length > 0
      ? owed[0]
      : firstOccurrenceOnOrAfter(date, form.interval, todayDate);
    const ended = Boolean(endsAt && next > endsAt);
    return { turningOn, owed, next, ended };
  }, [
    editing,
    form.backfill,
    form.date,
    form.endsAt,
    form.interval,
    form.repeats,
    isCopy,
    todayDate,
    wasRepeating,
  ]);

  const validate = useCallback((): Partial<Record<Field, string>> => {
    const found: Partial<Record<Field, string>> = {};
    const amount = Number(form.amount);
    if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
      found.amount = text(
        "finance.expenses.amountRequired",
        "Enter an amount above zero",
      );
    } else if (decimalsOf(form.amount) > decimals) {
      found.amount =
        decimals === 0
          ? text(
              "finance.expenses.amountWholeUnits",
              "{currency} has no decimals — enter a whole amount",
              { currency: form.currency },
            )
          : text(
              "finance.expenses.amountDecimals",
              "Use at most {count} decimal places",
              { count: decimals },
            );
    }
    if (form.description.trim().length < 2) {
      found.description = text(
        "finance.expenses.descriptionRequired",
        "Describe what this was for",
      );
    }
    if (!form.category) {
      found.category = text(
        "finance.expenses.categoryRequired",
        "Choose a category",
      );
    }
    if (!form.date) {
      found.date = text("finance.expenses.dateRequired", "Choose a date");
    }
    if (form.repeats && form.endsAt && form.endsAt < form.date) {
      found.endsAt = text(
        "finance.expenses.endsBeforeStart",
        "The last copy cannot be before the first",
      );
    }
    return found;
  }, [decimals, form, text]);

  const focusField = useCallback((field: Field) => {
    // After the render that shows the message, so it is read with the field.
    requestAnimationFrame(() => {
      const element = document.getElementById(FIELD_INPUT_ID[field]);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    });
  }, []);

  const showErrors = useCallback(
    (found: Partial<Record<Field, string>>) => {
      setErrors(found);
      const first = FIELD_ORDER.find((field) => found[field]);
      if (first) focusField(first);
    },
    [focusField],
  );

  const uploadReceipt = useCallback(
    async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(EXPENSE_RECEIPT_ROUTE, {
        method: "POST",
        body,
      });
      const json = (await response.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
        data?: { key?: string };
      } | null;
      if (!response.ok || !json?.success || !json.data?.key) {
        throw new Error(
          json?.message || text("ui.fileUpload.failed", "Upload failed"),
        );
      }
      return json.data.key;
    },
    [text],
  );

  const save = useCallback(async () => {
    if (isSaving || isUploading) return;
    setFormError(null);
    const found = validate();
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        date: form.date,
        category: form.category,
        amount: Number(form.amount),
        currency: form.currency,
        description: form.description.trim(),
        payee: form.payee.trim(),
        paidFrom: form.paidFrom,
        // Sent as the row has it even where the choice is hidden: a store
        // that switched multi-vendor off keeps its marketplace costs there.
        book: form.book,
        receiptUrl: form.receiptUrl.trim(),
        // Sent as a pair so turning it off is an instruction, not an
        // omission. Never for a generated copy, whose schedule is the
        // template's.
        ...(isCopy
          ? {}
          : {
              recurring: {
                enabled: form.repeats,
                interval: form.interval,
                endsAt: form.repeats && form.endsAt ? form.endsAt : null,
                backfill: form.repeats && form.backfill,
              },
            }),
        note: form.note.trim(),
      };
      if (editing) {
        await apiClient.put(`${API}/${editing._id}`, payload);
        toast.success(text("finance.expenses.updated", "Expense updated"));
      } else {
        await apiClient.post(API, payload);
        toast.success(text("finance.expenses.created", "Expense recorded"));
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        error.code === "LEDGER_WRITE_FAILED" &&
        editing
      ) {
        // The correction is saved; the books catch up on the daily pass.
        toast.warning(error.message);
        onOpenChange(false);
        onSaved();
        return;
      }
      const fieldErrors: Partial<Record<Field, string>> = {};
      if (error instanceof ApiClientError && error.errors) {
        for (const [key, messages] of Object.entries(error.errors)) {
          const field = SERVER_FIELD[key];
          if (field && messages?.[0]) fieldErrors[field] = messages[0];
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        showErrors(fieldErrors);
      } else {
        setFormError(
          describeApiError(
            error,
            text("finance.expenses.saveFailed", "Could not save the expense"),
          ),
        );
      }
    } finally {
      setIsSaving(false);
    }
  }, [
    editing,
    form,
    isCopy,
    isSaving,
    isUploading,
    onOpenChange,
    onSaved,
    showErrors,
    text,
    validate,
  ]);

  /** Closing with something typed asks first; Esc and a stray click count. */
  const requestClose = useCallback(async () => {
    if (isSaving) return;
    if (dirty || isUploading) {
      const ok = await confirm({
        title: text("finance.expenses.discardTitle", "Discard this expense?"),
        description: isUploading
          ? text(
              "finance.expenses.discardUploading",
              "The receipt is still uploading, and what you typed will be lost.",
            )
          : text(
              "finance.expenses.discardDescription",
              "What you typed has not been saved and will be lost.",
            ),
        confirmText: text("finance.expenses.discard", "Discard"),
        cancelText: text("finance.expenses.keepEditing", "Keep editing"),
        variant: "destructive",
      });
      if (!ok) return;
    }
    onOpenChange(false);
  }, [confirm, dirty, isSaving, isUploading, onOpenChange, text]);

  const errorId = (field: Field) => `${FIELD_INPUT_ID[field]}-error`;
  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={errorId(field)} className="text-xs font-medium text-destructive">
        {errors[field]}
      </p>
    ) : null;
  const required = (
    <span aria-hidden="true" className="ml-0.5 text-destructive">
      *
    </span>
  );
  const invalidProps = (field: Field) =>
    errors[field]
      ? { "aria-invalid": true, "aria-describedby": errorId(field) }
      : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}
    >
      {/* A column that scrolls in the middle: the title and the Save button
          stay on screen at any height. The form ran off a laptop screen and
          off every phone, with no way to reach the button. */}
      <DialogContent className="flex max-h-[min(92dvh,56rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 pr-12">
          <DialogTitle>
            {editing
              ? text("finance.expenses.editTitle", "Edit expense")
              : text("finance.expenses.add", "Record expense")}
          </DialogTitle>
          <DialogDescription>
            {text(
              "finance.expenses.dialogSubtitle",
              "Costs the store pays out — rent, salaries, advertising, anything no order or payout already records.",
            )}
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
            <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
              {/* When, and how much */}
              <div className="space-y-1.5">
                <Label htmlFor="expense-date">
                  {text("finance.expenses.date", "Date")}
                  {required}
                </Label>
                <DateField
                  id="expense-date"
                  value={form.date}
                  onChange={(value) => set("date", value)}
                  // A cost cannot have been paid in the future, and a date in
                  // one posts a ledger entry into a period nobody is looking
                  // at yet.
                  disableAfter={new Date()}
                  yearPicker
                  startMonth={new Date(new Date().getFullYear() - 10, 0, 1)}
                  invalid={Boolean(errors.date)}
                  ariaDescribedBy={errors.date ? errorId("date") : undefined}
                />
                {fieldError("date")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expense-amount">
                  {text("finance.expenses.amount", "Amount")}
                  {required}
                </Label>
                <div className="flex gap-2">
                  <SearchableSelect
                    id="expense-currency"
                    modal
                    ariaLabel={text("finance.expenses.currency", "Currency")}
                    value={form.currency}
                    onValueChange={(value) => set("currency", value)}
                    options={currencyOptions}
                    renderValue={(option) => option.value}
                    searchPlaceholder={text("common.search", "Search")}
                    emptyText={text("common.noResults", "No results found")}
                    disabled={Boolean(settlement)}
                    className="w-[5.5rem] shrink-0"
                    contentClassName="w-64"
                  />
                  <CurrencyInput
                    id="expense-amount"
                    currencySymbol={currency.symbol}
                    inputMode="decimal"
                    min="0"
                    step={decimals === 0 ? "1" : `0.${"0".repeat(decimals - 1)}1`}
                    placeholder={decimals === 0 ? "0" : `0.${"0".repeat(decimals)}`}
                    value={form.amount}
                    disabled={Boolean(settlement)}
                    onChange={(event) => set("amount", event.target.value)}
                    // A number field changes under a scrolling wheel.
                    onWheel={(event) => event.currentTarget.blur()}
                    className={cn(errors.amount && "border-destructive")}
                    {...invalidProps("amount")}
                  />
                </div>
                {fieldError("amount") ?? fieldError("currency")}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="expense-description">
                  {text("finance.expenses.description", "Description")}
                  {required}
                </Label>
                <Input
                  id="expense-description"
                  value={form.description}
                  maxLength={LIMITS.description}
                  placeholder={text(
                    "finance.expenses.descriptionPlaceholder",
                    "August office rent",
                  )}
                  onChange={(event) => set("description", event.target.value)}
                  className={cn(errors.description && "border-destructive")}
                  {...invalidProps("description")}
                />
                {fieldError("description")}
              </div>

              {closedNote ? (
                <p className="flex gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
                  <Lock className="mt-0.5 size-3.5 shrink-0" />
                  {closedNote}
                </p>
              ) : null}

              {/* What it was, and whose */}
              <div
                className={cn(
                  "space-y-1.5",
                  !multiVendor && "sm:col-span-2",
                )}
              >
                <Label htmlFor="expense-category">
                  {text("finance.expenses.category", "Category")}
                  {required}
                </Label>
                {/* Searchable: a bill is filed by what it was for, and the
                    keywords find "Salaries & contractors" from "salary". */}
                <SearchableSelect
                  id="expense-category"
                  modal
                  value={form.category}
                  onValueChange={(value) =>
                    set("category", value as ExpenseCategory)
                  }
                  options={categoryOptions}
                  placeholder={text(
                    "finance.expenses.categoryPlaceholder",
                    "Choose a category",
                  )}
                  searchPlaceholder={text("common.search", "Search")}
                  emptyText={text("common.noResults", "No results found")}
                  className={cn(errors.category && "border-destructive")}
                />
                {fieldError("category")}
              </div>
              {/* Only a marketplace has a second book to file a cost under. */}
              {multiVendor ? (
                <div className="space-y-1.5">
                  <Label htmlFor="expense-book">
                    {text("finance.expenses.book", "Book")}
                  </Label>
                  <Select
                    value={form.book}
                    disabled={Boolean(settlement)}
                    onValueChange={(value) =>
                      set("book", value as "own" | "marketplace")
                    }
                  >
                    <SelectTrigger
                      id="expense-book"
                      className="w-full"
                      aria-describedby="expense-book-hint"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="own">
                        {text("finance.book.own", "Own store")}
                      </SelectItem>
                      <SelectItem value="marketplace">
                        {text("finance.book.marketplace", "Marketplace")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p
                    id="expense-book-hint"
                    className="text-xs text-muted-foreground"
                  >
                    {form.book === "own"
                      ? text(
                          "finance.expenses.bookOwnHint",
                          "A cost of your own shop — the products you sell yourself.",
                        )
                      : text(
                          "finance.expenses.bookMarketplaceHint",
                          "A cost of running the marketplace itself — not of any one shop.",
                        )}
                  </p>
                  {fieldError("book")}
                </div>
              ) : null}

              {form.category === "inventory_purchase" ? (
                <p className="flex gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {text(
                      "finance.expenses.stockNote",
                      "Stock is recorded as inventory, not as a cost. It reaches your profit as cost of goods when the items sell.",
                    )}
                    {hasProductCosts ? null : (
                      <strong className="mt-1 block font-medium text-amber-700 dark:text-amber-500">
                        {text(
                          "finance.expenses.stockNoCostNote",
                          "None of your products has a cost price yet, so this will not show up in profit at all. Add cost prices to your products first.",
                        )}
                      </strong>
                    )}
                  </span>
                </p>
              ) : null}

              {/* How it was paid, and to whom */}
              <div className="space-y-1.5">
                <Label htmlFor="expense-paid-from">
                  {text("finance.expenses.paidFrom", "Paid from")}
                </Label>
                {settlement ? (
                  <div
                    id="expense-paid-from"
                    className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground"
                  >
                    {text(
                      "finance.expenses.paidOnFrom",
                      "{account} · paid {date}",
                      {
                        account: paidFromLabel(settlement.paidFrom),
                        date: formatDay(settlement.paidAt, locale),
                      },
                    )}
                  </div>
                ) : (
                  <Select
                    value={form.paidFrom}
                    onValueChange={(value) =>
                      set("paidFrom", value as PaidFrom)
                    }
                  >
                    <SelectTrigger id="expense-paid-from" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAID_FROM.map((key) => (
                        <SelectItem key={key} value={key}>
                          {paidFromLabel(key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {fieldError("paidFrom")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expense-payee">
                  {text("finance.expenses.payee", "Paid to")}
                </Label>
                <Input
                  id="expense-payee"
                  value={form.payee}
                  maxLength={LIMITS.payee}
                  placeholder={text(
                    "finance.expenses.payeePlaceholder",
                    "Landlord, supplier, Meta…",
                  )}
                  onChange={(event) => set("payee", event.target.value)}
                  {...invalidProps("payee")}
                />
                {fieldError("payee")}
              </div>
              {settlement ? (
                <p className="flex gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
                  <Lock className="mt-0.5 size-3.5 shrink-0" />
                  {text(
                    "finance.expenses.paidLockedNote",
                    "This bill is marked paid. To change its amount, currency, book or how it was paid, mark it unpaid first from the list.",
                  )}
                </p>
              ) : form.paidFrom === "unpaid" ? (
                <p className="flex gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {text(
                    "finance.expenses.unpaidNote",
                    "Recorded as owed. When you pay it, use “Mark as paid” in the list, so the payment is dated the day the money left.",
                  )}
                </p>
              ) : null}

              {/* The receipt is the evidence behind the number; without it
                  the row is one person's word. Kept private: it is an
                  invoice, a salary slip or a bank transfer. */}
              <div className="space-y-1.5 sm:col-span-2">
                <FileUploadField
                  id="expense-receipt"
                  label={text("finance.expenses.receipt", "Receipt")}
                  hint={text(
                    "finance.expenses.receiptHint",
                    "Optional, but it is the evidence behind the number.",
                  )}
                  value={form.receiptUrl}
                  onChange={(value) => set("receiptUrl", value)}
                  accept={EXPENSE_RECEIPT_ACCEPT}
                  maxSizeMb={EXPENSE_RECEIPT_MAX_SIZE_MB}
                  upload={uploadReceipt}
                  viewUrl={expenseReceiptViewUrl}
                  onUploadingChange={setIsUploading}
                  invalid={Boolean(errors.receipt)}
                />
                {fieldError("receipt")}
              </div>

              {/* Rent, salaries and hosting arrive on a schedule, and
                  re-typing them every month is how a store's costs quietly
                  stop being recorded. */}
              {isCopy ? (
                <p className="flex gap-2 rounded-md border px-3 py-2.5 text-xs text-muted-foreground sm:col-span-2">
                  <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
                  {text(
                    "finance.expenses.generatedCopyNote",
                    "Created automatically by a repeating expense. To change the schedule, edit the original.",
                  )}
                </p>
              ) : (
                <div className="space-y-3 rounded-md border p-3 sm:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="expense-repeats">
                        {text("finance.expenses.repeats", "Repeats")}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {text(
                          "finance.expenses.repeatsHint",
                          "Record this again automatically, dated when it falls due.",
                        )}
                      </p>
                    </div>
                    <Switch
                      id="expense-repeats"
                      checked={form.repeats}
                      onCheckedChange={(checked) => set("repeats", checked)}
                    />
                  </div>
                  {form.repeats ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="expense-interval">
                            {text("finance.expenses.every", "How often")}
                          </Label>
                          <Select
                            value={form.interval}
                            onValueChange={(value) =>
                              set("interval", value as RecurringInterval)
                            }
                          >
                            <SelectTrigger id="expense-interval" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {INTERVALS.map((interval) => (
                                <SelectItem key={interval} value={interval}>
                                  {text(`finance.expenses.${interval}`, {
                                    weekly: "Every week",
                                    monthly: "Every month",
                                    quarterly: "Every quarter",
                                    yearly: "Every year",
                                  }[interval])}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="expense-ends">
                            {text("finance.expenses.endsOn", "Last copy")}
                          </Label>
                          <div className="flex gap-1">
                            <DateField
                              id="expense-ends"
                              value={form.endsAt}
                              onChange={(value) => set("endsAt", value)}
                              placeholder={text(
                                "finance.expenses.noEnd",
                                "No end date",
                              )}
                              disableBefore={
                                form.date ? storedLocalDay(form.date) : undefined
                              }
                              yearPicker
                              startMonth={
                                form.date ? storedLocalDay(form.date) : undefined
                              }
                              // A contract's last month can be years out.
                              endMonth={new Date(new Date().getFullYear() + 10, 11, 31)}
                              invalid={Boolean(errors.endsAt)}
                              ariaDescribedBy={
                                errors.endsAt ? errorId("endsAt") : undefined
                              }
                            />
                            {form.endsAt ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="shrink-0"
                                aria-label={text(
                                  "finance.expenses.clearEnd",
                                  "Remove the end date",
                                )}
                                onClick={() => set("endsAt", "")}
                              >
                                <X className="size-4" />
                              </Button>
                            ) : null}
                          </div>
                          {fieldError("endsAt")}
                        </div>
                      </div>

                      {schedule && schedule.turningOn && schedule.owed.length > 0 ? (
                        <label className="flex cursor-pointer items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          <Checkbox
                            className="mt-0.5"
                            checked={form.backfill}
                            onCheckedChange={(checked) =>
                              set("backfill", checked === true)
                            }
                          />
                          <span>
                            {text(
                              "finance.expenses.backfillPrompt",
                              "Also record the {count} copies already due ({first} – {last})",
                              {
                                count: schedule.owed.length,
                                first: formatDay(schedule.owed[0], locale),
                                last: formatDay(
                                  schedule.owed[schedule.owed.length - 1],
                                  locale,
                                ),
                              },
                            )}
                            {form.backfill && schedule.owed.length > COPIES_PER_RUN ? (
                              <span className="mt-0.5 block text-amber-800/80 dark:text-amber-300/80">
                                {text(
                                  "finance.expenses.backfillPace",
                                  "The daily job adds {count} at a time, so this takes a few days.",
                                  { count: COPIES_PER_RUN },
                                )}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ) : null}

                      {schedule ? (
                        <p className="flex gap-2 text-xs text-muted-foreground">
                          <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            {schedule.ended
                              ? text(
                                  "finance.expenses.scheduleEnded",
                                  "No more copies — the end date has passed.",
                                )
                              : text(
                                  "finance.expenses.nextCopy",
                                  "Next copy: {date}.",
                                  { date: formatDay(schedule.next, locale) },
                                )}
                            {wasRepeating
                              ? ` ${text(
                                  "finance.expenses.futureCopiesOnly",
                                  "Changes apply to copies made from now on; earlier ones stay as they are.",
                                )}`
                              : null}
                          </span>
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="expense-note">
                  {text("finance.expenses.note", "Note")}
                </Label>
                <Textarea
                  id="expense-note"
                  rows={2}
                  maxLength={LIMITS.note}
                  value={form.note}
                  onChange={(event) => set("note", event.target.value)}
                  {...invalidProps("note")}
                />
                {fieldError("note")}
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:items-center">
            {formError ? (
              <p
                role="alert"
                className="text-sm text-destructive sm:mr-auto sm:max-w-[60%]"
              >
                {formError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => void requestClose()}
              disabled={isSaving}
            >
              {text("common.cancel", "Cancel")}
            </Button>
            <Button type="submit" disabled={isSaving || isUploading}>
              {isUploading
                ? text("finance.expenses.waitingForReceipt", "Uploading receipt…")
                : isSaving
                  ? text("finance.expenses.saving", "Saving…")
                  : editing
                    ? text("common.save", "Save")
                    : text("finance.expenses.add", "Record expense")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A "YYYY-MM-DD" day as the viewer's local midnight — what the calendar compares. */
function storedLocalDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}
