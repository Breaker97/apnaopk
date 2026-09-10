"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrency } from "@/providers/currency-provider";

type Payload = {
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
  locale,
  payoutId,
}: {
  locale: string;
  payoutId: string;
}) {
  const { formatPrice } = useCurrency();
  const [data, setData] = useState<Payload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/vendor/payouts/${payoutId}`);
        const json = await res.json().catch(() => null);
        if (!active) return;
        if (res.ok && json?.success) {
          setData(json.data as Payload);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [payoutId]);

  if (isLoading) return <p className="text-muted-foreground">Loading payout details...</p>;
  if (!data) return <p className="text-muted-foreground">Payout not found.</p>;

  const payout = data.payout;

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
        className={`grid gap-4 ${payout.adjustments ? "md:grid-cols-4" : "md:grid-cols-3"}`}
      >
        <Metric title="Gross Sales" value={formatPrice(payout.grossSales)} />
        <Metric
          title="Commission"
          value={formatPrice(payout.commissionAmount)}
        />
        {payout.adjustments ? (
          <Metric
            title="Adjustments"
            value={formatPrice(payout.adjustments)}
            hint="Already paid to you on orders refunded since, recovered here"
          />
        ) : null}
        <Metric title="Net Payout" value={formatPrice(payout.netAmount)} />
      </div>

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
              <Link href={`/${locale}/vendor/payouts`}>Back to Payouts</Link>
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
