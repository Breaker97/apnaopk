"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Minus, Plus, Printer, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { printSlip } from "@/lib/pos/print-slip";
import type { POSSaleSummary } from "@/lib/pos/pos-order-search";

/** Mirrors lib/pos/pos-returns.ts; kept here because that module is server-only. */
type RefundMethod = "cash" | "card" | "bank" | "original" | "store_credit" | "exchange" | "later";
type Condition = "new" | "opened" | "damaged" | "missing_parts" | "unusable";
const CONDITIONS: Condition[] = ["new", "opened", "damaged", "missing_parts", "unusable"];
const KNOWN_REASONS = [
  "wrong_size_or_variant",
  "damaged_or_defective",
  "not_as_described",
  "wrong_item_received",
  "arrived_late",
  "changed_mind",
  "other",
] as const;

interface ReturnOptions {
  orderId: string;
  orderNumber: string;
  currency: string;
  reasons: Array<{ code: string; noteRequired: boolean }>;
  lines: Array<{
    index: number;
    name: string;
    unitPrice: number;
    ordered: number;
    eligible: number;
    finalSale: boolean;
    blockedReason?: string;
  }>;
  refundMethods: RefundMethod[];
  canRefund: boolean;
}

interface ReturnResult {
  returns: Array<{ id: string; number: string; refunded: number }>;
  refunded: number;
  refundMethod: RefundMethod;
  refundPending: boolean;
  /** Paid out as money; less than `refunded` where store credit paid part of the sale. */
  paidOut: number;
  /** Given back to the store credit that paid part of the sale. */
  creditBack: number;
  cashOut: number;
  warnings: string[];
}

export interface POSExchangeCredit {
  amount: number;
  reference: string;
}

interface POSReturnDialogProps {
  sale: POSSaleSummary | null;
  onClose: () => void;
  fp: (amount: number) => string;
  isOffline: boolean;
  registerSessionId?: string;
  storeName?: string;
  /** An exchange: the refund pays toward the sale rung up next. */
  onExchange: (credit: POSExchangeCredit) => void;
  /** The sale changed (refunded, returned): the list behind should reload. */
  onReturned: (cashOut: number) => void;
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Taking goods back at the till against one of its sales: choose the lines
 * and their condition, see what the store's return policy refunds, choose
 * how the money goes back. The server does the rest (lib/pos/pos-returns.ts).
 */
export function POSReturnDialog({
  sale,
  onClose,
  fp,
  isOffline,
  registerSessionId,
  storeName,
  onExchange,
  onReturned,
}: POSReturnDialogProps) {
  const t = useTranslations("pos.returns");
  const [options, setOptions] = React.useState<ReturnOptions | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [quantities, setQuantities] = React.useState<Record<number, number>>({});
  const [conditions, setConditions] = React.useState<Record<number, Condition>>({});
  const [reason, setReason] = React.useState<string>("changed_mind");
  const [note, setNote] = React.useState("");
  const [method, setMethod] = React.useState<RefundMethod | null>(null);
  const [preview, setPreview] = React.useState<{ total: number; restockingFee: number } | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<ReturnResult | null>(null);
  // One key per return, kept across retries until it goes through: a retry
  // after a dropped answer finishes the same return instead of opening another.
  const [requestId, setRequestId] = React.useState<string | null>(null);

  const saleId = sale?._id ?? null;
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  if (saleId !== loadedFor) {
    setLoadedFor(saleId);
    setOptions(null);
    setLoadError(null);
    setQuantities({});
    setConditions({});
    setReason("changed_mind");
    setNote("");
    setMethod(null);
    setPreview(null);
    setResult(null);
    setRequestId(null);
  }

  React.useEffect(() => {
    if (!saleId || isOffline) return;
    const controller = new AbortController();
    fetch(`/api/pos/returns/options?orderId=${encodeURIComponent(saleId)}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) throw new Error(json?.message || t("loadFailed"));
        const data = json.data as ReturnOptions;
        setOptions(data);
        setMethod(data.refundMethods[0] ?? null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : t("loadFailed"));
      });
    return () => controller.abort();
  }, [saleId, isOffline, t]);

  const lines = React.useMemo(
    () =>
      (options?.lines ?? [])
        .filter((line) => (quantities[line.index] ?? 0) > 0)
        .map((line) => ({
          index: line.index,
          quantity: quantities[line.index],
          condition: conditions[line.index] ?? "new",
        })),
    [options, quantities, conditions],
  );
  const linesKey = JSON.stringify(lines.map(({ index, quantity }) => [index, quantity]));

  // What the policy refunds for the chosen lines, asked again as they change.
  React.useEffect(() => {
    if (!saleId || !lines.length || isOffline) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      fetch("/api/pos/returns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: saleId, lines, reason }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = await res.json().catch(() => null);
          if (!res.ok || !json?.success) throw new Error(json?.message || t("previewFailed"));
          setPreview({ total: Number(json.data.total) || 0, restockingFee: Number(json.data.restockingFee) || 0 });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setPreview(null);
          toast.error(error instanceof Error ? error.message : t("previewFailed"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewing(false);
        });
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `lines` is read through its key: a new array of the same lines is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleId, linesKey, reason, isOffline, t]);

  if (!sale) return null;

  const noteRequired = options?.reasons.find((row) => row.code === reason)?.noteRequired ?? reason === "other";
  const canSubmit =
    Boolean(options) &&
    lines.length > 0 &&
    Boolean(method) &&
    !submitting &&
    !isOffline &&
    !(noteRequired && !note.trim());

  const reasonLabel = (code: string) =>
    (KNOWN_REASONS as readonly string[]).includes(code) ? t(`reasons.${code}`) : code.replaceAll("_", " ");

  const submit = async () => {
    if (!canSubmit || !method || !options) return;
    const key = requestId ?? newRequestId();
    setRequestId(key);
    setSubmitting(true);
    try {
      const res = await fetch("/api/pos/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: options.orderId,
          lines,
          reason,
          note: note.trim() || undefined,
          refundMethod: method,
          requestId: key,
          registerSessionId,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast.error(json?.message || t("failed"));
        return;
      }
      setRequestId(null);
      const data = json.data as ReturnResult;
      setResult(data);
      onReturned(data.cashOut);
      for (const warning of data.warnings) toast.warning(warning);
      toast.success(t("done", { numbers: data.returns.map((row) => row.number).join(", ") }));
      // Only the money: the part store credit paid is back on their account.
      if (data.refundMethod === "exchange" && data.paidOut > 0) {
        onExchange({
          amount: data.paidOut,
          reference: data.returns.map((row) => row.number).join(", "),
        });
      }
    } catch {
      toast.error(t("failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const printReturnSlip = () => {
    if (!result || !options) return;
    const rows: Array<[string, string]> = [
      [t("slipSale"), options.orderNumber],
      ...lines.map((line) => {
        const source = options.lines.find((row) => row.index === line.index);
        return [`${line.quantity} × ${source?.name ?? ""}`, t(`conditions.${line.condition}`)] as [string, string];
      }),
      [t("reason"), reasonLabel(reason)],
      [t("refundTotal"), result.refundPending ? t("methods.later") : fp(result.refunded)],
      ...(result.refundPending ? [] : ([[t("refundTo"), t(`methods.${result.refundMethod}`)]] as Array<[string, string]>)),
      ...(result.creditBack > 0 ? ([[t("methods.store_credit"), fp(result.creditBack)]] as Array<[string, string]>) : []),
    ];
    if (!printSlip({ title: t("slipTitle"), heading: [storeName, result.returns.map((row) => row.number).join(", ")], rows, footer: note.trim() || null })) {
      toast.error(t("printBlocked"));
    }
  };

  const doneMessage = (data: ReturnResult) => {
    if (data.refundPending) return t("doneLater");
    if (data.refundMethod === "exchange") return t("doneExchange", { amount: fp(data.paidOut) });
    if (data.refundMethod === "store_credit") return t("doneCredit", { amount: fp(data.refunded) });
    if (data.cashOut > 0) return t("doneCash", { amount: fp(data.cashOut) });
    return t("doneRefunded", { amount: fp(data.paidOut) });
  };

  let body: React.ReactNode;
  if (isOffline) {
    body = <p className="p-5 text-sm text-muted-foreground">{t("offline")}</p>;
  } else if (loadError) {
    body = <p className="p-5 text-sm text-rose-600">{loadError}</p>;
  } else if (!options) {
    body = (
      <div className="flex justify-center p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (result) {
    body = (
      <div className="space-y-4 p-5">
        <div className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          <p className="font-semibold">{t("done", { numbers: result.returns.map((row) => row.number).join(", ") })}</p>
          <p className="mt-1">{doneMessage(result)}</p>
          {result.creditBack > 0 ? (
            <p className="mt-1">{t("creditBack", { amount: fp(result.creditBack) })}</p>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={printReturnSlip}>
            <Printer className="mr-1.5 h-4 w-4" />
            {t("print")}
          </Button>
          <Button type="button" className="h-11 rounded-xl" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </div>
    );
  } else {
    const returnable = options.lines.filter((line) => line.eligible > 0);
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {returnable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("nothingReturnable")}</p>
          ) : null}
          <ul className="space-y-2">
            {options.lines.map((line) => {
              const quantity = quantities[line.index] ?? 0;
              const blocked = line.eligible <= 0;
              return (
                <li key={line.index} className={cn("rounded-xl border p-3", blocked && "opacity-60")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fp(line.unitPrice)} ·{" "}
                        {blocked
                          ? line.blockedReason === "FINAL_SALE"
                            ? t("blockedFinalSale")
                            : line.blockedReason === "RETURN_WINDOW_CLOSED"
                              ? t("blockedWindow")
                              : t("blockedOther")
                          : t("returnable", { count: line.eligible })}
                      </p>
                    </div>
                    {!blocked ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          disabled={quantity <= 0}
                          aria-label={t("less")}
                          onClick={() => setQuantities((prev) => ({ ...prev, [line.index]: Math.max(0, quantity - 1) }))}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-7 text-center text-sm font-semibold tabular-nums">{quantity}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 rounded-lg"
                          disabled={quantity >= line.eligible}
                          aria-label={t("more")}
                          onClick={() =>
                            setQuantities((prev) => ({ ...prev, [line.index]: Math.min(line.eligible, quantity + 1) }))
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {quantity > 0 ? (
                    <label className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      {t("condition")}
                      <select
                        className="h-8 rounded-lg border bg-background px-2 text-xs text-foreground"
                        value={conditions[line.index] ?? "new"}
                        onChange={(event) =>
                          setConditions((prev) => ({ ...prev, [line.index]: event.target.value as Condition }))
                        }
                      >
                        {CONDITIONS.map((condition) => (
                          <option key={condition} value={condition}>
                            {t(`conditions.${condition}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {returnable.length > 0 ? <p className="text-xs text-muted-foreground">{t("restockHint")}</p> : null}

          {returnable.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="pos-return-reason">
                {t("reason")}
              </label>
              <select
                id="pos-return-reason"
                className="h-10 w-full rounded-xl border bg-background px-3 text-sm"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                {options.reasons.map((row) => (
                  <option key={row.code} value={row.code}>
                    {reasonLabel(row.code)}
                  </option>
                ))}
              </select>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={noteRequired ? t("noteRequired") : t("notePlaceholder")}
                aria-label={t("note")}
                className="h-10 rounded-xl"
                maxLength={1000}
              />
            </div>
          ) : null}

          {returnable.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("refundTo")}</p>
              {!options.canRefund ? <p className="text-xs text-muted-foreground">{t("adminOnly")}</p> : null}
              <div className="grid grid-cols-2 gap-2">
                {options.refundMethods.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setMethod(candidate)}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                      method === candidate ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
                    )}
                    aria-pressed={method === candidate}
                  >
                    {t(`methods.${candidate}`)}
                  </button>
                ))}
              </div>
              {method === "exchange" ? <p className="text-xs text-muted-foreground">{t("exchangeHint")}</p> : null}
              {method === "later" && options.canRefund ? (
                <p className="text-xs text-muted-foreground">{t("laterHint")}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {returnable.length > 0 ? (
          <div className="space-y-2 border-t bg-muted/30 px-5 py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("refundTotal")}</span>
              <span className="font-semibold tabular-nums">
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : preview && lines.length ? fp(preview.total) : "—"}
              </span>
            </div>
            {preview && preview.restockingFee > 0 && lines.length ? (
              <p className="text-xs text-muted-foreground">{t("restockingFee", { amount: fp(preview.restockingFee) })}</p>
            ) : null}
            <Button type="button" className="h-11 w-full rounded-xl" disabled={!canSubmit} onClick={submit}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
              {t("submit")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold">{t("title")}</h2>
            <p className="font-mono text-xs text-muted-foreground">{sale.orderNumber}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={onClose}
            disabled={submitting}
            aria-label={t("close")}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {body}
      </div>
    </div>
  );
}
