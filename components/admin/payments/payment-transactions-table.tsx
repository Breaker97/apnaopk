"use client";

import { useCallback, useMemo } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Circle, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
};

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

const TRANSACTION_FILTER_IDS = ["type", "provider"];

export function PaymentTransactionsTable({
  locale,
  data,
  pagination,
}: PaymentTransactionsTableProps) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const router = useRouter();
  const list = useListNavigation<TransactionRow>({
    items: data,
    pagination,
    filterIds: TRANSACTION_FILTER_IDS,
    defaultPageSize: 20,
  });

  // The "statuses" dropdown filter mirrors the active tab.
  const handleStatusChange = useCallback(
    (value: string) => list.handleTabChange(value),
    [list],
  );

  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
      }),
    [locale],
  );

  const translateWithFallback = useCallback(
    (key: string, fallback: string) => {
      try {
        const translated = t(key);
        return translated === key ? fallback : translated;
      } catch {
        return fallback;
      }
    },
    [t],
  );

  const translateType = useCallback(
    (typeValue: string) =>
      translateWithFallback(
        `admin.paymentTransactionsPage.transactionTypes.${toKeyToken(typeValue)}`,
        toReadableLabel(typeValue),
      ),
    [translateWithFallback],
  );

  const translateStatus = useCallback(
    (statusValue: string) =>
      translateWithFallback(
        `admin.paymentTransactionsPage.transactionStatuses.${toKeyToken(statusValue)}`,
        toReadableLabel(statusValue),
      ),
    [translateWithFallback],
  );

  const translateProvider = useCallback(
    (providerValue: string) =>
      translateWithFallback(
        `admin.paymentTransactionsPage.providers.${toKeyToken(providerValue)}`,
        getProviderFallbackLabel(providerValue),
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

  const columns = useMemo<DataTableColumn<TransactionRow>[]>(
    () => [
      {
        id: "order",
        header: t("admin.paymentTransactionsPage.table.columns.order"),
        cell: (row) => (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-blue-600 dark:text-blue-400">
              {row.orderNumber}
            </span>
            {row.externalId && (
              <span className="block max-w-[220px] truncate text-xs text-muted-foreground">
                {row.externalId}
              </span>
            )}
          </div>
        ),
        className: "w-[220px]",
      },
      {
        id: "type",
        header: t("admin.paymentTransactionsPage.table.columns.type"),
        cell: (row) => <TextCell value={translateType(row.type)} />,
        className: "w-[120px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
      },
      {
        id: "status",
        header: t("admin.paymentTransactionsPage.table.columns.status"),
        cell: (row) => (
          <Badge
            variant="outline"
            className={`gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium ${getStatusClasses(row.status)}`}
          >
            <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
            {translateStatus(row.status)}
          </Badge>
        ),
        className: "w-[140px]",
      },
      {
        id: "provider",
        header: t("admin.paymentTransactionsPage.table.columns.provider"),
        cell: (row) => <TextCell value={translateProvider(row.provider)} />,
        className: "w-[140px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
      {
        id: "grossAmount",
        header: t("admin.paymentTransactionsPage.table.columns.gross"),
        cell: (row) => (
          <TextCell
            value={formatPrice(row.grossAmount)}
            className="block w-full text-right font-medium"
          />
        ),
        sortable: true,
        className: "w-[130px] text-right hidden xl:table-cell",
        headerClassName: "text-right [&>div]:justify-end hidden xl:table-cell",
      },
      {
        id: "netAmount",
        header: t("admin.paymentTransactionsPage.table.columns.net"),
        cell: (row) => (
          <TextCell
            value={formatPrice(row.netAmount)}
            className="block w-full text-right font-medium"
          />
        ),
        sortable: true,
        className: "w-[130px] text-right",
        headerClassName: "text-right [&>div]:justify-end",
      },
      {
        id: "createdAt",
        header: t("admin.paymentTransactionsPage.table.columns.date"),
        cell: (row) => (
          <TextCell
            value={formatDateTime(row.createdAt)}
            className="text-muted-foreground"
          />
        ),
        sortable: true,
        className: "w-[220px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
    ],
    [formatDateTime, formatPrice, t, translateProvider, translateStatus, translateType],
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
    ],
    [locale, t],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">
          {t("admin.paymentTransactionsPage.title")}
        </h1>
        <p className="text-muted-foreground">
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
        rowActionsHeader={t("admin.paymentTransactionsPage.table.columns.details")}
        rowActionsVariant="split"
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-sm"
        onRowClick={(row) => router.push(getOrderHref(row, locale))}
        emptyMessage={t("admin.paymentTransactionsPage.table.empty")}
      />
    </div>
  );
}
