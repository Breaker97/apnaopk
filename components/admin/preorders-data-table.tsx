"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Banknote,
  CreditCard,
  Download,
  Eye,
  PackageCheck,
  XCircle,
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { getPreorderBalanceDue } from "@/lib/orders/order-payment-status";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface PreorderItem {
  name: string;
  quantity: number;
  price?: number;
  purchaseType?: string;
  preorderReleaseDate?: string;
  preorderStatus?: string;
  /**
   * Read only through `getPreorderBalanceDue`, which nets off the lines of any
   * consignment a vendor has cancelled. The list query returns whole orders, so
   * the figure was always on the row — it just had no name here, and the
   * balance column quietly counted goods nobody is sending.
   */
  preorderOutstandingAmount?: number;
}

interface PreorderSubOrder {
  status: string;
  subtotal: number;
  vendorEarnings?: number;
  items: PreorderItem[];
}

interface PreorderOrder {
  _id: string;
  orderNumber: string;
  customerId?: { name?: string; email?: string };
  status: string;
  preorderStatus?: string;
  preorderReleaseDate?: string;
  preorderPaymentMode?: string;
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  paymentStatus: string;
  total: number;
  createdAt: string;
  items: PreorderItem[];
  subOrders?: PreorderSubOrder[];
}

interface PreordersDataTableProps {
  locale: string;
  scope?: "admin" | "vendor";
  canEditPreorder?: boolean;
  canCancelPreorder?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: PreorderOrder[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Status chips here use the same geometry and 12px type as the orders table, so
 * both lists read as one surface.
 */
const STATUS_CHIP_CLASS =
  "inline-flex items-center rounded-sm px-2 py-1 text-[12px] font-medium";

const PREORDER_STATUS_LABELS: Record<string, string> = {
  reserved: "Reserved",
  payment_due: "Payment due",
  delayed: "Delayed",
  partially_ready: "Partially ready",
  ready: "Ready",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  expired: "Expired",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  preordered: "Pre-ordered",
  pending: "Pending",
  processing: "Processing",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  partially_paid: "Partially paid",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

function getSubOrder(order: PreorderOrder) {
  return order.subOrders?.[0] || null;
}

function getPreorderItems(order: PreorderOrder, scope: "admin" | "vendor") {
  const sourceItems = scope === "vendor" ? getSubOrder(order)?.items : order.items;
  return (sourceItems || []).filter((item) => item.purchaseType === "preorder");
}

function getItemsCount(items: PreorderItem[]) {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

function getPreorderStatus(order: PreorderOrder, scope: "admin" | "vendor") {
  if (scope === "admin" && order.preorderStatus) return order.preorderStatus;

  const itemStatuses = getPreorderItems(order, scope)
    .map((item) => item.preorderStatus)
    .filter((status): status is string => Boolean(status));

  if (itemStatuses.length === 0) {
    if (order.status === "processing") return "ready";
    if (order.status === "cancelled") return "cancelled";
    return "reserved";
  }

  const firstStatus = itemStatuses[0];
  if (itemStatuses.every((status) => status === firstStatus)) {
    return firstStatus;
  }
  if (
    itemStatuses.some(
      (status) => status === "ready" || status === "payment_due",
    )
  ) {
    return "partially_ready";
  }
  return "reserved";
}

function getReleaseDate(order: PreorderOrder, scope: "admin" | "vendor") {
  if (order.preorderReleaseDate) return order.preorderReleaseDate;

  const dates = getPreorderItems(order, scope)
    .map((item) => item.preorderReleaseDate)
    .filter(Boolean)
    .map((value) => new Date(String(value)))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (!dates.length) return undefined;
  return dates.reduce((latest, date) =>
    date.getTime() > latest.getTime() ? date : latest,
  ).toISOString();
}

function getPurchasedLabel(items: PreorderItem[]) {
  if (!items.length) return "No pre-order items";
  const [first, second] = items;
  if (!second) return `${first.name} x${first.quantity}`;
  return `${first.name} x${first.quantity} + ${items.length - 1} more`;
}

function getPaymentStatusStyles(status: string) {
  const map: Record<string, string> = {
    paid: "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200",
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
    partially_paid:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
    refunded: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
    partially_refunded:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
  };
  return (
    map[status] ||
    "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200"
  );
}

function getPreorderStatusStyles(status: string) {
  const map: Record<string, string> = {
    reserved:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
    payment_due:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
    delayed:
      "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
    partially_ready:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
    ready:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    fulfilled:
      "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
    cancelled: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
    expired:
      "bg-zinc-100 text-zinc-800 dark:bg-zinc-500/20 dark:text-zinc-300",
  };
  return (
    map[status] ||
    "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200"
  );
}

function getOrderStatusStyles(status: string) {
  const map: Record<string, string> = {
    preordered:
      "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
    processing:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
    shipped: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
    delivered:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
    cancelled: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  };
  return (
    map[status] ||
    "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200"
  );
}

export function PreordersDataTable({
  locale,
  scope = "admin",
  canEditPreorder = true,
  canCancelPreorder = true,
  data,
  pagination,
}: PreordersDataTableProps) {
  const router = useRouter();
  const { formatPrice } = useCurrency();

  const [selectedOrders, setSelectedOrders] = useState<PreorderOrder[]>([]);
  const [delayTarget, setDelayTarget] = useState<{
    ids: string[];
    bulk: boolean;
  } | null>(null);
  const [delayReleaseDate, setDelayReleaseDate] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [isDelaySubmitting, setIsDelaySubmitting] = useState(false);
  const [balanceTarget, setBalanceTarget] = useState<{
    id: string;
    orderNumber: string;
    amount: number;
  } | null>(null);
  const [balanceMethod, setBalanceMethod] = useState("Bank transfer");
  const [balanceReference, setBalanceReference] = useState("");
  const [balanceNote, setBalanceNote] = useState("");
  const [isBalanceSubmitting, setIsBalanceSubmitting] = useState(false);

  const list = useListNavigation<PreorderOrder>({
    items: data,
    pagination,
  });

  // Fetching a fresh page invalidates row selection, as before.
  useApplyOnChange([list.items], () => {
    setSelectedOrders([]);
  });

  const runAction = useCallback(
    async (orderId: string, action: "ready" | "payment_due" | "cancel") => {
      // Cancelling refunds whatever the shopper paid, so the confirmation says
      // so. "Cancel this pre-order?" hid the fact that money moves.
      if (
        action === "cancel" &&
        !window.confirm(
          "Cancel this pre-order and refund everything the customer has paid?",
        )
      ) {
        return;
      }
      try {
        const result = await apiClient.put<{
          refund?: { refunded?: boolean; reason?: string };
        }>(`/api/${scope}/preorders/${orderId}`, { action });
        if (action === "cancel") {
          const refund = result?.refund;
          // A refund the gateway would not take is the one outcome an admin
          // has to act on, so it is a warning rather than a success line they
          // would scroll past.
          if (refund && !refund.refunded && refund.reason) {
            toast.warning(`Pre-order cancelled — ${refund.reason}`);
          } else {
            toast.success("Pre-order cancelled and refunded");
          }
        } else {
          toast.success(
            action === "ready"
              ? "Pre-order moved to fulfillment"
              : "Balance request sent",
          );
        }
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update pre-order",
        );
      }
    },
    [list, scope],
  );

  const submitRecordBalance = useCallback(async () => {
    if (!balanceTarget || !balanceReference.trim()) return;
    setIsBalanceSubmitting(true);
    try {
      await apiClient.post(
        `/api/admin/preorders/${balanceTarget.id}/record-balance`,
        {
          amount: balanceTarget.amount,
          method: balanceMethod.trim() || "Offline payment",
          reference: balanceReference.trim(),
          ...(balanceNote.trim() ? { note: balanceNote.trim() } : {}),
        },
      );
      toast.success(`Balance recorded on ${balanceTarget.orderNumber}`);
      setBalanceTarget(null);
      list.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to record the balance",
      );
    } finally {
      setIsBalanceSubmitting(false);
    }
  }, [balanceTarget, balanceMethod, balanceReference, balanceNote, list]);

  const runDelayAction = useCallback(
    (orderId: string) => {
      setDelayTarget({ ids: [orderId], bulk: false });
      setDelayReleaseDate("");
      setDelayReason("");
    },
    [],
  );

  const submitDelayAction = useCallback(async () => {
    if (!delayTarget || !delayReleaseDate) return;
    setIsDelaySubmitting(true);
    try {
      const body: Record<string, unknown> = {
        action: "delay",
        releaseDate: delayReleaseDate,
        reason: delayReason.trim() || undefined,
      };

      if (delayTarget.bulk) {
        body.ids = delayTarget.ids;
        try {
          await apiClient.post("/api/admin/preorders", body);
          toast.success("Selected pre-orders updated");
          setDelayTarget(null);
          list.refetch();
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Failed to update pre-orders",
          );
        }
        return;
      }

      try {
        await apiClient.put(
          `/api/${scope}/preorders/${delayTarget.ids[0]}`,
          body,
        );
        toast.success("Pre-order release date updated");
        setDelayTarget(null);
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update pre-order",
        );
      }
    } finally {
      setIsDelaySubmitting(false);
    }
  }, [
    delayReason,
    delayReleaseDate,
    delayTarget,
    list,
    scope,
  ]);

  const runBulkAction = useCallback(
    async (
      items: PreorderOrder[],
      action: "ready" | "payment_due" | "cancel" | "delay",
    ) => {
      if (scope !== "admin" || items.length === 0) return;
      if (action === "delay") {
        setDelayTarget({ ids: items.map((item) => item._id), bulk: true });
        setDelayReleaseDate("");
        setDelayReason("");
        return;
      }
      const body: Record<string, unknown> = {
        action,
        ids: items.map((item) => item._id),
      };
      if (
        action === "cancel" &&
        !window.confirm(
          `Cancel ${items.length} selected pre-order(s) and refund everything the customers have paid?`,
        )
      ) {
        return;
      }
      try {
        const result = await apiClient.post<{
          refunded?: number;
          refundsNeedingAttention?: Array<{ orderNumber?: string; reason?: string }>;
        }>("/api/admin/preorders", body);
        const needsAttention = result?.refundsNeedingAttention || [];
        if (action === "cancel" && needsAttention.length > 0) {
          // Named rather than counted: an admin has to go and refund these by
          // hand, and "3 failed" sends them hunting through the whole list.
          toast.warning(
            `Cancelled, but ${needsAttention.length} refund(s) need to be issued by hand: ${needsAttention
              .map((row) => row.orderNumber)
              .filter(Boolean)
              .join(", ")}`,
          );
        } else if (action === "cancel") {
          toast.success(
            `Cancelled and refunded ${result?.refunded ?? items.length} pre-order(s)`,
          );
        } else {
          toast.success("Selected pre-orders updated");
        }
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update pre-orders",
        );
      }
    },
    [list, scope],
  );

  const exportCsv = useCallback(() => {
    const params = new URLSearchParams();
    params.set("format", "csv");
    if (list.search.trim()) params.set("search", list.search.trim());
    if (list.activeTab === "due_soon" || list.activeTab === "overdue") {
      params.set("view", list.activeTab);
    } else if (list.activeTab !== "all") {
      params.set("status", list.activeTab);
    }
    // A file download, not a page: the route answers with the CSV, so the
    // document navigates to it and the browser saves the response.
    window.location.assign(
      new URL(`/api/admin/preorders?${params.toString()}`, window.location.origin).href,
    );
  }, [list.activeTab, list.search]);

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: "All" },
      { id: "reserved", label: "Reserved" },
      { id: "payment_due", label: "Payment due" },
      { id: "delayed", label: "Delayed" },
      { id: "ready", label: "Ready" },
      { id: "due_soon", label: "Due soon" },
      { id: "overdue", label: "Overdue" },
      { id: "cancelled", label: "Cancelled" },
    ],
    [],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "status",
        label: "Status",
        type: "select",
        options: tabs.map((tab) => ({ label: tab.label, value: tab.id })),
      },
    ],
    [tabs],
  );

  const columns = useMemo<DataTableColumn<PreorderOrder>[]>(
    () => [
      {
        id: "order",
        header: "Pre-order",
        className: "w-[126px] max-w-[126px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => (
          <div className="min-w-0">
            <Link
              href={`/${locale}/${scope}/orders/${row._id}`}
              className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.orderNumber}
            </Link>
            <p className="text-xs text-muted-foreground">
              <DateCell date={row.createdAt} format="medium" />
            </p>
          </div>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        className: "w-[174px] max-w-[174px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => (
          <div className="min-w-0">
            <TextCell value={row.customerId?.name || "Customer"} />
            <p className="truncate text-xs text-muted-foreground">
              {row.customerId?.email || "No email"}
            </p>
          </div>
        ),
      },
      {
        id: "items",
        header: "Items",
        className: "w-[230px] max-w-[230px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => {
          const items = getPreorderItems(row, scope);
          return (
            <div className="min-w-0">
              <TextCell value={getPurchasedLabel(items)} truncate maxWidth="205px" />
              <p className="text-xs text-muted-foreground">
                {getItemsCount(items)} reserved
              </p>
            </div>
          );
        },
      },
      {
        id: "release",
        header: "Expected",
        className: "w-[104px] max-w-[104px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => <DateCell date={getReleaseDate(row, scope)} format="medium" />,
      },
      {
        id: "preorderStatus",
        header: "Pre-order status",
        className: "w-[134px] max-w-[134px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => {
          const status = getPreorderStatus(row, scope);
          return (
            <span
              className={`${STATUS_CHIP_CLASS} ${getPreorderStatusStyles(status)}`}
            >
              {PREORDER_STATUS_LABELS[status] || status}
            </span>
          );
        },
      },
      {
        id: "fulfillment",
        header: "Fulfillment",
        className: "w-[110px] max-w-[110px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => (
          <span className={`${STATUS_CHIP_CLASS} ${getOrderStatusStyles(row.status)}`}>
            {ORDER_STATUS_LABELS[row.status] || row.status}
          </span>
        ),
      },
      {
        id: "payment",
        header: "Payment",
        className: "w-[92px] max-w-[92px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => (
          <span
            className={`${STATUS_CHIP_CLASS} ${getPaymentStatusStyles(row.paymentStatus)}`}
          >
            {PAYMENT_STATUS_LABELS[row.paymentStatus] || row.paymentStatus}
          </span>
        ),
      },
      {
        id: "terms",
        header: "Terms",
        className: "w-[124px] max-w-[124px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => {
          const mode = row.preorderPaymentMode || "full";
          const label =
            mode === "deposit"
              ? "Deposit"
              : mode === "pay_later"
                ? "Pay later"
                : "Full";
          const dueNow = `Due now ${formatPrice(row.preorderDepositAmount || 0)}`;
          const later = row.preorderOutstandingAmount
            ? `Later ${formatPrice(row.preorderOutstandingAmount)}`
            : null;
          // One amount per line: side by side they ran past this fixed-width
          // column (cells are `whitespace-nowrap`) and printed over the Subtotal.
          return (
            <div className="min-w-0">
              <div className="font-medium">{label}</div>
              {mode !== "full" ? (
                <>
                  <p className="truncate text-xs text-muted-foreground" title={dueNow}>
                    {dueNow}
                  </p>
                  {later ? (
                    <p className="truncate text-xs text-muted-foreground" title={later}>
                      {later}
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        },
      },
      {
        id: "total",
        header: scope === "vendor" ? "Subtotal" : "Total",
        className: "w-[92px] max-w-[92px] !px-4",
        headerClassName: "!px-4",
        cell: (row) => {
          const subOrder = getSubOrder(row);
          const value = scope === "vendor" ? subOrder?.subtotal || 0 : row.total;
          return <span className="font-medium">{formatPrice(value)}</span>;
        },
      },
    ],
    [formatPrice, locale, scope],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: "Pre-orders",
      }),
    [],
  );

  const rowActions = useCallback(
    (row: PreorderOrder): DataTableAction[] => {
      const preorderStatus = getPreorderStatus(row, scope);
      // Only while the balance is still owed: an order whose balance was
      // collected (online, or recorded by an admin) moves straight to
      // fulfilment rather than asking the shopper to pay it again.
      const hasOutstandingBalance = getPreorderBalanceDue(row) > 0;
      const actions: DataTableAction[] = [
        {
          id: "view",
          label: "View order",
          icon: <Eye className="h-4 w-4" />,
          href: `/${locale}/${scope}/orders/${row._id}`,
        },
      ];

      if (
        canEditPreorder &&
        (preorderStatus === "reserved" || preorderStatus === "delayed")
      ) {
        actions.push({
          id: hasOutstandingBalance ? "payment_due" : "ready",
          label: hasOutstandingBalance
            ? "Request balance"
            : "Move to fulfillment",
          icon: hasOutstandingBalance ? (
            <CreditCard className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          ),
          onClick: () =>
            void runAction(
              row._id,
              hasOutstandingBalance ? "payment_due" : "ready",
            ),
        });
        // A vendor moves their own date too — they are the one who knows when
        // the goods arrive. Bulk updates stay admin-only: they post to the
        // admin collection route, which a vendor cannot reach.
        actions.push({
          id: "delay",
          label: "Update release date",
          icon: <Clock3 className="h-4 w-4" />,
          onClick: () => void runDelayAction(row._id),
        });
      }

      if (
        canEditPreorder &&
        preorderStatus === "payment_due" &&
        hasOutstandingBalance
      ) {
        actions.push({
          id: "payment_due",
          label: "Send balance reminder",
          icon: <CreditCard className="h-4 w-4" />,
          onClick: () => void runAction(row._id, "payment_due"),
        });
      }

      // Paid, but still on `payment_due`: the balance landed while its stock
      // was not recorded yet (the settle path then leaves it waiting), or a
      // vendor's consignment was released before the money came in. Nothing
      // else on the row moves it on, so it sat there paid for good.
      if (
        canEditPreorder &&
        preorderStatus === "payment_due" &&
        !hasOutstandingBalance
      ) {
        actions.push({
          id: "ready",
          label: "Move to fulfillment",
          icon: <CheckCircle2 className="h-4 w-4" />,
          onClick: () => void runAction(row._id, "ready"),
        });
      }

      // The way out for a balance the store cannot collect online — a deposit
      // taken on a gateway that cannot be charged a second time. Without it
      // those orders stay part-paid for ever.
      if (scope === "admin" && canEditPreorder && hasOutstandingBalance) {
        actions.push({
          id: "record-balance",
          label: "Record balance received",
          icon: <Banknote className="h-4 w-4" />,
          onClick: () => {
            setBalanceTarget({
              id: row._id,
              orderNumber: row.orderNumber,
              amount: getPreorderBalanceDue(row),
            });
            setBalanceMethod("Bank transfer");
            setBalanceReference("");
            setBalanceNote("");
          },
        });
      }

      if (
        canCancelPreorder &&
        preorderStatus !== "cancelled" &&
        preorderStatus !== "fulfilled"
      ) {
        actions.push({
          id: "cancel",
          label: "Cancel pre-order",
          icon: <XCircle className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => void runAction(row._id, "cancel"),
        });
      }

      return actions;
    },
    [canCancelPreorder, canEditPreorder, locale, runAction, runDelayAction, scope],
  );

  const toolbarActions = useMemo(
    () =>
      scope === "admin"
        ? [
            ...(tableHeader.toolbarActions || []),
            {
              id: "export",
              label: "Export CSV",
              icon: <Download className="h-4 w-4" />,
              onClick: exportCsv,
            },
          ]
        : tableHeader.toolbarActions,
    [exportCsv, scope, tableHeader.toolbarActions],
  );

  const bulkActions = useMemo(
    () =>
      scope === "admin"
        ? [
            {
              id: "ready",
              label: "Move to fulfillment",
              icon: <CheckCircle2 className="h-4 w-4" />,
              onClick: (items: PreorderOrder[]) => runBulkAction(items, "ready"),
            },
            {
              id: "payment_due",
              label: "Request balances",
              icon: <CreditCard className="h-4 w-4" />,
              onClick: (items: PreorderOrder[]) =>
                runBulkAction(items, "payment_due"),
            },
            {
              id: "delay",
              label: "Update release date",
              icon: <Clock3 className="h-4 w-4" />,
              onClick: (items: PreorderOrder[]) => runBulkAction(items, "delay"),
            },
            {
              id: "cancel",
              label: "Cancel pre-orders",
              icon: <XCircle className="h-4 w-4" />,
              variant: "destructive" as const,
              onClick: (items: PreorderOrder[]) => runBulkAction(items, "cancel"),
            },
          ]
        : undefined,
    [runBulkAction, scope],
  );

  return (
    <>
      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        selectable={scope === "admin"}
        selectedItems={selectedOrders}
        onSelectionChange={setSelectedOrders}
        bulkActions={bulkActions}
        isLoading={list.isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        titleIcon={<CalendarClock className="h-5 w-5" />}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        searchable
        searchPlaceholder="Search order or product"
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={{ status: list.activeTab }}
        onFilterChange={(_, value) => list.handleTabChange(value || "all")}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        rowActions={rowActions}
        rowActionsHeader="Actions"
        rowActionsVariant="dropdown"
        onRowClick={(row) =>
          router.push(`/${locale}/${scope}/orders/${row._id}`)
        }
        emptyMessage="Pre-orders will appear here after customers reserve products marked for pre-order."
        emptyIcon={<PackageCheck className="h-6 w-6" />}
        actions={tableHeader.actions}
        toolbarActions={toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        className="[&_table]:w-full [&_table]:table-fixed [&_thead_th]:text-xs [&_tbody_td]:text-xs [&_th:last-child]:!w-[74px] [&_th:last-child]:!px-4 [&_td:last-child]:!px-4"
        dense
      />

      <Dialog
        open={Boolean(delayTarget)}
        onOpenChange={(open) => {
          if (!open && !isDelaySubmitting) setDelayTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update release date</DialogTitle>
            <DialogDescription>
              {scope === "vendor"
                ? "The customer is told the new date and your reason, and offered a full refund if it no longer works for them."
                : "Customers are told the new expected ship date and the reason, and offered a full refund if it no longer works for them."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="preorder-delay-date">
                New expected ship date
              </label>
              <Input
                id="preorder-delay-date"
                type="date"
                value={delayReleaseDate}
                onChange={(event) => setDelayReleaseDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="preorder-delay-reason"
              >
                Delay reason
                {scope === "vendor" ? (
                  <span className="text-destructive"> *</span>
                ) : null}
              </label>
              <Textarea
                id="preorder-delay-reason"
                value={delayReason}
                onChange={(event) => setDelayReason(event.target.value)}
                placeholder="Supplier delay, customs hold, production update..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDelayTarget(null)}
              disabled={isDelaySubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitDelayAction()}
              disabled={
                !delayReleaseDate ||
                isDelaySubmitting ||
                // The server refuses a vendor's delay without a reason; say so
                // before the round trip rather than after it.
                (scope === "vendor" && !delayReason.trim())
              }
            >
              {isDelaySubmitting ? "Updating..." : "Update and notify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(balanceTarget)}
        onOpenChange={(open) => {
          if (!open && !isBalanceSubmitting) setBalanceTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record balance received</DialogTitle>
            <DialogDescription>
              For money that reached you outside the store — a bank transfer,
              cash, or a payment link on another gateway. This settles the order
              and releases it for fulfillment; it does not charge anyone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">
                  {balanceTarget?.orderNumber}
                </span>
                <span className="font-semibold tabular-nums">
                  {formatPrice(balanceTarget?.amount || 0)}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                The whole balance, or nothing — a part payment would mark the
                order paid while it is not.
              </p>
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="preorder-balance-method"
              >
                How it was paid
              </label>
              <Input
                id="preorder-balance-method"
                value={balanceMethod}
                onChange={(event) => setBalanceMethod(event.target.value)}
                placeholder="Bank transfer, cash, mobile money..."
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="preorder-balance-reference"
              >
                Reference
              </label>
              <Input
                id="preorder-balance-reference"
                value={balanceReference}
                onChange={(event) => setBalanceReference(event.target.value)}
                placeholder="Transfer id, receipt number..."
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="preorder-balance-note"
              >
                Internal note (optional)
              </label>
              <Textarea
                id="preorder-balance-note"
                value={balanceNote}
                onChange={(event) => setBalanceNote(event.target.value)}
                placeholder="Where the proof of payment lives, who confirmed it..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBalanceTarget(null)}
              disabled={isBalanceSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitRecordBalance()}
              disabled={!balanceReference.trim() || isBalanceSubmitting}
            >
              {isBalanceSubmitting
                ? "Recording..."
                : `Record ${formatPrice(balanceTarget?.amount || 0)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
