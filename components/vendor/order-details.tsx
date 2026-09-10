"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  CheckCircle,
  CircleDollarSign,
  Clock,
  Loader2,
  MapPin,
  MoreHorizontal,
  Package,
  Printer,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { useCurrency } from "@/providers/currency-provider";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { AppImage } from "@/components/ui/app-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api/client";
import {
  getSavedThermalPrinterName,
  printPdfBlobWithQz,
} from "@/lib/printing/qz-client";
import { formatPickupWindow } from "@/lib/checkout/pickup-fulfillment-shared";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { OrderShipmentsCard } from "@/components/shipping/order-shipments-card";

interface VendorOrderItem {
  name: string;
  sku?: string;
  quantity: number;
  price: number;
  image?: string;
}

interface VendorSubOrder {
  status: string;
  /** This consignment's own collection state; absent on pre-split rows. */
  paymentStatus?: string;
  /** Who takes the COD cash for this consignment; absent means the vendor. */
  codCollectedBy?: string;
  subtotal: number;
  commission: number;
  vendorEarnings: number;
  trackingNumber?: string;
  shippedAt?: string;
  deliveredAt?: string;
  fulfillment?: {
    method: "delivery" | "pickup";
    pickup?: {
      pickupAddress: string;
      instructions?: string;
      timeZone: string;
      startAt: string;
      endAt: string;
      status: "scheduled" | "ready" | "collected";
      readyAt?: string;
      collectedAt?: string;
    };
    /** Which branch a delivery order ships from; absent on a pickup. */
    fulfillmentLocationName?: string;
  };
  items: VendorOrderItem[];
}

interface VendorOrder {
  _id: string;
  orderNumber: string;
  paymentStatus: string;
  paymentMethod?: string;
  /**
   * Both read by `isPlatformSettled`. Without them a POS sale on the
   * merchant's OWN card terminal — normalised to a bare "card" — would look
   * like a platform-gateway charge and the vendor would lose a button they are
   * entitled to.
   */
  channel?: string;
  stripePaymentIntentId?: string;
  createdAt: string;
  shippingAddress?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  };
  customerId?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  subOrders: VendorSubOrder[];
}

interface VendorReturnRequest {
  _id: string;
  returnNumber: string;
  status: string;
  refundStatus: string;
  estimatedRefund: {
    total: number;
  };
}

interface VendorOrderDetailsProps {
  orderId: string;
  locale: string;
  canEditOrder?: boolean;
  canDeleteOrder?: boolean;
}

function statusBadge(status: string) {
  const map: Record<
    string,
    {
      icon: typeof Clock;
      variant: "default" | "secondary" | "outline" | "destructive";
      label: string;
    }
  > = {
    pending: { icon: Clock, variant: "secondary", label: "Pending" },
    processing: { icon: Package, variant: "default", label: "Processing" },
    shipped: { icon: Truck, variant: "outline", label: "Shipped" },
    delivered: { icon: CheckCircle, variant: "default", label: "Delivered" },
    cancelled: { icon: XCircle, variant: "destructive", label: "Cancelled" },
  };

  const config = map[status] || map.pending;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1">
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </Badge>
  );
}

function paymentBadge(paymentStatus: string) {
  const variants: Record<
    string,
    "default" | "secondary" | "outline" | "destructive"
  > = {
    paid: "default",
    pending: "secondary",
    partially_paid: "outline",
    refunded: "outline",
    partially_refunded: "outline",
  };

  const labels: Record<string, string> = {
    pending: "Payment Pending",
    paid: "Paid",
    partially_paid: "Partially paid",
    refunded: "Refunded",
    partially_refunded: "Partially refunded",
  };

  return (
    <Badge
      variant={variants[paymentStatus] || "secondary"}
      className={paymentStatus === "paid" ? "bg-green-600 hover:bg-green-700" : ""}
    >
      {labels[paymentStatus] || paymentStatus}
    </Badge>
  );
}

function returnStatusVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "rejected" || status === "cancelled") return "destructive";
  if (status === "received" || status === "refunded") return "default";
  if (status === "requested" || status === "refund_pending") return "secondary";
  return "outline";
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

export function VendorOrderDetails({
  orderId,
  locale,
  canEditOrder = false,
  canDeleteOrder = false,
}: VendorOrderDetailsProps) {
  const { formatPrice } = useCurrency();
  const { confirm } = useConfirmation();

  const [order, setOrder] = useState<VendorOrder | null>(null);
  const [returnRequests, setReturnRequests] = useState<VendorReturnRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [shipDialog, setShipDialog] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [isShippingLabelLoading, setIsShippingLabelLoading] = useState(false);

  const subOrder = useMemo(() => order?.subOrders?.[0] || null, [order]);
  const handlePrint = () => {
    window.print();
  };

  const fetchOrder = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.get<VendorOrder>(
        `/api/vendor/orders/${orderId}`,
      );
      setOrder(data);
      setError(null);
    } catch (error) {
      setError(
        error instanceof Error && error.message
          ? error.message
          : "Failed to load order",
      );
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchOrder();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchOrder]);

  const fetchReturns = useCallback(async () => {
    try {
      const params = new URLSearchParams({ orderId, limit: "20" });
      const data = await apiClient.get<{ data?: VendorReturnRequest[] }>(
        `/api/vendor/returns?${params.toString()}`,
      );
      setReturnRequests(data?.data || []);
    } catch {
      setReturnRequests([]);
    }
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchReturns();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchReturns]);

  const updateStatus = useCallback(
    async (status: string, tracking?: string, shipmentCarrier?: string) => {
      setIsUpdating(true);
      try {
        await apiClient.put(`/api/vendor/orders/${orderId}`, {
          status,
          trackingNumber: tracking,
          carrier: shipmentCarrier?.trim() || undefined,
        });

        if (status === "shipped") {
          await apiClient.post(`/api/vendor/orders/${orderId}/shipments`, {
            trackingNumber: tracking || order?.orderNumber,
            carrier: shipmentCarrier || "Internal fulfillment",
          });
        }

        toast.success("Order updated");
        setShipDialog(false);
        setTrackingNumber("");
        fetchOrder();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Failed to update order",
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [fetchOrder, order, orderId],
  );

  const updatePickup = useCallback(
    async (action: "ready" | "collected") => {
      setIsUpdating(true);
      try {
        await apiClient.post(`/api/vendor/orders/${orderId}/pickup`, { action });
        toast.success(
          action === "ready"
            ? "Customer can now collect this order"
            : "Pickup marked as collected",
        );
        await fetchOrder();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Failed to update pickup",
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [fetchOrder, orderId],
  );

  const downloadShippingLabel = useCallback(async () => {
    setIsShippingLabelLoading(true);
    try {
      await apiClient.post(`/api/vendor/orders/${orderId}/shipments`, {
        trackingNumber: subOrder?.trackingNumber || order?.orderNumber,
        carrier: carrier || "Internal fulfillment",
      });
      const response = await fetch(`/api/vendor/orders/${orderId}/shipping-label`);
      if (!response.ok) throw new Error("Failed to generate shipping label");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `shipping-label-${order?.orderNumber || orderId}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Shipping label downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create shipping label");
    } finally {
      setIsShippingLabelLoading(false);
    }
  }, [carrier, order, orderId, subOrder]);

  const printShippingLabelDirect = useCallback(async () => {
    setIsShippingLabelLoading(true);
    try {
      await apiClient.post(`/api/vendor/orders/${orderId}/shipments`, {
        trackingNumber: subOrder?.trackingNumber || order?.orderNumber,
        carrier: carrier || "Internal fulfillment",
      });
      const response = await fetch(`/api/vendor/orders/${orderId}/shipping-label`);
      if (!response.ok) throw new Error("Failed to generate shipping label");
      await printPdfBlobWithQz(
        getSavedThermalPrinterName(),
        await response.blob(),
        { widthIn: 4, heightIn: 6 },
      );
      toast.success("4 × 6 shipping label sent to thermal printer");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to print shipping label",
      );
    } finally {
      setIsShippingLabelLoading(false);
    }
  }, [carrier, order, orderId, subOrder]);

  const handleCancel = useCallback(async () => {
    const shouldCancel = await confirm({
      title: "Cancel order",
      description: "Are you sure you want to cancel this order?",
      confirmText: "Cancel order",
      cancelText: "Keep order",
      variant: "destructive",
    });

    if (!shouldCancel) return;
    await updateStatus("cancelled");
  }, [confirm, updateStatus]);

  const handleMarkAsPaid = useCallback(async () => {
    const shouldMarkPaid = await confirm({
      title: "Mark as paid",
      description: "Mark this order as paid?",
      confirmText: "Mark as paid",
      cancelText: "Cancel",
    });
    if (!shouldMarkPaid) return;

    setIsUpdating(true);
    try {
      await apiClient.put(`/api/vendor/orders/${orderId}`, {
        paymentStatus: "paid",
      });

      toast.success("Order marked as paid");
      await fetchOrder();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to update order",
      );
    } finally {
      setIsUpdating(false);
    }
  }, [confirm, fetchOrder, orderId]);

  const updateReturn = useCallback(
    async (request: VendorReturnRequest, payload: Record<string, unknown>) => {
      setIsUpdating(true);
      try {
        await apiClient.put(`/api/vendor/returns/${request._id}`, payload);
        toast.success("Return updated");
        await fetchReturns();
        await fetchOrder();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Failed to update return",
        );
      } finally {
        setIsUpdating(false);
      }
    },
    [fetchOrder, fetchReturns],
  );

  if (isLoading) {
    return <VendorOrderDetailsSkeleton />;
  }

  if (!order || !subOrder || error) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/${locale}/vendor/orders`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to orders
          </Link>
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {error || "Order not found"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const requestedReturns = returnRequests.filter(
    (request) => request.status === "requested",
  );
  const receivableReturns = returnRequests.filter((request) =>
    ["approved", "in_transit"].includes(request.status),
  );
  const canMarkPaid =
    canEditOrder &&
    subOrder.status !== "cancelled" &&
    // Only money the vendor actually handles: not a gateway-settled order, and
    // not a COD delivery the store's own courier collects. The API refuses
    // both either way — this just keeps the button from offering something
    // that can only fail.
    !isPlatformSettled(order, subOrder) &&
    ["pending", "partially_paid"].includes(
      subOrder.paymentStatus || order.paymentStatus,
    );
  const pickup = subOrder.fulfillment?.method === "pickup"
    ? subOrder.fulfillment.pickup
    : undefined;
  const isPickup = Boolean(pickup);
  const shipsFrom = isPickup
    ? undefined
    : subOrder.fulfillment?.fulfillmentLocationName?.trim() || undefined;
  const pickupWindow = pickup
    ? formatPickupWindow(locale, pickup)
    : null;
  const canStartProcessing =
    canEditOrder && !isPickup && isAllowedTransition(subOrder.status, "processing");
  const canMarkShipped =
    canEditOrder && !isPickup && isAllowedTransition(subOrder.status, "shipped");
  const canMarkDelivered =
    canEditOrder && !isPickup && isAllowedTransition(subOrder.status, "delivered");
  const canMarkPickupReady =
    canEditOrder &&
    pickup?.status === "scheduled" &&
    ["pending", "processing"].includes(subOrder.status);
  const canMarkPickupCollected =
    canEditOrder &&
    pickup?.status === "ready" &&
    subOrder.status === "processing";
  const canCancel =
    canDeleteOrder && isAllowedTransition(subOrder.status, "cancelled");
  const canShowMoreActions =
    canMarkPaid ||
    requestedReturns.length > 0 ||
    receivableReturns.length > 0 ||
    canStartProcessing ||
    canMarkShipped ||
    canMarkDelivered ||
    canMarkPickupReady ||
    canMarkPickupCollected ||
    canCancel;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Order #{order.orderNumber}
            </h1>
            {paymentBadge(order.paymentStatus)}
            {statusBadge(subOrder.status)}
            {pickup ? (
              <Badge variant="outline" className="gap-1">
                <MapPin className="h-3.5 w-3.5" />
                Pickup · {pickup.status}
              </Badge>
            ) : shipsFrom ? (
              // Which of the merchant's branches this order is packed at. The
              // one thing a two-branch seller could not previously tell from an
              // order at all — the stock came off whichever shelf happened to
              // hold the most, and nothing recorded which.
              <Badge variant="outline" className="gap-1">
                <MapPin className="h-3.5 w-3.5" />
                Ships from {shipsFrom}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-muted-foreground">
            Placed on {format(new Date(order.createdAt), "MMMM d, yyyy, h:mm a")}
          </p>
          {returnRequests.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                Return requests
              </span>
              {returnRequests.map((request) => (
                <Badge
                  key={request._id}
                  variant={returnStatusVariant(request.status)}
                  className="gap-1.5 capitalize"
                >
                  <span>{request.returnNumber}</span>
                  <span>{request.status.replace(/_/g, " ")}</span>
                  {request.refundStatus && request.refundStatus !== "not_required" ? (
                    <span className="border-l border-current/30 pl-1.5">
                      {request.refundStatus.replace(/_/g, " ")}
                    </span>
                  ) : null}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          {!isPickup ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadShippingLabel()}
                disabled={isShippingLabelLoading}
              >
                {isShippingLabelLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Package className="mr-2 h-4 w-4" />
                )}
                Shipping label
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void printShippingLabelDirect()}
                disabled={isShippingLabelLoading}
                title="Print the 4 × 6 PDF with the saved QZ thermal printer"
              >
                <Printer className="mr-2 h-4 w-4" />
                Print 4 × 6
              </Button>
            </>
          ) : null}
          {canShowMoreActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canStartProcessing ? (
                  <DropdownMenuItem
                    disabled={isUpdating}
                    onClick={() => void updateStatus("processing")}
                  >
                    {isUpdating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                    Start processing
                  </DropdownMenuItem>
                ) : null}
                {canMarkShipped ? (
                  <DropdownMenuItem
                    disabled={isUpdating}
                    onClick={() => setShipDialog(true)}
                  >
                    <Truck className="h-4 w-4" />
                    Mark shipped
                  </DropdownMenuItem>
                ) : null}
                {canMarkDelivered ? (
                  <DropdownMenuItem
                    disabled={isUpdating}
                    onClick={() => void updateStatus("delivered")}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Mark delivered
                  </DropdownMenuItem>
                ) : null}
                {canMarkPickupReady ? (
                  <DropdownMenuItem
                    disabled={isUpdating}
                    onClick={() => void updatePickup("ready")}
                  >
                    <Package className="h-4 w-4" />
                    Mark ready for collection
                  </DropdownMenuItem>
                ) : null}
                {canMarkPickupCollected ? (
                  <DropdownMenuItem
                    disabled={isUpdating}
                    onClick={() => void updatePickup("collected")}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Mark collected
                  </DropdownMenuItem>
                ) : null}
                {canCancel ? (
                  <DropdownMenuItem
                    className="text-destructive"
                    disabled={isUpdating}
                    onClick={handleCancel}
                  >
                    <XCircle className="h-4 w-4" />
                    Cancel order
                  </DropdownMenuItem>
                ) : null}
                {(canStartProcessing ||
                  canMarkShipped ||
                  canMarkDelivered ||
                  canMarkPickupReady ||
                  canMarkPickupCollected ||
                  canCancel) &&
                (canMarkPaid ||
                  requestedReturns.length > 0 ||
                  receivableReturns.length > 0) ? (
                  <DropdownMenuSeparator />
                ) : null}
                {canMarkPaid ? (
                  <DropdownMenuItem
                    disabled={isUpdating}
                    onClick={() => void handleMarkAsPaid()}
                  >
                    <CircleDollarSign className="h-4 w-4" />
                    Mark as paid
                  </DropdownMenuItem>
                ) : null}
                {requestedReturns.map((request) => (
                  <DropdownMenuItem
                    key={`approve-${request._id}`}
                    disabled={isUpdating}
                    onClick={() => void updateReturn(request, { status: "approved" })}
                  >
                    <CheckCircle className="h-4 w-4" />
                    Approve return
                  </DropdownMenuItem>
                ))}
                {receivableReturns.map((request) => (
                  <DropdownMenuItem
                    key={`receive-${request._id}`}
                    disabled={isUpdating}
                    onClick={() => void updateReturn(request, { status: "received" })}
                  >
                    <Package className="h-4 w-4" />
                    Mark return received
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href={`/${locale}/vendor/orders`}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Items in this shipment</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subOrder.items.map((item, index) => (
                    <TableRow key={`${item.name}-${index}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="relative h-12 w-12 overflow-hidden rounded-md border bg-muted">
                            {item.image ? (
                              <AppImage
                                src={item.image}
                                alt={item.name}
                                fill
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                N/A
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{item.name}</p>
                            {item.sku ? (
                              <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{formatPrice(item.price)}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatPrice(item.price * item.quantity)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="space-y-2 border-t bg-muted/30 p-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Shipment subtotal</span>
                  <span>{formatPrice(subOrder.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Commission</span>
                  <span>-{formatPrice(subOrder.commission)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between text-base font-semibold">
                  <span>Your earnings</span>
                  <span>{formatPrice(subOrder.vendorEarnings)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Scoped server-side to this vendor's own sub-order, so a split
              order never shows another vendor's parcels here. */}
          <OrderShipmentsCard
            apiBase="/api/vendor"
            orderId={orderId}
            orderNumber={order.orderNumber}
            // The vendor scope resolves the sub-order from the vendor id
            // server-side, so the client never has to name it.
            readOnly={!canEditOrder}
            hidden={isPickup}
            onChanged={fetchOrder}
          />

          <Card>
            <CardHeader>
              <CardTitle>Fulfillment timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-sm">Order placed</span>
                <span className="text-sm text-muted-foreground">
                  {format(new Date(order.createdAt), "MMM d, yyyy h:mm a")}
                </span>
              </div>

              {pickup && pickupWindow ? (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">Pickup window</span>
                    <span className="text-right text-sm text-muted-foreground">
                      {pickupWindow}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {pickup.timeZone}
                  </p>
                </div>
              ) : null}

              {pickup?.readyAt ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Ready for collection</span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(pickup.readyAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
              ) : null}

              {pickup?.collectedAt ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Collected</span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(pickup.collectedAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
              ) : null}

              {subOrder.shippedAt ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Marked shipped</span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(subOrder.shippedAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
              ) : null}

              {subOrder.deliveredAt ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Marked delivered</span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(subOrder.deliveredAt), "MMM d, yyyy h:mm a")}
                  </span>
                </div>
              ) : null}

              {subOrder.trackingNumber ? (
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Tracking number</span>
                  <span className="font-mono text-sm">{subOrder.trackingNumber}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {pickup ? (
            <Card>
              <CardHeader>
                <CardTitle>Pickup details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="whitespace-pre-line">{pickup.pickupAddress}</p>
                    {pickup.instructions ? (
                      <p className="text-muted-foreground">{pickup.instructions}</p>
                    ) : null}
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Collection status</span>
                  <span className="capitalize">{pickup.status}</span>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start gap-2">
                <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">{order.customerId?.name || "Guest"}</p>
                  <p className="text-muted-foreground">{order.customerId?.email || "No email"}</p>
                </div>
              </div>

              <Separator />

              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="space-y-0.5">
                  <p>{order.shippingAddress?.street || "-"}</p>
                  <p>
                    {order.shippingAddress?.city || ""}
                    {order.shippingAddress?.city ? ", " : ""}
                    {order.shippingAddress?.state || ""} {order.shippingAddress?.postalCode || ""}
                  </p>
                  <p>{order.shippingAddress?.country || ""}</p>
                  {order.shippingAddress?.phone ? (
                    <p className="text-muted-foreground">{order.shippingAddress.phone}</p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                {paymentBadge(order.paymentStatus)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Method</span>
                <span className="capitalize">{order.paymentMethod || "-"}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={shipDialog} onOpenChange={setShipDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as shipped</DialogTitle>
            <DialogDescription>
              Add an optional tracking number before confirming shipment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="vendor-details-carrier">Carrier</Label>
              <Input
                id="vendor-details-carrier"
                placeholder="Carrier name"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
              />
            </div>
            <div className="space-y-2">
            <Label htmlFor="vendor-details-tracking">Tracking number</Label>
            <Input
              id="vendor-details-tracking"
              placeholder="Enter tracking number"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
            />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipDialog(false)}>
              Cancel
            </Button>
            <Button disabled={isUpdating} onClick={() => updateStatus("shipped", trackingNumber, carrier)}>
              {isUpdating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Truck className="mr-2 h-4 w-4" />
              )}
              Confirm shipment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function VendorOrderDetailsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
