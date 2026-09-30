"use client";

import { useCallback, useMemo, useState } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "@/hooks/use-locale-navigation";
import { Ban, Circle, Clock3, Eye, HandCoins } from "lucide-react";
import Link from "@/components/language/link";
import { Badge } from "@/components/ui/badge";
import {
  InputDialog,
  type InputDialogField,
  type InputDialogValues,
} from "@/components/ui/input-dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/providers/currency-provider";
import {
  DataTable,
  TextCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type TransactionRow = {
  _id: string;
  orderId?: string | { _id?: string };
  orderNumber: string;
  type: string;
  status: string;
  provider: string;
  paymentMethod?: string;
  grossAmount: number;
  netAmount: number;
  currency: string;
  externalId?: string;
  createdAt: string;
  /** Why the gateway said no — normalized, and in the gateway's own words. */
  failureCode?: string;
  gatewayCode?: string;
  gatewayMessage?: string;
  /** Who was trying to pay, on a row that has no order to name them. */
  customerEmail?: string;
  clientIp?: string;
  metadata?: {
    settlement?: {
      required?: boolean;
      settledAt?: string | null;
      /** Cancelled before anybody sent it. */
      voidedAt?: string | null;
      /** The part sellers hold the cash for — theirs to send, not the store's. */
      owedBySellers?: Array<{ vendorId?: string; amount?: number }> | null;
    } | null;
  } | null;
};

/** A hand refund whose whole amount a seller took at the door, and sends. */
function isOwedBySellers(row: TransactionRow) {
  const owed = (row.metadata?.settlement?.owedBySellers || []).reduce(
    (sum, share) => sum + Math.max(0, Number(share?.amount) || 0),
    0,
  );
  return owed > 0 && owed >= Math.abs(Number(row.grossAmount || 0)) - 0.01;
}

/** A refund no gateway sent, still waiting for someone to record sending it. */
function isAwaitingSettlement(row: TransactionRow) {
  const settlement = row.metadata?.settlement;
  return Boolean(
    settlement?.required &&
      !settlement.settledAt &&
      !settlement.voidedAt &&
      row.status === "succeeded",
  );
}

/** A hand refund cancelled before it was sent — not a refund that failed. */
function isVoidedRefund(row: TransactionRow) {
  return Boolean(row.metadata?.settlement?.voidedAt);
}

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

const PROVIDER_FALLBACK_LABELS: Record<string, string> = {
  stripe: "Stripe",
  paypal: "PayPal",
  razorpay: "Razorpay",
  paystack: "Paystack",
  pesapal: "Pesapal",
  iotec: "ioTec Pay",
  orange_money: "Orange Money",
  mtn_momo: "MTN Mobile Money",
  cod: "Cash on Delivery",
  cash: "Cash",
  manual: "Manual",
  manual_pending: "Manual (Pending)",
  pos: "POS",
  pos_card: "POS Card",
  pos_cash: "POS Cash",
  pos_bank: "POS Bank",
  pos_manual: "POS Manual",
  store_credit: "Store credit",
};

const PROVIDER_FILTER_OPTIONS = [
  "stripe",
  "paypal",
  "razorpay",
  "paystack",
  "pesapal",
  "iotec",
  "orange_money",
  "mtn_momo",
  "cod",
  "cash",
  "manual",
  "pos_card",
  "pos_cash",
  "pos_bank",
  "pos_manual",
  "store_credit",
] as const;

function getProviderFallbackLabel(providerValue: string) {
  const key = toKeyToken(providerValue);
  return PROVIDER_FALLBACK_LABELS[key] || toReadableLabel(providerValue);
}

function getOrderId(row: TransactionRow) {
  if (!row.orderId) return null;
  if (typeof row.orderId === "string") return row.orderId;
  return row.orderId._id || null;
}

function getOrderHref(row: TransactionRow, locale: string) {
  const orderId = getOrderId(row);
  if (orderId) return `/${locale}/admin/orders/${orderId}`;
  return `/${locale}/admin/orders?search=${encodeURIComponent(row.orderNumber)}`;
}

function getStatusClasses(status: string) {
  const map: Record<string, string> = {
    succeeded:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    pending:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    failed:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
    cancelled:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
  };
  return map[status] || map.pending;
}

interface PaymentTransactionsTableProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: TransactionRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const TRANSACTION_FILTER_IDS = ["type", "provider", "settlement"];

export function PaymentTransactionsTable({
  locale,
  data,
  pagination,
}: PaymentTransactionsTableProps) {
  const t = useTranslations();
  // New keys land in en and bn; every other locale takes the English
  // sentence rather than an empty cell.
  const tr = useFallbackTranslator(t);
  const { formatPrice } = useCurrency();
  const router = useRouter();
  const list = useListNavigation<TransactionRow>({
    items: data,
    pagination,
    filterIds: TRANSACTION_FILTER_IDS,
    defaultPageSize: 20,
  });

  const [settlingRow, setSettlingRow] = useState<TransactionRow | null>(null);
  const [settlementValues, setSettlementValues] = useState<InputDialogValues>({});
  const [isSettling, setIsSettling] = useState(false);
  const [voidingRow, setVoidingRow] = useState<TransactionRow | null>(null);
  const [voidValues, setVoidValues] = useState<InputDialogValues>({});
  const [isVoiding, setIsVoiding] = useState(false);

  // A hand refund recorded by mistake and never sent: undone in full — the
  // order's refunded total, the books, the seller's payable, the points —
  // and a return it was for is open again.
  const voidRefund = useCallback(
    async (values: InputDialogValues) => {
      if (!voidingRow) return;
      setIsVoiding(true);
      try {
        await apiClient.patch(`/api/admin/payments/transactions/${voidingRow._id}`, {
          action: "void",
          reason: values.reason?.trim() || undefined,
        });
        toast.success(
          tr("admin.paymentTransactionsPage.settlement.voided", "Refund cancelled"),
        );
        setVoidingRow(null);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "The refund could not be cancelled",
        );
      } finally {
        setIsVoiding(false);
      }
    },
    [router, tr, voidingRow],
  );

  const recordSettlement = useCallback(
    async (values: InputDialogValues) => {
      if (!settlingRow) return;
      setIsSettling(true);
      try {
        await apiClient.patch(`/api/admin/payments/transactions/${settlingRow._id}`, {
          action: "settle",
          method: values.method?.trim(),
          reference: values.reference?.trim() || undefined,
          note: values.note?.trim() || undefined,
        });
        toast.success(
          t.has("admin.paymentTransactionsPage.settlement.recorded")
            ? t("admin.paymentTransactionsPage.settlement.recorded")
            : "Refund recorded as sent",
        );
        setSettlingRow(null);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "The refund could not be recorded",
        );
      } finally {
        setIsSettling(false);
      }
    },
    [router, settlingRow, t],
  );

  const settlementFields = useMemo<InputDialogField[]>(
    () => [
      {
        name: "method",
        label: t.has("admin.paymentTransactionsPage.settlement.method")
          ? t("admin.paymentTransactionsPage.settlement.method")
          : "How it was sent",
        placeholder: "Bank transfer, mobile money, cash, gateway…",
        required: true,
      },
      {
        name: "reference",
        label: t.has("admin.paymentTransactionsPage.settlement.reference")
          ? t("admin.paymentTransactionsPage.settlement.reference")
          : "Reference",
        placeholder: "Transfer or receipt reference",
      },
      {
        name: "note",
        label: t.has("admin.paymentTransactionsPage.settlement.note")
          ? t("admin.paymentTransactionsPage.settlement.note")
          : "Note",
        multiline: true,
        rows: 3,
      },
    ],
    [t],
  );

  // The "statuses" dropdown filter mirrors the active tab.
  const handleStatusChange = useCallback(
    (value: string) => list.handleTabChange(value),
    [list],
  );

  // The cell shows minutes so the column stays narrow; the seconds are in its
  // tooltip for matching a row against a gateway dashboard.
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );
  const fullDateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    [locale],
  );

  const awaitingSettlementLabel = t.has(
    "admin.paymentTransactionsPage.settlement.awaiting",
  )
    ? t("admin.paymentTransactionsPage.settlement.awaiting")
    : "Awaiting settlement";
  const sellerSendsLabel = t.has("admin.paymentTransactionsPage.settlement.sellerSends")
    ? t("admin.paymentTransactionsPage.settlement.sellerSends")
    : "Seller sends it";

  // Most pages hold no refused payment, and a column of dashes only pushed
  // the actions off the right edge.
  const hasFailureReasons = useMemo(
    () => list.items.some((row) => Boolean(row.failureCode)),
    [list.items],
  );

  // `tr` checks the key first: calling `t` on a missing one (a provider such
  // as mtn_momo with no string yet) logged a MISSING_MESSAGE before the
  // fallback ever applied.
  const translateType = useCallback(
    (typeValue: string) =>
      tr(
        `admin.paymentTransactionsPage.transactionTypes.${toKeyToken(typeValue)}`,
        toReadableLabel(typeValue),
      ),
    [tr],
  );

  const translateStatus = useCallback(
    (statusValue: string) =>
      tr(
        `admin.paymentTransactionsPage.transactionStatuses.${toKeyToken(statusValue)}`,
        toReadableLabel(statusValue),
      ),
    [tr],
  );

  const translateProvider = useCallback(
    (providerValue: string) =>
      tr(
        `admin.paymentTransactionsPage.providers.${toKeyToken(providerValue)}`,
        getProviderFallbackLabel(providerValue),
      ),
    [tr],
  );

  const formatDateTime = useCallback(
    (value: string, full = false) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return (full ? fullDateTimeFormatter : dateTimeFormatter).format(date);
    },
    [dateTimeFormatter, fullDateTimeFormatter],
  );

  const columns = useMemo<DataTableColumn<TransactionRow>[]>(
    () => [
      {
        id: "order",
        header: t("admin.paymentTransactionsPage.table.columns.order"),
        cell: (row) => {
          // A refused payment has no order to name — it never got that far
          // — so the shopper who was trying is what identifies the row.
          const label = row.orderNumber || row.customerEmail || "—";
          const reference = row.externalId || row.clientIp;
          return (
            <div className="min-w-0">
              {row.orderNumber ? (
                <Link
                  href={getOrderHref(row, locale)}
                  onClick={(event) => event.stopPropagation()}
                  className="block max-w-[170px] truncate font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  {label}
                </Link>
              ) : (
                <span
                  className="block max-w-[170px] truncate font-semibold text-blue-600 dark:text-blue-400"
                  title={label}
                >
                  {label}
                </span>
              )}
              {reference && (
                <span
                  className="block max-w-[170px] truncate text-xs text-muted-foreground"
                  title={reference}
                >
                  {reference}
                </span>
              )}
            </div>
          );
        },
        className: "w-[200px]",
      },
      {
        id: "type",
        header: t("admin.paymentTransactionsPage.table.columns.type"),
        cell: (row) => <TextCell value={translateType(row.type)} />,
        className: "w-[100px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
      },
      {
        id: "status",
        header: t("admin.paymentTransactionsPage.table.columns.status"),
        cell: (row) => {
          // A refund no gateway sent is not done until someone sends the
          // money, so it reads as that one state rather than a green
          // "Succeeded" with a note hanging under it.
          const awaiting = isAwaitingSettlement(row);
          return (
            <Badge
              variant="outline"
              className={`gap-1.5 whitespace-nowrap rounded-sm px-2 py-1 text-[12px] font-medium ${getStatusClasses(awaiting ? "pending" : row.status)}`}
            >
              {awaiting ? (
                <Clock3 className="h-3.5 w-3.5" />
              ) : (
                <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
              )}
              {awaiting
                ? isOwedBySellers(row)
                  ? sellerSendsLabel
                  : awaitingSettlementLabel
                : isVoidedRefund(row)
                  ? tr("admin.paymentTransactionsPage.settlement.voidedBadge", "Cancelled")
                  : translateStatus(row.status)}
            </Badge>
          );
        },
        className: "w-[170px]",
      },
      {
        id: "reason",
        header: tr(
          "admin.paymentTransactionsPage.table.columns.reason",
          "Why it failed",
        ),
        cell: (row) => {
          if (!row.failureCode) return <TextCell value="—" />;
          return (
            <div className="min-w-0">
              {/* The normalized code first, because it is what a merchant
                  counts by; the gateway's own sentence beneath it, because it
                  is what they read back to the shopper or to support. */}
              <span className="block truncate font-mono text-xs font-medium text-rose-600 dark:text-rose-400">
                {tr(
                  `admin.paymentTransactionsPage.failureCodes.${row.failureCode}`,
                  row.failureCode.replace(/_/g, " "),
                )}
              </span>
              {(row.gatewayMessage || row.gatewayCode) && (
                <span
                  className="block max-w-[200px] truncate text-xs text-muted-foreground"
                  title={row.gatewayMessage || row.gatewayCode}
                >
                  {row.gatewayMessage || row.gatewayCode}
                </span>
              )}
            </div>
          );
        },
        hidden: !hasFailureReasons,
        className: "w-[240px] hidden lg:table-cell",
      },
      {
        id: "provider",
        header: t("admin.paymentTransactionsPage.table.columns.provider"),
        cell: (row) => (
          <TextCell
            value={translateProvider(row.provider)}
            className="whitespace-nowrap"
          />
        ),
        className: "w-[150px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
      {
        id: "grossAmount",
        header: t("admin.paymentTransactionsPage.table.columns.gross"),
        cell: (row) => (
          <TextCell
            value={formatPrice(row.grossAmount)}
            className="block w-full whitespace-nowrap text-right font-medium"
          />
        ),
        sortable: true,
        className: "w-[120px] text-right hidden xl:table-cell",
        headerClassName: "text-right [&>div]:justify-end hidden xl:table-cell",
      },
      {
        id: "netAmount",
        header: t("admin.paymentTransactionsPage.table.columns.net"),
        cell: (row) => (
          <TextCell
            value={formatPrice(row.netAmount)}
            className="block w-full whitespace-nowrap text-right font-medium"
          />
        ),
        sortable: true,
        className: "w-[120px] text-right",
        headerClassName: "text-right [&>div]:justify-end",
      },
      {
        id: "createdAt",
        header: t("admin.paymentTransactionsPage.table.columns.date"),
        cell: (row) => (
          <span
            className="whitespace-nowrap text-muted-foreground"
            title={formatDateTime(row.createdAt, true)}
          >
            {formatDateTime(row.createdAt)}
          </span>
        ),
        sortable: true,
        className: "w-[180px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
    ],
    [
      awaitingSettlementLabel,
      sellerSendsLabel,
      formatDateTime,
      formatPrice,
      hasFailureReasons,
      locale,
      t,
      translateProvider,
      translateStatus,
      translateType,
      tr,
    ],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      {
        id: "all",
        label: t("admin.ordersPage.tabs.all"),
      },
      {
        id: "succeeded",
        label: t("admin.paymentTransactionsPage.transactionStatuses.succeeded"),
      },
      {
        id: "pending",
        label: t("admin.paymentTransactionsPage.transactionStatuses.pending"),
      },
      {
        id: "failed",
        label: t("admin.paymentTransactionsPage.transactionStatuses.failed"),
      },
      {
        id: "cancelled",
        label: t("admin.paymentTransactionsPage.transactionStatuses.cancelled"),
      },
    ],
    [t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "statuses",
        label: t("admin.paymentTransactionsPage.table.columns.status"),
        type: "select",
        options: [
          {
            label: t("admin.paymentTransactionsPage.filters.allStatuses"),
            value: "all",
          },
          {
            label: t("admin.paymentTransactionsPage.transactionStatuses.succeeded"),
            value: "succeeded",
          },
          {
            label: t("admin.paymentTransactionsPage.transactionStatuses.pending"),
            value: "pending",
          },
          {
            label: t("admin.paymentTransactionsPage.transactionStatuses.failed"),
            value: "failed",
          },
          {
            label: t("admin.paymentTransactionsPage.transactionStatuses.cancelled"),
            value: "cancelled",
          },
        ],
      },
      {
        id: "type",
        label: t("admin.paymentTransactionsPage.table.columns.type"),
        type: "select",
        options: [
          {
            label: t("admin.paymentTransactionsPage.filters.allTypes"),
            value: "all",
          },
          {
            label: t("admin.paymentTransactionsPage.transactionTypes.charge"),
            value: "charge",
          },
          {
            label: t("admin.paymentTransactionsPage.transactionTypes.refund"),
            value: "refund",
          },
          {
            label: t("admin.paymentTransactionsPage.transactionTypes.adjustment"),
            value: "adjustment",
          },
        ],
      },
      {
        // Refunds no gateway sent, still waiting for someone to send them.
        id: "settlement",
        label: t.has("admin.paymentTransactionsPage.settlement.filter")
          ? t("admin.paymentTransactionsPage.settlement.filter")
          : "Settlement",
        type: "select",
        options: [
          {
            label: t.has("admin.paymentTransactionsPage.settlement.all")
              ? t("admin.paymentTransactionsPage.settlement.all")
              : "All",
            value: "all",
          },
          {
            label: t.has("admin.paymentTransactionsPage.settlement.awaiting")
              ? t("admin.paymentTransactionsPage.settlement.awaiting")
              : "Awaiting settlement",
            value: "pending",
          },
        ],
      },
      {
        id: "provider",
        label: t("admin.paymentTransactionsPage.table.columns.provider"),
        type: "select",
        options: [
          {
            label: t("admin.paymentTransactionsPage.filters.allProviders"),
            value: "all",
          },
          ...PROVIDER_FILTER_OPTIONS.map((provider) => ({
            label: translateProvider(provider),
            value: provider,
          })),
        ],
      },
    ],
    [t, translateProvider],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.sidebar.transactions"),
      }),
    [t],
  );

  const rowActions = useCallback(
    (row: TransactionRow): DataTableAction[] => [
      {
        id: "view-order",
        label: t("admin.paymentTransactionsPage.table.viewOrder"),
        icon: <Eye className="h-4 w-4" />,
        href: getOrderHref(row, locale),
      },
      ...(isAwaitingSettlement(row)
        ? [
            {
              id: "record-settlement",
              label: t.has("admin.paymentTransactionsPage.settlement.record")
                ? t("admin.paymentTransactionsPage.settlement.record")
                : "Record refund sent",
              icon: <HandCoins className="h-4 w-4" />,
              onClick: () => {
                setSettlementValues({});
                setSettlingRow(row);
              },
            },
          ]
        : []),
      // The store's own hand refunds only: a seller's is theirs to send.
      ...(isAwaitingSettlement(row) && !isOwedBySellers(row)
        ? [
            {
              id: "void-refund",
              label: tr(
                "admin.paymentTransactionsPage.settlement.void",
                "Cancel refund (not sent)",
              ),
              icon: <Ban className="h-4 w-4" />,
              onClick: () => {
                setVoidValues({});
                setVoidingRow(row);
              },
            },
          ]
        : []),
    ],
    [locale, t, tr],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("admin.paymentTransactionsPage.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("admin.paymentTransactionsPage.subtitle")}
        </p>
      </div>

      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        isLoading={list.isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={handleStatusChange}
        searchable
        searchPlaceholder={t("admin.paymentTransactionsPage.filters.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={{ ...list.filters, statuses: list.activeTab }}
        onFilterChange={(filterId, value) => {
          if (filterId === "statuses") {
            handleStatusChange(value);
            return;
          }
          list.handleFilterChange(filterId, value);
        }}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        rowActions={rowActions}
        rowActionsHeader={tr("common.actions", "Actions")}
        // One ⋮ on every row, as on Orders: the split "View Order" button
        // grew a menu only on refunds awaiting settlement, which knocked
        // that row's button out of line with the rest.
        rowActionsVariant="dropdown"
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-xs"
        onRowClick={(row) => router.push(getOrderHref(row, locale))}
        emptyMessage={t("admin.paymentTransactionsPage.table.empty")}
      />

      <InputDialog
        open={Boolean(settlingRow)}
        onOpenChange={(open) => {
          if (!open) setSettlingRow(null);
        }}
        title={
          t.has("admin.paymentTransactionsPage.settlement.record")
            ? t("admin.paymentTransactionsPage.settlement.record")
            : "Record refund sent"
        }
        description={
          settlingRow
            ? `${settlingRow.orderNumber} · ${formatPrice(settlingRow.grossAmount)}`
            : undefined
        }
        fields={settlementFields}
        values={settlementValues}
        onValuesChange={setSettlementValues}
        onSubmit={(values) => void recordSettlement(values)}
        submitText={
          t.has("admin.paymentTransactionsPage.settlement.submit")
            ? t("admin.paymentTransactionsPage.settlement.submit")
            : "Record"
        }
        loading={isSettling}
      />

      <InputDialog
        open={Boolean(voidingRow)}
        onOpenChange={(open) => {
          if (!open) setVoidingRow(null);
        }}
        title={tr("admin.paymentTransactionsPage.settlement.void", "Cancel refund (not sent)")}
        description={
          voidingRow
            ? `${voidingRow.orderNumber} · ${formatPrice(voidingRow.grossAmount)} — ${tr(
                "admin.paymentTransactionsPage.settlement.voidDescription",
                "Only for a refund nobody has sent. The order stops showing it as refunded, and a return it was for is open again.",
              )}`
            : undefined
        }
        fields={[
          {
            name: "reason",
            label: tr("admin.paymentTransactionsPage.settlement.voidReason", "Why"),
            multiline: true,
            rows: 3,
          },
        ]}
        values={voidValues}
        onValuesChange={setVoidValues}
        onSubmit={(values) => void voidRefund(values)}
        submitText={tr("admin.paymentTransactionsPage.settlement.voidSubmit", "Cancel refund")}
        loading={isVoiding}
      />
    </div>
  );
}
