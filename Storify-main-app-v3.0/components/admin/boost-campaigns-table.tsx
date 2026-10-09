"use client";

import { useMemo } from "react";
import Image from "next/image";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Plus, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  TextCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { BOOST_CREDIT_OWED_TAB } from "@/config/app.config";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

const STATUS_VARIANTS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  // Blue reads as upcoming — distinct from amber "waiting on you" and green
  // "running right now", which is exactly the distinction a booking made six
  // weeks in advance depends on.
  scheduled: "bg-blue-100 text-blue-800",
  pending_payment: "bg-amber-100 text-amber-800",
  paused: "bg-slate-100 text-slate-700",
  expired: "bg-slate-100 text-slate-500",
  canceled: "bg-red-100 text-red-700",
};

/**
 * "12 – 18 Sep" for a booking's own UTC days.
 *
 * Formats the DAY STRINGS with `timeZone: "UTC"`, never the instants: a range
 * starting 2026-09-12T00:00Z rendered in browser-local time prints "11 Sep" for
 * everyone west of Greenwich, on a value the vendor is billed for.
 *
 * Shared by the bookings list (admin and vendor) and the campaign detail page.
 */
export function formatBoostWindow(row: BoostCampaignListRow, locale: string) {
  if (!row.startDay || !row.endDay) return "—";
  const fmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const from = fmt.format(new Date(`${row.startDay}T00:00:00.000Z`));
  if (row.startDay === row.endDay) return from;
  return `${from} – ${fmt.format(new Date(`${row.endDay}T00:00:00.000Z`))}`;
}

export function boostCtr(row: BoostCampaignListRow) {
  if (!row.totalImpressions) return "—";
  // Clamped: impressions are deduped per session while clicks are per
  // pageview, so a shopper who returns and clicks again can legitimately
  // outnumber their own impressions. "150% CTR" reads as a broken report
  // rather than as engagement.
  const ratio = Math.min(1, row.totalClicks / row.totalImpressions);
  return `${(ratio * 100).toFixed(1)}%`;
}

export function BoostStatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  const key = `boosts.status.${status}`;
  return (
    <Badge
      variant="secondary"
      className={STATUS_VARIANTS[status] || ""}
    >
      {t.has(key) ? t(key) : status.replace(/_/g, " ")}
    </Badge>
  );
}

function BoostProductCell({
  row,
  className,
}: {
  row: BoostCampaignListRow;
  /** A width cap from the table; the name ends in an ellipsis inside it. */
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      {row.product?.image ? (
        <Image
          src={row.product.image}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-md object-cover"
        />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded-md bg-muted" />
      )}
      <div className="min-w-0">
        <p className="truncate font-medium" title={row.product?.name}>
          {row.product?.name || "—"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          #{row.positionSnapshot.position} · {row.positionSnapshot.label}
        </p>
      </div>
    </div>
  );
}

/**
 * "Starts in 6 days · 12 – 18 Sep" for a booking that has not opened yet.
 *
 * A scheduled row showing only its dates reads as an error to a vendor who just
 * paid — the countdown is what makes "nothing is live" the expected answer.
 */
function BoostWindowCell({
  row,
  locale,
}: {
  row: BoostCampaignListRow;
  locale: string;
}) {
  const t = useTranslations();
  const window = formatBoostWindow(row, locale);
  if (row.status !== "scheduled" || !row.startDay) return <span>{window}</span>;

  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round(
    (Date.parse(`${row.startDay}T00:00:00.000Z`) -
      Date.parse(`${today}T00:00:00.000Z`)) /
      86_400_000,
  );
  const key = "boosts.table.startsIn";
  const startsIn =
    days <= 0
      ? t.has("boosts.table.startsToday")
        ? t("boosts.table.startsToday")
        : "Starts today"
      : t.has(key)
        ? t(key, { days })
        : `Starts in ${days} days`;

  return (
    <span className="block leading-tight">
      <span className="block text-xs font-medium">{startsIn}</span>
      <span className="block text-xs text-muted-foreground">{window}</span>
    </span>
  );
}

/**
 * Total, with the arithmetic that produced it underneath. A per-day booking
 * whose row shows only a total cannot be audited without opening the detail
 * page — and the total is exactly what a vendor disputes.
 */
function RowAmount({ row }: { row: BoostCampaignListRow }) {
  const formatPrice = useCurrencyFormatter(row.currency);
  return (
    <span className="block leading-tight">
      <span className="block font-medium">{formatPrice(row.amount)}</span>
      {row.billedDays > 0 ? (
        <span className="block text-xs text-muted-foreground">
          {formatPrice(row.positionSnapshot.pricePerDay)} × {row.billedDays}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Money owed and not yet sent, in the currency the booking was charged in.
 *
 * It is a column rather than a detail-page line because it is a queue: an
 * obligation sits here until a human settles it at the gateway, and a list that
 * does not show it is a list nobody can work through.
 */
function RowCredit({ row }: { row: BoostCampaignListRow }) {
  const formatPrice = useCurrencyFormatter(row.currency);
  if (!(row.refundableAmount > 0)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
      {formatPrice(row.refundableAmount)}
    </span>
  );
}

/**
 * Cancel reasons that mean MONEY WAS TAKEN and nothing ran. Everything else is
 * an ordinary end to a booking; these three are a queue item, so they are
 * called out rather than folded into a grey "canceled" badge.
 */
const MONEY_AT_RISK_REASONS = new Set([
  "fulfilment_refused",
  "slot_resold",
  "payment_reversed",
]);

const CANCEL_REASON_TEXT: Record<string, string> = {
  admin: "Cancelled by admin",
  vendor: "Withdrawn by vendor",
  checkout_expired: "Checkout expired",
  checkout_abandoned: "Checkout abandoned",
  product_deleted: "Product deleted",
  product_unavailable: "Product unavailable",
  vendor_inactive: "Store inactive",
  payment_reversed: "Payment reversed",
  hold_expired: "Hold expired",
  slot_resold: "Slot resold before payment landed",
  fulfilment_refused: "Paid, never fulfilled",
};

function RowStatus({ row }: { row: BoostCampaignListRow }) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const reason = row.cancelReason;
  if (!reason) return <BoostStatusBadge status={row.status} />;

  const atRisk = MONEY_AT_RISK_REASONS.has(reason);
  return (
    <div className="flex flex-col items-start gap-1">
      <BoostStatusBadge status={row.status} />
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] leading-tight",
          atRisk ? "font-medium text-destructive" : "text-muted-foreground",
        )}
      >
        {atRisk ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
        {label(
          `boosts.cancelReason.${reason}`,
          CANCEL_REASON_TEXT[reason] ?? reason.replace(/_/g, " "),
        )}
      </span>
    </div>
  );
}

/**
 * The boost bookings list, for the admin and for a vendor.
 *
 * One table rather than a copy per area: the vendor's own copy kept 15px type
 * and an uncapped product name after the admin list was sized like Orders, so a
 * long product title pushed it sideways. `area` decides what only one side
 * sees. The seller column and filter, the credit owed column and tab, and the
 * cancel reasons are the admin's; clicks per booking are the vendor's.
 */
export function BoostCampaignsTable(props: {
  area: "admin" | "vendor";
  locale: string;
  data: BoostCampaignListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** The header button: an offline booking (admin) or a checkout (vendor). */
  onAdd: () => void;
  rowActions: (row: BoostCampaignListRow) => DataTableAction[];
  /** Admin only: sellers that hold at least one booking, for the vendor filter. */
  vendorOptions?: Array<{ value: string; label: string }>;
  /** Ladder rungs, for the position filter the ladder's "View bookings" sets. */
  positionOptions?: Array<{ value: string; label: string }>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const label = useFallbackTranslator(t);
  const isAdmin = props.area === "admin";

  const list = useListNavigation<BoostCampaignListRow>({
    items: props.data,
    pagination: props.pagination,
    filterIds: ["vendor", "position"],
  });

  const columns = useMemo<DataTableColumn<BoostCampaignListRow>[]>(
    () => [
      {
        id: "product",
        header: label("boosts.table.product", "Product"),
        // Capped like the Orders list's product column: a long title ends in
        // an ellipsis instead of pushing the table sideways.
        cell: (row) => <BoostProductCell row={row} className="max-w-[260px]" />,
        className: "w-[240px]",
      },
      {
        id: "position",
        header: label("boosts.table.position", "Slot"),
        cell: (row) => (
          <span className="font-semibold">
            #{row.positionSnapshot.position}
          </span>
        ),
        className: "w-[70px]",
        sortable: true,
      },
      {
        id: "vendor",
        header: label("boosts.table.vendor", "Vendor"),
        cell: (row) => (
          <TextCell value={row.vendor?.storeName} truncate maxWidth="160px" />
        ),
        className: "w-[150px]",
        // A vendor's list is one store, so the column would repeat their name.
        hidden: !isAdmin,
      },
      {
        id: "amount",
        header: label("boosts.table.price", "Price"),
        cell: (row) => <RowAmount row={row} />,
        className: "w-[130px]",
        sortable: true,
      },
      {
        // Money the marketplace owes and has not sent. It was fetched on every
        // row already and drawn nowhere — the only trace of an obligation was
        // a "Mark refunded" item inside a menu nobody opens on a settled row.
        id: "credit",
        header: label("boosts.table.credit", "Credit owed"),
        cell: (row) => <RowCredit row={row} />,
        className: "w-[120px]",
        sortable: true,
        hidden: !isAdmin,
      },
      {
        id: "status",
        header: label("boosts.table.status", "Status"),
        cell: (row) =>
          isAdmin ? (
            <RowStatus row={row} />
          ) : (
            <BoostStatusBadge status={row.status} />
          ),
        className: "w-[150px]",
        sortable: true,
      },
      {
        id: "window",
        header: label("boosts.table.window", "Runs"),
        cell: (row) => <BoostWindowCell row={row} locale={props.locale} />,
        className: "w-[160px]",
      },
      {
        id: "impressions",
        header: label("boosts.table.impressions", "Impressions"),
        cell: (row) => row.totalImpressions.toLocaleString(),
        className: "hidden w-[110px] xl:table-cell",
        headerClassName: "hidden xl:table-cell",
        sortable: true,
      },
      {
        // One breakpoint later than impressions and CTR, which already imply
        // it: at 1280px the extra column pushed the vendor list sideways.
        id: "clicks",
        header: label("boosts.table.clicks", "Clicks"),
        cell: (row) => row.totalClicks.toLocaleString(),
        className: "hidden w-[90px] 2xl:table-cell",
        headerClassName: "hidden 2xl:table-cell",
        hidden: isAdmin,
      },
      {
        id: "ctr",
        header: label("boosts.table.ctr", "CTR"),
        cell: (row) => boostCtr(row),
        className: "hidden w-[80px] xl:table-cell",
        headerClassName: "hidden xl:table-cell",
      },
    ],
    [isAdmin, label, props.locale],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: label("boosts.tabs.all", "All") },
      { id: "scheduled", label: label("boosts.tabs.scheduled", "Upcoming") },
      { id: "active", label: label("boosts.tabs.active", "Active") },
      { id: "paused", label: label("boosts.tabs.paused", "Paused") },
      {
        id: "pending_payment",
        label: label("boosts.tabs.pending", "Pending payment"),
      },
      { id: "expired", label: label("boosts.tabs.expired", "Expired") },
      { id: "canceled", label: label("boosts.tabs.canceled", "Canceled") },
      // Not a status: a credit outlives the booking that created it, so most
      // of this queue sits on cancelled and expired rows where no status tab
      // would ever surface it.
      ...(isAdmin
        ? [
            {
              id: BOOST_CREDIT_OWED_TAB,
              label: label("boosts.tabs.creditOwed", "Credit owed"),
            },
          ]
        : []),
    ],
    [isAdmin, label],
  );

  const filters = useMemo<DataTableFilter[]>(() => {
    const vendorOptions = isAdmin ? (props.vendorOptions ?? []) : [];
    const positionOptions = props.positionOptions ?? [];
    return [
      ...(vendorOptions.length > 0
        ? [
            {
              id: "vendor",
              label: label("boosts.table.vendor", "Vendor"),
              type: "select" as const,
              options: [
                { label: label("boosts.filters.allVendors", "All vendors"), value: "all" },
                ...vendorOptions,
              ],
            },
          ]
        : []),
      ...(positionOptions.length > 0
        ? [
            {
              id: "position",
              label: label("boosts.table.position", "Slot"),
              type: "select" as const,
              options: [
                {
                  label: label("boosts.filters.allPositions", "All positions"),
                  value: "all",
                },
                ...positionOptions,
              ],
            },
          ]
        : []),
    ];
  }, [isAdmin, label, props.vendorOptions, props.positionOptions]);

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: isAdmin
          ? label("boosts.admin.title", "Boost campaigns")
          : label("boosts.title", "Boosts"),
        addAction: {
          id: isAdmin ? "create-boost" : "boost-product",
          label: isAdmin
            ? label("boosts.admin.create", "Create booking")
            : label("boosts.addAction", "Boost a product"),
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
          onClick: props.onAdd,
        },
      }),
    [isAdmin, label, props.onAdd],
  );

  return (
    <DataTable
      data={list.items}
      columns={columns}
      keyField="_id"
      isLoading={list.isLoading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={list.activeTab}
      onTabChange={list.handleTabChange}
      actions={tableHeader.actions}
      searchable
      searchPlaceholder={
        isAdmin
          ? label(
              "boosts.admin.searchPlaceholder",
              "Search store, product, position or label",
            )
          : label(
              "boosts.searchPlaceholder",
              "Search product, position or label",
            )
      }
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      filters={filters}
      filterValues={list.filters}
      onFilterChange={list.handleFilterChange}
      sortColumn={list.sortBy}
      sortDirection={list.sortOrder}
      onSortChange={list.handleSortChange}
      toolbarActions={tableHeader.toolbarActions}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      appearance={tableHeader.appearance}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
      pagination={list.pagination}
      onPageChange={list.handlePageChange}
      onPageSizeChange={list.handlePageSizeChange}
      onRowClick={(row) =>
        router.push(`/${props.locale}/${props.area}/boosts/${row._id}`)
      }
      rowActions={props.rowActions}
      rowActionsHeader={label("boosts.table.actions", "Actions")}
      rowActionsVariant="inline"
      emptyMessage={
        isAdmin
          ? label("boosts.admin.empty", "No boost campaigns yet")
          : label(
              "boosts.empty",
              "No boosts yet. Promote a product to reach more shoppers.",
            )
      }
      emptyIcon={<Rocket className="h-8 w-8" />}
      className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-xs"
    />
  );
}
