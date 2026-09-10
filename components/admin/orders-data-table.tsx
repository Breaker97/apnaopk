"use client";

import Link from "next/link";
import {
  Circle,
  CheckCircle,
  Clock3,
  ChevronsUpDown,
  Download,
  Eye,
  Package,
  Plus,
  Trash2,
  Truck,
  Upload,
  XCircle,
} from "lucide-react";
import {
  DataTable,
  DateCell,
  TextCell,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  canTransitionOrderStatus,
  getOrderStatusActions,
  type OrderStatusActionDefinition,
} from "@/lib/orders/order-status-workflow";

interface AdminOrder {
  _id: string;
  orderNumber: string;
  customerId?: { name?: string; email?: string };
  total: number;
  status: string;
  paymentStatus: string;
  channel?: string;
  createdAt: string;
  items: {
    name: string;
    quantity: number;
    productId?: string | { _id?: string } | null;
  }[];
}

interface StatusDialogState {
  orderIds: string[];
  count: number;
  skipped?: number;
}

interface OrdersDataTableProps {
  locale: string;
  area?: "admin" | "staff";
  readOnly?: boolean;
  /**
   * Rows for the current query string, fetched by the page's server component.
   * This table does not fetch: every control is a navigation, the server
   * re-runs the query, and the new rows stream back. See
   * `hooks/use-list-navigation.ts`.
   */
  data: AdminOrder[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/** Filter ids this table reads out of the query string. */
const ORDER_FILTER_IDS = ["status", "paymentStatus", "channel"];

function getItemsCount(items: AdminOrder["items"]) {
  return items.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

function getTwoWordProductName(name?: string) {
  const value = name?.trim();
  if (!value) return "—";

  const words = value.split(/\s+/);
  return words.length > 2 ? `${words.slice(0, 2).join(" ")}...` : value;
}

function getPurchasedLabel(items: AdminOrder["items"]) {
  if (!items?.length) return "—";
  return getTwoWordProductName(items[0]?.name);
}

function getFullPurchasedLabel(items: AdminOrder["items"]) {
  if (!items?.length) return "—";
  return items[0]?.name || "—";
}

function escapeCsvValue(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function getFirstItemProductId(items: AdminOrder["items"]) {
  const firstProductId = items?.[0]?.productId;
  if (!firstProductId) return null;
  if (typeof firstProductId === "string") return firstProductId;
  if (typeof firstProductId === "object" && typeof firstProductId._id === "string") {
    return firstProductId._id;
  }
  return null;
}

function getFulfillmentStatus(orderStatus: string) {
  if (orderStatus === "cancelled") return "cancelled";
  if (orderStatus === "delivered") return "fulfilled";
  if (orderStatus === "shipped") return "in_transit";
  return "unfulfilled";
}

function getDeliveryStatus(orderStatus: string) {
  if (orderStatus === "cancelled") return "cancelled";
  if (orderStatus === "delivered") return "delivered";
  if (orderStatus === "shipped") return "in_transit";
  return "not_shipped";
}

function getPaymentStatusStyles(paymentStatus: string) {
  const map: Record<string, string> = {
    paid:
      "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200",
    pending:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
    partially_paid:
      "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300",
    refunded:
      "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
    partially_refunded:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300",
  };
  return (
    map[paymentStatus] ||
    "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200"
  );
}

function getFulfillmentStyles(status: string) {
  const map: Record<string, string> = {
    unfulfilled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    in_transit:
      "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    fulfilled:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  };
  return (
    map[status] ||
    "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200"
  );
}

function getDeliveryStyles(status: string) {
  const map: Record<string, string> = {
    not_shipped:
      "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200",
    in_transit:
      "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    delivered:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  };
  return (
    map[status] ||
    "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200"
  );
}

export function OrdersDataTable({
  locale,
  area = "admin",
  readOnly = false,
  data,
  pagination,
}: OrdersDataTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const { formatPrice } = useCurrency();

  const [selectedOrders, setSelectedOrders] = useState<AdminOrder[]>([]);
  const [shipDialog, setShipDialog] = useState<StatusDialogState | null>(null);
  const [cancelDialog, setCancelDialog] = useState<StatusDialogState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<StatusDialogState | null>(null);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const basePath = `/${locale}/${area}`;

  const list = useListNavigation<AdminOrder>({
    items: data,
    pagination,
    tabParam: "view",
    filterIds: ORDER_FILTER_IDS,
  });

  const updateOrderStatus = useCallback(
    async (
      orderId: string,
      newStatus: string,
      payload: Record<string, string | undefined> = {},
    ) => {
      try {
        await apiClient.put(`/api/admin/orders/${orderId}`, {
          status: newStatus,
          ...payload,
        });
        return { ok: true, message: "" };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error && error.message
              ? error.message
              : t("orders.orderUpdateFailed"),
        };
      }
    },
    [t],
  );

  const runStatusUpdates = useCallback(
    async (
      orderIds: string[],
      newStatus: string,
      payload: Record<string, string | undefined> = {},
      skipped = 0,
    ) => {
      if (orderIds.length === 0) return false;

      setIsUpdatingStatus(true);
      try {
        const results = await Promise.all(
          orderIds.map((orderId) => updateOrderStatus(orderId, newStatus, payload)),
        );
        const updated = results.filter((result) => result.ok).length;
        const failed = results.length - updated;

        if (updated > 0) {
          setSelectedOrders([]);
          list.refetch();
        }

        if (failed > 0 || skipped > 0) {
          const firstFailure = results.find((result) => !result.ok)?.message;
          toast.error(
            [
              `${updated} updated`,
              failed > 0 ? `${failed} failed` : null,
              skipped > 0 ? `${skipped} skipped` : null,
              firstFailure ? `First issue: ${firstFailure}` : null,
            ]
              .filter(Boolean)
              .join(". "),
          );
          return failed === 0;
        }

        toast.success(
          orderIds.length === 1
            ? t("orders.orderUpdated")
            : `${updated} orders updated`,
        );
        return true;
      } finally {
        setIsUpdatingStatus(false);
      }
    },
    [list, t, updateOrderStatus],
  );

  const openShipDialog = useCallback((state: StatusDialogState) => {
    setTrackingNumber("");
    setCarrier("");
    setShipDialog(state);
  }, []);

  const openCancelDialog = useCallback((state: StatusDialogState) => {
    setCancelReason("");
    setCancelDialog(state);
  }, []);

  const handleStatusAction = useCallback(
    (order: AdminOrder, action: OrderStatusActionDefinition) => {
      const state = { orderIds: [order._id], count: 1, skipped: 0 };
      if (action.to === "shipped") {
        openShipDialog(state);
        return;
      }
      if (action.to === "cancelled") {
        openCancelDialog(state);
        return;
      }
      void runStatusUpdates([order._id], action.to);
    },
    [openCancelDialog, openShipDialog, runStatusUpdates],
  );

  const handleBulkUpdateStatus = useCallback(
    async (items: AdminOrder[], newStatus: string) => {
      const eligible = items.filter((order) =>
        canTransitionOrderStatus(order.status, newStatus),
      );
      const skipped = items.length - eligible.length;

      if (eligible.length === 0) {
        toast.error(
          t("admin.ordersPage.bulk.noEligibleOrders"),
        );
        return;
      }

      const state = {
        orderIds: eligible.map((order) => order._id),
        count: eligible.length,
        skipped,
      };

      if (newStatus === "cancelled") {
        openCancelDialog(state);
        return;
      }

      await runStatusUpdates(state.orderIds, newStatus, {}, skipped);
    },
    [openCancelDialog, runStatusUpdates, t],
  );

  const handleSubmitShipment = useCallback(async () => {
    if (!shipDialog) return;
    const ok = await runStatusUpdates(
      shipDialog.orderIds,
      "shipped",
      {
        trackingNumber: trackingNumber.trim() || undefined,
        carrier: carrier.trim() || undefined,
      },
      shipDialog.skipped || 0,
    );
    if (ok) setShipDialog(null);
  }, [carrier, runStatusUpdates, shipDialog, trackingNumber]);

  const handleSubmitCancellation = useCallback(async () => {
    if (!cancelDialog) return;
    const ok = await runStatusUpdates(
      cancelDialog.orderIds,
      "cancelled",
      { cancelReason: cancelReason.trim() || undefined },
      cancelDialog.skipped || 0,
    );
    if (ok) setCancelDialog(null);
  }, [cancelDialog, cancelReason, runStatusUpdates]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteDialog) return;

    setIsDeleting(true);
    try {
      const results = await Promise.all(
        deleteDialog.orderIds.map(async (orderId) => {
          try {
            await apiClient.delete(`/api/admin/orders/${orderId}`);
            return { ok: true, message: "" };
          } catch (error) {
            return {
              ok: false,
              message:
                error instanceof Error && error.message
                  ? error.message
                  : t("orders.orderUpdateFailed"),
            };
          }
        }),
      );
      const deleted = results.filter((result) => result.ok).length;
      const failed = results.length - deleted;

      if (deleted > 0) {
        setSelectedOrders([]);
        list.refetch();
      }

      if (failed > 0) {
        const firstFailure = results.find((result) => !result.ok)?.message;
        toast.error(
          [
            `${deleted} deleted`,
            `${failed} failed`,
            firstFailure ? `First issue: ${firstFailure}` : null,
          ]
            .filter(Boolean)
            .join(". "),
        );
        return;
      }

      toast.success(
        deleted === 1 ? "Order deleted" : `${deleted} orders deleted`,
      );
      setDeleteDialog(null);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteDialog, list, t]);

  const getActionIcon = useCallback((actionId: string) => {
    if (actionId === "mark_processing" || actionId === "mark_ready_to_fulfill")
      return <Package className="h-4 w-4" />;
    if (actionId === "mark_shipped") return <Truck className="h-4 w-4" />;
    if (actionId === "mark_delivered") return <CheckCircle className="h-4 w-4" />;
    return <XCircle className="h-4 w-4" />;
  }, []);

  const columns = useMemo<DataTableColumn<AdminOrder>[]>(
    () => [
      {
        id: "orderNumber",
        header: t("checkout.orderNumber"),
        cell: (row) => (
          <div className="min-w-0">
            <Link
              href={`${basePath}/orders/${row._id}`}
              className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.orderNumber}
            </Link>
            <div className="text-xs text-muted-foreground">
              <DateCell date={row.createdAt} format="relative" />
            </div>
          </div>
        ),
        className: "w-[170px]",
        sortable: true,
      },
      {
        id: "purchased",
        header: t("admin.ordersPage.table.purchased"),
        cell: (row) => {
          const label = getPurchasedLabel(row.items);
          const fullLabel = getFullPurchasedLabel(row.items);
          const productId = getFirstItemProductId(row.items);

          if (!productId) {
            return (
              <TextCell
                value={label}
                truncate
                maxWidth="220px"
                className="font-medium text-slate-700 dark:text-slate-300"
              />
            );
          }

          return (
            <Link
              href={`${basePath}/products/${productId}/edit`}
              className="block max-w-[220px] truncate font-medium text-slate-700 hover:text-blue-600 hover:underline dark:text-slate-300 dark:hover:text-blue-400"
              title={fullLabel}
              onClick={(e) => e.stopPropagation()}
            >
              {row.items.length > 1
                ? `${label} ${t("admin.ordersPage.plusMore", {
                    count: row.items.length - 1,
                  })}`
                : label}
            </Link>
          );
        },
        className: "w-[220px] hidden xl:table-cell",
        headerClassName: "hidden xl:table-cell",
      },
      {
        id: "createdAt",
        header: t("admin.ordersPage.table.date"),
        cell: (row) => <DateCell date={row.createdAt} format="medium" />,
        className: "w-[140px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
        sortable: true,
      },
      {
        id: "customer",
        header: t("admin.ordersPage.table.customer"),
        cell: (row) => (
          <div className="min-w-0">
            <TextCell value={row.customerId?.name || t("common.guest")} />
            <div className="text-xs text-muted-foreground">
              <TextCell value={row.customerId?.email} truncate maxWidth="220px" />
            </div>
          </div>
        ),
        className: "w-[260px]",
      },
      {
        id: "channel",
        header: t("admin.ordersPage.table.channel"),
        cell: (row) => (
          <TextCell
            value={
              row.channel === "pos"
                ? t("admin.ordersPage.channel.pos")
                : t("admin.ordersPage.channel.online")
            }
          />
        ),
        className: "w-[140px] hidden xl:table-cell",
        headerClassName: "hidden xl:table-cell",
      },
      {
        id: "total",
        header: t("common.total"),
        cell: (row) => (
          <TextCell value={formatPrice(row.total)} className="block w-full text-right" />
        ),
        className: "w-[140px]",
        headerClassName: "text-right [&>div]:justify-center",
        sortable: true,
      },
      {
        id: "paymentStatus",
        header: t("admin.ordersPage.table.payment"),
        cell: (row) => {
          const labelMap: Record<string, string> = {
            pending: t("orders.pending"),
            paid: t("admin.ordersPage.paymentStatus.paid"),
            partially_paid: t("admin.ordersPage.paymentStatus.partiallyPaid"),
            refunded: t("orders.refunded"),
            partially_refunded: t("admin.ordersPage.paymentStatus.partiallyRefunded"),
          };
          const label = labelMap[row.paymentStatus] || row.paymentStatus;
          return (
            <span
              className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium ${getPaymentStatusStyles(row.paymentStatus)}`}
            >
              <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
              {label}
            </span>
          );
        },
        className: "w-[170px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
        sortable: true,
      },
      {
        id: "status",
        header: t("admin.ordersPage.table.fulfillment"),
        cell: (row) => {
          const status = getFulfillmentStatus(row.status);
          const labelMap: Record<string, string> = {
            unfulfilled: t("admin.ordersPage.fulfillment.unfulfilled"),
            in_transit: t("admin.ordersPage.fulfillment.inTransit"),
            fulfilled: t("admin.ordersPage.fulfillment.fulfilled"),
            cancelled: t("orders.cancelled"),
          };
          return (
            <span
              className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium ${getFulfillmentStyles(status)}`}
            >
              <Clock3 className="h-3.5 w-3.5" />
              {labelMap[status] || status}
            </span>
          );
        },
        className: "w-[150px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
        sortable: true,
      },
      {
        id: "items",
        header: t("common.items"),
        cell: (row) => (
          <TextCell
            value={`${getItemsCount(row.items)} ${
              getItemsCount(row.items) === 1
                ? t("admin.ordersPage.item")
                : t("common.items")
            }`}
          />
        ),
        className: "w-[110px] text-center hidden md:table-cell",
        headerClassName: "text-center hidden md:table-cell",
      },
      {
        id: "deliveryStatus",
        header: t("admin.ordersPage.table.delivery"),
        cell: (row) => {
          const status = getDeliveryStatus(row.status);
          const labelMap: Record<string, string> = {
            not_shipped: t("admin.ordersPage.delivery.notShipped"),
            in_transit: t("admin.ordersPage.delivery.inTransit"),
            delivered: t("orders.delivered"),
            cancelled: t("orders.cancelled"),
          };
          return (
            <span
              className={`inline-flex items-center rounded-sm px-2 py-1 text-[12px] font-medium ${getDeliveryStyles(status)}`}
            >
              {labelMap[status] || status}
            </span>
          );
        },
        className: "w-[140px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
    ],
    [basePath, formatPrice, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("admin.ordersPage.tabs.all") },
      {
        id: "unfulfilled",
        label: t("admin.ordersPage.tabs.unfulfilled"),
      },
      { id: "unpaid", label: t("admin.ordersPage.tabs.unpaid") },
      { id: "open", label: t("admin.ordersPage.tabs.open") },
      {
        id: "archived",
        label: t("admin.ordersPage.tabs.archived"),
      },
    ],
    [t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "status",
        label: t("admin.ordersPage.filters.orderStatus"),
        type: "select",
        options: [
          { label: t("admin.ordersPage.tabs.all"), value: "all" },
          { label: t("orders.pending"), value: "pending" },
          { label: t("orders.processing"), value: "processing" },
          { label: t("orders.shipped"), value: "shipped" },
          { label: t("orders.delivered"), value: "delivered" },
          { label: t("orders.cancelled"), value: "cancelled" },
        ],
      },
      {
        id: "paymentStatus",
        label: t("admin.ordersPage.table.payment"),
        type: "select",
        options: [
          { label: t("admin.ordersPage.tabs.all"), value: "all" },
          { label: t("orders.pending"), value: "pending" },
          { label: t("admin.ordersPage.paymentStatus.paid"), value: "paid" },
          {
            label: t("admin.ordersPage.paymentStatus.partiallyPaid"),
            value: "partially_paid",
          },
          { label: t("orders.refunded"), value: "refunded" },
          {
            label: t("admin.ordersPage.paymentStatus.partiallyRefunded"),
            value: "partially_refunded",
          },
        ],
      },
      {
        id: "channel",
        label: t("admin.ordersPage.table.channel"),
        type: "select",
        options: [
          { label: t("admin.ordersPage.tabs.all"), value: "all" },
          {
            label: t("admin.ordersPage.channel.online"),
            value: "online",
          },
          { label: "POS", value: "pos" },
        ],
      },
    ],
    [t],
  );

  const handleExportCurrentView = useCallback(() => {
    const headers = [
      "Order number",
      "Date",
      "Customer",
      "Email",
      "Channel",
      "Status",
      "Payment status",
      "Items",
      "Total",
    ];
    const rows = list.items.map((order) => [
      order.orderNumber,
      order.createdAt,
      order.customerId?.name || "",
      order.customerId?.email || "",
      order.channel || "online",
      order.status,
      order.paymentStatus,
      getItemsCount(order.items),
      order.total,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvValue).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(
      t("admin.ordersPage.exportSuccess"),
    );
  }, [list.items, t]);

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.orders"),
        importExportAction: {
          id: "import-export",
          label: t("admin.productsDataTable.actions.importExport"),
          icon: <ChevronsUpDown className="h-4 w-4" />,
          variant: "outline",
          items: [
            {
              id: "toolbar-export",
              label: t("admin.ordersPage.export"),
              icon: <Download className="h-4 w-4" />,
              onClick: handleExportCurrentView,
            },
            {
              id: "toolbar-import",
              label: t("admin.productsDataTable.actions.import"),
              icon: <Upload className="h-4 w-4" />,
              disabled: true,
            },
          ],
        },
        addAction: readOnly
          ? undefined
          : {
              id: "create-order",
              label: t("admin.ordersPage.createOrder"),
              icon: <Plus className="h-4 w-4" />,
              href: `${basePath}/orders/create`,
            },
      }),
    [basePath, handleExportCurrentView, readOnly, t],
  );

  const bulkActions = useMemo<DataTableBulkAction<AdminOrder>[]>(
    () =>
      readOnly
        ? []
        : [
            {
              id: "processing",
              label: t("orders.markProcessing"),
              icon: <Package className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkUpdateStatus(items, "processing"),
            },
            {
              id: "shipped",
              label: t("orders.markShipped"),
              icon: <Truck className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkUpdateStatus(items, "shipped"),
            },
            {
              id: "delivered",
              label: t("orders.markDelivered"),
              icon: <CheckCircle className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkUpdateStatus(items, "delivered"),
            },
            {
              id: "cancelled",
              label: t("orders.cancelOrder"),
              icon: <XCircle className="h-4 w-4" />,
              variant: "destructive",
              onClick: (items) => handleBulkUpdateStatus(items, "cancelled"),
            },
            {
              id: "delete",
              label: t("common.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: (items) =>
                setDeleteDialog({
                  orderIds: items.map((order) => order._id),
                  count: items.length,
                }),
            },
          ],
    [handleBulkUpdateStatus, readOnly, t],
  );

  const rowActions = useCallback(
    (row: AdminOrder): DataTableAction[] => {
      const viewAction: DataTableAction = {
        id: "view",
        label: t("common.viewDetails"),
        icon: <Eye className="h-4 w-4" />,
        href: `${basePath}/orders/${row._id}`,
      };

      if (readOnly) return [viewAction];

      const statusActions: DataTableAction[] = getOrderStatusActions(row.status).map((action) => ({
        id: action.id,
        // The workflow constants carry English labels for server use; the row
        // menu shows the localized copy.
        label: t(`admin.orderDetails.statusAction.${action.id}`),
        icon: getActionIcon(action.id),
        variant: action.destructive ? ("destructive" as const) : undefined,
        onClick: () => handleStatusAction(row, action),
      }));

      const deleteAction: DataTableAction = {
        id: "delete",
        label: t("common.delete"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => setDeleteDialog({ orderIds: [row._id], count: 1 }),
      };

      return [viewAction, ...statusActions, deleteAction];
    },
    [basePath, getActionIcon, handleStatusAction, readOnly, t],
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
        selectable
        selectedItems={selectedOrders}
        onSelectionChange={setSelectedOrders}
        bulkActions={bulkActions}
        searchable
        searchPlaceholder={t("orders.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={list.filters}
        onFilterChange={list.handleFilterChange}
        toolbarActions={tableHeader.toolbarActions}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        paginationLabels={{
          showing: t("admin.ordersPage.pagination.showing"),
          to: t("admin.ordersPage.pagination.to"),
          of: t("admin.ordersPage.pagination.of"),
          results: t("admin.ordersPage.pagination.results"),
          rowsPerPage: t("admin.ordersPage.pagination.rowsPerPage"),
        }}
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        rowActions={rowActions}
        rowActionsHeader={t("common.actions")}
        rowActionsVariant="dropdown"
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-xs"
        onRowClick={(row) => router.push(`${basePath}/orders/${row._id}`)}
        emptyMessage={t("orders.noOrdersFound")}
      />

      <Dialog open={Boolean(shipDialog)} onOpenChange={(open) => !open && setShipDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {shipDialog?.count === 1 ? "Mark as shipped" : "Mark orders as shipped"}
            </DialogTitle>
            <DialogDescription>
              Add carrier details now so customers and support can track fulfillment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="order-carrier">Carrier</Label>
              <Input
                id="order-carrier"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                placeholder="DHL, FedEx, UPS"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="order-tracking-number">Tracking number</Label>
              <Input
                id="order-tracking-number"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder="Tracking number"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShipDialog(null)}
              disabled={isUpdatingStatus}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmitShipment()}
              disabled={isUpdatingStatus}
            >
              Mark shipped
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelDialog)}
        onOpenChange={(open) => !open && setCancelDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {cancelDialog?.count === 1 ? "Cancel order" : "Cancel orders"}
            </DialogTitle>
            <DialogDescription>
              Cancellation restores inventory for eligible orders and cannot be used after shipment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="order-cancel-reason">Reason</Label>
            <Textarea
              id="order-cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Optional note for the order history"
              className="min-h-24"
            />
            {cancelDialog?.skipped ? (
              <p className="text-sm text-muted-foreground">
                {cancelDialog.skipped} selected orders will be skipped because
                their current status cannot be cancelled.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelDialog(null)}
              disabled={isUpdatingStatus}
            >
              Keep order
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleSubmitCancellation()}
              disabled={isUpdatingStatus}
            >
              {cancelDialog?.count === 1 ? "Cancel order" : "Cancel orders"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteDialog)}
        onOpenChange={(open) => !open && !isDeleting && setDeleteDialog(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteDialog?.count === 1
                ? "Delete order"
                : `Delete ${deleteDialog?.count} orders`}
            </DialogTitle>
            <DialogDescription>
              This permanently removes the order record — it cannot be undone.
              Unshipped orders return their reserved stock; shipped or delivered
              orders keep inventory as is. To restock a fulfilled order, cancel
              or refund it instead of deleting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialog(null)}
              disabled={isDeleting}
            >
              Keep {deleteDialog?.count === 1 ? "order" : "orders"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleConfirmDelete()}
              disabled={isDeleting}
            >
              {isDeleting
                ? "Deleting..."
                : deleteDialog?.count === 1
                  ? "Delete order"
                  : "Delete orders"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
