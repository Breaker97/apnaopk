"use client";

import Link from "next/link";
import {
  ChevronsUpDown,
  CheckCircle,
  Clock3,
  Circle,
  Download,
  Eye,
  MapPin,
  Package,
  Plus,
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
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import { useTranslations } from "next-intl";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
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
import { Button } from "@/components/ui/button";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";

interface VendorOrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface VendorSubOrder {
  status: string;
  subtotal: number;
  commission: number;
  vendorEarnings: number;
  trackingNumber?: string;
  fulfillment?: {
    method: "delivery" | "pickup";
    pickup?: { status: "scheduled" | "ready" | "collected" };
  };
  items: VendorOrderItem[];
}

interface VendorOrder {
  _id: string;
  orderNumber: string;
  customerId?: { name?: string; email?: string };
  paymentStatus: string;
  createdAt: string;
  subOrders: VendorSubOrder[];
}

interface VendorOrdersTableProps {
  locale: string;
  canEditOrder?: boolean;
  canDeleteOrder?: boolean;
  canCreateOrder?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: VendorOrder[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function getSubOrder(order: VendorOrder): VendorSubOrder | null {
  return order.subOrders?.[0] || null;
}

function getPickup(subOrder: VendorSubOrder | null) {
  return subOrder?.fulfillment?.method === "pickup"
    ? subOrder.fulfillment.pickup
    : undefined;
}

function getItemsCount(items: VendorOrderItem[]) {
  return items.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

function getFulfillmentStatusStyles(status: string) {
  const map: Record<string, string> = {
    pending:
      "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    processing:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    shipped:
      "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    delivered:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    cancelled:
      "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  };
  return (
    map[status] ||
    "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200"
  );
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

function getPaymentLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pending",
    paid: "Paid",
    partially_paid: "Partially paid",
    refunded: "Refunded",
    partially_refunded: "Partially refunded",
  };
  return labels[status] || status;
}

function getFulfillmentLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Unfulfilled",
    processing: "Processing",
    shipped: "In transit",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  return labels[status] || status;
}

function isAllowedTransition(from: string, to: string) {
  const transitions: Record<string, string[]> = {
    pending: ["processing", "cancelled"],
    processing: ["shipped", "cancelled"],
    shipped: ["delivered", "cancelled"],
    delivered: [],
    cancelled: [],
  };
  return transitions[from]?.includes(to) ?? false;
}

export function VendorOrdersTable({
  locale,
  canEditOrder = false,
  canDeleteOrder = false,
  canCreateOrder = false,
  data,
  pagination,
}: VendorOrdersTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { formatPrice } = useCurrency();

  const [selectedOrders, setSelectedOrders] = useState<VendorOrder[]>([]);
  const [shipDialog, setShipDialog] = useState<{
    open: boolean;
    orderId: string;
  }>({ open: false, orderId: "" });
  const [trackingNumber, setTrackingNumber] = useState("");

  const list = useListNavigation<VendorOrder>({
    items: data,
    pagination,
    tabParam: "view",
    filterIds: ["status", "paymentStatus"],
  });

  const handleUpdateStatus = useCallback(
    async (orderId: string, newStatus: string, tracking?: string) => {
      try {
        await apiClient.put(`/api/vendor/orders/${orderId}`, {
          status: newStatus,
          trackingNumber: tracking,
        });

        toast.success(
          t("vendor.ordersTable.updated"),
        );
        setShipDialog({ open: false, orderId: "" });
        setTrackingNumber("");
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("vendor.ordersTable.updateFailed"),
        );
      }
    },
    [list, t],
  );

  const handleCancelOrder = useCallback(
    async (orderId: string) => {
      const confirmed = await confirm({
        title: t("vendor.ordersTable.cancelOrderTitle"),
        description: t("vendor.ordersTable.cancelOrderDescription"),
        confirmText: t("vendor.ordersTable.cancelOrderConfirm"),
        cancelText: t("vendor.ordersTable.cancelOrderKeep"),
        variant: "destructive",
      });

      if (!confirmed) return;
      await handleUpdateStatus(orderId, "cancelled");
    },
    [confirm, handleUpdateStatus, t],
  );

  const handleBulkUpdateStatus = useCallback(
    async (items: VendorOrder[], newStatus: string) => {
      const shouldProceed =
        newStatus !== "cancelled"
          ? true
          : await confirm({
              title: t("vendor.ordersTable.cancelOrdersTitle"),
              description: t("vendor.ordersTable.cancelOrdersDescription", {
                count: items.length,
              }),
              confirmText: t("vendor.ordersTable.cancelOrdersConfirm"),
              cancelText: t("vendor.ordersTable.cancelOrdersKeep"),
              variant: "destructive",
            });

      if (!shouldProceed) return;

      try {
        const results = await Promise.all(
          items.map(async (order) => {
            const subOrder = getSubOrder(order);
            if (
              !subOrder ||
              (getPickup(subOrder) && newStatus !== "cancelled") ||
              !isAllowedTransition(subOrder.status, newStatus)
            ) {
              return false;
            }

            try {
              await apiClient.put(`/api/vendor/orders/${order._id}`, {
                status: newStatus,
              });
              return true;
            } catch {
              return false;
            }
          }),
        );

        const successCount = results.filter(Boolean).length;
        setSelectedOrders([]);
        list.refetch();

        if (successCount === items.length) {
          toast.success(
            t("vendor.ordersTable.bulkUpdatedAll", {
              count: successCount,
            }),
          );
        } else if (successCount > 0) {
          toast.success(
            t("vendor.ordersTable.bulkUpdatedSome", {
              success: successCount,
              total: items.length,
            }),
          );
        } else {
          toast.error(
            t("vendor.ordersTable.bulkUpdatedNone"),
          );
        }
      } catch {
        toast.error(
          t("vendor.ordersTable.bulkUpdateFailed"),
        );
      }
    },
    [confirm, list, t],
  );

  const columns = useMemo<DataTableColumn<VendorOrder>[]>(
    () => [
      {
        id: "orderNumber",
        header: t("vendor.ordersTable.columns.order"),
        sortable: true,
        cell: (row) => (
          <div className="min-w-0">
            <Link
              href={`/${locale}/vendor/orders/${row._id}`}
              className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
            >
              {row.orderNumber}
            </Link>
            <div className="text-xs text-muted-foreground">
              <DateCell date={row.createdAt} format="relative" />
            </div>
          </div>
        ),
        className: "w-[180px]",
      },
      {
        id: "customer",
        header: t("vendor.ordersTable.columns.customer"),
        cell: (row) => (
          <div className="min-w-0">
            <TextCell
              value={
                row.customerId?.name ||
                t("vendor.ordersTable.guest")
              }
              className="text-sm"
            />
            <div className="text-xs text-muted-foreground">
              <TextCell value={row.customerId?.email} truncate maxWidth="220px" />
            </div>
          </div>
        ),
        className: "w-[260px]",
      },
      {
        id: "createdAt",
        header: t("vendor.ordersTable.columns.date"),
        sortable: true,
        cell: (row) => (
          <span className="text-sm">
            <DateCell date={row.createdAt} format="medium" />
          </span>
        ),
        className: "w-[140px]",
      },
      {
        id: "paymentStatus",
        header: t("vendor.ordersTable.columns.payment"),
        sortable: true,
        cell: (row) => (
          <span
            className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium ${getPaymentStatusStyles(row.paymentStatus)}`}
          >
            <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
            {t(`vendor.paymentStatus.${row.paymentStatus}`, {
              defaultMessage: getPaymentLabel(row.paymentStatus),
            })}
          </span>
        ),
        className: "w-[170px]",
      },
      {
        id: "fulfillmentStatus",
        header: t("vendor.ordersTable.columns.fulfillment"),
        cell: (row) => {
          const subOrder = getSubOrder(row);
          const pickup = getPickup(subOrder);
          const status = pickup?.status || subOrder?.status || "pending";
          return (
            <span
              className={`inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium ${getFulfillmentStatusStyles(status)}`}
            >
              {pickup ? <MapPin className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
              {pickup
                ? `${t("checkout.pickup.localPickup")} · ${t(`checkout.pickup.${status}`)}`
                : t(`vendor.fulfillmentStatus.${status}`, {
                    defaultMessage: getFulfillmentLabel(status),
                  })}
            </span>
          );
        },
        className: "w-[150px]",
      },
      {
        id: "items",
        header: t("vendor.ordersTable.columns.items"),
        cell: (row) => {
          const subOrder = getSubOrder(row);
          const itemCount = getItemsCount(subOrder?.items || []);
          return (
            <TextCell
              value={t("vendor.ordersTable.itemCount", {
                count: itemCount,
              })}
              className="text-sm"
            />
          );
        },
        className: "w-[120px]",
      },
      {
        id: "vendorEarnings",
        header: t("vendor.ordersTable.columns.netSales"),
        cell: (row) => {
          const subOrder = getSubOrder(row);
          return (
            <TextCell
              value={formatPrice(subOrder?.vendorEarnings || 0)}
              className="block w-full text-right text-sm"
            />
          );
        },
        className: "w-[140px]",
        headerClassName: "text-right [&>div]:justify-center",
      },
    ],
    [formatPrice, locale, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      {
        id: "all",
        label: t("vendor.ordersTable.tabs.all"),
      },
      {
        id: "unfulfilled",
        label: t("vendor.ordersTable.tabs.unfulfilled"),
      },
      {
        id: "unpaid",
        label: t("vendor.ordersTable.tabs.unpaid"),
      },
      {
        id: "open",
        label: t("vendor.ordersTable.tabs.open"),
      },
      {
        id: "archived",
        label: t("vendor.ordersTable.tabs.archived"),
      },
    ],
    [t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "status",
        label: t("vendor.ordersTable.filters.fulfillment"),
        type: "select",
        options: [
          {
            label: t("vendor.ordersTable.tabs.all"),
            value: "all",
          },
          {
            label: t("vendor.fulfillmentStatus.pending"),
            value: "pending",
          },
          {
            label: t("vendor.fulfillmentStatus.processing"),
            value: "processing",
          },
          {
            label: t("vendor.fulfillmentStatus.shipped"),
            value: "shipped",
          },
          {
            label: t("vendor.fulfillmentStatus.delivered"),
            value: "delivered",
          },
          {
            label: t("vendor.fulfillmentStatus.cancelled"),
            value: "cancelled",
          },
        ],
      },
      {
        id: "paymentStatus",
        label: t("vendor.ordersTable.columns.payment"),
        type: "select",
        options: [
          {
            label: t("vendor.ordersTable.tabs.all"),
            value: "all",
          },
          {
            label: t("vendor.paymentStatus.pending"),
            value: "pending",
          },
          {
            label: t("vendor.paymentStatus.paid"),
            value: "paid",
          },
          {
            label: t("vendor.paymentStatus.partially_paid"),
            value: "partially_paid",
          },
          {
            label: t("vendor.paymentStatus.refunded"),
            value: "refunded",
          },
          {
            label: t("vendor.paymentStatus.partially_refunded"),
            value: "partially_refunded",
          },
        ],
      },
    ],
    [t],
  );

  const bulkActions = useMemo<DataTableBulkAction<VendorOrder>[]>(
    () => {
      const actions: DataTableBulkAction<VendorOrder>[] = [];
      if (canEditOrder) {
        actions.push(
          {
            id: "processing",
            label: t("vendor.ordersTable.actions.markProcessing"),
            icon: <Package className="h-4 w-4" />,
            variant: "outline",
            onClick: (items) => handleBulkUpdateStatus(items, "processing"),
          },
          {
            id: "shipped",
            label: t("vendor.ordersTable.actions.markShipped"),
            icon: <Truck className="h-4 w-4" />,
            variant: "outline",
            onClick: (items) => handleBulkUpdateStatus(items, "shipped"),
          },
          {
            id: "delivered",
            label: t("vendor.ordersTable.actions.markDelivered"),
            icon: <CheckCircle className="h-4 w-4" />,
            variant: "outline",
            onClick: (items) => handleBulkUpdateStatus(items, "delivered"),
          },
        );
      }
      if (canDeleteOrder) {
        actions.push({
          id: "cancelled",
          label: t("vendor.ordersTable.actions.cancel"),
          icon: <XCircle className="h-4 w-4" />,
          variant: "destructive",
          onClick: (items) => handleBulkUpdateStatus(items, "cancelled"),
        });
      }
      return actions;
    },
    [canDeleteOrder, canEditOrder, handleBulkUpdateStatus, t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("vendor.ordersTable.title"),
        importExportAction: {
          id: "import-export",
          label: t("admin.productsDataTable.actions.importExport"),
          icon: <ChevronsUpDown className="h-4 w-4" />,
          variant: "outline",
          items: [
            {
              id: "toolbar-export",
              label: t("admin.productsDataTable.actions.export"),
              icon: <Download className="h-4 w-4" />,
              disabled: true,
            },
            {
              id: "toolbar-import",
              label: t("admin.productsDataTable.actions.import"),
              icon: <Upload className="h-4 w-4" />,
              disabled: true,
            },
          ],
        },
        addAction: canCreateOrder
          ? {
              id: "create-order",
              label: t("vendor.ordersTable.createOrder"),
              icon: <Plus className="h-4 w-4" />,
              href: `/${locale}/vendor/orders/create`,
            }
          : undefined,
      }),
    [canCreateOrder, locale, t],
  );

  const rowActions = useCallback(
    (row: VendorOrder): DataTableAction[] => {
      const actions: DataTableAction[] = [
        {
          id: "view",
          label: t("vendor.ordersTable.actions.viewDetails"),
          icon: <Eye className="h-4 w-4" />,
          href: `/${locale}/vendor/orders/${row._id}`,
        },
      ];

      const subOrder = getSubOrder(row);
      const currentStatus = subOrder?.status;
      const pickup = getPickup(subOrder);

      if (!currentStatus) return actions;

      if (pickup) {
        if (canDeleteOrder && isAllowedTransition(currentStatus, "cancelled")) {
          actions.push({
            id: "cancel",
            label: t("vendor.ordersTable.actions.cancelOrder"),
            icon: <XCircle className="h-4 w-4" />,
            variant: "destructive",
            onClick: () => handleCancelOrder(row._id),
          });
        }
        return actions;
      }

      if (canEditOrder && isAllowedTransition(currentStatus, "processing")) {
        actions.push({
          id: "processing",
          label: t("vendor.ordersTable.actions.startProcessing"),
          icon: <Package className="h-4 w-4" />,
          onClick: () => handleUpdateStatus(row._id, "processing"),
        });
      }

      if (canEditOrder && isAllowedTransition(currentStatus, "shipped")) {
        actions.push({
          id: "shipped",
          label: t("vendor.ordersTable.actions.markShipped"),
          icon: <Truck className="h-4 w-4" />,
          onClick: () => setShipDialog({ open: true, orderId: row._id }),
        });
      }

      if (canEditOrder && isAllowedTransition(currentStatus, "delivered")) {
        actions.push({
          id: "delivered",
          label: t("vendor.ordersTable.actions.markDelivered"),
          icon: <CheckCircle className="h-4 w-4" />,
          onClick: () => handleUpdateStatus(row._id, "delivered"),
        });
      }

      if (canDeleteOrder && isAllowedTransition(currentStatus, "cancelled")) {
        actions.push({
          id: "cancel",
          label: t("vendor.ordersTable.actions.cancelOrder"),
          icon: <XCircle className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handleCancelOrder(row._id),
        });
      }

      return actions;
    },
    [
      canDeleteOrder,
      canEditOrder,
      handleCancelOrder,
      handleUpdateStatus,
      locale,
      t,
    ],
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
        selectable={canEditOrder || canDeleteOrder}
        selectedItems={selectedOrders}
        onSelectionChange={setSelectedOrders}
        bulkActions={bulkActions}
        searchable
        searchPlaceholder={t("vendor.ordersTable.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={list.filters}
        onFilterChange={list.handleFilterChange}
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
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        rowActions={rowActions}
        rowActionsHeader={t("vendor.ordersTable.columns.actions")}
        rowActionsVariant="dropdown"
        onRowClick={(row) => router.push(`/${locale}/vendor/orders/${row._id}`)}
        emptyMessage={t("vendor.ordersTable.empty")}
      />

      <Dialog
        open={shipDialog.open}
        onOpenChange={(open) =>
          setShipDialog((prev) => ({
            ...prev,
            open,
          }))
        }
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("vendor.ordersTable.shipDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("vendor.ordersTable.shipDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="vendor-order-tracking">
              {t("vendor.ordersTable.shipDialog.trackingLabel")}
            </Label>
            <Input
              id="vendor-order-tracking"
              placeholder={t("vendor.ordersTable.shipDialog.trackingPlaceholder")}
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShipDialog({ open: false, orderId: "" });
                setTrackingNumber("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() =>
                handleUpdateStatus(shipDialog.orderId, "shipped", trackingNumber)
              }
            >
              <Truck className="mr-2 h-4 w-4" />
              {t("vendor.ordersTable.shipDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
