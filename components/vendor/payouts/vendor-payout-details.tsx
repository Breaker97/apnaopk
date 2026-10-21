"use client";

import Link from "@/components/language/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPayoutDay } from "@/components/payouts/payout-period";
import { useCurrencyFormatter } from "@/providers/currency-provider";

type StatusEvent = { status: string; at: string; note?: string };

type Payload = {
  payout: {
    _id: string;
    payoutNumber: string;
    status: string;
    currency: string;
    grossSales: number;
    adjustments?: number;
    commissionOffset?: number;
    shippingAmount?: number;
    commissionCredit?: number;
    commissionAmount: number;
    netAmount: number;
    periodStart: string;
    periodEnd: string;
    periodBoundary?: string;
    createdAt: string;
    paidAt?: string;
    reversedAt?: string;
    breakdown?: Record<string, number>;
    legacyCalculation?: boolean;
    preorderReserveHeld?: number;
    preorderReserveReleaseAt?: string;
    note?: string;
    paidFrom?: string;
    paymentReference?: string;
    statusHistory?: StatusEvent[];
  };
  orders: Array<{
    _id: string;
    orderNumber: string;
    vendorShare?: number;
    vendorEarnings?: number;
    total: number;
    paymentStatus: string;
    status: string;
    createdAt: string;
  }>;
};

/** The corrections a payout's breakdown records, in reading order, with their sign. */
const ADJUSTMENTS: Array<[key: string, sign: 1 | -1]> = [
  ["recoveryDeducted", -1],
  ["recoveryReturned", 1],
  ["reserveHeld", -1],
  ["reserveReleased", 1],
  ["reserveCreditDeducted", -1],
  ["reserveCreditReturned", 1],
  ["commissionOffset", -1],
  ["commissionCredit", 1],
];

/**
 * One payout, from the seller's side: how the amount was reached, where it
 * has got to — with the store's note, which is where a returned payment's
 * reason is written — and the orders in it.
 */
export function VendorPayoutDetails({ payoutId }: { payoutId: string }) {
  const t = useTranslations("vendor.payoutDetail");
  const tCommon = useTranslations();
  const locale = useLocale();
  const [data, setData] = useState<Payload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const formatPrice = useCurrencyFormatter(data?.payout.currency);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      setData(null);
      try {
        const res = await fetch(`/api/vendor/payouts/${payoutId}`);
        const json = await res.json().catch(() => null);
        if (!active) return;
        if (res.ok && json?.success) {
          setData(json.data as Payload);
          setError(null);
        } else {
          setError(res.status === 404 ? tCommon("finance.reliability.notFound") : tCommon("finance.reliability.readError"));
        }
      } catch {
        if (active) setError(tCommon("finance.reliability.readError"));
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [payoutId, retry, tCommon]);

  if (isLoading) return <p className="text-muted-foreground">{tCommon("common.loading")}</p>;
  if (!data) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-muted-foreground">{error || tCommon("finance.reliability.notFound")}</p>
        {error && (
          <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
            {tCommon("common.retry")}
          </Button>
        )}
      </div>
    );
  }

  const payout = data.payout;
  const status = (value: string) => tCommon(`admin.payoutsPage.statuses.${value}`);
  const when = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const day = (value: string) => formatPayoutDay(value, locale, payout.periodBoundary);
  const history: StatusEvent[] = [
    { status: "pending", at: payout.createdAt },
    ...(payout.statusHistory ?? []).filter((event) => event.status !== "pending"),
  ];
  const adjustments = payout.breakdown
    ? ADJUSTMENTS.filter(([key]) => Number(payout.breakdown?.[key] || 0) !== 0)
    : [];
  // A payout from before breakdowns were recorded: one line for whatever moved it.
  const legacyAdjustment = payout.breakdown ? 0 : Number(payout.adjustments || 0);

  return (
    <div className="space-y-6">
      <Link
        href="/vendor/payouts"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {t("back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{payout.payoutNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {t("period", { start: day(payout.periodStart), end: day(payout.periodEnd) })}
          </p>
        </div>
        <Badge variant="outline">{status(payout.status)}</Badge>
      </div>

      {payout.note ? (
        <div className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium">{t("noteFromStore")}</p>
            <p className="text-muted-foreground">{payout.note}</p>
          </div>
        </div>
      ) : null}

      <Card className="gap-0 py-6">
        <CardContent className="grid gap-8 px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <dl className="divide-y">
            <Row label={t("grossSales")} hint={t("grossSalesHint")} value={formatPrice(payout.grossSales)} />
            <Row label={t("commission")} value={`-${formatPrice(payout.commissionAmount)}`} />
            {payout.shippingAmount ? (
              <Row label={t("shipping")} hint={t("shippingHint")} value={`+${formatPrice(payout.shippingAmount)}`} />
            ) : null}
            {adjustments.map(([key, sign]) => (
              <Row
                key={key}
                label={t(`adjustment.${key}`)}
                hint={
                  key === "reserveHeld" && payout.preorderReserveReleaseAt
                    ? t("reserveUntil", { date: day(payout.preorderReserveReleaseAt) })
                    : t(`adjustment.${key}Hint`)
                }
                value={`${sign < 0 ? "-" : "+"}${formatPrice(Math.abs(Number(payout.breakdown?.[key] || 0)))}`}
              />
            ))}
            {legacyAdjustment ? (
              <Row label={t("otherAdjustments")} hint={t("otherAdjustmentsHint")} value={formatPrice(legacyAdjustment)} />
            ) : null}
          </dl>
          <div className="flex flex-col justify-center lg:border-s lg:ps-8">
            <p className="text-sm text-muted-foreground">{t("netPayout")}</p>
            <p className="mt-1.5 text-4xl font-semibold tracking-tight tabular-nums">{formatPrice(payout.netAmount)}</p>
            {payout.paidAt ? (
              <p className="mt-3 flex items-start gap-1.5 text-[13px]">
                <Check className="mt-0.5 size-3.5 shrink-0 text-green-600" />
                <span>
                  {t("sentOn", { date: when(payout.paidAt) })}
                  {payout.paidFrom ? ` · ${tCommon(`finance.paidFrom.${payout.paidFrom}`)}` : ""}
                  {payout.paymentReference ? ` · ${t("reference", { reference: payout.paymentReference })}` : ""}
                </span>
              </p>
            ) : null}
            {payout.reversedAt ? (
              <p className="mt-2 text-[13px] font-medium text-destructive">
                {t("returnedOn", { date: when(payout.reversedAt) })}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {payout.legacyCalculation ? <p className="text-sm text-muted-foreground">{tCommon("finance.reliability.legacy")}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("history")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2.5">
            {history.map((event, index) => (
              <li key={`${event.status}-${index}`} className="flex items-start gap-2.5 text-[13px]">
                <span
                  className={`mt-1 size-2 shrink-0 rounded-full ${
                    event.status === "failed" || event.status === "cancelled" ? "bg-destructive" : "bg-green-600"
                  }`}
                />
                <div className="min-w-0">
                  <p className="font-medium">
                    {event.status === "failed" && payout.reversedAt ? t("returnedStep") : status(event.status)}
                    <span className="ms-2 font-normal text-muted-foreground">{when(event.at)}</span>
                  </p>
                  {event.note ? <p className="mt-0.5 text-xs text-muted-foreground">{event.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("orders")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-start text-muted-foreground">
                  <th className="py-2 pe-4 text-start font-medium">{t("order")}</th>
                  <th className="py-2 pe-4 text-start font-medium">{t("placed")}</th>
                  <th className="py-2 pe-4 text-end font-medium">{t("yourShare")}</th>
                  <th className="py-2 text-end font-medium">{t("afterCommission")}</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order._id} className="border-b last:border-0">
                    <td className="py-2 pe-4 font-medium">{order.orderNumber}</td>
                    <td className="py-2 pe-4 text-muted-foreground">{when(order.createdAt)}</td>
                    <td className="py-2 pe-4 text-end tabular-nums">{formatPrice(order.vendorShare ?? order.total)}</td>
                    <td className="py-2 text-end font-medium tabular-nums">
                      {order.vendorEarnings === undefined ? "—" : formatPrice(order.vendorEarnings)}
                    </td>
                  </tr>
                ))}
                {data.orders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t("noOrders")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, hint, value }: { label: string; hint?: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
      <dt className="text-sm">
        {label}
        {hint ? <span className="ms-1.5 text-muted-foreground">— {hint}</span> : null}
      </dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}
