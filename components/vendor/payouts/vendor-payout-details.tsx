"use client";
import { PayoutBreakdown } from "@/components/payouts/payout-breakdown";

import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrencyFormatter } from "@/providers/currency-provider";

type Payload = {
  payout: {
    _id: string;
    payoutNumber: string;
    status: string;
    currency: string;
    grossSales: number;
    /** Signed correction carried in from an earlier payout; negative is a clawback. */
    adjustments?: number;
    /** Commission owed on the vendor's own cash sales, deducted here. Inside `adjustments`. */
    commissionOffset?: number;
    /** Delivery charges the vendor earned, inside `netAmount`. */
    shippingAmount?: number;
    /** Store promotions owed on the vendor's cash sales, paid here. Inside `adjustments`. */
    commissionCredit?: number;
    commissionAmount: number;
    netAmount: number;
    periodStart: string;
    periodEnd: string;
    createdAt: string;
    paidAt?: string;
    reversedAt?: string;
    breakdown?: Record<string, number>;
    legacyCalculation?: boolean;
    note?: string;
  };
  orders: Array<{
    _id: string;
    orderNumber: string;
    total: number;
    paymentStatus: string;
    status: string;
    createdAt: string;
  }>;
};

export function VendorPayoutDetails({
  payoutId,
}: {
  payoutId: string;
}) {
  const t = useTranslations();
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
        } else { setError(res.status === 404 ? t("finance.reliability.notFound") : t("finance.reliability.readError")); }
      } catch { if (active) setError(t("finance.reliability.readError")); } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [payoutId, retry, t]);

  if (isLoading) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (!data) return <div className="space-y-3"><p role="alert" className="text-muted-foreground">{error || t("finance.reliability.notFound")}</p>{error && <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>{t("common.retry")}</Button>}</div>;

  const payout = data.payout;
  // The commission deduction sits inside `adjustments`; it has its own card,
  // so this is what is left of the adjustment once it is taken out.
  const otherAdjustments =
    Math.round(
      ((payout.adjustments ?? 0) +
        (payout.commissionOffset ?? 0) -
        (payout.commissionCredit ?? 0)) *
        100,
    ) / 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{payout.payoutNumber}</h1>
          <p className="text-muted-foreground">
            Period: {new Date(payout.periodStart).toLocaleDateString()} -{" "}
            {new Date(payout.periodEnd).toLocaleDateString()}
          </p>
        </div>
        <Badge variant="outline" className="capitalize">
          {payout.status}
        </Badge>
      </div>

      {/*
        Net is gross less commission ONLY when nothing was carried in. A refund
        that lands after a payout has cleared is recovered from the next one, so
        without this column the difference reads as an arithmetic error.
      */}
      <div
        className={`grid gap-4 sm:grid-cols-2 ${
          [
            otherAdjustments,
            payout.commissionOffset,
            payout.commissionCredit,
            payout.shippingAmount,
          ].filter(Boolean).length >= 2
            ? "lg:grid-cols-5"
            : otherAdjustments ||
                payout.commissionOffset ||
                payout.commissionCredit ||
                payout.shippingAmount
              ? "md:grid-cols-4"
              : "md:grid-cols-3"
        }`}
      >
        <Metric title="Gross Sales" value={formatPrice(payout.grossSales)} />
        <Metric
          title="Commission"
          value={formatPrice(payout.commissionAmount)}
        />
        {payout.shippingAmount ? (
          <Metric
            title="Delivery charges"
            value={formatPrice(payout.shippingAmount)}
            hint="Charged to shoppers for parcels you delivered"
          />
        ) : null}
        {payout.commissionOffset ? (
          <Metric
            title="Commission on cash sales"
            value={formatPrice(-payout.commissionOffset)}
            hint="Owed on sales you collected the money for yourself, deducted here instead of invoiced"
          />
        ) : null}
        {payout.commissionCredit ? (
          <Metric
            title="Store promotions on cash sales"
            value={formatPrice(payout.commissionCredit)}
            hint="Discounts the store paid for on sales you collected, beyond the commission you owed"
          />
        ) : null}
        {otherAdjustments ? (
          <Metric
            title="Adjustments"
            value={formatPrice(otherAdjustments)}
            hint="Already paid to you on orders refunded since, recovered here"
          />
        ) : null}
        <Metric title="Net Payout" value={formatPrice(payout.netAmount)} />
      </div>

      {payout.breakdown && <PayoutBreakdown breakdown={payout.breakdown} currency={payout.currency} />}
      {payout.legacyCalculation && <p className="text-muted-foreground">{t("finance.reliability.legacy")}</p>}
      {payout.paidAt && <p>{t("finance.reliability.paidAt")}: {new Date(payout.paidAt).toLocaleString()}</p>}
      {payout.reversedAt && <p>{t("finance.reliability.returnedAt")}: {new Date(payout.reversedAt).toLocaleString()}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Orders Included</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Order</th>
                  <th className="py-2 pr-4">Order Status</th>
                  <th className="py-2 pr-4">Payment Status</th>
                  <th className="py-2 pr-4">Total</th>
                  <th className="py-2 pr-0">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order._id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{order.orderNumber}</td>
                    <td className="py-2 pr-4 capitalize">{order.status}</td>
                    <td className="py-2 pr-4 capitalize">{order.paymentStatus}</td>
                    <td className="py-2 pr-4">
                      {formatPrice(order.total)}
                    </td>
                    <td className="py-2 pr-0 text-muted-foreground">
                      {new Date(order.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
                {data.orders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No orders linked to this payout.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4">
            <Button variant="outline" asChild>
              <Link href="/vendor/payouts">Back to Payouts</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  /** Why this figure is here, for the ones that are not self-explanatory. */
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
