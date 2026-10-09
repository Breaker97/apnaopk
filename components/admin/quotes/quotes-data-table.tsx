"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  RotateCcw,
  Tag,
  Trash2,
  TriangleAlert,
  Undo2,
  XCircle,
} from "lucide-react";
import Link from "@/components/language/link";
import {
  DataTable,
  DateCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { getPaymentMethodMeta } from "@/components/common/payment-method-meta";
import { toast } from "@/components/ui/toast-notification";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { lotFits } from "@/lib/quotes/quote-lot-fit";
import type { AdminQuoteDetail, AdminQuoteRow } from "@/lib/quotes/quotes";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { QuoteDetailSheet, type QuoteSheetAction } from "./quote-detail-sheet";
import { QuoteOfferDialog } from "./quote-offer-dialog";
import {
  formatQuoteDate,
  GuestChip,
  QuoteOfferBy,
  QuoteProductThumb,
  QuoteStageBadge,
  quoteMovesFor,
  useLotMessage,
  type QuoteScope,
} from "./quote-ui";
import { useQuoteActions } from "./use-quote-actions";

/**
 * The quote inbox, laid out the way the Orders list is: counts above, tabs by
 * where each request stands, one row per request with a single status, and
 * every move in the row's ⋮ menu. A row opens the request in a side sheet —
 * the full message, the price history and the team's note live there, not in
 * the table.
 *
 * This table does not fetch: the page's server component reads the query
 * string, and every control here is a navigation (see useListNavigation).
 *
 * The vendor's Quotes page draws the same table over its own quotes
 * (`scope="vendor"`): its sheet and dialog talk to the vendor's routes, its
 * links go to the vendor's orders, and its moves are the ones the store has
 * left the vendor (see `quoteMovesFor`).
 */

interface QuotesDataTableProps {
  data: AdminQuoteRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  /**
   * False for staff who may look but not answer (no manage-orders grant), and
   * for a vendor's seat that may view orders but not change them.
   */
  canManage: boolean;
  scope?: QuoteScope;
}

const FILTER_IDS = ["requested", "customer"];

type OfferTarget = {
  id: string;
  initial?: AdminQuoteDetail | null;
  open: boolean;
  /** Keys the dialog, so each opening starts from the quote as it is now. */
  nonce: number;
};

function escapeCsvValue(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function QuotesDataTable({
  data,
  pagination,
  canManage,
  scope = "admin",
}: QuotesDataTableProps) {
  const t = useTranslations("admin.quotesPage");
  const tRoot = useTranslations();
  const { formatPrice } = useCurrency();
  const lotMessage = useLotMessage();

  const list = useListNavigation<AdminQuoteRow>({
    items: data,
    pagination,
    tabParam: "stage",
    filterIds: FILTER_IDS,
  });
  const { refetch } = list;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // `?quote=<id>` opens that request's sheet — the link a new-request
  // notification and an order's quoted line both carry.
  const [sheet, setSheet] = useState<{ id: string; open: boolean } | null>(
    () => {
      const linked = searchParams.get("quote");
      return linked ? { id: linked, open: true } : null;
    },
  );
  const [sheetVersion, setSheetVersion] = useState(0);
  const [offer, setOffer] = useState<OfferTarget | null>(null);

  /** Close the sheet, and drop the link that opened it so a reload does not. */
  const closeSheet = useCallback(() => {
    setSheet((current) => (current ? { ...current, open: false } : current));
    if (!searchParams.get("quote")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("quote");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const afterWrite = useCallback(() => {
    refetch();
    setSheetVersion((version) => version + 1);
  }, [refetch]);

  const { markLost, reopen, withdraw, remove } = useQuoteActions(
    afterWrite,
    scope,
  );

  const openSheet = useCallback((row: AdminQuoteRow) => {
    setSheet({ id: row._id, open: true });
  }, []);

  const openOffer = useCallback(
    (id: string, initial?: AdminQuoteDetail | null) => {
      setOffer({ id, initial, open: true, nonce: Date.now() });
    },
    [],
  );

  const handleSheetOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setSheet((current) => (current ? { ...current, open } : current));
      } else {
        closeSheet();
      }
    },
    [closeSheet],
  );

  const handleOfferOpenChange = useCallback((open: boolean) => {
    setOffer((current) => (current ? { ...current, open } : current));
  }, []);

  // A dialog opened over the sheet would sit underneath it, so the sheet
  // steps aside for anything that asks a question.
  const handleSheetAction = useCallback(
    (action: QuoteSheetAction, quote: AdminQuoteDetail) => {
      closeSheet();
      if (action === "send_price") openOffer(quote._id, quote);
      else if (action === "withdraw") void withdraw(quote);
      else if (action === "mark_lost") void markLost(quote);
      else if (action === "reopen") void reopen(quote);
      else void remove(quote);
    },
    [closeSheet, markLost, openOffer, remove, reopen, withdraw],
  );

  const stageDetail = useCallback(
    (row: AdminQuoteRow): ReactNode => {
      switch (row.stage) {
        case "offer_sent":
          return row.offer?.expiresAt
            ? t("table.expires", { date: formatQuoteDate(row.offer.expiresAt) })
            : t("table.noExpiry");
        case "expired":
          return t("table.expiredOn", {
            date: formatQuoteDate(row.offer?.expiresAt),
          });
        case "ordered":
        case "won":
          return row.order ? (
            <>
              <Link
                href={`/${scope}/orders/${row.order._id}`}
                className="font-medium text-primary hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {row.order.orderNumber}
              </Link>
              {" · "}
              {getPaymentMethodMeta(tRoot, row.order.paymentMethod).label}
            </>
          ) : null;
        case "closed":
          return row.status === "lost"
            ? t("table.lost")
            : t("table.withdrawnOn", {
                date: formatQuoteDate(row.offer?.withdrawnAt),
              });
        default:
          return null;
      }
    },
    [scope, t, tRoot],
  );

  const columns = useMemo<DataTableColumn<AdminQuoteRow>[]>(
    () => [
      {
        id: "createdAt",
        header: t("columns.requested"),
        // The date the way the Orders list prints it, with the age under it —
        // an order number carries that line there, and a quote has none.
        cell: (row) => (
          <div className="min-w-0">
            <DateCell date={row.createdAt} format="medium" />
            <div className="text-muted-foreground">
              <DateCell date={row.createdAt} format="relative" />
            </div>
          </div>
        ),
        // Widths are set so the row fits the card beside the open sidebar;
        // on a narrower screen the date folds under the customer instead.
        className: "w-[120px] hidden min-[1400px]:table-cell",
        headerClassName: "hidden min-[1400px]:table-cell",
        sortable: true,
      },
      {
        id: "customer",
        header: t("columns.customer"),
        cell: (row) => (
          <div className="min-w-0 max-w-[150px] sm:max-w-[160px] 2xl:max-w-[220px]">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-medium" title={row.name}>
                {row.name}
              </span>
              {row.userId ? null : <GuestChip />}
            </div>
            {row.contactHidden ? (
              <div className="truncate italic text-muted-foreground">
                {t("table.contactHidden")}
              </div>
            ) : (
              <div className="truncate text-muted-foreground" title={row.email}>
                {row.email}
              </div>
            )}
            <div className="text-muted-foreground min-[1400px]:hidden">
              <DateCell date={row.createdAt} format="relative" />
            </div>
          </div>
        ),
      },
      {
        id: "product",
        header: t("columns.product"),
        cell: (row) => {
          const fullName = row.variantName
            ? `${row.productName} — ${row.variantName}`
            : row.productName;
          return (
            <div className="flex min-w-0 max-w-[210px] items-center gap-2.5 2xl:max-w-[340px]">
              <QuoteProductThumb src={row.productImage} alt={row.productName} />
              <div className="min-w-0">
                <p className="truncate font-medium" title={fullName}>
                  {row.productName}
                </p>
                <p className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span className="truncate">
                    {row.variantName ? `${row.variantName} · ` : ""}
                    {t("table.qty", { count: row.quantity })}
                  </span>
                  {row.message ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1"
                      title={row.message}
                    >
                      <MessageSquare className="h-3 w-3" />
                      {t("table.message")}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          );
        },
        className: "hidden xl:table-cell",
        headerClassName: "hidden xl:table-cell",
      },
      {
        id: "offerTotal",
        header: t("columns.offer"),
        cell: (row) => {
          if (!row.offer) {
            return <span className="block text-right text-muted-foreground">—</span>;
          }
          const lotProblem =
            (row.stage === "offer_sent" || row.stage === "expired") &&
            !lotFits(row.lot, row.offer.quantity);
          return (
            <div className="text-right">
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  row.stage === "closed" && "text-muted-foreground",
                )}
              >
                {formatPrice(row.offerTotal ?? 0)}
              </div>
              <div className="flex items-center justify-end gap-1.5 text-muted-foreground tabular-nums">
                <QuoteOfferBy role={row.offer.offeredByRole} />
                <span>
                  {row.offer.quantity} × {formatPrice(row.offer.unitPrice)}
                </span>
              </div>
              {lotProblem ? (
                <div
                  className="mt-0.5 inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400"
                  title={lotMessage.long(row.lot, row.offer.quantity)}
                >
                  <TriangleAlert className="h-3 w-3" />
                  {lotMessage.short(row.lot)}
                </div>
              ) : null}
            </div>
          );
        },
        className: "w-[150px] hidden sm:table-cell",
        headerClassName: "text-right hidden sm:table-cell",
        sortable: true,
      },
      {
        id: "stage",
        header: t("columns.status"),
        cell: (row) => {
          const detail = stageDetail(row);
          return (
            <div className="min-w-0 space-y-1">
              <QuoteStageBadge stage={row.stage} />
              {detail ? (
                <div className="hidden max-w-[150px] truncate text-muted-foreground sm:block">
                  {detail}
                </div>
              ) : null}
            </div>
          );
        },
      },
    ],
    [formatPrice, lotMessage, stageDetail, t],
  );

  const rowActions = useCallback(
    (row: AdminQuoteRow): DataTableAction[] => {
      const onOrder = row.stage === "ordered" || row.stage === "won";
      const moves = quoteMovesFor(scope, row);
      const actions: DataTableAction[] = [
        {
          id: "view",
          label: tRoot("common.viewDetails"),
          icon: <Eye className="h-4 w-4" />,
          onClick: () => openSheet(row),
        },
      ];

      if (canManage && moves.canSendPrice) {
        actions.push({
          id: "send-price",
          label: row.offer ? t("actions.sendNewPrice") : t("actions.sendPrice"),
          icon: <Tag className="h-4 w-4" />,
          onClick: () => openOffer(row._id),
        });
      }
      if (canManage && moves.canReopen) {
        actions.push({
          id: "reopen",
          label: t("actions.reopen"),
          icon: <RotateCcw className="h-4 w-4" />,
          onClick: () => void reopen(row),
        });
      }
      if (canManage && moves.canWithdraw) {
        actions.push({
          id: "withdraw",
          label: t("actions.withdraw"),
          icon: <Undo2 className="h-4 w-4" />,
          onClick: () => void withdraw(row),
        });
      }
      if (onOrder && row.order) {
        actions.push({
          id: "open-order",
          label: t("actions.openOrder"),
          icon: <ExternalLink className="h-4 w-4" />,
          href: `/${scope}/orders/${row.order._id}`,
        });
      }
      if (row.email) {
        actions.push({
          id: "email",
          label: t("actions.email"),
          icon: <Mail className="h-4 w-4" />,
          onClick: () => {
            window.location.href = `mailto:${row.email}`;
          },
        });
      }
      if (row.phone) {
        actions.push({
          id: "call",
          label: t("actions.call", { phone: row.phone }),
          icon: <Phone className="h-4 w-4" />,
          onClick: () => {
            window.location.href = `tel:${row.phone}`;
          },
        });
      }
      if (canManage && moves.canMarkLost) {
        actions.push({
          id: "mark-lost",
          label: t("actions.markLost"),
          icon: <XCircle className="h-4 w-4" />,
          onClick: () => void markLost(row),
        });
      }
      if (canManage && moves.canDelete) {
        actions.push({
          id: "delete",
          label: tRoot("common.delete"),
          icon: <Trash2 className="h-4 w-4" />,
          variant: "destructive",
          disabled: onOrder,
          hint: onOrder ? t("table.keptWithOrder") : undefined,
          onClick: () => void remove(row),
        });
      }
      return actions;
    },
    [
      canManage,
      markLost,
      openOffer,
      openSheet,
      remove,
      reopen,
      scope,
      t,
      tRoot,
      withdraw,
    ],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("tabs.all") },
      { id: "needs_reply", label: t("tabs.needsReply") },
      { id: "offer_sent", label: t("tabs.offerSent") },
      { id: "expired", label: t("tabs.expired") },
      { id: "ordered", label: t("tabs.ordered") },
      { id: "closed", label: t("tabs.closed") },
    ],
    [t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "requested",
        label: t("filters.requested"),
        type: "select",
        options: [
          { label: t("filters.anyTime"), value: "all" },
          { label: t("filters.last7"), value: "7d" },
          { label: t("filters.last30"), value: "30d" },
          { label: t("filters.last90"), value: "90d" },
        ],
      },
      {
        id: "customer",
        label: t("filters.customer"),
        type: "select",
        options: [
          { label: t("filters.everyone"), value: "all" },
          { label: t("filters.withAccount"), value: "account" },
          { label: t("filters.guests"), value: "guest" },
        ],
      },
    ],
    [t],
  );

  const exportCsv = useCallback(() => {
    const headers = [
      "Requested",
      "Customer",
      "Company",
      "Email",
      "Phone",
      "Account",
      "Product",
      "Variant",
      "Quantity asked",
      "Offer quantity",
      "Unit price",
      "Offer total",
      "Status",
      "Price expires",
      "Order",
    ];
    const rows = list.items.map((row) => [
      row.createdAt,
      row.name,
      row.company,
      row.email,
      row.phone,
      row.userId ? "account" : "guest",
      row.productName,
      row.variantName,
      row.quantity,
      row.offer?.quantity,
      row.offer?.unitPrice,
      row.offerTotal,
      row.stage,
      row.offer?.expiresAt,
      row.order?.orderNumber,
    ]);
    const csv = [headers, ...rows]
      .map((line) => line.map(escapeCsvValue).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `quotes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t("toast.exported"));
  }, [list.items, t]);

  const tableHeader = buildAdminCommerceTableHeader({ title: t("title") });

  const hasQuery =
    Boolean(list.search) ||
    Object.values(list.filters).some((value) => value && value !== "all");
  const emptyMessage = hasQuery
    ? t("empty.filtered")
    : list.activeTab === "all"
      ? t("empty.all")
      : t("empty.tab");

  return (
    <>
      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        isLoading={list.isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        actions={tableHeader.actions}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        searchable
        searchPlaceholder={t("searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={list.filters}
        onFilterChange={list.handleFilterChange}
        toolbarActions={[
          {
            id: "export",
            label: t("export"),
            icon: <Download className="h-4 w-4" />,
            variant: "outline",
            onClick: exportCsv,
            disabled: list.items.length === 0,
          },
        ]}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        paginationLabels={{
          showing: tRoot("admin.ordersPage.pagination.showing"),
          to: tRoot("admin.ordersPage.pagination.to"),
          of: tRoot("admin.ordersPage.pagination.of"),
          results: tRoot("admin.ordersPage.pagination.results"),
          rowsPerPage: tRoot("admin.ordersPage.pagination.rowsPerPage"),
        }}
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        rowActions={rowActions}
        rowActionsHeader={tRoot("common.actions")}
        rowActionsVariant="dropdown"
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        className="overflow-hidden [&_tbody_td]:text-xs [&_thead_th]:text-xs"
        onRowClick={openSheet}
        emptyMessage={emptyMessage}
        emptyIcon={<FileText className="h-8 w-8" />}
      />

      <QuoteDetailSheet
        quoteId={sheet?.id ?? null}
        open={Boolean(sheet?.open)}
        onOpenChange={handleSheetOpenChange}
        canManage={canManage}
        scope={scope}
        version={sheetVersion}
        onAction={handleSheetAction}
      />

      {offer ? (
        <QuoteOfferDialog
          key={offer.nonce}
          quoteId={offer.id}
          initial={offer.initial}
          open={offer.open}
          onOpenChange={handleOfferOpenChange}
          onSaved={afterWrite}
          scope={scope}
        />
      ) : null}
    </>
  );
}
