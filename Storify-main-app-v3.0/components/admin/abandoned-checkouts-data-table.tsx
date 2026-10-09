"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import { useRouter } from "@/hooks/use-locale-navigation";
import {
  Circle,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Gift,
  Mail,
  RefreshCcw,
  RotateCcw,
  ShoppingCart,
} from "lucide-react";
import {
  DataTable,
  DateCell,
  TextCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { periodPickerConfig } from "@/components/admin/period-picker-config";
import { useCsvImportExport } from "@/hooks/use-csv-import-export";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import {
  CheckoutPaymentTimelineDialog,
  type CheckoutPaymentEvent,
} from "@/components/admin/checkout-payment-timeline-dialog";
import {
  AutomaticOfferDialog,
  SendOfferDialog,
  type AbandonedOfferLimits,
} from "@/components/admin/abandoned-offer-dialogs";

interface AbandonedCheckoutItem {
  name: string;
  quantity: number;
  price: number;
  productId?: string | { _id?: string } | null;
}

interface AbandonedCheckout {
  _id: string;
  email?: string;
  phone?: string;
  customerName?: string;
  checkoutUrl?: string;
  gateway?: string;
  sourceName?: string;
  recoveryEmailStatus?: string;
  recoveryStatus?: string;
  abandonedAt?: string;
  checkoutStartedAt?: string;
  updatedAt: string;
  totalPrice?: number;
  subtotalPrice?: number;
  itemCount?: number;
  items: AbandonedCheckoutItem[];
  /**
   * What the gateway said, try by try. Written by `recordCheckoutPaymentEvent`
   * — a refused payment produces no order, so this is the only place a
   * merchant can see why a shopper who tried to pay did not.
   */
  paymentEvents?: CheckoutPaymentEvent[];
  /** The recovery ladder: one entry per scheduled email. */
  recoveryEmails?: Array<{
    step: number;
    dueAt?: string;
    sentAt?: string;
    status?: string;
  }>;
  /** Set once the shopper has asked to be left alone. */
  unsubscribedAt?: string;
  /**
   * A vendor's row only: whether the shopper was signed in — all a vendor
   * learns about them (`toVendorAbandonedCheckout`).
   */
  customerType?: "registered" | "guest";
  /** A vendor's row only: the order it became, when it holds the vendor's goods. */
  order?: { _id: string; orderNumber?: string };
  /** A vendor's row only: its own latest offer on the checkout. */
  offer?: { kind: string; type: string; value: number; validUntil?: string; status: string };
  /** A vendor's row only: whether an offer could go out now. */
  offerAvailable?: boolean;
  /** The store's rows: every vendor offer on the checkout, by seller. */
  offerSummaries?: Array<{
    vendorName: string;
    kind?: string;
    type?: string;
    value?: number;
    code?: string;
    status: string;
  }>;
}

/** An offer's state, as a list says it. */
const OFFER_STATUS_LABELS: Record<string, string> = {
  pending: "Sending",
  sent: "Sent",
  queued: "Sending",
  failed: "Not sent",
  suppressed: "Not sent",
  used: "Used",
  expired: "Expired",
};

/**
 * Whose list this is:
 * - `admin`: the store's, with every action;
 * - `staff`: the staff area's, the recovery actions only with `canManage`;
 * - `vendor`: a vendor's own lines, read-only, with no shopper named — the
 *   rows arrive that way from the server, so this only lays them out.
 */
export type AbandonedCheckoutsArea = "admin" | "staff" | "vendor";

interface AbandonedCheckoutsDataTableProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: AbandonedCheckout[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  area?: AbandonedCheckoutsArea;
  /** Staff: may send a recovery email and copy the recovery link. */
  canManage?: boolean;
  /**
   * The vendor's offers, when the store allows them and the vendor may make
   * discounts: a Send offer action on each row, and the standing offer.
   */
  offers?: { canSend: boolean; automatic: boolean; limits: AbandonedOfferLimits };
}

const ABANDONED_FILTER_IDS = ["emailStatus", "date"];

/** First two words of a product title — how the Orders list shortens it. */
function getTwoWordProductName(name?: string) {
  const value = name?.trim();
  if (!value) return "—";

  const words = value.split(/\s+/);
  return words.length > 2 ? `${words.slice(0, 2).join(" ")}...` : value;
}

function getFirstItemProductId(items: AbandonedCheckoutItem[]) {
  const firstProductId = items[0]?.productId;
  if (!firstProductId) return null;
  if (typeof firstProductId === "string") return firstProductId;
  if (typeof firstProductId === "object" && typeof firstProductId._id === "string") {
    return firstProductId._id;
  }
  return null;
}

/** Badge copy in the Orders list's sentence case ("Not sent", not "Not Sent"). */
const EMAIL_STATUS_LABELS: Record<string, string> = {
  not_sent: "Not sent",
  sent: "Sent",
  failed: "Failed",
  not_applicable: "No email",
};

const RECOVERY_STATUS_LABELS: Record<string, string> = {
  not_recovered: "Not recovered",
  recovered: "Recovered",
};

function getStatusBadgeClasses(status?: string) {
  if (status === "recovered") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
}

function getEmailBadgeClasses(status?: string) {
  if (status === "sent") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  }
  if (status === "not_applicable") {
    return "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200";
  }
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200";
}

function formatStatus(value: string, labels: Record<string, string>) {
  return labels[value] || value.replace(/_/g, " ");
}

function RecoveryBadge({ status }: { status?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium ${getStatusBadgeClasses(status)}`}
    >
      <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
      {formatStatus(status || "not_recovered", RECOVERY_STATUS_LABELS)}
    </span>
  );
}

export function AbandonedCheckoutsDataTable({
  locale,
  data,
  pagination,
  area = "admin",
  canManage = false,
  offers,
}: AbandonedCheckoutsDataTableProps) {
  const t = useTranslations();
  const tOr = useFallbackTranslator(t);
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const basePath = `/${locale}/${area}`;
  const isStore = area === "admin";
  const isVendor = area === "vendor";
  /** Send the recovery email, copy or open the recovery link. */
  const canRecover = isStore || (area === "staff" && canManage);
  const [isDetecting, setIsDetecting] = useState(false);
  /** The checkout whose payment timeline is open, if any. */
  const [timelineRow, setTimelineRow] = useState<AbandonedCheckout | null>(null);
  /** The checkout a vendor is making an offer on; `nonce` mounts it fresh. */
  const [offerTarget, setOfferTarget] = useState<{
    row: AbandonedCheckout;
    nonce: number;
  } | null>(null);
  const [automaticOpen, setAutomaticOpen] = useState(false);
  const canSendOffers = isVendor && Boolean(offers?.canSend);
  // Stable, so a dialog's own effects do not re-run (and refetch over what the
  // vendor typed) each time this table renders.
  const closeOffer = useCallback((open: boolean) => {
    if (!open) setOfferTarget(null);
  }, []);
  const closeAutomatic = useCallback((open: boolean) => {
    if (!open) setAutomaticOpen(false);
  }, []);

  const list = useListNavigation<AbandonedCheckout>({
    items: data,
    pagination,
    tabParam: "view",
    filterIds: ABANDONED_FILTER_IDS,
    defaultSortBy: "abandonedAt",
  });

  // The table's current view as a file — every matching checkout, not the page
  // on screen: the server reads the same query string the page does.
  const csv = useCsvImportExport({
    endpoint: "/api/admin/abandoned-checkouts/export",
    noun: "abandoned checkouts",
    onImported: list.refetch,
  });

  const handleDetect = useCallback(async () => {
    setIsDetecting(true);
    try {
      const data = await apiClient.post<{ modified?: number }>(
        "/api/admin/abandoned-checkouts/detect",
        { minutes: 10, locale },
      );
      toast.success(`${data?.modified || 0} abandoned checkouts marked`);
      router.refresh();
      list.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Detection failed");
    } finally {
      setIsDetecting(false);
    }
  }, [list, locale, router]);

  const handleSendEmail = useCallback(
    async (row: AbandonedCheckout) => {
      try {
        const data = await apiClient.post<{
          sent?: boolean;
          outcome?: "sent" | "queued" | "suppressed" | "failed";
          suppression?: string;
        }>("/api/admin/abandoned-checkouts/send", {
          checkoutId: row._id,
          locale,
        });
        // A mail waiting on an outbox retry has not failed — it usually goes
        // within minutes — so it is said as it is, not as an error.
        if (data?.outcome === "queued") {
          toast.info("Recovery email queued — delivery is being retried");
        } else if (data?.outcome === "suppressed") {
          // Nor is one the shopper refused: nothing here for the merchant to
          // fix, and the outbox would have refused it anyway.
          toast.warning(
            data.suppression === "pending"
              ? "Not sent — the shopper has not confirmed their subscription yet"
              : "Not sent — the shopper unsubscribed from these emails",
          );
        } else if (data?.sent) {
          toast.success("Recovery email sent");
        } else {
          toast.error("Recovery email could not be sent");
        }
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to send recovery email",
        );
      }
    },
    [list, locale],
  );

  /** "10% off" or "$5.00 off". */
  const offerText = useCallback(
    (offer: { type?: string; value?: number }) =>
      offer.type === "fixed"
        ? `${formatPrice(Number(offer.value) || 0)} off`
        : `${Number(offer.value) || 0}% off`,
    [formatPrice],
  );

  const handleCopyLink = useCallback((row: AbandonedCheckout) => {
    if (!row.checkoutUrl) {
      toast.error("No recovery link is available");
      return;
    }
    void navigator.clipboard.writeText(row.checkoutUrl);
    toast.success("Recovery link copied");
  }, []);

  const columns = useMemo<DataTableColumn<AbandonedCheckout>[]>(() => {
    const all: DataTableColumn<AbandonedCheckout>[] = [
      {
        id: "customer",
        header: "Customer",
        // A vendor is told only whether the shopper was signed in: the row
        // carries no name or contact to show.
        cell: (row) =>
          isVendor ? (
            <TextCell
              value={
                row.customerType === "registered"
                  ? "Registered customer"
                  : t("common.guest")
              }
              truncate
              maxWidth="220px"
            />
          ) : (
            <div className="min-w-0">
              <TextCell
                value={row.customerName || t("common.guest")}
                truncate
                maxWidth="220px"
              />
              <div className="text-xs text-muted-foreground">
                <TextCell value={row.email || row.phone} truncate maxWidth="220px" />
              </div>
            </div>
          ),
        className: "w-[260px]",
      },
      {
        id: "items",
        header: "Products",
        cell: (row) => {
          const items = row.items || [];
          const fullName = items[0]?.name;
          const label = getTwoWordProductName(fullName);
          const text =
            items.length > 1
              ? `${label} ${t("admin.ordersPage.plusMore", {
                  count: items.length - 1,
                })}`
              : label;
          // The store and a vendor open the product's editor; staff may not
          // hold product permissions, so their row names it without a link.
          const productId = area === "staff" ? null : getFirstItemProductId(items);
          const textClassName =
            "block max-w-[220px] truncate font-medium text-slate-700 dark:text-slate-300";

          if (!productId) {
            return (
              <span className={textClassName} title={fullName}>
                {text}
              </span>
            );
          }

          return (
            <Link
              href={`${basePath}/products/${productId}/edit`}
              className={`${textClassName} hover:text-blue-600 hover:underline dark:hover:text-blue-400`}
              title={fullName}
            >
              {text}
            </Link>
          );
        },
        className: "w-[220px] hidden xl:table-cell",
        headerClassName: "hidden xl:table-cell",
      },
      {
        id: "abandonedAt",
        header: "Abandoned",
        // The date the way the Orders list prints it, with the relative age
        // under it — an order number carries that line there, and this list
        // has none.
        cell: (row) => {
          const date = row.abandonedAt || row.checkoutStartedAt || row.updatedAt;
          return (
            <div className="min-w-0">
              <DateCell date={date} format="medium" />
              <div className="text-xs text-muted-foreground">
                <DateCell date={date} format="relative" />
              </div>
            </div>
          );
        },
        className: "w-[140px]",
        sortable: true,
      },
      {
        id: "totalPrice",
        // A vendor's figure is its own lines, never the whole basket.
        header: isVendor ? "Your total" : "Total",
        cell: (row) => (
          <TextCell
            value={formatPrice(row.totalPrice || row.subtotalPrice || 0)}
            className="block w-full text-right"
          />
        ),
        className: "w-[140px]",
        headerClassName: "text-right [&>div]:justify-center",
        sortable: true,
      },
      {
        id: "recoveryEmailStatus",
        header: "Email",
        // The badge alone could not tell "one reminder sent, two to come"
        // from "that is all they will get", which is the question asked of
        // this column once there is a ladder rather than a single email.
        cell: (row) => {
          const ladder = row.recoveryEmails || [];
          const sent = ladder.filter((rung) => rung.status === "sent").length;
          const status = row.recoveryEmailStatus || "not_sent";
          return (
            <div className="space-y-1">
              <span
                className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium ${getEmailBadgeClasses(status)}`}
              >
                <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
                {formatStatus(status, EMAIL_STATUS_LABELS)}
              </span>
              {row.unsubscribedAt ? (
                <div className="text-[11px] text-muted-foreground">
                  Unsubscribed
                </div>
              ) : ladder.length > 1 ? (
                <div className="text-[11px] text-muted-foreground">
                  {sent} of {ladder.length}
                </div>
              ) : null}
            </div>
          );
        },
        className: "w-[150px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
        sortable: true,
      },
      {
        id: "recoveryStatus",
        header: "Recovery",
        // The store's rows also say which seller made an offer, and how it
        // stands — the latest one, since a checkout holds one at a time.
        cell: (row) => {
          const latest = row.offerSummaries?.[row.offerSummaries.length - 1];
          return (
            <div className="space-y-1">
              <RecoveryBadge status={row.recoveryStatus} />
              {latest ? (
                <div
                  className="max-w-[200px] truncate text-[11px] text-muted-foreground"
                  title={latest.code ? `Code ${latest.code}` : undefined}
                >
                  Offer {offerText(latest)} · {latest.vendorName} ·{" "}
                  {OFFER_STATUS_LABELS[latest.status] ?? latest.status}
                </div>
              ) : null}
            </div>
          );
        },
        className: "w-[150px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
        sortable: true,
      },
      // A vendor's own offer on the checkout, when the store allows offers.
      ...(isVendor && offers
        ? [
            {
              id: "offer",
              header: "Offer",
              cell: (row: AbandonedCheckout) =>
                row.offer ? (
                  <div className="min-w-0">
                    <TextCell value={offerText(row.offer)} />
                    <div className="text-xs text-muted-foreground">
                      {OFFER_STATUS_LABELS[row.offer.status] ?? row.offer.status}
                      {row.offer.kind === "automatic" ? " · automatic" : ""}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              className: "w-[130px]",
            } satisfies DataTableColumn<AbandonedCheckout>,
          ]
        : []),
    ];
    // The recovery emails are the store's, so a vendor's list has no column
    // for them.
    return isVendor
      ? all.filter((column) => column.id !== "recoveryEmailStatus")
      : all;
  }, [area, basePath, formatPrice, isVendor, offerText, offers, t]);

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: "All" },
      { id: "open", label: "Open" },
      { id: "recovered", label: "Recovered" },
    ],
    [],
  );

  const selectFilters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "emailStatus",
        label: "Email status",
        type: "select",
        options: [
          { label: "All", value: "all" },
          { label: "Not sent", value: "not_sent" },
          { label: "Sent", value: "sent" },
          { label: "Failed", value: "failed" },
          { label: "No email", value: "not_applicable" },
        ],
      },
    ],
    [],
  );

  // The Orders list's date filter, with the dashboard's period names and
  // footer. Built on every render rather than memoised: "today" and the last
  // day the calendar lets you pick move at midnight, and this tab can outlive it.
  const now = new Date();
  const dateFilter: DataTableFilter = {
    id: "date",
    label: tOr("admin.ordersPage.filters.date", "Date"),
    type: "date",
    date: { locale, ...periodPickerConfig(tOr, locale, now), maxDate: now },
  };
  // A vendor's rows carry no recovery-email state, so there is nothing for
  // the email filter to narrow.
  const filters = isVendor ? [dateFilter] : [...selectFilters, dateFilter];

  // Export and detection are the store's alone: the file holds every
  // shopper's contact details, and detection sweeps every checkout.
  const tableHeader = buildAdminCommerceTableHeader({
    title: "Abandoned checkouts",
    ...(isStore
      ? {
          // Export only: a checkout is written by the storefront, never imported.
          importExportAction: {
            id: "toolbar-export",
            label: tOr("admin.ordersPage.export", "Export"),
            icon: <Download className="h-4 w-4" />,
            variant: "outline" as const,
            onClick: csv.exportCsv,
            disabled: csv.isExporting,
          },
          secondaryActions: [
            {
              id: "detect",
              label: isDetecting ? "Detecting..." : "Detect now",
              icon: (
                <RefreshCcw className={`h-4 w-4 ${isDetecting ? "animate-spin" : ""}`} />
              ),
              onClick: handleDetect,
              disabled: isDetecting,
            },
          ],
        }
      : {}),
    // A vendor's standing offer, which the store's recovery email carries.
    ...(canSendOffers && offers?.automatic
      ? {
          secondaryActions: [
            {
              id: "automatic-offer",
              label: "Automatic offer",
              icon: <Gift className="h-4 w-4" />,
              onClick: () => setAutomaticOpen(true),
            },
          ],
        }
      : {}),
  });

  const rowActions = (row: AbandonedCheckout): DataTableAction[] => {
    // A vendor reads, and — where the store allows it — sends its own offer.
    // The one other thing to open is its own order, when the shopper came
    // back and bought.
    if (isVendor) {
      return [
        ...(canSendOffers
          ? [
              {
                id: "send-offer",
                label: "Send offer",
                icon: <Gift className="h-4 w-4" />,
                onClick: () =>
                  setOfferTarget({ row, nonce: Date.now() }),
                disabled: !row.offerAvailable,
                hint: row.offerAvailable
                  ? undefined
                  : "An offer is already open on this checkout, or it has closed.",
              },
            ]
          : []),
        ...(row.order
          ? [
              {
                id: "open-order",
                label: row.order.orderNumber
                  ? `View order ${row.order.orderNumber}`
                  : "View order",
                icon: <ExternalLink className="h-4 w-4" />,
                href: `${basePath}/orders/${row.order._id}`,
              },
            ]
          : []),
      ];
    }

    return [
      ...(row.paymentEvents?.length
        ? [
            {
              id: "payment-timeline",
              label: "Payment timeline",
              icon: <Clock className="h-4 w-4" />,
              onClick: () => setTimelineRow(row),
            },
          ]
        : []),
      ...(canRecover
        ? [
            {
              id: "send-email",
              label: "Send recovery email",
              icon: <Mail className="h-4 w-4" />,
              onClick: () => void handleSendEmail(row),
              disabled: !row.email || row.recoveryStatus === "recovered",
            },
            {
              id: "copy-link",
              label: "Copy recovery link",
              icon: <Copy className="h-4 w-4" />,
              onClick: () => handleCopyLink(row),
              disabled: !row.checkoutUrl,
            },
            ...(row.checkoutUrl
              ? [
                  {
                    id: "open-recovery",
                    label: "Open checkout",
                    icon: <RotateCcw className="h-4 w-4" />,
                    href: row.checkoutUrl,
                  },
                ]
              : []),
          ]
        : []),
    ];
  };
  // No column at all when no row on the page has anything to offer — a vendor's
  // page without a recovered order, or staff who may only look. The store's
  // list always has its recovery actions.
  const showRowActions =
    isStore || list.items.some((row) => rowActions(row).length > 0);

  return (
    <>
    <DataTable
      data={list.items}
      columns={columns}
      keyField="_id"
      title={tableHeader.title}
      titleIcon={<ShoppingCart className="h-5 w-5" />}
      actions={tableHeader.actions}
      tabs={tabs}
      activeTab={list.activeTab}
      onTabChange={list.handleTabChange}
      searchable
      searchPlaceholder={
        isVendor
          ? "Search your products"
          : "Search customer, email, phone, or product"
      }
      toolbarActions={tableHeader.toolbarActions}
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      filters={filters}
      filterValues={list.filters}
      onFilterChange={list.handleFilterChange}
      pagination={list.pagination}
      onPageChange={list.handlePageChange}
      onPageSizeChange={list.handlePageSizeChange}
      sortColumn={list.sortBy}
      sortDirection={list.sortOrder}
      onSortChange={list.handleSortChange}
      isLoading={list.isLoading}
      loadingMode="rows"
      rowActions={showRowActions ? rowActions : undefined}
      rowActionsHeader={t("common.actions")}
      rowActionsVariant="dropdown"
      emptyMessage={
        isVendor
          ? "Checkouts that held your products will show here when a shopper leaves before paying."
          : "Abandoned checkouts will show here after a customer starts checkout and leaves before payment."
      }
      emptyIcon={<ShoppingCart className="h-8 w-8" />}
      appearance={tableHeader.appearance}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
      className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-xs"
    />

    {offerTarget && offers ? (
      <SendOfferDialog
        key={offerTarget.nonce}
        open
        onOpenChange={closeOffer}
        checkoutId={offerTarget.row._id}
        productNames={(offerTarget.row.items || []).map((item) => item.name)}
        subtotal={Number(offerTarget.row.subtotalPrice ?? offerTarget.row.totalPrice ?? 0)}
        limits={offers.limits}
        onSent={() => list.refetch()}
      />
    ) : null}

    {automaticOpen ? (
      <AutomaticOfferDialog open onOpenChange={closeAutomatic} />
    ) : null}

    {isVendor ? null : (
      <CheckoutPaymentTimelineDialog
        open={Boolean(timelineRow)}
        onOpenChange={(open) => !open && setTimelineRow(null)}
        locale={locale}
        customerName={timelineRow?.customerName || t("common.guest")}
        contact={timelineRow?.email || timelineRow?.phone}
        statusBadge={<RecoveryBadge status={timelineRow?.recoveryStatus} />}
        events={timelineRow?.paymentEvents || []}
      />
    )}
    </>
  );
}
