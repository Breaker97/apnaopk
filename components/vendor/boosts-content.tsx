"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban, Plus, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  type DataTableAction,
  type DataTableColumn,
  type DataTableTab,
} from "@/components/ui/data-table";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { RAZORPAY_RETURN_PARAM } from "@/lib/payments/razorpay-callback";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useCurrencyFormatter } from "@/providers/currency-provider";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { BoostPurchaseDialog } from "@/components/vendor/boost-purchase-dialog";
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
 * Shared by the vendor list, the admin list and the campaign detail page.
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

export function BoostProductCell({ row }: { row: BoostCampaignListRow }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {row.product?.image ? (
        <Image
          src={row.product.image}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 rounded-md object-cover"
        />
      ) : (
        <div className="h-9 w-9 rounded-md bg-muted" />
      )}
      <div className="min-w-0">
        <p className="truncate font-medium">{row.product?.name || "—"}</p>
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
export function BoostWindowCell({
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
 * Vendor boosts list. Verifies a returning `?boost_payment=` redirect once
 * on mount (so the vendor sees the campaign flip to Active even before the
 * webhook lands), then strips the param from the URL.
 */
export function BoostsContent(props: {
  locale: string;
  data: BoostCampaignListRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const label = useFallbackTranslator(t);

  const list = useListNavigation<BoostCampaignListRow>({
    items: props.data,
    pagination: props.pagination,
  });

  const { confirm } = useConfirmation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const verifiedRef = useRef(false);

  /**
   * Withdraw a booking that has not started yet.
   *
   * Deliberately absent on an `active` booking: part of it has already
   * rendered, and self-service on a mid-flight placement turns every
   * disappointing day into a refund dispute. The reason it exists at all is
   * that bookings run up to 60 days out — "email support to cancel" leaves the
   * marketplace sitting on inventory it cannot resell until a human intervenes.
   */
  const cancelBooking = useCallback(
    async (row: BoostCampaignListRow) => {
      const ok = await confirm({
        title: label("boosts.cancel.title", "Cancel this booking?"),
        description: label(
          "boosts.cancel.description",
          "The days go back on sale immediately and someone else can book them. Anything you have paid is credited back to you and refunded through your payment provider.",
        ),
        confirmText: label("boosts.cancel.confirm", "Cancel booking"),
        cancelText: label("common.back", "Back"),
        type: "danger",
      });
      if (!ok) return;
      setCancelingId(row._id);
      try {
        await apiClient.delete(`/api/vendor/boosts/campaigns/${row._id}`);
        toast.success(label("boosts.cancel.done", "Booking canceled"));
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : label("boosts.cancel.failed", "Could not cancel the booking"),
        );
      } finally {
        setCancelingId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, router, t],
  );

  const rowActions = useCallback(
    (row: BoostCampaignListRow): DataTableAction[] =>
      row.status === "scheduled"
        ? [
            {
              id: "cancel",
              label: label("boosts.cancel.action", "Cancel booking"),
              icon: <Ban className="h-4 w-4 text-destructive" />,
              onClick: () => cancelBooking(row),
              variant: "destructive",
              disabled: cancelingId === row._id,
            },
          ]
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cancelBooking, cancelingId, t],
  );

  // Return-from-gateway verification (once).
  useEffect(() => {
    const paymentId = searchParams.get("boost_payment");
    const canceled = searchParams.get("canceled");
    if (!paymentId || verifiedRef.current) return;
    verifiedRef.current = true;

    const cleanUrl = () => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("boost_payment");
      params.delete("canceled");
      params.delete("session_id");
      params.delete("reference");
      params.delete("trxref");
      params.delete("OrderTrackingId");
      params.delete("OrderMerchantReference");
      for (const key of Object.values(RAZORPAY_RETURN_PARAM)) {
        params.delete(key);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    };

    if (canceled) {
      toast.info(
        label("boosts.purchase.canceled", "Payment was canceled. Please try again."),
      );
      cleanUrl();
      return;
    }

    apiClient
      .post<{ paid: boolean }>("/api/vendor/boosts/checkout/verify", {
        paymentId,
        // A Razorpay return carries the signed payment; the route cannot ask
        // Razorpay about this attempt without it.
        razorpayPaymentId:
          searchParams.get(RAZORPAY_RETURN_PARAM.paymentId) ?? undefined,
        razorpaySignature:
          searchParams.get(RAZORPAY_RETURN_PARAM.signature) ?? undefined,
      })
      .then(({ paid }) => {
        if (paid) {
          toast.success(
            // Not "your boost is live": a booking that starts next month is
            // paid and correct, and telling that vendor it is live now is the
            // fastest way to get a ticket saying it isn't.
            label("boosts.purchase.booked", "Your booking is confirmed."),
          );
        } else {
          toast.info(
            label(
              "boosts.purchase.pendingInfo",
              "Payment is still processing — the boost activates automatically once confirmed.",
            ),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        cleanUrl();
        router.refresh();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo<DataTableColumn<BoostCampaignListRow>[]>(
    () => [
      {
        id: "product",
        header: label("boosts.table.product", "Product"),
        cell: (row) => <BoostProductCell row={row} />,
        className: "w-[280px]",
      },
      {
        id: "position",
        header: label("boosts.table.position", "Slot"),
        cell: (row) => (
          <span className="font-semibold">
            #{row.positionSnapshot.position}
          </span>
        ),
        className: "w-[90px]",
      },
      {
        id: "amount",
        header: label("boosts.table.price", "Price"),
        cell: (row) => <RowAmount row={row} />,
        className: "w-[140px]",
      },
      {
        id: "status",
        header: label("boosts.table.status", "Status"),
        cell: (row) => <BoostStatusBadge status={row.status} />,
        className: "w-[130px]",
      },
      {
        id: "window",
        header: label("boosts.table.window", "Runs"),
        cell: (row) => <BoostWindowCell row={row} locale={props.locale} />,
        className: "w-[170px]",
      },
      {
        id: "impressions",
        header: label("boosts.table.impressions", "Impressions"),
        cell: (row) => row.totalImpressions.toLocaleString(),
        className: "w-[110px]",
      },
      {
        id: "clicks",
        header: label("boosts.table.clicks", "Clicks"),
        cell: (row) => row.totalClicks.toLocaleString(),
        className: "w-[90px]",
      },
      {
        id: "ctr",
        header: label("boosts.table.ctr", "CTR"),
        cell: (row) => boostCtr(row),
        className: "w-[80px]",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.locale, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: label("boosts.tabs.all", "All") },
      { id: "scheduled", label: label("boosts.tabs.scheduled", "Upcoming") },
      { id: "active", label: label("boosts.tabs.active", "Active") },
      {
        id: "pending_payment",
        label: label("boosts.tabs.pending", "Pending payment"),
      },
      { id: "paused", label: label("boosts.tabs.paused", "Paused") },
      { id: "expired", label: label("boosts.tabs.expired", "Expired") },
      { id: "canceled", label: label("boosts.tabs.canceled", "Canceled") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: label("boosts.title", "Boosts"),
        addAction: {
          id: "boost-product",
          label: label("boosts.addAction", "Boost a product"),
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
          onClick: () => setDialogOpen(true),
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  return (
    <>
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
        searchPlaceholder={label(
          "boosts.searchPlaceholder",
          "Search by position or label",
        )}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
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
          router.push(`/${props.locale}/vendor/boosts/${row._id}`)
        }
        rowActions={rowActions}
        rowActionsHeader={label("boosts.table.actions", "Actions")}
        rowActionsVariant="inline"
        emptyMessage={label(
          "boosts.empty",
          "No boosts yet. Promote a product to reach more shoppers.",
        )}
        emptyIcon={<Rocket className="h-8 w-8" />}
      />
      <BoostPurchaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        locale={props.locale}
      />
    </>
  );
}

/**
 * Total, with the arithmetic that produced it underneath. A per-day booking
 * whose row shows only a total cannot be audited without opening the detail
 * page — and the total is exactly what a vendor disputes.
 */
export function RowAmount({ row }: { row: BoostCampaignListRow }) {
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
