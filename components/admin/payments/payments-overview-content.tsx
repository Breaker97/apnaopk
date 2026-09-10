"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ChevronRight, Clock, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { useCurrency } from "@/providers/currency-provider";
import { FinancePeriodPicker } from "@/components/admin/finance/finance-period-picker";
import {
  DataTable,
  TextCell,
  type DataTableColumn,
} from "@/components/ui/data-table";

type OverviewPayload = {
  totals: {
    paidRevenue: number;
    refundedAmount: number;
    pendingPayments: number;
    refundedOrders: number;
    pendingPayoutAmount: number;
    paidPayoutAmount: number;
  };
  recentTransactions: Array<{
    _id: string;
    orderNumber: string;
    type: string;
    status: string;
    provider: string;
    paymentMethod?: string;
    grossAmount: number;
    currency?: string;
    createdAt: string;
  }>;
};

type RecentTransaction = OverviewPayload["recentTransactions"][number];

function toReadableLabel(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toKeyToken(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * A transaction status is not decoration: succeeded, pending and failed are
 * three different things to do next, and every one of them used to render as
 * the same outline pill.
 */
const STATUS_TONE: Record<string, string> = {
  succeeded:
    "border-green-600/25 bg-green-600/10 text-green-700 dark:text-green-400",
  paid: "border-green-600/25 bg-green-600/10 text-green-700 dark:text-green-400",
  pending:
    "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  processing:
    "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "border-destructive/30 bg-destructive/10 text-destructive",
};

/**
 * Payments: what was charged, what came back, and what is still to be settled.
 *
 * The figures are grouped by what they ARE. Money and counts were sharing one
 * six-column grid of identical tiles — "$128,440.00" beside "12" beside
 * "$22,480.90" — which reads as one row of comparable numbers and is nothing of
 * the kind: two are money that moved in a period, one is a queue of orders
 * waiting on a gateway, and one is a balance owed to other people.
 */
export function PaymentsOverviewContent({
  locale,
  period,
  periodLabel,
  from,
  to,
}: {
  locale: string;
  period: string;
  periodLabel: string;
  from: string;
  to: string;
}) {
  const t = useTranslations();
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { isMultiVendor } = useMultiVendorMode();
  const { formatPrice: money } = useCurrency();
  const searchParams = useSearchParams();

  // The days as they were WRITTEN in the URL, not as the server resolved them.
  // A resolved bound is an instant in UTC; handing that back to an API that
  // parses calendar days would move the range by one in half the world.
  const rawFrom = searchParams.get("from") || "";
  const rawTo = searchParams.get("to") || "";

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams(
        period === "custom" && rawFrom && rawTo
          ? { from: rawFrom, to: rawTo }
          : { period },
      );
      const res = await fetch(`/api/admin/payments/overview?${params}`);
      const json = await res.json();
      if (res.ok && json?.success) {
        setData(json.data as OverviewPayload);
      }
    } finally {
      setIsLoading(false);
    }
  }, [period, rawFrom, rawTo]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Both the totals and the transaction rows use the store currency (`money`).
  // A row carries the code it was charged in, but honouring it made the same
  // sale read "USh 308" in Orders and "$308.00" here.
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const translateWithFallback = useCallback(
    (key: string, fallback: string) => {
      try {
        return t(key);
      } catch {
        return fallback;
      }
    },
    [t],
  );

  const translateTransactionType = useCallback(
    (type: string) =>
      translateWithFallback(
        `admin.paymentsOverviewPage.transactionTypes.${toKeyToken(type)}`,
        toReadableLabel(type),
      ),
    [translateWithFallback],
  );

  const translateTransactionStatus = useCallback(
    (status: string) =>
      translateWithFallback(
        `admin.paymentsOverviewPage.transactionStatuses.${toKeyToken(status)}`,
        toReadableLabel(status),
      ),
    [translateWithFallback],
  );

  const translateProvider = useCallback(
    (provider: string) =>
      translateWithFallback(
        `admin.paymentsOverviewPage.providers.${toKeyToken(provider)}`,
        toReadableLabel(provider),
      ),
    [translateWithFallback],
  );

  const formatDateTime = useCallback(
    (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return dateTimeFormatter.format(date);
    },
    [dateTimeFormatter],
  );

  const totals = data?.totals;
  const netCollected =
    Number(totals?.paidRevenue || 0) - Number(totals?.refundedAmount || 0);

  const recentTransactionsColumns = useMemo<
    DataTableColumn<RecentTransaction>[]
  >(
    () => [
      {
        id: "order",
        header: t(
          "admin.paymentsOverviewPage.recentTransactions.columns.order",
        ),
        cell: (txn) => (
          <Link
            href={`/${locale}/admin/orders?search=${encodeURIComponent(txn.orderNumber)}`}
            className="font-medium text-primary hover:underline"
          >
            {txn.orderNumber}
          </Link>
        ),
        className: "w-[200px]",
      },
      {
        id: "type",
        header: t("admin.paymentsOverviewPage.recentTransactions.columns.type"),
        cell: (txn) => (
          <TextCell
            value={translateTransactionType(txn.type)}
            className="text-muted-foreground"
          />
        ),
        className: "w-[140px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
      },
      {
        id: "provider",
        header: t(
          "admin.paymentsOverviewPage.recentTransactions.columns.provider",
        ),
        cell: (txn) => (
          <span>
            {translateProvider(txn.provider)}
            {txn.paymentMethod ? (
              <span className="ms-1.5 text-xs text-muted-foreground">
                · {toReadableLabel(txn.paymentMethod)}
              </span>
            ) : null}
          </span>
        ),
        className: "w-[200px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
      {
        id: "status",
        header: t(
          "admin.paymentsOverviewPage.recentTransactions.columns.status",
        ),
        cell: (txn) => (
          <span
            className={cn(
              "inline-flex h-[22px] items-center rounded-full border px-2 text-xs font-medium capitalize",
              STATUS_TONE[toKeyToken(txn.status)] ?? "text-muted-foreground",
            )}
          >
            {translateTransactionStatus(txn.status)}
          </span>
        ),
        className: "w-[150px]",
      },
      {
        id: "amount",
        header: t(
          "admin.paymentsOverviewPage.recentTransactions.columns.amount",
        ),
        cell: (txn) => {
          // A refund is money leaving. Printing it unsigned in the same column
          // as a charge made a day of refunds read as a day of takings.
          const refund = toKeyToken(txn.type) === "refund";
          return (
            <span
              className={cn(
                "block w-full text-right font-medium tabular-nums",
                refund && "text-muted-foreground",
              )}
            >
              {refund ? "-" : ""}
              {money(txn.grossAmount)}
            </span>
          );
        },
        className: "w-[160px] text-right",
        headerClassName: "text-right [&>div]:justify-end",
      },
      {
        id: "date",
        header: t("admin.paymentsOverviewPage.recentTransactions.columns.date"),
        cell: (txn) => (
          <TextCell
            value={formatDateTime(txn.createdAt)}
            className="text-muted-foreground"
          />
        ),
        className: "w-[200px] hidden lg:table-cell text-right",
        headerClassName: "hidden lg:table-cell text-right [&>div]:justify-end",
      },
    ],
    [
      money,
      formatDateTime,
      locale,
      t,
      translateProvider,
      translateTransactionStatus,
      translateTransactionType,
    ],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("admin.paymentsOverviewPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isMultiVendor
              ? t("admin.paymentsOverviewPage.subtitleMultiVendor")
              : t("admin.paymentsOverviewPage.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FinancePeriodPicker
            period={period}
            from={from}
            to={to}
            book="all"
            showBookFilter={false}
          />
          <Button variant="outline" asChild>
            <Link href={`/${locale}/admin/payments/transactions`}>
              {t("admin.paymentsOverviewPage.actions.transactions")}
              <ArrowRight className="ms-2 h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => void load()}
            disabled={isLoading}
            aria-label={t("admin.paymentsOverviewPage.actions.refresh")}
          >
            <RefreshCcw
              className={cn("h-4 w-4", isLoading && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-4",
          isMultiVendor
            ? "lg:grid-cols-[1.5fr_1fr_1fr]"
            : "lg:grid-cols-[1.5fr_1fr]",
        )}
      >
        {/* Money that moved, in the period at the top. */}
        <Card className="gap-0 py-6">
          <CardContent className="px-6">
            <p className="text-sm text-muted-foreground">
              {t.has("admin.paymentsOverviewPage.metrics.paidVolume")
                ? t("admin.paymentsOverviewPage.metrics.paidVolume")
                : "Paid order volume"}
            </p>
            {isLoading && !data ? (
              <Skeleton className="mt-2 h-9 w-48" />
            ) : (
              <p className="mt-2 text-[32px] font-semibold leading-9 tracking-tight tabular-nums">
                {money(totals?.paidRevenue || 0)}
              </p>
            )}
            {/* Called "revenue" until it sat in the same nav group as Finance,
                which reports revenue from the ledger and gets a different,
                smaller number. This is every paid order's gross total —
                merchandise plus tax the store only collects, plus, on a
                marketplace, the vendors' share. Naming it volume is what stops
                the two screens contradicting each other. */}
            <p className="mt-1 text-[13px] text-muted-foreground">
              {periodLabel}
            </p>
            <p className="mt-1.5 max-w-[52ch] text-xs text-muted-foreground">
              {t.has("admin.paymentsOverviewPage.metrics.paidVolumeHint")
                ? t("admin.paymentsOverviewPage.metrics.paidVolumeHint")
                : "Gross, including tax — see Finance for revenue"}
            </p>

            <div className="mt-4 border-t pt-3">
              <div className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-sm text-muted-foreground">
                  {t("admin.paymentsOverviewPage.metrics.refundedAmount")}
                  {/* Gross refunds across every transaction, which is not the
                      contra-income figure the profit and loss reports — that
                      one is net of what never reached the platform. Said here
                      so the gap is a stated difference rather than two screens
                      disagreeing. */}
                  <span className="ms-1.5 text-xs">
                    {t.has(
                      "admin.paymentsOverviewPage.metrics.refundedAmountHint",
                    )
                      ? t(
                          "admin.paymentsOverviewPage.metrics.refundedAmountHint",
                        )
                      : "— gross across all transactions"}
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  -{money(totals?.refundedAmount || 0)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-sm font-semibold">
                  {t.has("admin.paymentsOverviewPage.metrics.netCollected")
                    ? t("admin.paymentsOverviewPage.metrics.netCollected")
                    : "Net collected"}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {money(netCollected)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* A balance, not a flow — and only a marketplace has one. */}
        {isMultiVendor ? (
          <Card className="gap-0 py-6">
            <CardContent className="flex h-full flex-col px-6">
              <p className="text-base font-semibold">
                {t.has("admin.paymentsOverviewPage.toVendors")
                  ? t("admin.paymentsOverviewPage.toVendors")
                  : "To vendors"}
              </p>
              {/* A balance, not a flow — it does not move with the period. */}
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t.has("admin.paymentsOverviewPage.asThingsStand")
                  ? t("admin.paymentsOverviewPage.asThingsStand")
                  : "As things stand now"}
              </p>
              <div className="mt-4">
                <p className="text-sm text-muted-foreground">
                  {t("admin.paymentsOverviewPage.metrics.pendingPayoutAmount")}
                </p>
                <p className="mt-1.5 text-[22px] font-semibold leading-7 tracking-tight tabular-nums">
                  {money(totals?.pendingPayoutAmount || 0)}
                </p>
              </div>
              <div className="mt-4 border-t pt-4">
                <p className="text-sm text-muted-foreground">
                  {t("admin.paymentsOverviewPage.metrics.paidPayoutAmount")}
                </p>
                <p className="mt-1.5 text-[22px] font-semibold leading-7 tracking-tight tabular-nums">
                  {money(totals?.paidPayoutAmount || 0)}
                </p>
              </div>
              <Link
                href={`/${locale}/admin/payouts`}
                className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[13px] font-medium text-primary hover:underline"
              >
                {t.has("admin.paymentsOverviewPage.reviewPayouts")
                  ? t("admin.paymentsOverviewPage.reviewPayouts")
                  : "Review payouts"}
                <ArrowRight className="size-3.5" />
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {/* Counts, kept away from the money and given somewhere to go. */}
        <Card className="gap-0 py-6">
          <CardContent className="px-0">
            <p className="px-6 text-base font-semibold">
              {t.has("admin.paymentsOverviewPage.needsLook")
                ? t("admin.paymentsOverviewPage.needsLook")
                : "Needs a look"}
            </p>
            <p className="mt-0.5 px-6 text-[13px] text-muted-foreground">
              {t.has("admin.paymentsOverviewPage.asThingsStand")
                ? t("admin.paymentsOverviewPage.asThingsStand")
                : "As things stand now"}
            </p>
            <div className="mt-2">
              <AttentionRow
                href={`/${locale}/admin/orders?paymentStatus=pending`}
                tone="amber"
                icon={<Clock className="size-4" />}
                title={`${totals?.pendingPayments ?? 0} ${t("admin.paymentsOverviewPage.metrics.pendingPayments")}`}
                hint={
                  t.has("admin.paymentsOverviewPage.pendingHint")
                    ? t("admin.paymentsOverviewPage.pendingHint")
                    : "Started at a gateway, never confirmed"
                }
              />
              <AttentionRow
                href={`/${locale}/admin/orders?paymentStatus=refunded`}
                icon={<RefreshCcw className="size-4" />}
                title={`${totals?.refundedOrders ?? 0} ${t("admin.paymentsOverviewPage.metrics.refundedOrders")}`}
                hint={
                  t.has("admin.paymentsOverviewPage.refundedHint")
                    ? t("admin.paymentsOverviewPage.refundedHint")
                    : "Fully or in part"
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        data={data?.recentTransactions || []}
        columns={recentTransactionsColumns}
        keyField="_id"
        isLoading={isLoading && !data}
        loadingMode="rows"
        loadingRows={5}
        title={t("admin.paymentsOverviewPage.recentTransactions.title")}
        appearance="commerce"
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-sm"
        emptyMessage={t("admin.paymentsOverviewPage.recentTransactions.empty")}
      />
    </div>
  );
}

/** A count with somewhere to go — a number alone is not a thing to do. */
function AttentionRow({
  href,
  icon,
  title,
  hint,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
  tone?: "amber";
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 border-b px-6 py-3 transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          tone === "amber"
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </div>
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
