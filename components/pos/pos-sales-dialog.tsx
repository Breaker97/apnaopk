"use client";

import * as React from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { ArrowLeft, FileText, Loader2, Printer, Receipt, Search, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import type { POSSettings } from "@/lib/pos/build-pos-settings";
import type { POSTenderInput } from "@/lib/pos/tenders";
import type { POSSaleSummary } from "@/lib/pos/pos-order-search";
import type { ReceiptPrintPayload } from "@/components/pos/pos-types";
import { reprintReceiptPayload } from "@/lib/pos/receipt-payload";
import { POSTakePaymentDialog } from "@/components/pos/take-payment-dialog";
import { POSReceiptSender } from "@/components/pos/pos-receipt-sender";

interface POSSalesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: POSSettings;
  /** The counter the register stands at: its latest sales show first. */
  locationId?: string;
  isOffline: boolean;
  /** This device's open drawer: a balance paid in cash goes into it. */
  registerSessionId?: string;
  fp: (amount: number) => string;
  /** A tender's name at the till. */
  tenderLabel: (method: string) => string;
  /** Print a receipt the way the till prints every receipt. */
  onPrint: (receipt: ReceiptPrintPayload) => void;
  /** A balance was paid with cash: the drawer opens for it. */
  onCashTaken?: () => void;
  /**
   * Extra actions for the selected sale (returns, from the returns feature),
   * rendered under the built-in ones.
   */
  renderSaleActions?: (sale: POSSaleSummary, refresh: () => void) => React.ReactNode;
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `pos_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Finding a counter sale again — by its receipt number or the customer's
 * phone — to collect a deposit's balance, send its receipt, print it again,
 * or (with the returns feature) take items back.
 *
 * Online only: the sales are the server's, and a balance is paid against the
 * server's figure (lib/pos/collect-balance.ts).
 */
export function POSSalesDialog({
  open,
  onOpenChange,
  settings,
  locationId,
  isOffline,
  registerSessionId,
  fp,
  tenderLabel,
  onPrint,
  onCashTaken,
  renderSaleActions,
}: POSSalesDialogProps) {
  const t = useTranslations("pos.sales");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [search, setSearch] = React.useState("");
  const [dueOnly, setDueOnly] = React.useState(false);
  const [sales, setSales] = React.useState<POSSaleSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [collecting, setCollecting] = React.useState(false);
  const [isPaying, setIsPaying] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);
  const requestIdRef = React.useRef<string | null>(null);

  const selected = sales.find((sale) => sale._id === selectedId) ?? null;

  // Load as the cashier types (debounced), and again when asked to refresh.
  React.useEffect(() => {
    if (!open || isOffline) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (dueOnly) params.set("due", "1");
      if (locationId) params.set("locationId", locationId);
      fetch(`/api/pos/orders?${params.toString()}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((json) => {
          if (json?.success) setSales(json.data as POSSaleSummary[]);
          else toast.error(json?.message || t("loadFailed"));
        })
        .catch((error) => {
          if ((error as Error)?.name !== "AbortError") toast.error(t("loadFailed"));
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, search.trim() ? 300 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, isOffline, search, dueOnly, locationId, reloadToken, t]);

  const refresh = React.useCallback(() => setReloadToken((n) => n + 1), []);

  // Escape closes (the payment dialog on top handles its own).
  React.useEffect(() => {
    if (!open || collecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, collecting, onOpenChange]);

  if (!open) return null;

  // The sale's own figures and counter, as its receipt printed them.
  const receiptFor = (sale: POSSaleSummary): ReceiptPrintPayload =>
    reprintReceiptPayload(sale, { tenderLabel, splitLabel: t("split") });

  const collect = async (tenders: POSTenderInput[]): Promise<boolean> => {
    if (!selected) return false;
    if (!requestIdRef.current) requestIdRef.current = newRequestId();
    setIsPaying(true);
    try {
      const res = await fetch(`/api/pos/orders/${encodeURIComponent(selected._id)}/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestIdRef.current, tenders, registerSessionId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        toast.error(json?.message || t("collectFailed"));
        return false;
      }
      requestIdRef.current = null;
      if (tenders.some((tender) => tender.method === "cash")) onCashTaken?.();
      const due = Number(json.data?.balanceDue || 0);
      toast.success(
        json.data?.completed ? t("balancePaid") : t("balancePart", { due: fp(due) }),
      );
      setCollecting(false);
      if (settings.printedReceiptsEnabled) {
        onPrint({
          ...receiptFor(selected),
          // The sale's cash and change belong to its first receipt, not this one.
          cashTendered: undefined,
          balanceReturned: 0,
          payments: [
            ...selected.tenders.map((tender) => ({ label: tenderLabel(tender.method), amount: tender.amount })),
            ...tenders.map((tender) => ({ label: tenderLabel(tender.method), amount: tender.amount })),
          ],
          balanceDue: due > 0 ? due : undefined,
        });
      }
      refresh();
      return true;
    } catch {
      toast.error(t("collectFailed"));
      return false;
    } finally {
      setIsPaying(false);
    }
  };

  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-primary"
            checked={dueOnly}
            onChange={(event) => setDueOnly(event.target.checked)}
          />
          {t("dueOnly")}
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && sales.length === 0 ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sales.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="divide-y">
            {!search.trim() ? (
              <li className="px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t("recentHint")}
              </li>
            ) : null}
            {sales.map((sale) => (
              <li key={sale._id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(sale._id)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                    sale._id === selectedId && "bg-muted",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {sale.orderNumber}
                      {sale.localReceiptNumber ? (
                        <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
                          {sale.localReceiptNumber}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {format.relativeTime(new Date(sale.createdAt), now)}
                      {sale.customerName ? ` · ${sale.customerName}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{fp(sale.total)}</p>
                    {sale.balanceDue > 0 ? (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        {t("balanceDue", { amount: fp(sale.balanceDue) })}
                      </p>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const detail = selected ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full md:hidden"
          onClick={() => setSelectedId(null)}
          aria-label={t("back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{selected.orderNumber}</p>
          <p className="truncate text-xs text-muted-foreground">
            {format.dateTime(new Date(selected.createdAt), { dateStyle: "medium", timeStyle: "short" })}
            {selected.customerName ? ` · ${selected.customerName}` : ""}
            {selected.customerPhone ? ` · ${selected.customerPhone}` : ""}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("items")}
          </p>
          <ul className="space-y-1 text-sm">
            {selected.items.map((item) => (
              <li key={item.index} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {item.quantity} × {item.name}
                </span>
                <span className="shrink-0 tabular-nums">{fp(item.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("payments")}
          </p>
          <ul className="space-y-1 text-sm">
            {selected.tenders.map((tender, index) => (
              <li key={index} className="flex justify-between gap-3">
                <span>{tenderLabel(tender.method)}</span>
                <span className="tabular-nums">{fp(tender.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t pt-1 font-semibold">
              <span>{t("total")}</span>
              <span className="tabular-nums">{fp(selected.total)}</span>
            </li>
            {selected.refundedTotal > 0 ? (
              <li className="flex justify-between gap-3 text-muted-foreground">
                <span>{t("refunded")}</span>
                <span className="tabular-nums">−{fp(selected.refundedTotal)}</span>
              </li>
            ) : null}
            {selected.balanceDue > 0 ? (
              <li className="flex justify-between gap-3 font-semibold text-amber-600 dark:text-amber-400">
                <span>{t("balanceDueLabel")}</span>
                <span className="tabular-nums">{fp(selected.balanceDue)}</span>
              </li>
            ) : null}
          </ul>
        </div>
        <POSReceiptSender
          orderId={selected._id}
          defaultEmail={selected.customerEmail}
          defaultPhone={selected.customerPhone}
          receiptChannels={settings.receiptChannels}
        />
      </div>
      <div className="space-y-2 border-t p-3">
        {selected.balanceDue > 0 ? (
          <Button
            type="button"
            className="h-11 w-full rounded-xl"
            onClick={() => {
              requestIdRef.current = newRequestId();
              setCollecting(true);
            }}
          >
            <Wallet className="mr-2 h-4 w-4" />
            {t("collectBalance", { amount: fp(selected.balanceDue) })}
          </Button>
        ) : null}
        {renderSaleActions?.(selected, refresh)}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            onClick={() => onPrint(receiptFor(selected))}
          >
            <Printer className="mr-1.5 h-4 w-4" />
            {t("print")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            onClick={() =>
              window.open(
                `/api/pos/orders/${encodeURIComponent(selected._id)}/invoice?disposition=inline`,
                "_blank",
                "noopener,noreferrer",
              )
            }
          >
            <FileText className="mr-1.5 h-4 w-4" />
            {t("viewInvoice")}
          </Button>
        </div>
      </div>
    </div>
  ) : (
    <div className="hidden flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground md:flex">
      {t("selectHint")}
    </div>
  );

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={(event) => {
          if (event.target === event.currentTarget) onOpenChange(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("title")}
          className="flex h-[min(42rem,92dvh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Receipt className="h-4 w-4" />
              {t("title")}
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={() => onOpenChange(false)}
              aria-label={t("close")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {isOffline ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("offline")}</p>
          ) : (
            <div className="flex min-h-0 flex-1">
              <div
                className={cn(
                  "flex min-h-0 w-full flex-col md:w-80 md:border-r",
                  selected && "hidden md:flex",
                )}
              >
                {list}
              </div>
              <div className={cn("min-h-0 flex-1 flex-col", selected ? "flex" : "hidden md:flex")}>
                {detail}
              </div>
            </div>
          )}
        </div>
      </div>
      {selected ? (
        <POSTakePaymentDialog
          open={collecting}
          onOpenChange={setCollecting}
          mode="balance"
          total={selected.balanceDue}
          itemCount={selected.items.reduce((sum, item) => sum + item.quantity, 0)}
          discount={null}
          onComplete={(tenders) => collect(tenders)}
          onCreateStripeIntent={async () => {
            throw new Error(t("collectFailed"));
          }}
          isProcessing={isPaying}
          settings={settings}
          isOffline={isOffline}
          fp={fp}
          hasCustomer
        />
      ) : null}
    </>
  );
}
