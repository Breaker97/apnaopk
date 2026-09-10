"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Landmark, Wallet } from "lucide-react";
import {
  DataTable,
  CurrencyCell,
  DateCell,
  StatusCell,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import { CommissionOwedCard } from "./commission-owed-card";

interface VendorFinance {
  currency: string;
  /** Currencies this vendor also holds a balance in, which this screen cannot show. */
  otherCurrencies?: string[];
  /** Already paid for sales refunded since — recovered from the next payout. */
  overpaid?: number;
  minWithdrawalAmount: number;
  owed: {
    amount: number;
    grossSales: number;
    commissionAmount: number;
    orderCount: number;
  };
  lifetime: {
    grossSales: number;
    commission: number;
    vendorEarnings: number;
    shipping: number;
  };
  platformRevenue: {
    commission: number;
    subscriptions: number;
    shipping: number;
    total: number;
    invoiceCount: number;
    paidInvoiceCount: number;
  };
  payouts: {
    paidAmount: number;
    pendingAmount: number;
    paidCount: number;
    pendingCount: number;
    lastPaidAt: string | null;
  };
  bank: { complete: boolean; missing: string[] };
}

interface PayoutRow {
  _id: string;
  payoutNumber: string;
  status: string;
  currency: string;
  netAmount: number;
  grossSales?: number;
  commissionAmount?: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

interface PayoutsResponse {
  data: PayoutRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface PayoutsTabProps {
  vendorId: string;
  basePath: string;
}

const PAYOUT_STATUS_MAP = {
  pending: { label: "Pending", variant: "outline" as const },
  processing: { label: "Processing", variant: "secondary" as const },
  paid: { label: "Paid", variant: "default" as const },
  failed: { label: "Failed", variant: "destructive" as const },
  cancelled: { label: "Cancelled", variant: "destructive" as const },
};

function MoneyStat({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-24" />
      ) : (
        <p className="mt-0.5 truncate text-lg font-semibold tabular-nums">
          {value}
        </p>
      )}
      {!loading && hint ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function PayoutsTab({ vendorId, basePath }: PayoutsTabProps) {
  const router = useRouter();
  const [finance, setFinance] = useState<VendorFinance | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);

  const { formatPrice: format } = useCurrency();

  useEffect(() => {
    let active = true;

    apiClient
      .get<VendorFinance>(`/api/admin/vendors/${vendorId}/finance`)
      .then((res) => {
        if (active) setFinance(res);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load vendor finance:", error);
        toast.error("Failed to load payout summary");
      })
      .finally(() => {
        if (active) setFinanceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vendorId]);

  useEffect(() => {
    let active = true;

    apiClient
      .get<PayoutsResponse>(
        `/api/admin/payouts?vendorId=${vendorId}&page=${page}&limit=10`,
      )
      .then((res) => {
        if (!active) return;
        setRows(res.data || []);
        setPagination({
          page: res.pagination.page,
          pageSize: res.pagination.limit,
          total: res.pagination.total,
          totalPages: res.pagination.totalPages,
        });
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load vendor payouts:", error);
        toast.error("Failed to load payouts");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vendorId, page]);

  const openPayout = useCallback(
    (row: PayoutRow) => router.push(`${basePath}/payouts/${row._id}`),
    [basePath, router],
  );

  const owed = finance?.owed;
  const belowMinimum = Boolean(
    finance && owed && owed.amount > 0 && owed.amount < finance.minWithdrawalAmount,
  );

  const columns: DataTableColumn<PayoutRow>[] = [
    {
      id: "payoutNumber",
      header: "Payout",
      cell: (row) => (
        <Link
          href={`${basePath}/payouts/${row._id}`}
          className="font-medium hover:underline"
        >
          {row.payoutNumber}
        </Link>
      ),
      className: "w-[210px]",
    },
    {
      id: "period",
      header: "Period",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          <DateCell date={row.periodStart} format="medium" /> –{" "}
          <DateCell date={row.periodEnd} format="medium" />
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusCell status={row.status} statusMap={PAYOUT_STATUS_MAP} />
      ),
      className: "w-[130px]",
    },
    {
      id: "netAmount",
      header: "Net amount",
      cell: (row) => (
        <CurrencyCell value={row.netAmount} />
      ),
      className: "w-[140px]",
    },
  ];

  return (
    <div className="space-y-6">
      {!financeLoading && finance && !finance.bank.complete && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No payout account on file</AlertTitle>
          <AlertDescription>
            Missing {finance.bank.missing.join(", ").toLowerCase()}. A payout can
            still be recorded, but there is nowhere to send the money — add the
            details on the Business tab first.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                Owed now
              </CardTitle>
              <CardDescription>
                Delivered, paid orders not yet included in any payout — the
                exact amount a payout created now would carry
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={`${basePath}/payouts`}>Create payout</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {financeLoading ? (
            <Skeleton className="h-9 w-40" />
          ) : (
            <>
              <p className="text-3xl font-semibold tabular-nums">
                {format(owed?.amount ?? 0)}
              </p>
              {/*
                An eligible order can still be worth nothing — fully refunded,
                or wiped out by a 100%-off coupon. It would be consumed by a
                payout either way, so it is counted rather than hidden; the
                copy just has to explain the zero instead of reading like a bug.
              */}
              <p className="text-sm text-muted-foreground">
                {!owed?.orderCount ? (
                  "No delivered, paid orders are awaiting payout."
                ) : owed.amount === 0 ? (
                  <>
                    {owed.orderCount.toLocaleString()} eligible order
                    {owed.orderCount === 1 ? "" : "s"}, but refunds and
                    order-level discounts leave nothing payable.
                  </>
                ) : (
                  <>
                    Across {owed.orderCount.toLocaleString()} order
                    {owed.orderCount === 1 ? "" : "s"} ·{" "}
                    {format(owed.grossSales)} gross less{" "}
                    {format(owed.commissionAmount)} commission. Refunds and
                    order-level discounts are already deducted.
                  </>
                )}
              </p>
              {belowMinimum && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Below the minimum withdrawal</AlertTitle>
                  <AlertDescription>
                    Payouts must be at least{" "}
                    {format(finance?.minWithdrawalAmount ?? 0)}. Creating one now
                    would be rejected.
                  </AlertDescription>
                </Alert>
              )}
              {/*
                A payout is final and a refund is not, so money can already have
                gone out for goods that came back. It comes off the next payout,
                which means "Owed now" is not what one created today would carry.
              */}
              {finance?.overpaid ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>
                    {format(finance.overpaid)} overpaid on refunded orders
                  </AlertTitle>
                  <AlertDescription>
                    Already paid for sales that were refunded afterwards. It is
                    recovered from the next payout, so one created now would
                    carry {format(Math.max(0, (owed?.amount ?? 0) - finance.overpaid))}.
                  </AlertDescription>
                </Alert>
              ) : null}
              {/*
                Every figure on this screen is in one currency. A vendor who has
                also traded in another holds a balance nothing here can show or
                pay out, and saying nothing about it is how that balance is
                never collected.
              */}
              {finance?.otherCurrencies?.length ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>
                    Balances in {finance.otherCurrencies.join(", ")}
                  </AlertTitle>
                  <AlertDescription>
                    This vendor has also traded in{" "}
                    {finance.otherCurrencies.join(", ")}. Those balances are not
                    in the figures above and need a payout of their own —
                    currencies are never added together.
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/*
        Directly under "Owed now" on purpose: the two are the same question
        asked in opposite directions, and a vendor can genuinely be owed money
        while owing more of it back.
      */}
      <CommissionOwedCard vendorId={vendorId} />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Trade</CardTitle>
          <CardDescription>
            What this vendor sold, across every non-cancelled order, in{" "}
            {finance?.currency || "store currency"}
          </CardDescription>
        </CardHeader>
        <div className="grid grid-cols-2 divide-x divide-y border-t lg:grid-cols-3 lg:divide-y-0">
          <MoneyStat
            label="Gross sales"
            value={format(finance?.lifetime.grossSales ?? 0)}
            loading={financeLoading}
          />
          <MoneyStat
            label="Vendor earnings"
            value={format(finance?.lifetime.vendorEarnings ?? 0)}
            hint="gross less commission"
            loading={financeLoading}
          />
          <MoneyStat
            label="Paid out"
            value={format(finance?.payouts.paidAmount ?? 0)}
            hint={
              finance?.payouts.pendingAmount
                ? `${format(finance.payouts.pendingAmount)} pending`
                : undefined
            }
            loading={financeLoading}
          />
        </div>
      </Card>

      {/*
        Grouped rather than left as one commission figure among trade numbers:
        read alone, commission understates the vendor — a subscription fee can
        outweigh a year of it. "Revenue" is deliberate; gateway costs are not
        netted, so this is not profit.
      */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Platform revenue from this vendor</CardTitle>
          <CardDescription>
            Commission and retained shipping from their sales, plus the
            subscription fees they paid. Revenue before platform costs.
          </CardDescription>
        </CardHeader>
        <div className="grid grid-cols-2 divide-x divide-y border-t lg:grid-cols-4 lg:divide-y-0">
          <MoneyStat
            label="Commission"
            value={format(finance?.platformRevenue.commission ?? 0)}
            hint="on gross sales"
            loading={financeLoading}
          />
          <MoneyStat
            label="Subscriptions"
            value={format(finance?.platformRevenue.subscriptions ?? 0)}
            hint={
              finance?.platformRevenue.invoiceCount
                ? `${finance.platformRevenue.paidInvoiceCount} of ${finance.platformRevenue.invoiceCount} invoices paid`
                : "no invoices"
            }
            loading={financeLoading}
          />
          <MoneyStat
            label="Shipping"
            value={format(finance?.platformRevenue.shipping ?? 0)}
            hint="retained, not paid out"
            loading={financeLoading}
          />
          <MoneyStat
            label="Total"
            value={format(finance?.platformRevenue.total ?? 0)}
            loading={financeLoading}
          />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4" />
            Payout history
          </CardTitle>
          <CardDescription>
            Payouts recorded for this vendor, newest first
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={rows}
            columns={columns}
            keyField="_id"
            isLoading={isLoading}
            loadingMode="rows"
            pagination={pagination ?? undefined}
            onPageChange={setPage}
            onRowClick={openPayout}
            emptyMessage="No payouts have been created for this vendor yet"
          />
        </CardContent>
      </Card>
    </div>
  );
}
