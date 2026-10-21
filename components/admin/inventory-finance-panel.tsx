"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ApiClientError, describeApiError } from "@/lib/api/client";
import { resolveDateFilter } from "@/lib/date-filter";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import {
  InventoryActionDialog,
  type ExpenseOption,
  type InventoryActionForm,
} from "./inventory-finance/action-dialog";
import { InventoryAttentionList } from "./inventory-finance/attention-list";
import {
  EMPTY_HISTORY_FILTERS,
  EMPTY_STOCK_FILTERS,
  InventoryTables,
  type HistoryFilters,
  type InventoryTab,
  type StockFilters,
} from "./inventory-finance/inventory-tables";
import { InventorySummaryCard } from "./inventory-finance/summary-card";
import {
  fromLocalDay,
  InventorySelect,
  toLocalDay,
  type Action,
  type History,
  type Movement,
  type Position,
  type Preview,
  type Report,
} from "./inventory-finance/shared";

async function callApi<T>(
  url: string,
  body?: unknown,
  requestKey?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: "no-store", signal }
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": requestKey ?? crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok || !result.success) {
    const fallback =
      result.message ?? result.error ?? "Could not save inventory.";
    throw new Error(
      describeApiError(
        new ApiClientError(fallback, {
          status: response.status,
          code: result.code,
          errors: result.errors,
        }),
        fallback,
      ),
    );
  }
  return result.data as T;
}

const INITIAL_FORM: InventoryActionForm = {
  quantity: "1",
  price: "0",
  mode: "adjust",
  field: "available",
  payment: "unpaid",
  paidFrom: "bank",
  paymentDate: "",
  reason: "count",
  disposition: "write_off",
  note: "",
  expenseId: "",
};

/** The last moment of a "2026-09-30" day, which is when its balances are read. */
function endOfLocalDay(day: string) {
  const date = fromLocalDay(day);
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * A picked payment day as a timestamp. Today stays unset so the server uses
 * "now"; an earlier day is dated at its local noon, which no timezone can move
 * to a neighbouring day.
 */
function paymentTimestamp(day: string) {
  if (!day || day === toLocalDay(new Date())) return undefined;
  const date = fromLocalDay(day);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

/**
 * Inventory and ledger: what the stock is worth and whether the books agree.
 *
 * One figure with its verdict, then only what needs doing, then the stock and
 * its history in the admin's one table. Navigation lives in the sidebar; this
 * page carries no tabs or back links of its own.
 */
export function InventoryFinancePanel({
  currency: initialCurrency,
  currencies,
  allowFinance,
  allowAdjust,
  productId,
  variantId,
  locationId,
}: {
  currency: string;
  currencies: string[];
  allowFinance: boolean;
  allowAdjust: boolean;
  productId?: string;
  variantId?: string;
  locationId?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const tOr = useFallbackTranslator(t);
  const label = useCallback(
    (key: string, fallback: string, values?: Record<string, string | number>) =>
      tOr(`inventoryFinance.${key}`, fallback, values),
    [tOr],
  );
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      value,
    );
  const [currency, setCurrency] = useState(initialCurrency);
  /** "" for now, otherwise the day whose closing balances are shown. */
  const [asOf, setAsOf] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reportRequest = useRef(0);
  const expenseRequest = useRef(0);
  const historyRequest = useRef(0);
  const mutationBusy = useRef(false);
  const correctionRequests = useRef(new Map<string, string>());
  const sourceRequests = useRef(new Map<string, string>());
  const [tab, setTab] = useState<InventoryTab>("stock");
  const [stockFilters, setStockFilters] =
    useState<StockFilters>(EMPTY_STOCK_FILTERS);
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(
    EMPTY_HISTORY_FILTERS,
  );
  const [historyPage, setHistoryPage] = useState(1);
  const [historySearch, setHistorySearch] = useState("");
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [target, setTarget] = useState<Position | null>(null);
  const [action, setAction] = useState<Action>("receipts");
  const [form, setForm] = useState<InventoryActionForm>(INITIAL_FORM);
  const [expenses, setExpenses] = useState<ExpenseOption[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [retryKey, setRetryKey] = useState("");
  const [repairing, setRepairing] = useState("");
  const [correction, setCorrection] = useState<Movement | null>(null);
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionPreview, setCorrectionPreview] = useState<Preview | null>(
    null,
  );
  const correctionInput = useRef<{
    movementId: string;
    expectedVersion: number;
    note: string;
  } | null>(null);
  const [correctionError, setCorrectionError] = useState("");
  const [source, setSource] = useState<
    Report["saleCoverage"]["sources"][number] | null
  >(null);
  const [sourceExpenses, setSourceExpenses] = useState<ExpenseOption[]>([]);
  const [sourceForm, setSourceForm] = useState({
    expenseId: "",
    quantity: "",
    amount: "",
  });
  const [sourceError, setSourceError] = useState("");

  const scope = useCallback(() => {
    const query = new URLSearchParams({ currency });
    if (productId) query.set("productId", productId);
    if (variantId) query.set("variantId", variantId);
    if (locationId) query.set("locationId", locationId);
    return query;
  }, [currency, productId, variantId, locationId]);

  const load = useCallback(
    async (scopeChanged = false, signal?: AbortSignal) => {
      const request = ++reportRequest.current;
      if (signal?.aborted) return;
      if (scopeChanged) {
        expenseRequest.current++;
        setExpenses([]);
        setSourceExpenses([]);
        setExpensesLoading(false);
        setReport(null);
        setTarget(null);
        setCorrection(null);
        setSource(null);
      }
      setLoading(true);
      setError("");
      try {
        const query = scope();
        if (asOf) query.set("asOf", endOfLocalDay(asOf).toISOString());
        const value = await callApi<Report>(
          `/api/admin/inventory/valuation?${query}`,
          undefined,
          undefined,
          signal,
        );
        if (request === reportRequest.current && !signal?.aborted)
          setReport(value);
      } catch (error) {
        if (request === reportRequest.current && !signal?.aborted)
          setError(
            error instanceof Error
              ? error.message
              : label("loadError", "Could not load inventory."),
          );
      } finally {
        if (request === reportRequest.current && !signal?.aborted)
          setLoading(false);
      }
    },
    [scope, asOf, label],
  );

  // History has its own date filter and never follows "as of": it lists the
  // changes themselves, newest first, a numbered page at a time.
  const loadHistory = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++historyRequest.current;
      if (signal?.aborted) return;
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const query = scope();
        query.set("page", String(historyPage));
        query.set("limit", String(historyPageSize));
        if (historyFilters.reason !== "all")
          query.set("reason", historyFilters.reason);
        if (historySearch.trim()) query.set("search", historySearch.trim());
        const range = resolveDateFilter(historyFilters.date);
        if (range) {
          query.set("from", range.from.toISOString());
          query.set("asOf", range.to.toISOString());
        }
        const page = await callApi<History>(
          `/api/admin/inventory/movements?${query}`,
          undefined,
          undefined,
          signal,
        );
        if (request === historyRequest.current && !signal?.aborted)
          setHistory(page);
      } catch (error) {
        if (request === historyRequest.current && !signal?.aborted)
          setHistoryError(
            error instanceof Error
              ? error.message
              : label("historyError", "Could not load stock changes."),
          );
      } finally {
        if (request === historyRequest.current && !signal?.aborted)
          setHistoryLoading(false);
      }
    },
    [scope, historyPage, historyPageSize, historyFilters, historySearch, label],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(true, controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load]);
  useEffect(() => {
    if (tab !== "history") return;
    const controller = new AbortController();
    const timer = setTimeout(() => void loadHistory(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadHistory, tab]);

  const refresh = async () => {
    await Promise.all([
      load(),
      tab === "history" ? loadHistory() : Promise.resolve(),
    ]);
  };
  const saved = (state?: string) =>
    toast.success(
      state === "pending"
        ? label("postingPending", "Saved; ledger posting is pending")
        : label("saved", "Inventory saved"),
    );
  const open = (position: Position, nextAction: Action) => {
    if (asOf || mutationBusy.current) return;
    setTarget(position);
    expenseRequest.current++;
    setExpensesLoading(false);
    setAction(nextAction);
    setForm({ ...INITIAL_FORM, price: String(position.unitCost ?? 0) });
    setPreview(null);
    setActionError("");
    setExpenses([]);
    setRetryKey(crypto.randomUUID());
  };
  const loadExpenses = async (stockPurchase: boolean) => {
    const request = ++expenseRequest.current;
    setExpensesLoading(true);
    try {
      const data = await callApi<{ data: ExpenseOption[] }>(
        `/api/admin/finance/expenses?book=own&limit=100${stockPurchase ? "&category=inventory_purchase" : ""}`,
      );
      if (request !== expenseRequest.current) return;
      const rows = (data.data ?? []).filter(
        (expense) =>
          expense.currency === currency &&
          (stockPurchase || expense.debitAccount !== "inventory"),
      );
      if (stockPurchase) setExpenses(rows);
      else setSourceExpenses(rows);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : label("expensesError", "Could not load expenses.");
      if (request !== expenseRequest.current) return;
      if (stockPurchase) setActionError(message);
      else setSourceError(message);
    } finally {
      if (request === expenseRequest.current) setExpensesLoading(false);
    }
  };
  const changeForm = (field: keyof InventoryActionForm, value: string) => {
    if (saving) return;
    setForm((current) => ({ ...current, [field]: value }));
    setPreview(null);
    setActionError("");
    setRetryKey("");
    if (field === "payment" && value === "already_recorded")
      void loadExpenses(true);
  };
  const submit = async (commit: boolean) => {
    if (!target || asOf || mutationBusy.current || (commit && !preview)) return;
    mutationBusy.current = true;
    setSaving(true);
    setActionError("");
    try {
      const common = {
        productId: target.productId,
        ...(target.variantId ? { variantId: target.variantId } : {}),
        ...(target.locationId ? { locationId: target.locationId } : {}),
        expectedVersion: target.version,
        note: form.note,
        preview: !commit,
      };
      const expense = expenses.find(
        (expense) => expense._id === form.expenseId,
      );
      const paymentDate = paymentTimestamp(form.paymentDate);
      const body =
        action === "receipts"
          ? {
              ...common,
              quantity: Number(form.quantity),
              actualUnitPrice: Number(form.price),
              payment: form.payment,
              ...(form.payment === "paid"
                ? {
                    paidFrom: form.paidFrom,
                    ...(paymentDate ? { paymentDate } : {}),
                  }
                : {}),
              ...(form.payment === "already_recorded"
                ? {
                    expenseId: form.expenseId,
                    expenseRevision: expense?.revision,
                  }
                : {}),
            }
          : action === "adjustments"
            ? {
                ...common,
                mode: form.mode,
                value: Number(form.quantity),
                field: form.field,
                reason: form.reason,
                ...(form.reason === "damaged"
                  ? { disposition: form.disposition }
                  : {}),
              }
            : {
                productId: target.productId,
                ...(target.variantId ? { variantId: target.variantId } : {}),
                newUnitCost: Number(form.price),
                expectedVersions: Object.fromEntries(
                  (preview?.positions ?? []).map((position) => [
                    position.key,
                    position.version,
                  ]),
                ),
                productVersion: preview?.productVersion ?? "",
                note: form.note,
                preview: !commit,
                ...(target.missingCostQuantity
                  ? { costEstablishment: "opening" }
                  : {}),
              };
      const key = retryKey || crypto.randomUUID();
      setRetryKey(key);
      const result = await callApi<Preview & { bookkeepingState?: string }>(
        `/api/admin/inventory/${action}`,
        body,
        commit ? key : crypto.randomUUID(),
      );
      if (commit) {
        saved(result.bookkeepingState);
        setTarget(null);
        await refresh();
      } else setPreview(result);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : label("saveError", "Could not save inventory."),
      );
    } finally {
      mutationBusy.current = false;
      setSaving(false);
    }
  };

  const submitCorrection = async () => {
    if (!correction || asOf || !correctionNote.trim() || mutationBusy.current)
      return;
    mutationBusy.current = true;
    setSaving(true);
    setCorrectionError("");
    try {
      if (!correctionPreview) {
        const position = report?.positions.find(
          (position) => position.key === correction.positionKey,
        );
        if (!position)
          throw new Error(
            label("reloadPosition", "Reload the current stock position first."),
          );
        const input = {
          movementId: correction._id,
          expectedVersion: position.version,
          note: correctionNote,
        };
        const value = await callApi<Preview>(
          "/api/admin/inventory/receipt-corrections",
          { ...input, preview: true },
        );
        correctionInput.current = input;
        setCorrectionPreview(value);
      } else if (correctionInput.current) {
        const input = correctionInput.current;
        const fingerprint = JSON.stringify(input);
        const key =
          correctionRequests.current.get(fingerprint) ?? crypto.randomUUID();
        correctionRequests.current.set(fingerprint, key);
        const result = await callApi<{ bookkeepingState: string }>(
          "/api/admin/inventory/receipt-corrections",
          input,
          key,
        );
        saved(result.bookkeepingState);
        setCorrection(null);
        await refresh();
      }
    } catch (error) {
      setCorrectionError(
        error instanceof Error
          ? error.message
          : label("correctionError", "Could not correct receipt."),
      );
    } finally {
      mutationBusy.current = false;
      setSaving(false);
    }
  };

  const submitSource = async () => {
    if (!source || asOf || mutationBusy.current) return;
    const expense = sourceExpenses.find(
      (expense) => expense._id === sourceForm.expenseId,
    );
    if (!expense) {
      setSourceError(label("chooseExpense", "Choose an expense"));
      return;
    }
    mutationBusy.current = true;
    setSaving(true);
    setSourceError("");
    const input = {
      orderId: source.orderId,
      lineId: source.lineId,
      expenseId: expense._id,
      expenseRevision: expense.revision,
      quantity: Number(sourceForm.quantity),
      amount: Number(sourceForm.amount),
    };
    const fingerprint = JSON.stringify(input);
    const key = sourceRequests.current.get(fingerprint) ?? crypto.randomUUID();
    sourceRequests.current.set(fingerprint, key);
    try {
      const result = await callApi<{ bookkeepingState: string }>(
        "/api/admin/inventory/cost-sources",
        input,
        key,
      );
      saved(result.bookkeepingState);
      setSource(null);
      await refresh();
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : label("sourceError", "Could not link the cost source."),
      );
    } finally {
      mutationBusy.current = false;
      setSaving(false);
    }
  };

  /** Retries each waiting posting in turn; every retry is safe to repeat. */
  const retryPostings = async (issues: Report["issues"]) => {
    if (repairing || asOf) return;
    try {
      for (const issue of issues) {
        setRepairing(issue.operationId);
        await callApi("/api/admin/finance/inventory-reconciliation/repairs", {
          operationId: issue.operationId,
          fingerprint: issue.fingerprint,
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : label("retryError", "Could not retry posting."),
      );
    } finally {
      setRepairing("");
      await refresh();
    }
  };
  const linkSource = (item: Report["saleCoverage"]["sources"][number]) => {
    if (asOf) return;
    setSource(item);
    setSourceExpenses([]);
    setSourceForm({
      expenseId: "",
      quantity: String(item.quantity),
      amount: item.estimate == null ? "" : String(item.estimate),
    });
    setSourceError("");
    void loadExpenses(false);
  };

  const isScoped = Boolean(productId || variantId || locationId);
  const currencyOptions = [...new Set([initialCurrency, ...currencies])];
  const asOfDay = asOf
    ? new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(fromLocalDay(asOf))
    : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {label("title", "Inventory and ledger")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {label(
              "subtitle",
              "What your stock is worth at cost, and whether the ledger agrees.",
            )}
          </p>
          {isScoped ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full border bg-muted/40 py-1 pe-1 ps-3 text-xs text-muted-foreground">
              {label("filteredScope", "Showing one product or location")}
              <Link
                href="/admin/inventory/finance"
                aria-label={label("showAllStock", "Show all stock")}
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </Link>
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {currencyOptions.length > 1 ? (
            <Select
              value={currency}
              onValueChange={setCurrency}
              disabled={saving}
            >
              <SelectTrigger
                id="inventory-currency"
                aria-label={label("currency", "Currency")}
                className="w-24 bg-background"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencyOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            aria-label={label("refresh", "Refresh")}
            title={label("refresh", "Refresh")}
            onClick={() => void refresh()}
            disabled={loading}
            className="bg-background"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
        >
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {label("tryAgain", "Try again")}
          </Button>
        </div>
      ) : null}

      {!report && loading ? (
        <div
          role="status"
          aria-label={label("loading", "Loading…")}
          className="space-y-5"
        >
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : null}

      {report ? (
        <div className="space-y-5" aria-busy={loading}>
          <InventorySummaryCard
            report={report}
            currency={currency}
            asOf={asOf}
            onAsOfChange={setAsOf}
            disabled={saving}
            locale={locale}
            label={label}
            money={money}
          />
          {/* What needs doing is about today's stock, so a past day shows
              the figures without the to-do list. */}
          {asOf ? (
            <p className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-[13px] text-primary">
              {label(
                "pastNote",
                "The stock list below is today's. The value above is for {date}.",
                { date: asOfDay },
              )}
            </p>
          ) : (
            <InventoryAttentionList
              report={report}
              currency={currency}
              allowFinance={allowFinance}
              allowAdjust={allowAdjust}
              repairing={repairing}
              onRetry={(issues) => void retryPostings(issues)}
              onSetCost={(position) => open(position, "valuation-changes")}
              onShowMissingCost={() => {
                setTab("stock");
                setStockFilters({ ...EMPTY_STOCK_FILTERS, cost: "missing" });
              }}
              onLinkSource={linkSource}
              label={label}
              money={money}
            />
          )}
          <InventoryTables
            tab={tab}
            onTabChange={setTab}
            currency={currency}
            positions={report.positions}
            historical={Boolean(asOf)}
            allowFinance={allowFinance}
            allowAdjust={allowAdjust}
            onAction={open}
            stockFilters={stockFilters}
            onStockFilterChange={(id, value) =>
              setStockFilters((current) => ({ ...current, [id]: value }))
            }
            history={history}
            historyLoading={historyLoading}
            historyError={historyError}
            historyFilters={historyFilters}
            onHistoryFilterChange={(id, value) => {
              setHistoryFilters((current) => ({ ...current, [id]: value }));
              setHistoryPage(1);
            }}
            historySearch={historySearch}
            onHistorySearchChange={(value) => {
              setHistorySearch(value);
              setHistoryPage(1);
            }}
            historyPage={historyPage}
            historyPageSize={historyPageSize}
            onHistoryPageChange={setHistoryPage}
            onHistoryPageSizeChange={(size) => {
              setHistoryPageSize(size);
              setHistoryPage(1);
            }}
            onReloadHistory={() => void loadHistory()}
            onCorrect={(movement) => {
              setCorrection(movement);
              setCorrectionNote("");
              setCorrectionPreview(null);
              setCorrectionError("");
              correctionInput.current = null;
            }}
            locale={locale}
            label={label}
            tOr={tOr}
            money={money}
          />
          {report.positions.length >= report.positionLimit ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {label(
                "boundedPositions",
                "Showing the first {count} SKU/location positions. Open this view from a product’s Inventory control to narrow the table; the totals above cover every position.",
                { count: report.positionLimit.toLocaleString(locale) },
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <InventoryActionDialog
        target={target}
        action={action}
        form={form}
        onChange={changeForm}
        onClose={() => {
          if (!saving) setTarget(null);
        }}
        onSubmit={(commit) => void submit(commit)}
        expenses={expenses}
        expensesLoading={expensesLoading}
        preview={preview}
        saving={saving}
        error={actionError}
        label={label}
        money={money}
      />
      <Dialog
        open={Boolean(correction)}
        onOpenChange={(open) => {
          if (!open && !saving) setCorrection(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          showCloseButton={!saving}
        >
          <DialogHeader>
            <DialogTitle>
              {label("reverseReceipt", "Correct unused receipt")}
            </DialogTitle>
            <DialogDescription>{correction?.productName}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCorrection();
            }}
          >
            <p className="rounded-lg bg-muted/50 p-3 text-sm leading-6 text-muted-foreground">
              {label(
                "reverseReceiptConfirm",
                "Reverse this untouched receipt and its recorded funding? This records a refund or cancelled bill; it does not send money.",
              )}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-correction-note">
                {label("note", "Note / explanation")}
              </Label>
              <Textarea
                id="receipt-correction-note"
                value={correctionNote}
                onChange={(event) => {
                  setCorrectionNote(event.target.value);
                  setCorrectionPreview(null);
                  setCorrectionError("");
                  correctionInput.current = null;
                }}
                required
                maxLength={500}
                rows={3}
                disabled={saving}
                placeholder={label(
                  "correctionNote",
                  "Explain the receipt cancellation and recorded refund/bill cancellation",
                )}
              />
            </div>
            {correctionPreview && (
              <div
                aria-live="polite"
                className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm"
              >
                <p className="font-semibold">
                  {label("previewSummary", "Changes to be recorded")}
                </p>
                <div className="flex justify-between">
                  <span>{label("quantityChange", "Quantity change")}</span>
                  <span className="tabular-nums">
                    {correctionPreview.delta}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{label("valueChange", "Book value change")}</span>
                  <span className="tabular-nums">
                    {money(
                      correctionPreview.valueDelta ?? 0,
                      correctionPreview.currency ?? currency,
                    )}
                  </span>
                </div>
              </div>
            )}
            {correctionError && (
              <p role="alert" className="text-sm text-destructive">
                {correctionError}
              </p>
            )}
            <DialogFooter className="sticky bottom-0 z-10 border-t bg-background py-4">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setCorrection(null)}
              >
                {label("cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                variant={correctionPreview ? "destructive" : "default"}
                disabled={saving || !correctionNote.trim()}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving
                  ? label("saving", "Saving…")
                  : correctionPreview
                    ? label("confirmCorrection", "Confirm correction")
                    : label("preview", "Preview changes")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(source)}
        onOpenChange={(open) => {
          if (!open && !saving) setSource(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto"
          showCloseButton={!saving}
        >
          <DialogHeader>
            <DialogTitle>
              {label("linkSource", "Link recorded cost")}
            </DialogTitle>
            <DialogDescription>
              {source?.productName} · {source?.currency}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSource();
            }}
          >
            <p className="rounded-lg bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">
              {label(
                "nonphysicalHint",
                "Unit costs are margin estimates until a recorded expense is linked. Linking reclassifies that expense into COGS and does not add another expense or physical Inventory.",
              )}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="source-expense">
                {label("recordedExpense", "Recorded expense")}
              </Label>
              <InventorySelect
                id="source-expense"
                value={sourceForm.expenseId}
                onChange={(expenseId) =>
                  setSourceForm((current) => ({ ...current, expenseId }))
                }
                disabled={saving || expensesLoading}
                options={[
                  {
                    value: "",
                    label: expensesLoading
                      ? label("loading", "Loading…")
                      : label("chooseExpense", "Choose an expense"),
                  },
                  ...sourceExpenses.map((expense) => ({
                    value: expense._id,
                    label: `${expense.description} · ${money(expense.amount, expense.currency)}`,
                  })),
                ]}
              />
              {!expensesLoading && sourceExpenses.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {label(
                    "noSourceExpenses",
                    "No eligible recorded expenses in this currency. Record the expense first, then link its cost here.",
                  )}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="source-quantity">
                  {label("quantity", "Quantity")}
                </Label>
                <Input
                  id="source-quantity"
                  type="number"
                  min="1"
                  max={source?.quantity}
                  step="1"
                  required
                  disabled={saving}
                  value={sourceForm.quantity}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source-amount">
                  {label("linkedCost", "Allocated recorded cost")}
                </Label>
                <Input
                  id="source-amount"
                  type="number"
                  min="0"
                  step="any"
                  required
                  disabled={saving}
                  value={sourceForm.amount}
                  onChange={(event) =>
                    setSourceForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {sourceError && (
              <p role="alert" className="text-sm text-destructive">
                {sourceError}
              </p>
            )}
            <DialogFooter className="sticky bottom-0 z-10 border-t bg-background py-4">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setSource(null)}
              >
                {label("cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                disabled={saving || expensesLoading || !sourceForm.expenseId}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving
                  ? label("saving", "Saving…")
                  : label("linkSource", "Link recorded cost")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
