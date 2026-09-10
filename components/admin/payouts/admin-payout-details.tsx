"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Check, Info } from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type StatusEvent = { status: string; at: string; by?: string; note?: string };

type PayoutDetailsPayload = {
  payout: {
    _id: string;
    payoutNumber: string;
    status: string;
    currency: string;
    grossSales: number;
    /** Signed correction carried in from an earlier payout; negative is a clawback. */
    adjustments?: number;
    commissionAmount: number;
    netAmount: number;
    periodStart: string;
    periodEnd: string;
    createdAt: string;
    paidAt?: string;
    note?: string;
    paidFrom?: string;
    paymentReference?: string;
    statusHistory?: StatusEvent[];
    vendorId?: { _id?: string; storeName?: string; slug?: string };
  };
  orders: Array<{
    _id: string;
    orderNumber: string;
    total: number;
    /** The vendor's share of the goods — what gross sales is made of. */
    vendorShare: number;
    /** That share after commission — what the net payout is made of. */
    vendorEarnings: number;
    paymentStatus: string;
    status: string;
    createdAt: string;
  }>;
};

const STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
] as const;

/** The happy path, in order. Failed and cancelled are exits, not steps. */
const STEPS = ["pending", "processing", "paid"] as const;

const ACCOUNTS = ["bank", "cash", "gateway", "other"] as const;

const STATUS_TONE: Record<string, string> = {
  paid: "border-green-600/25 bg-green-600/10 text-green-700 dark:text-green-400",
  processing:
    "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  pending: "border-border bg-muted text-muted-foreground",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Initials for the vendor chip; a store name is what a payout is recognised by. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * One payout, and the decision to pay it.
 *
 * Three things this screen has to do, in this order: say what is owed and how
 * that figure was reached, say where the payout has got to, and let someone
 * move it on. It used to do the first with three unrelated tiles, the second
 * not at all, and the third with an unlabelled dropdown beside a Save button
 * that was always enabled — so the most consequential action in finance looked
 * like a form field.
 */
export function AdminPayoutDetails({
  locale,
  payoutId,
}: {
  locale: string;
  payoutId: string;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  /** The list screen's own status names, already translated everywhere. */
  const statusLabel = (status: string) =>
    label(
      `admin.payoutsPage.statuses.${status}`,
      status.charAt(0).toUpperCase() + status.slice(1),
    );
  const accountLabel = (account: string) =>
    label(
      `finance.paidFrom.${account}`,
      account.charAt(0).toUpperCase() + account.slice(1),
    );

  const [data, setData] = useState<PayoutDetailsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("pending");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [paidFrom, setPaidFrom] = useState("");

  // The payout's OWN currency, not the store's current one: a payout is frozen
  // in what it was calculated in, and relabelling it later says the vendor was
  // paid an amount they never were.
  const money = useCurrencyFormatter(data?.payout?.currency);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/payouts/${payoutId}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || "Failed to load payout");
      }
      const payload = json.data as PayoutDetailsPayload;
      setData(payload);
      setStatus(payload.payout?.status || "pending");
      setNote(payload.payout?.note || "");
      setReference(payload.payout?.paymentReference || "");
      setPaidFrom(payload.payout?.paidFrom || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load payout");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Deferred a tick, the way the payments overview loads: kicking a fetch
    // that immediately setStates inside the effect body trips React's
    // set-state-in-effect rule and renders once with stale state.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payoutId]);

  const payout = data?.payout;

  /*
   * Nothing to save until something changed.
   *
   * The button posted the same status back to an API that accepts it — a
   * no-op that still looked like an action and, on a paid payout, invited a
   * click on the one screen where clicking is irreversible.
   */
  const dirty = useMemo(() => {
    if (!payout) return false;
    return (
      status !== (payout.status || "pending") ||
      note !== (payout.note || "") ||
      reference !== (payout.paymentReference || "") ||
      paidFrom !== (payout.paidFrom || "")
    );
  }, [payout, status, note, reference, paidFrom]);

  /** A terminal payout accepts no further transitions; the API refuses them. */
  const settled =
    payout?.status === "paid" ||
    payout?.status === "failed" ||
    payout?.status === "cancelled";

  const updatePayout = async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/payouts/${payoutId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          note,
          paymentReference: reference,
          paidFrom,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || "Failed to update payout");
      }
      toast.success(label("finance.payout.updated", "Payout updated."));
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update payout",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!payout) {
    return (
      <p className="text-muted-foreground">
        {label("finance.payout.notFound", "Payout not found.")}
      </p>
    );
  }

  const dateTime = (value: string) =>
    new Date(value).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const day = (value: string) =>
    new Date(value).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const orders = data?.orders ?? [];
  const orderTotal = orders.reduce((sum, order) => sum + order.total, 0);
  const shareTotal = orders.reduce((sum, order) => sum + order.vendorShare, 0);
  const earningsTotal = orders.reduce(
    (sum, order) => sum + order.vendorEarnings,
    0,
  );

  const history = payout.statusHistory ?? [];
  const stepAt = (step: string) => {
    if (step === "pending") return payout.createdAt;
    if (step === "paid" && payout.paidAt) return payout.paidAt;
    return history.find((event) => event.status === step)?.at;
  };
  const reachedIndex = STEPS.indexOf(payout.status as (typeof STEPS)[number]);

  return (
    <div className="space-y-5">
      <Link
        href={`/${locale}/admin/payouts`}
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {label("finance.payout.backToPayouts", "Payouts")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {payout.payoutNumber}
            </h1>
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
                STATUS_TONE[payout.status] ?? "border-border",
              )}
            >
              {payout.status === "paid" ? <Check className="size-3" /> : null}
              {statusLabel(payout.status)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
              {initials(payout.vendorId?.storeName || "?")}
            </span>
            {payout.vendorId?._id ? (
              <Link
                href={`/${locale}/admin/vendors/${payout.vendorId._id}`}
                className="font-medium text-foreground hover:underline"
              >
                {payout.vendorId?.storeName || "-"}
              </Link>
            ) : (
              <span className="font-medium text-foreground">
                {payout.vendorId?.storeName || "-"}
              </span>
            )}
            <span aria-hidden>·</span>
            <span>
              {label("finance.payout.ordersUpTo", "Orders up to {date}").replace(
                "{date}",
                day(payout.periodEnd),
              )}
            </span>
            <span aria-hidden>·</span>
            <span>
              {label("finance.payout.orderCount", "{count} orders").replace(
                "{count}",
                String(orders.length),
              )}
            </span>
          </div>
        </div>
      </div>

      {/*
        The arithmetic, not three unrelated figures.

        Gross less commission — and, when one was carried in, less an
        adjustment — IS the net. Printed as separate cards, the difference read
        as an error on the one screen whose entire purpose is being checked.
      */}
      <Card className="gap-0 py-6">
        <CardContent className="grid gap-8 px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <p className="text-base font-semibold">
              {label(
                "finance.payout.howItWasWorkedOut",
                "How this payout was worked out",
              )}
            </p>
            <div className="mt-4 divide-y">
              <CalculationRow
                label={label("finance.payout.grossSales", "Gross sales")}
                hint={label(
                  "finance.payout.grossSalesHint",
                  "the vendor's share of the orders below",
                )}
                value={money(payout.grossSales)}
              />
              <CalculationRow
                label={label("finance.payout.commission", "Commission")}
                hint={
                  payout.grossSales > 0
                    ? `${((payout.commissionAmount / payout.grossSales) * 100).toFixed(1)}% ${label("finance.payout.ofGross", "of gross")}`
                    : undefined
                }
                value={`-${money(payout.commissionAmount)}`}
              />
              {payout.adjustments ? (
                <CalculationRow
                  label={label("finance.payout.adjustments", "Adjustments")}
                  hint={label(
                    "finance.payout.adjustmentsHint",
                    "recovered from this payout — already paid on orders refunded since",
                  )}
                  value={money(payout.adjustments)}
                />
              ) : (
                <CalculationRow
                  label={label("finance.payout.adjustments", "Adjustments")}
                  hint={label(
                    "finance.payout.noAdjustments",
                    "none carried in from an earlier payout",
                  )}
                  value={money(0)}
                  muted
                />
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center lg:border-s lg:ps-8">
            <p className="text-sm text-muted-foreground">
              {label("finance.payout.netPayout", "Net payout")}
            </p>
            <p className="mt-1.5 text-4xl font-semibold tracking-tight tabular-nums">
              {money(payout.netAmount)}
            </p>
            {payout.paidAt ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/60 p-3">
                <Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {label("finance.payout.paidOn", "Paid {date}").replace(
                      "{date}",
                      dateTime(payout.paidAt),
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[
                      payout.paidFrom ? accountLabel(payout.paidFrom) : null,
                      payout.paymentReference
                        ? `${label("finance.payout.reference", "Reference")} ${payout.paymentReference}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") ||
                      label(
                        "finance.payout.noReference",
                        "No payment reference recorded",
                      )}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Where it has got to, and how to move it on. */}
      <Card className="gap-0 py-0">
        <CardContent className="px-6 py-6">
          <p className="text-base font-semibold">
            {label("finance.payout.statusTitle", "Status")}
          </p>
          <div className="mt-5 flex flex-wrap items-start gap-y-4">
            {STEPS.map((step, index) => {
              const done = reachedIndex >= index && reachedIndex !== -1;
              const at = stepAt(step);
              return (
                <div key={step} className="flex flex-1 items-start gap-2.5">
                  <span
                    className={cn(
                      "flex size-[22px] shrink-0 items-center justify-center rounded-full text-xs",
                      done
                        ? "bg-green-600 text-white"
                        : "border border-dashed border-border text-muted-foreground",
                    )}
                  >
                    {done ? <Check className="size-3" /> : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {statusLabel(step)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {/* A payout can jump straight from pending to paid. The
                          step it skipped has been passed, so saying "not yet"
                          about it under a tick contradicts the tick. */}
                      {done
                        ? at
                          ? dateTime(at)
                          : label("finance.payout.notRecorded", "Not recorded")
                        : label("finance.payout.notYet", "Not yet")}
                    </p>
                  </div>
                  {index < STEPS.length - 1 ? (
                    <span className="mt-[11px] hidden h-px flex-1 bg-border sm:block" />
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>

        <div className="border-t px-6 py-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label className="mb-1.5 block">
                {label("finance.payout.statusTitle", "Status")}
              </Label>
              <Select value={status} onValueChange={setStatus} disabled={settled}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {statusLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payout-reference" className="mb-1.5 block">
                {label("finance.payout.reference", "Payment reference")}
              </Label>
              <Input
                id="payout-reference"
                value={reference}
                maxLength={120}
                onChange={(event) => setReference(event.target.value)}
                placeholder={label("finance.payout.referencePlaceholder", "TRX-88213")}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">
                {label("finance.expenses.paidFrom", "Paid from")}
              </Label>
              <Select
                value={paidFrom || "unset"}
                onValueChange={(value) =>
                  setPaidFrom(value === "unset" ? "" : value)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">
                    {label("finance.payout.accountUnset", "Not recorded")}
                  </SelectItem>
                  {ACCOUNTS.map((account) => (
                    <SelectItem key={account} value={account}>
                      {accountLabel(account)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4">
            <Label htmlFor="payout-note" className="mb-1.5 block">
              {label("finance.payout.note", "Note")}
              <span className="font-normal text-muted-foreground">
                {label(
                  "finance.payout.noteHint",
                  "— kept on the payout and visible to the vendor",
                )}
              </span>
            </Label>
            <Input
              id="payout-note"
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className="flex max-w-[60ch] items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {label(
              "finance.payout.saveWarning",
              "Marking a payout paid posts a ledger entry and settles the orders behind it. It cannot be unposted — a mistake is corrected with an adjustment.",
            )}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {dirty ? null : label("finance.payout.noChanges", "No changes yet")}
            </span>
            <Button
              onClick={() => void updatePayout()}
              disabled={isSaving || !dirty}
            >
              {isSaving
                ? label("common.saving", "Saving...")
                : label("common.saveChanges", "Save changes")}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4 pt-5">
          <p className="text-base font-semibold">
            {label("finance.payout.ordersTitle", "Orders in this payout")}
          </p>
          <span className="text-[13px] text-muted-foreground">
            {label(
              "finance.payout.ordersHint",
              "Everything delivered and unpaid up to {date}",
            ).replace("{date}", day(payout.periodEnd))}
          </span>
        </div>
        <div className="overflow-x-auto border-t">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[13px]">
                <th className="h-10 px-4 font-medium">
                  {label("finance.payout.order", "Order")}
                </th>
                <th className="h-10 px-4 font-medium">
                  {label("finance.payout.placed", "Placed")}
                </th>
                <th className="h-10 px-4 font-medium">
                  {label("finance.payout.orderStatus", "Order status")}
                </th>
                <th className="h-10 px-4 font-medium">
                  {label("finance.payout.payment", "Payment")}
                </th>
                <th className="h-10 px-4 text-right font-medium">
                  {label("finance.payout.orderTotal", "Order total")}
                </th>
                <th className="h-10 px-4 text-right font-medium">
                  {label("finance.payout.vendorShare", "Vendor's share")}
                </th>
                <th className="h-10 px-4 text-right font-medium">
                  {label("finance.payout.vendorEarnings", "After commission")}
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order._id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/${locale}/admin/orders?search=${encodeURIComponent(order.orderNumber)}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {dateTime(order.createdAt)}
                  </td>
                  <td className="px-4 py-3 capitalize">{order.status}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">
                    {order.paymentStatus}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {money(order.total)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(order.vendorShare)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {money(order.vendorEarnings)}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {label(
                      "finance.payout.noOrders",
                      "No orders linked to this payout.",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
            {orders.length > 0 ? (
              <tfoot>
                <tr className="border-t bg-muted/40 font-medium">
                  <td className="px-4 py-3" colSpan={4}>
                    {label("finance.payout.orderCount", "{count} orders").replace(
                      "{count}",
                      String(orders.length),
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {money(orderTotal)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(shareTotal)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {money(earningsTotal)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <p className="px-6 pb-5 pt-3.5 text-xs text-muted-foreground">
          {label(
            "finance.payout.shareNote",
            "The order total is what the buyer paid, including shipping and tax the store collected. The vendor's share of the goods is what gross sales adds up to; after commission it is what the net payout adds up to.",
          )}
        </p>
      </Card>
    </div>
  );
}

/** One line of the calculation: what it is, why, and how much. */
function CalculationRow({
  label,
  hint,
  value,
  muted,
}: {
  label: string;
  hint?: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5",
        muted && "text-muted-foreground/70",
      )}
    >
      <span className="text-sm">
        {label}
        {hint ? (
          <span className={cn("ms-1.5", !muted && "text-muted-foreground")}>
            — {hint}
          </span>
        ) : null}
      </span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}
