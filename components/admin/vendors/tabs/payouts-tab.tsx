"use client";
import { formatCurrency } from "@/lib/intl/money";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { useRouter } from "@/hooks/use-locale-navigation";
import { AlertTriangle, Landmark, Wallet } from "lucide-react";
import {
  DataTable,
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
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { CommissionOwedCard } from "./commission-owed-card";
import { RecordRepaymentDialog } from "./record-repayment-dialog";
import { PayoutPeriod } from "@/components/payouts/payout-period";

interface VendorFinance {
  currency: string;
  /** Currencies this vendor also holds a balance in, which this screen cannot show. */
  otherCurrencies?: string[];
  /** Already paid for sales refunded since — recovered from the next payout. */
  overpaid?: number;
  minWithdrawalAmount: number;
  quote?: {
    netAmount: number;
    eligible: boolean;
    eligibilityReason?: string | null;
    frozen?: boolean;
    hasMore?: boolean;
    commissionOwedNotDeducted?: number;
    breakdown?: Record<string, number>;
  };
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
  bank: { complete: boolean; missing: string[]; missingFields?: string[] };
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
  periodBoundary?: string;
  createdAt: string;
}

interface RepaymentRow {
  _id: string;
  amount: number;
  currency: string;
  receivedInto: string;
  reference?: string;
  receivedAt: string;
  status: "recorded" | "voided";
}

interface PayoutsResponse {
  data: PayoutRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface PayoutsTabProps {
  vendorId: string;
  basePath: string;
}

const PAYOUT_STATUS_VARIANT = {
  pending: "outline",
  processing: "secondary",
  paid: "default",
  failed: "destructive",
  cancelled: "destructive",
} as const;

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
  const t = useTranslations("admin.vendorPayoutsTab");
  const tStatus = useTranslations("admin.payoutsPage.statuses");
  const tBank = useTranslations("admin.payoutsPage.sendTo");
  const router = useRouter();
  const [finance, setFinance] = useState<VendorFinance | null>(null);
  const [financeLoading, setFinanceLoading] = useState(true);
  const [financeRevision, setFinanceRevision] = useState(0);
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [repayments, setRepayments] = useState<RepaymentRow[]>([]);
  const [repaymentOpen, setRepaymentOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null>(null);

  const format = useCurrencyFormatter(finance?.currency);

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
        toast.error(t("loadSummaryError"));
      })
      .finally(() => {
        if (active) setFinanceLoading(false);
      });
    apiClient
      .get<RepaymentRow[]>(`/api/admin/vendors/${vendorId}/repayments`)
      .then((list) => {
        if (active) setRepayments(list || []);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [vendorId, financeRevision, t]);

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
        toast.error(t("loadPayoutsError"));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vendorId, page, t]);

  const openPayout = useCallback(
    (row: PayoutRow) => router.push(`${basePath}/payouts/${row._id}`),
    [basePath, router],
  );

  const voidRepayment = async (row: RepaymentRow) => {
    const reason = window.prompt(t("repayment.voidReason"));
    if (!reason?.trim()) return;
    try {
      await apiClient.post(`/api/admin/vendors/${vendorId}/repayments/${row._id}/void`, { reason: reason.trim() });
      toast.success(t("repayment.voided"));
      setFinanceRevision((value) => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("repayment.failed"));
    }
  };

  const owed = finance?.owed;
  const quote = finance?.quote;
  const recovered = Number(quote?.breakdown?.recoveryDeducted || 0);
  const belowMinimum = Boolean(
    finance && owed && owed.amount > 0 && owed.amount < finance.minWithdrawalAmount,
  );
  const liveRepayments = repayments.filter((row) => row.status === "recorded");
  const statusMap = Object.fromEntries(
    Object.entries(PAYOUT_STATUS_VARIANT).map(([status, variant]) => [status, { label: tStatus(status), variant }]),
  );

  const columns: DataTableColumn<PayoutRow>[] = [
    {
      id: "payoutNumber",
      header: t("columns.payout"),
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
      header: t("columns.period"),
      cell: (row) => <PayoutPeriod start={row.periodStart} end={row.periodEnd} boundary={row.periodBoundary} />,
    },
    {
      id: "status",
      header: t("columns.status"),
      cell: (row) => <StatusCell status={row.status} statusMap={statusMap} />,
      className: "w-[130px]",
    },
    {
      id: "netAmount",
      header: t("columns.netAmount"),
      cell: (row) => (
        <span className="tabular-nums">{formatCurrency(row.netAmount, row.currency || "USD")}</span>
      ),
      className: "w-[140px]",
    },
  ];

  return (
    <div className="space-y-6">
      {!financeLoading && finance && !finance.bank.complete && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("bankMissingTitle")}</AlertTitle>
          <AlertDescription>
            {t("bankMissing", {
              fields: (finance.bank.missingFields ?? [])
                .map((field) => tBank(field as "accountName"))
                .join(", "),
            })}
          </AlertDescription>
        </Alert>
      )}

      {!financeLoading && quote?.frozen ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("frozenTitle")}</AlertTitle>
          <AlertDescription>{t("frozen")}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" />
                {t("owedNow")}
              </CardTitle>
              <CardDescription>{t("owedNowHint")}</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href={`${basePath}/payouts`}>{t("createPayout")}</Link>
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
                {!owed?.orderCount
                  ? t("noneAwaiting")
                  : owed.amount === 0
                    ? t("nothingPayable", { count: owed.orderCount })
                    : t("across", {
                        count: owed.orderCount,
                        gross: format(owed.grossSales),
                        commission: format(owed.commissionAmount),
                      })}
              </p>
              {belowMinimum && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>{t("belowMinimumTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("belowMinimum", { minimum: format(finance?.minWithdrawalAmount ?? 0) })}
                  </AlertDescription>
                </Alert>
              )}
              {quote?.commissionOwedNotDeducted ? (
                <p className="text-sm text-muted-foreground">
                  {t("commissionLeft", { amount: format(quote.commissionOwedNotDeducted) })}
                </p>
              ) : null}
              {/*
                A payout is final and a refund is not, so money can already have
                gone out for goods that came back. The figure above already has
                what the next payout recovers taken off — said here, not taken
                off a second time.
              */}
              {finance?.overpaid ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>
                    {t("overpaidTitle", { amount: format(finance.overpaid) })}
                  </AlertTitle>
                  <AlertDescription>
                    <p>
                      {recovered > 0
                        ? t("overpaidRecovered", { amount: format(recovered) })
                        : t("overpaidLater")}
                    </p>
                    <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setRepaymentOpen(true)}>
                      {t("repayment.open")}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
              {liveRepayments.length > 0 ? (
                <div className="space-y-1.5 text-sm">
                  <p className="font-medium">{t("repayment.listTitle")}</p>
                  <ul className="divide-y rounded-lg border">
                    {liveRepayments.map((row) => (
                      <li key={row._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className="min-w-0">
                          <span className="font-medium tabular-nums">{formatCurrency(row.amount, row.currency)}</span>
                          <span className="ms-2 text-muted-foreground">
                            <DateCell date={row.receivedAt} format="medium" />
                            {row.reference ? ` · ${row.reference}` : ""}
                          </span>
                        </span>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void voidRepayment(row)}>
                          {t("repayment.undo")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
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
                    {t("otherCurrenciesTitle", { currencies: finance.otherCurrencies.join(", ") })}
                  </AlertTitle>
                  <AlertDescription>
                    {t("otherCurrencies", { currencies: finance.otherCurrencies.join(", ") })}
                  </AlertDescription>
                </Alert>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {finance && finance.overpaid ? (
        <RecordRepaymentDialog
          key={`${finance.currency}-${finance.overpaid}`}
          vendorId={vendorId}
          currency={finance.currency}
          owedBack={finance.overpaid}
          open={repaymentOpen}
          onOpenChange={setRepaymentOpen}
          onRecorded={() => setFinanceRevision((value) => value + 1)}
        />
      ) : null}

      {/*
        Directly under "Owed now" on purpose: the two are the same question
        asked in opposite directions, and a vendor can genuinely be owed money
        while owing more of it back.
      */}
      <CommissionOwedCard vendorId={vendorId} />

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>{t("trade")}</CardTitle>
          <CardDescription>
            {t("tradeHint", { currency: finance?.currency || "" })}
          </CardDescription>
        </CardHeader>
        <div className="grid grid-cols-2 divide-x divide-y border-t lg:grid-cols-3 lg:divide-y-0">
          <MoneyStat
            label={t("grossSales")}
            value={format(finance?.lifetime.grossSales ?? 0)}
            loading={financeLoading}
          />
          <MoneyStat
            label={t("vendorEarnings")}
            value={format(finance?.lifetime.vendorEarnings ?? 0)}
            hint={t("vendorEarningsHint")}
            loading={financeLoading}
          />
          <MoneyStat
            label={t("paidOut")}
            value={format(finance?.payouts.paidAmount ?? 0)}
            hint={
              finance?.payouts.pendingAmount
                ? t("pendingAmount", { amount: format(finance.payouts.pendingAmount) })
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
          <CardTitle>{t("platformRevenue")}</CardTitle>
          <CardDescription>{t("platformRevenueHint")}</CardDescription>
        </CardHeader>
        <div className="grid grid-cols-2 divide-x divide-y border-t lg:grid-cols-4 lg:divide-y-0">
          <MoneyStat
            label={t("commission")}
            value={format(finance?.platformRevenue.commission ?? 0)}
            hint={t("commissionHint")}
            loading={financeLoading}
          />
          <MoneyStat
            label={t("subscriptions")}
            value={format(finance?.platformRevenue.subscriptions ?? 0)}
            hint={
              finance?.platformRevenue.invoiceCount
                ? t("invoicesPaid", {
                    paid: finance.platformRevenue.paidInvoiceCount,
                    total: finance.platformRevenue.invoiceCount,
                  })
                : t("noInvoices")
            }
            loading={financeLoading}
          />
          <MoneyStat
            label={t("shipping")}
            value={format(finance?.platformRevenue.shipping ?? 0)}
            hint={t("shippingHint")}
            loading={financeLoading}
          />
          <MoneyStat
            label={t("total")}
            value={format(finance?.platformRevenue.total ?? 0)}
            loading={financeLoading}
          />
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="h-4 w-4" />
            {t("history")}
          </CardTitle>
          <CardDescription>{t("historyHint")}</CardDescription>
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
            emptyMessage={t("historyEmpty")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
