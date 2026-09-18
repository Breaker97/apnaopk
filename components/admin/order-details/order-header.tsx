"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import {
  MoreHorizontal,
  Printer,
  Download,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  PackageCheck,
  Loader2,
  Truck,
  ArrowLeft,
  ChevronDown,
  CircleDollarSign,
  MapPin,
  ShieldAlert,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  InputDialog,
  type InputDialogField,
  type InputDialogValues,
} from "@/components/ui/input-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useCurrency } from "@/providers/currency-provider";
import { IOrder } from "@/types";
import {
  getOrderStatusActions,
  type OrderStatusActionDefinition,
} from "@/lib/orders/order-status-workflow";
import { apiClient } from "@/lib/api/client";
import { disputeGatewayForMethod } from "@/lib/payments/dispute-gateways";
import { refundSettlesOutOfBand } from "@/lib/returns/refund-settlement";
import {
  getSavedThermalPrinterName,
  printPdfBlobWithQz,
} from "@/lib/printing/qz-client";

/**
 * Every state an override may move an order to.
 *
 * The whole list, on purpose. The workflow graph is what decides the legal
 * *route*; this control exists precisely for the moves it has no route for —
 * walking a delivered order back to shipped, or reinstating one that was
 * cancelled by mistake.
 */
const OVERRIDABLE_STATUSES = [
  "preordered",
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
];

interface OrderReturnRequest {
  _id: string;
  returnNumber: string;
  status: string;
  refundStatus?: string;
  estimatedRefundTotal?: number;
  actualRefundAmount?: number;
  /** Whose items came back, when the return is not the store's own. */
  ownerLabel?: string;
}

interface OrderHeaderProps {
  order: IOrder;
  readOnly?: boolean;
  /**
   * Cancelling is a separate permission from editing on the API side, so it
   * gets its own flag — otherwise edit-only staff see a Cancel action that
   * always 403s.
   */
  canCancel?: boolean;
  canRefund?: boolean;
  /**
   * Stepping outside the workflow is admin-only — `PUT /api/admin/orders/[id]`
   * refuses it for scoped staff whatever order permissions they hold, so
   * showing them the action would only produce a 403.
   */
  canOverride?: boolean;
  /**
   * Return requests for this order, loaded alongside the order itself. The
   * header used to fetch them on mount, which meant a round-trip before the
   * return badges and the approve/receive actions could appear.
   */
  returnRequests?: OrderReturnRequest[];
  /**
   * Delivery this order cannot hand back — see `unrefundableDeliveryFor`.
   * Comes off the refundable ceiling so a full refund covers the goods and
   * their tax, and stops there.
   */
  unrefundableDelivery?: number;
}

export function OrderHeader({
  order,
  readOnly,
  canCancel = true,
  canRefund = false,
  canOverride = false,
  returnRequests: initialReturnRequests = [],
  unrefundableDelivery = 0,
}: OrderHeaderProps) {
  const t = useTranslations("admin");
  const tRoot = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();
  // Orders freeze the currency they were charged in; formatting with the
  // store's current default would relabel historical totals.
  const { formatPrice } = useCurrency();
  const [shipDialogOpen, setShipDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [refundDialogKind, setRefundDialogKind] = useState<
    "full" | "partial" | null
  >(null);
  const [refundValues, setRefundValues] = useState<InputDialogValues>({
    amount: "",
    reason: "",
    settle: "send",
  });
  const [refundErrors, setRefundErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [returnRequests, setReturnRequests] = useState<OrderReturnRequest[]>(
    initialReturnRequests,
  );
  /**
   * The branches this order touches, deduped.
   *
   * A marketplace order can span two vendors' warehouses, so this is a list
   * rather than a single value — and a single-location store produces an empty
   * one, because naming the only place goods can come from tells nobody
   * anything.
   */
  const fulfillmentPlaces = useMemo(() => {
    const places = new Set<string>();
    for (const sub of order.subOrders || []) {
      const fulfillment = sub.fulfillment;
      const place =
        fulfillment?.method === "pickup"
          ? fulfillment.pickup?.pickupLocationName
          : fulfillment?.fulfillmentLocationName;
      const label = place?.trim();
      if (!label) continue;
      places.add(
        fulfillment?.method === "pickup"
          ? `Collect at ${label}`
          : `Ships from ${label}`,
      );
    }
    return [...places];
  }, [order.subOrders]);
  const [trackingNumber, setTrackingNumber] = useState(
    order.trackingNumber || "",
  );
  const [carrier, setCarrier] = useState(order.carrier || "");
  const [cancelReason, setCancelReason] = useState(order.cancelReason || "");
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);
  const [isDownloadingShippingLabel, setIsDownloadingShippingLabel] = useState(false);

  // Re-read after this component mutates a return (approve/receive/refund).
  // The initial list arrives as a prop from the server, so this only runs in
  // response to an action the admin just took. Callers key this component by
  // order id, so moving to a different order remounts it with that order's
  // requests instead of stranding this state on the previous one.
  const fetchReturnRequests = async () => {
    try {
      const params = new URLSearchParams({
        orderId: String(order._id),
        limit: "20",
      });
      // The list API returns whole documents; flatten them into the same shape
      // the server loader hands us so the refund caps stay populated after a
      // refetch (they drive which endpoint a refund is recorded against).
      const data = await apiClient.get<{
        data?: (Omit<
          OrderReturnRequest,
          "estimatedRefundTotal" | "actualRefundAmount"
        > & {
          estimatedRefund?: { total?: number };
          actualRefund?: { amount?: number };
        })[];
      }>(`/api/admin/returns?${params.toString()}`);
      setReturnRequests(
        (data?.data || []).map((request) => ({
          _id: String(request._id),
          returnNumber: String(request.returnNumber || ""),
          status: String(request.status || ""),
          refundStatus: request.refundStatus,
          estimatedRefundTotal: Number(request.estimatedRefund?.total || 0),
          actualRefundAmount: Number(request.actualRefund?.amount || 0),
        })),
      );
    } catch {
      setReturnRequests([]);
    }
  };

  const handleStatusUpdate = async (
    status: string,
    payload: Record<string, string | boolean | undefined> = {},
  ) => {
    setIsUpdating(true);
    try {
      await apiClient.put(`/api/admin/orders/${order._id}`, {
        status,
        ...payload,
      });
      toast.success(tRoot("orders.orderUpdated"));
      router.refresh();
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tRoot("orders.orderUpdateFailed"),
      );
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMarkAsPaid = async () => {
    const confirmed = await confirm({
      type: "question",
      title: t("orderDetails.markAsPaid"),
      description: t("orderDetails.markAsPaidConfirm"),
      confirmText: t("orderDetails.markAsPaid"),
      cancelText: t("orderDetails.cancel"),
    });
    if (!confirmed) return;
    setIsUpdating(true);
    try {
      await apiClient.put(`/api/admin/orders/${order._id}`, {
        paymentStatus: "paid",
      });
      toast.success(t("orderDetails.markAsPaidSuccess"));
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tRoot("orders.orderUpdateFailed"),
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStatusAction = (action: OrderStatusActionDefinition) => {
    if (action.to === "shipped") {
      setShipDialogOpen(true);
      return;
    }
    if (action.to === "cancelled") {
      setCancelDialogOpen(true);
      return;
    }
    void handleStatusUpdate(action.to);
  };

  const getActionIcon = (actionId: string) => {
    if (actionId === "mark_processing" || actionId === "mark_ready_to_fulfill")
      return <Package className="h-4 w-4" />;
    if (actionId === "mark_shipped") return <Truck className="h-4 w-4" />;
    if (actionId === "mark_delivered")
      return <CheckCircle className="h-4 w-4" />;
    return <XCircle className="h-4 w-4" />;
  };

  // `ORDER_STATUS_ACTIONS` labels are English constants shared with server
  // code; the menu renders the localized copy instead.
  const getActionLabel = (action: OrderStatusActionDefinition) =>
    t(`orderDetails.statusAction.${action.id}`);

  const getStatusBadge = (status: string) => {
    const config: Record<
      string,
      {
        variant: "default" | "secondary" | "destructive" | "outline";
        icon: LucideIcon;
      }
    > = {
      pending: { variant: "secondary", icon: Clock },
      preordered: { variant: "outline", icon: Package },
      processing: { variant: "default", icon: Package },
      shipped: { variant: "outline", icon: Truck },
      delivered: { variant: "default", icon: CheckCircle },
      cancelled: { variant: "destructive", icon: XCircle },
    };
    const labels: Record<string, string> = {
      pending: t("orderDetails.orderStatus.pending"),
      preordered: t("orderDetails.orderStatus.preordered"),
      processing: t("orderDetails.orderStatus.processing"),
      shipped: t("orderDetails.orderStatus.shipped"),
      delivered: t("orderDetails.orderStatus.delivered"),
      cancelled: t("orderDetails.orderStatus.cancelled"),
    };
    const { variant, icon: Icon } = config[status] || config.pending;
    return (
      <Badge
        variant={variant}
        className="gap-1 px-3 py-1 text-sm font-medium capitalize"
      >
        <Icon className="h-3.5 w-3.5" />
        {labels[status] || status.replace(/_/g, " ")}
      </Badge>
    );
  };

  const getPaymentBadge = (status: string) => {
    const config: Record<
      string,
      {
        variant:
          | "default"
          | "secondary"
          | "destructive"
          | "outline"
          | "success";
      }
    > = {
      paid: { variant: "success" },
      pending: { variant: "secondary" },
      partially_paid: { variant: "outline" },
      refunded: { variant: "outline" },
      partially_refunded: { variant: "outline" },
    };
    const { variant } = config[status] || { variant: "secondary" };

    return (
      <Badge
        variant={variant === "success" ? "default" : variant}
        className={status === "paid" ? "bg-green-600 hover:bg-green-700" : ""}
      >
        {t(`orderDetails.paymentStatus.${status}`)}
      </Badge>
    );
  };

  const getReturnStatusVariant = (
    status: string,
  ): "default" | "secondary" | "destructive" | "outline" => {
    if (status === "rejected" || status === "cancelled") {
      return "destructive";
    }
    if (status === "received" || status === "refunded") {
      return "default";
    }
    if (status === "requested" || status === "refund_pending") {
      return "secondary";
    }
    return "outline";
  };

  const getReturnStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      requested: t("orderDetails.returnStatus.requested"),
      approved: t("orderDetails.returnStatus.approved"),
      rejected: t("orderDetails.returnStatus.rejected"),
      awaiting_shipment: t("orderDetails.returnStatus.awaitingShipment"),
      in_transit: t("orderDetails.returnStatus.inTransit"),
      received: t("orderDetails.returnStatus.received"),
      inspected: t("orderDetails.returnStatus.inspected"),
      refund_pending: t("orderDetails.returnStatus.refundPending"),
      refunded: t("orderDetails.returnStatus.refunded"),
      partially_refunded: t("orderDetails.returnStatus.partiallyRefunded"),
      closed: t("orderDetails.returnStatus.closed"),
      cancelled: t("orderDetails.returnStatus.cancelled"),
    };

    return labels[status] || status.replace(/_/g, " ");
  };

  const getReturnRefundStatusLabel = (status?: string) => {
    if (!status || status === "not_required") return null;

    const labels: Record<string, string> = {
      pending: t("orderDetails.returnRefundStatus.pending"),
      processing: t("orderDetails.returnRefundStatus.processing"),
      succeeded: t("orderDetails.returnRefundStatus.succeeded"),
      failed: t("orderDetails.returnRefundStatus.failed"),
      manual_required: t("orderDetails.returnRefundStatus.manualRequired"),
    };

    return labels[status] || status.replace(/_/g, " ");
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadInvoice = async () => {
    setIsDownloadingInvoice(true);
    try {
      const res = await fetch(`/api/admin/orders/${order._id}/invoice`);
      if (!res.ok) throw new Error("Failed to download invoice");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${order.orderNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("orderDetails.invoiceDownloadFailed"));
    } finally {
      setIsDownloadingInvoice(false);
    }
  };

  const shippingLabelErrorMessage = (error: unknown, fallbackKey: string) => {
    const raw = error instanceof Error ? error.message : "";
    // Backend Mongoose validation for an incomplete store ship-from address
    // surfaces as raw "shipFrom.<field>: Path ... is required" text. Show an
    // actionable, translated message instead of the raw validator string.
    if (/shipFrom\.\w+/i.test(raw)) {
      return t("orderDetails.shippingLabelAddressIncomplete");
    }
    return t(`orderDetails.${fallbackKey}`);
  };

  const ensureShippingLabel = async (download = true) => {
    setIsDownloadingShippingLabel(true);
    try {
      await apiClient.post(`/api/admin/orders/${order._id}/shipments`, {
        carrier: carrier.trim() || order.carrier || undefined,
        trackingNumber:
          trackingNumber.trim() || order.trackingNumber || order.orderNumber,
      });
      if (download) {
        const response = await fetch(
          `/api/admin/orders/${order._id}/shipping-label`,
        );
        if (!response.ok)
          throw new Error(t("orderDetails.shippingLabelFailed"));
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `shipping-label-${order.orderNumber}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }
      toast.success(
        download
          ? t("orderDetails.shippingLabelDownloaded")
          : t("orderDetails.shippingLabelCreated"),
      );
      return true;
    } catch (error) {
      toast.error(shippingLabelErrorMessage(error, "shippingLabelFailed"));
      return false;
    } finally {
      setIsDownloadingShippingLabel(false);
    }
  };

  const printShippingLabelDirect = async () => {
    setIsDownloadingShippingLabel(true);
    try {
      await apiClient.post(`/api/admin/orders/${order._id}/shipments`, {
        carrier: carrier.trim() || order.carrier || undefined,
        trackingNumber:
          trackingNumber.trim() || order.trackingNumber || order.orderNumber,
      });
      const response = await fetch(
        `/api/admin/orders/${order._id}/shipping-label`,
      );
      if (!response.ok)
        throw new Error(t("orderDetails.shippingLabelPrintFailed"));
      await printPdfBlobWithQz(
        getSavedThermalPrinterName(),
        await response.blob(),
        { widthIn: 4, heightIn: 6 },
      );
      toast.success(t("orderDetails.shippingLabelPrinted"));
    } catch (error) {
      toast.error(shippingLabelErrorMessage(error, "shippingLabelPrintFailed"));
    } finally {
      setIsDownloadingShippingLabel(false);
    }
  };

  // What is still refundable. A "full" refund on an order that was already
  // partially refunded must cover the REMAINDER — sending the whole order
  // total again trips the server's cumulative cap ("Refund amount exceeds
  // order total"), which made a second refund impossible from this screen.
  // Less the delivery a delivered order cannot give back: the carrier was
  // paid when the parcel left, and refunding it takes the fee out of the
  // merchant a second time for a service that was performed. An admin who
  // means to absorb it says so in the delivery field below.
  const refundableRemaining = Math.max(
    0,
    Number(order.total || 0) -
      Number(order.refundedTotal || 0) -
      Math.max(0, Number(unrefundableDelivery || 0)),
  );

  // The lines this refund can be described against, and what delivery is left
  // to hand back. Naming them turns the recorded split from an average across
  // the whole sale into a fact — see `allocateOrderRefund` on the server.
  // Leaving them blank keeps the old behaviour exactly.
  const refundableLines = (order.items || []).map((item, index) => ({
    index,
    name: String(item?.name || `Item ${index + 1}`),
    quantity: Math.max(0, Number(item?.quantity || 0)),
  }));
  // What delivery a refund may still reach. Zero on a delivered order under
  // the default policy, which is what makes handing it back a deliberate act.
  const refundableShipping = Math.max(
    0,
    Number(order.shippingCost || 0) - Math.max(0, Number(unrefundableDelivery || 0)),
  );

  const openRefundDialog = (kind: "full" | "partial") => {
    const currentStatus = String(order.paymentStatus || "").toLowerCase();
    if (currentStatus !== "paid" && currentStatus !== "partially_refunded") {
      toast.error(t("orderDetails.refundNotAvailable"));
      return;
    }
    if (refundableRemaining <= 0) {
      toast.error(t("orderDetails.refundNotAvailable"));
      return;
    }

    setRefundValues({ amount: "", reason: "", settle: "send" });
    setRefundErrors({});
    setRefundDialogKind(kind);
  };

  /** The lines and delivery the admin named, if any. */
  const describedRefund = (values: InputDialogValues) => {
    const items = refundableLines
      .map((line) => ({
        orderItemIndex: line.index,
        quantity: Math.max(0, Number(values[`qty_${line.index}`] || 0)),
      }))
      .filter((line) => line.quantity > 0);
    const shipping = Math.max(0, Number(values.shipping || 0));
    return {
      ...(items.length > 0 ? { refundItems: items } : {}),
      ...(shipping > 0 ? { refundShipping: shipping } : {}),
    };
  };

  const handleRefundSubmit = async (values: InputDialogValues) => {
    if (!refundDialogKind) return;

    const amount =
      refundDialogKind === "full"
        ? refundableRemaining
        : Number(values.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setRefundErrors({ amount: t("orderDetails.invalidRefundAmount") });
      return;
    }
    if (amount > refundableRemaining + 0.01) {
      setRefundErrors({
        amount: t("orderDetails.refundExceedsRemaining", {
          amount: formatPrice(refundableRemaining),
        }),
      });
      return;
    }

    setRefundErrors({});
    setIsUpdating(true);

    // Money that has already gone back is only recorded, never sent again: a
    // refund made in the gateway's own dashboard, or a chargeback the
    // customer's bank took. The server matches either to the gateway's report
    // when it arrives, so it is counted once.
    const settle = values.settle || "send";
    const isChargeback = settle === "chargeback";
    const alreadyGone = settle === "already" || isChargeback;

    try {
      // A return refund is capped server-side at the value of the goods coming
      // back, so only record this refund against a return when the amount
      // actually fits what is left of that cap. Routing every refund through
      // an open return made a FULL order refund impossible — the returns API
      // rejected the order total with "use the order refund flow for larger
      // refunds", and this screen has no other way to reach that flow. A
      // chargeback is the bank's, not a return's, so it never goes that way.
      const returnRequestForRefund = isChargeback
        ? undefined
        : returnRequests.find((request) => {
            if (
              !["approved", "received", "inspected", "refund_pending"].includes(
                request.status,
              )
            ) {
              return false;
            }
            const estimate = Number(request.estimatedRefundTotal || 0);
            if (estimate <= 0) return true;
            const remaining = estimate - Number(request.actualRefundAmount || 0);
            return amount <= remaining + 0.01;
          });
      await apiClient.put(
        returnRequestForRefund
          ? `/api/admin/returns/${returnRequestForRefund._id}`
          : `/api/admin/orders/${order._id}`,
        returnRequestForRefund
          ? {
              status: "refunded",
              refundAmount: amount,
              refundReason: values.reason.trim() || undefined,
              ...(alreadyGone ? { manualRefund: true } : {}),
            }
          : {
              paymentStatus:
                refundDialogKind === "full"
                  ? "refunded"
                  : "partially_refunded",
              refundAmount: amount,
              refundReason: values.reason.trim() || undefined,
              ...(isChargeback ? {} : describedRefund(values)),
              ...(alreadyGone ? { manualRefund: true } : {}),
              ...(isChargeback
                ? {
                    manualRefundKind: "chargeback",
                    chargebackDisputeId: (values.disputeId || "").trim() || undefined,
                  }
                : {}),
            },
      );

      toast.success(t("orderDetails.refundRecorded"));
      setRefundDialogKind(null);
      await fetchReturnRequests();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t("orderDetails.refundFailed"),
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReturnStatusUpdate = async (
    request: OrderReturnRequest,
    status: "approved" | "received",
  ) => {
    setIsUpdating(true);
    try {
      await apiClient.put(`/api/admin/returns/${request._id}`, { status });
      toast.success(t("orderDetails.returnRequestUpdated"));
      await fetchReturnRequests();
      router.refresh();
    } catch {
      toast.error(t("orderDetails.returnRequestUpdateFailed"));
    } finally {
      setIsUpdating(false);
    }
  };

  // Optional throughout. An admin who just wants the money back leaves them
  // alone and gets the behaviour they always had; one who fills them in gets a
  // statement line that says what the refund was for.
  const describeFields: InputDialogField[] = [
    ...refundableLines
      .filter((line) => line.quantity > 0)
      .map((line) => ({
        name: `qty_${line.index}`,
        label: t("orderDetails.refundCoversItem", {
          name: line.name,
          quantity: line.quantity,
        }),
        type: "number" as const,
        inputMode: "numeric" as const,
        min: "0",
        max: String(line.quantity),
        step: "1",
      })),
    ...(refundableShipping > 0
      ? [
          {
            name: "shipping",
            label: t("orderDetails.refundCoversShipping"),
            type: "number" as const,
            inputMode: "decimal" as const,
            min: "0",
            max: refundableShipping.toFixed(2),
            step: "0.01",
          },
        ]
      : []),
  ];

  // How the money goes back. Sending it is the default; the other two only
  // record money that has already left, so nothing is paid out twice.
  const refundOutOfBand = refundSettlesOutOfBand({
    paymentMethod: order.paymentMethod,
    channel: order.channel,
  });
  const refundDisputeGateway = refundOutOfBand
    ? null
    : disputeGatewayForMethod(order.paymentMethod);
  const recordingChargeback = refundValues.settle === "chargeback";
  const settleField: InputDialogField = {
    name: "settle",
    label: t("orderDetails.refundSettleLabel"),
    options: [
      {
        value: "send",
        label: refundOutOfBand
          ? t("orderDetails.refundSettleRecordToSend")
          : t("orderDetails.refundSettleSend"),
      },
      {
        value: "already",
        label: refundOutOfBand
          ? t("orderDetails.refundSettleAlreadyReturned")
          : t("orderDetails.refundSettleAlreadyAtGateway"),
        description: t("orderDetails.refundSettleAlreadyHint"),
      },
      ...(refundDisputeGateway
        ? [
            {
              value: "chargeback",
              label: t("orderDetails.refundSettleChargeback"),
              description: t("orderDetails.refundSettleChargebackHint"),
            },
          ]
        : []),
    ],
  };

  const refundFields: InputDialogField[] = [
    settleField,
    ...(refundDialogKind === "partial"
      ? [
          {
            name: "amount",
            label: t("orderDetails.enterRefundAmount"),
            type: "number" as const,
            inputMode: "decimal" as const,
            min: "0.01",
            max: refundableRemaining.toFixed(2),
            step: "0.01",
            required: true,
          },
        ]
      : []),
    ...(recordingChargeback
      ? [
          {
            name: "disputeId",
            label: t("orderDetails.refundChargebackDisputeId"),
            placeholder: t("orderDetails.refundChargebackDisputeIdPlaceholder"),
          },
        ]
      : describeFields),
    {
      name: "reason",
      label: t("orderDetails.refundReasonOptional"),
      multiline: true,
      rows: 3,
    },
  ];

  const statusActions = getOrderStatusActions(order.status).filter(
    (action) => canCancel || action.id !== "cancel_order",
  );
  const approvableReturnRequests = returnRequests.filter(
    (request) => request.status === "requested",
  );
  const receivableReturnRequests = returnRequests.filter((request) =>
    ["approved", "in_transit"].includes(request.status),
  );
  const canShowReturnActions =
    !readOnly &&
    (approvableReturnRequests.length > 0 ||
      receivableReturnRequests.length > 0);
  const canShowRefundActions =
    canRefund &&
    (order.paymentStatus === "paid" ||
      order.paymentStatus === "partially_refunded");
  const canMarkPaid =
    !readOnly &&
    order.status !== "cancelled" &&
    (order.paymentStatus === "pending" ||
      order.paymentStatus === "partially_paid");

  return (
    <>
      {/* Title and actions share a row only when there is room for both. At
          common laptop widths the badges and the four actions did not fit, and
          the row ran off the right edge — taking "More actions", and with it
          refunds and status changes, out of reach. */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {t("orderDetails.orderNumber", { number: order.orderNumber })}
            </h1>
            {getPaymentBadge(order.paymentStatus)}
            {getStatusBadge(order.status)}
            {/* Where this order is fulfilled from — the counter the shopper is
                collecting at, or the branch it is packed and posted from. A
                store with one location never sees it, which is right: there is
                no choice being reported. */}
            {fulfillmentPlaces.map((place) => (
              <Badge key={place} variant="outline" className="gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {place}
              </Badge>
            ))}
          </div>
          <p className="text-muted-foreground mt-1">
            {t("orderDetails.placedOn")}{" "}
            {format(new Date(order.createdAt), "MMMM d, yyyy, h:mm a")}
          </p>
          {order.trackingNumber ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("orderDetails.tracking")} {order.trackingNumber}
              {order.carrier ? ` · ${order.carrier}` : ""}
            </p>
          ) : null}
          {/* The reason was captured on cancel but only ever lived in the
              dialog — nothing on the page told you WHY an order was cancelled. */}
          {order.status === "cancelled" && order.cancelReason ? (
            <p className="mt-1 text-sm text-destructive">
              {t("orderDetails.cancelledReason", {
                reason: order.cancelReason,
              })}
            </p>
          ) : null}
          {returnRequests.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">
                {t("orderDetails.returnRequests")}
              </span>
              {returnRequests.map((request) => {
                const refundStatusLabel = getReturnRefundStatusLabel(
                  request.refundStatus,
                );

                return (
                  <Badge
                    key={request._id}
                    variant={getReturnStatusVariant(request.status)}
                    className="gap-1.5 capitalize"
                  >
                    <span>{request.returnNumber}</span>
                    {request.ownerLabel ? (
                      <span className="border-l border-current/30 pl-1.5">
                        {request.ownerLabel}
                      </span>
                    ) : null}
                    <span>{getReturnStatusLabel(request.status)}</span>
                    {refundStatusLabel ? (
                      <span className="border-l border-current/30 pl-1.5">
                        {refundStatusLabel}
                      </span>
                    ) : null}
                  </Badge>
                );
              })}
            </div>
          ) : null}
        </div>

        {/* The action bar is what you clicked to get here — it has no place on
            the printed sheet. */}
        <div className="flex flex-wrap items-center gap-2 print:hidden xl:shrink-0 xl:justify-end">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="mr-2 h-4 w-4" />
            {t("orderDetails.print")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDownloadInvoice()}
            disabled={isDownloadingInvoice}
          >
            <Download className="mr-2 h-4 w-4" />
            {t("orderDetails.downloadInvoice")}
          </Button>
          {/* One shipment, two ways to get it out: download the PDF or send it
              straight to the thermal printer. They were two toolbar buttons
              that both POST the same shipment first — collapsed into a single
              control so the difference reads as "which output", not "which
              action". Hidden entirely for view-only staff: creating the
              shipment needs EDIT/MANAGE, so either path would only 403. */}
          {!readOnly ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDownloadingShippingLabel}
                >
                  {isDownloadingShippingLabel ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PackageCheck className="mr-2 h-4 w-4" />
                  )}
                  {t("orderDetails.shippingLabel")}
                  <ChevronDown className="ml-1 h-4 w-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => void ensureShippingLabel(true)}
                >
                  <Download className="h-4 w-4" />
                  {t("orderDetails.shippingLabelDownload")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void printShippingLabelDirect()}
                  title={t("orderDetails.printThermalLabelHint")}
                >
                  <Printer className="h-4 w-4" />
                  {t("orderDetails.printThermalLabel")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {!readOnly &&
          (statusActions.length > 0 ||
            canShowReturnActions ||
            canShowRefundActions ||
            canMarkPaid ||
            canOverride) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">{t("orderDetails.moreActions")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {statusActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    className={
                      action.destructive ? "text-destructive" : undefined
                    }
                    onClick={() => handleStatusAction(action)}
                  >
                    {getActionIcon(action.id)}
                    {getActionLabel(action)}
                  </DropdownMenuItem>
                ))}
                {canMarkPaid && (
                  <>
                    {statusActions.length > 0 ? (
                      <DropdownMenuSeparator />
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => void handleMarkAsPaid()}
                    >
                      <CircleDollarSign className="h-4 w-4" />
                      {t("orderDetails.markAsPaid")}
                    </DropdownMenuItem>
                  </>
                )}
                {/* Always offered, including on delivered and cancelled orders
                    — those are precisely the ones the workflow leaves no way
                    out of, and the misclick this exists to undo. */}
                {canOverride && (
                  <>
                    {statusActions.length > 0 || canMarkPaid ? (
                      <DropdownMenuSeparator />
                    ) : null}
                    <DropdownMenuItem
                      onClick={() => {
                        setOverrideStatus("");
                        setOverrideReason("");
                        setOverrideDialogOpen(true);
                      }}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      {t("orderDetails.overrideStatus")}
                    </DropdownMenuItem>
                  </>
                )}
                {(canShowReturnActions || canShowRefundActions) &&
                (statusActions.length > 0 || canMarkPaid) ? (
                  <DropdownMenuSeparator />
                ) : null}
                {canShowReturnActions && (
                  <>
                    {approvableReturnRequests.map((request) => (
                      <DropdownMenuItem
                        key={`approve-return-${request._id}`}
                        disabled={isUpdating}
                        onClick={() =>
                          void handleReturnStatusUpdate(request, "approved")
                        }
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {t("orderDetails.returnRequestApprovedAction", {
                          number: request.returnNumber,
                        })}
                      </DropdownMenuItem>
                    ))}
                    {receivableReturnRequests.map((request) => (
                      <DropdownMenuItem
                        key={`receive-return-${request._id}`}
                        disabled={isUpdating}
                        onClick={() =>
                          void handleReturnStatusUpdate(request, "received")
                        }
                      >
                        <PackageCheck className="h-4 w-4" />
                        {t("orderDetails.returnRequestReceivedAction", {
                          number: request.returnNumber,
                        })}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                {canShowRefundActions && (
                  <>
                    {canShowReturnActions ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem onClick={() => openRefundDialog("full")}>
                      {t("orderDetails.refundFull")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => openRefundDialog("partial")}
                    >
                      {t("orderDetails.refundPartial")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.back()}
            className="shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("orderDetails.back")}
          </Button>
        </div>
      </div>

      <InputDialog
        open={refundDialogKind !== null}
        onOpenChange={(open) => {
          if (!open) setRefundDialogKind(null);
        }}
        title={
          refundDialogKind === "partial"
            ? t("orderDetails.refundPartial")
            : t("orderDetails.refundFull")
        }
        // Says WHY when delivery has been held back. The figure on its own
        // reads like an arbitrary number to whoever is about to press Confirm,
        // and the one question it should answer is what happened to the rest.
        description={
          unrefundableDelivery > 0
            ? t("orderDetails.refundableLessDelivery", {
                amount: formatPrice(refundableRemaining),
                delivery: formatPrice(unrefundableDelivery),
              })
            : t("orderDetails.refundableRemaining", {
                amount: formatPrice(refundableRemaining),
              })
        }
        fields={refundFields}
        values={refundValues}
        onValuesChange={(values) => {
          setRefundValues(values);
          if (Object.keys(refundErrors).length > 0) setRefundErrors({});
        }}
        onSubmit={handleRefundSubmit}
        submitText={tRoot("common.confirm")}
        cancelText={t("orderDetails.cancel")}
        loading={isUpdating}
        errors={refundErrors}
      />

      <Dialog open={shipDialogOpen} onOpenChange={setShipDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orderDetails.markShipped")}</DialogTitle>
            <DialogDescription>
              {t("orderDetails.markShippedDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="detail-order-carrier">{t("orderDetails.carrier")}</Label>
              <Input
                id="detail-order-carrier"
                value={carrier}
                onChange={(event) => setCarrier(event.target.value)}
                placeholder={t("orderDetails.carrierPlaceholder")}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="detail-order-tracking-number">
                {t("orderDetails.trackingNumber")}
              </Label>
              <Input
                id="detail-order-tracking-number"
                value={trackingNumber}
                onChange={(event) => setTrackingNumber(event.target.value)}
                placeholder={t("orderDetails.trackingNumberPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShipDialogOpen(false)}
              disabled={isUpdating}
            >
              {t("orderDetails.cancel")}
            </Button>
            <Button
              type="button"
              disabled={isUpdating}
              onClick={() => {
                void handleStatusUpdate("shipped", {
                  trackingNumber: trackingNumber.trim() || undefined,
                  carrier: carrier.trim() || undefined,
                }).then(async (ok) => {
                  if (ok) {
                    await ensureShippingLabel(false);
                    setShipDialogOpen(false);
                  }
                });
              }}
            >
              {t("orderDetails.markShipped")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orderDetails.overrideStatusTitle")}</DialogTitle>
            <DialogDescription>
              {t("orderDetails.overrideStatusDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="detail-order-override-status">
                {t("orderDetails.overrideNewStatus")}
              </Label>
              <Select value={overrideStatus} onValueChange={setOverrideStatus}>
                <SelectTrigger id="detail-order-override-status">
                  <SelectValue
                    placeholder={t("orderDetails.overrideNewStatus")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {OVERRIDABLE_STATUSES.filter(
                    (status) => status !== order.status,
                  ).map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`orderDetails.orderStatus.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Reinstating is the one override with physical consequences, so
                it is said out loud before the click rather than explained by
                an error afterwards. */}
            {order.status === "cancelled" && overrideStatus ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t("orderDetails.overrideReinstateWarning")}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="detail-order-override-reason">
                {t("orderDetails.reason")}
              </Label>
              <Textarea
                id="detail-order-override-reason"
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder={t("orderDetails.overrideReasonPlaceholder")}
                className="min-h-24"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOverrideDialogOpen(false)}
              disabled={isUpdating}
            >
              {t("orderDetails.cancel")}
            </Button>
            <Button
              type="button"
              disabled={
                isUpdating ||
                !overrideStatus ||
                overrideReason.trim().length < 3
              }
              onClick={() => {
                void handleStatusUpdate(overrideStatus, {
                  override: true,
                  overrideReason: overrideReason.trim(),
                }).then((ok) => {
                  if (ok) setOverrideDialogOpen(false);
                });
              }}
            >
              {t("orderDetails.overrideStatus")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orderDetails.cancelOrderTitle")}</DialogTitle>
            <DialogDescription>
              {t("orderDetails.cancelOrderDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="detail-order-cancel-reason">{t("orderDetails.reason")}</Label>
            <Textarea
              id="detail-order-cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder={t("orderDetails.cancelReasonPlaceholder")}
              className="min-h-24"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={isUpdating}
            >
              {t("orderDetails.keepOrder")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isUpdating}
              onClick={() => {
                void handleStatusUpdate("cancelled", {
                  cancelReason: cancelReason.trim() || undefined,
                }).then((ok) => {
                  if (ok) setCancelDialogOpen(false);
                });
              }}
            >
              {t("orderDetails.cancelOrder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
