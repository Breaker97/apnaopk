"use client";

import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
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
  Send,
  ShieldAlert,
  AlertTriangle,
  Undo2,
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
import { orderCreditRestorable } from "@/lib/store-credit/order-credit";
import {
  isOpenReturnStatus,
  REFUND_IN_MOTION_STATUSES,
  releasesReturnQuantity,
  returnClaimedQuantity,
} from "@/lib/returns/returns";
import { orderRefundRoom } from "@/lib/orders/order-refund-room";
import { currencyPriceScale, quantizeToCurrency } from "@/lib/intl/money";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import {
  getSavedThermalPrinterName,
  printPdfBlobWithQz,
} from "@/lib/printing/qz-client";
import {
  getFulfillmentPaymentBlock,
  isFulfillmentTransition,
} from "@/lib/orders/fulfillment-payment-gate";
import { getPendingPaymentLock } from "@/lib/orders/pending-payment-lock";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { OpenReturnDialog } from "@/components/admin/returns/open-return-dialog";

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
  /** Delivery inside the estimate, which a return may hand back. */
  estimatedRefundShipping?: number;
  /** Whose items came back, when the return is not the store's own. */
  ownerLabel?: string;
  /** The order lines this return covers, so the dialog cannot offer them. */
  items?: Array<{
    orderItemIndex: number;
    quantityRequested: number;
    quantityApproved?: number;
  }>;
  /** The exchange order the return became, while it stands (R7). */
  exchangeOrder?: { _id: string; orderNumber: string };
}

/**
 * Held while a mobile-money payment is in flight — the same rule the API
 * enforces (`lib/orders/pending-payment-lock.ts`). Read here so the actions
 * that would be refused are not offered: a Cancel button that always 400s is
 * how a store worker learns to ignore error messages.
 */
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
  /**
   * Delivery the shopper paid that no refund has handed back yet — what the
   * dialog's delivery row can name, the held-back part included. Naming it
   * is how an admin hands that part back anyway.
   */
  refundableDelivery?: number;
  /**
   * What the order collected — its total, unless part of it was never paid
   * for. The refundable remainder is measured from it, as the server's cap is.
   */
  refundCeiling?: number;
  /** Units of each line already refunded from this screen, by line index. */
  refundedQuantities?: Record<number, number>;
  /**
   * Whether a refund can go to the shopper as store credit (R8): a customer
   * account, and no seller holding the cash. Asked on the server, where the
   * store's own sellers are known.
   */
  canRefundToStoreCredit?: boolean;
}

export function OrderHeader({
  order,
  readOnly,
  canCancel = true,
  canRefund = false,
  canOverride = false,
  returnRequests: initialReturnRequests = [],
  unrefundableDelivery = 0,
  refundableDelivery,
  refundCeiling,
  refundedQuantities,
  canRefundToStoreCredit = false,
}: OrderHeaderProps) {
  const t = useTranslations("admin");
  // New key, added to en and bn only — every other locale falls back to the
  // English sentence, the convention the checkout keys already follow.
  const tr = useFallbackTranslator(t);
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
    target: "order",
    restock: "no",
    refundTo: "original",
    credit: "",
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
  const [openReturnDialogOpen, setOpenReturnDialogOpen] = useState(false);
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
          "estimatedRefundTotal" | "actualRefundAmount" | "estimatedRefundShipping"
        > & {
          estimatedRefund?: { total?: number; shipping?: number };
          actualRefund?: { amount?: number };
          exchange?: { orderId?: string; orderNumber?: string; undoneAt?: string } | null;
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
          estimatedRefundShipping: Math.max(
            0,
            Number(request.estimatedRefund?.shipping || 0),
          ),
          // The lines as well: dropped here, every return's units read as
          // free again after the first action, and the dialog offered to
          // refund goods a return was going to pay for.
          items: (request.items || []).map((item) => ({
            orderItemIndex: Number(item?.orderItemIndex ?? -1),
            quantityRequested: Math.max(0, Number(item?.quantityRequested || 0)),
            ...(typeof item?.quantityApproved === "number"
              ? { quantityApproved: Math.max(0, item.quantityApproved) }
              : {}),
          })),
          ...(request.exchange?.orderId && !request.exchange.undoneAt
            ? {
                exchangeOrder: {
                  _id: String(request.exchange.orderId),
                  orderNumber: String(request.exchange.orderNumber || ""),
                },
              }
            : {}),
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
      const updated = await apiClient.put<{
        refund?: { failed?: boolean; reason?: string };
      }>(`/api/admin/orders/${order._id}`, {
        status,
        ...payload,
      });
      // A cancellation stands even when its refund does not go through, and
      // "updated" read as though the shopper had their money back.
      if (updated?.refund?.failed) {
        toast.warning(
          t("orderDetails.orderCancelledNoRefund", {
            reason: updated.refund.reason || "",
          }),
        );
      } else {
        toast.success(tRoot("orders.orderUpdated"));
      }
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

  const handleSendPaymentLink = async () => {
    setIsUpdating(true);
    try {
      await apiClient.post(
        `/api/admin/orders/${order._id}/payment-link`,
        {},
      );
      toast.success(
        tr(
          "orderDetails.sendPaymentLinkSuccess",
          "Payment link sent to the customer.",
        ),
      );
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
      expired: { variant: "destructive" },
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

  // What is still refundable, measured the way the server measures it (see
  // `orderRefundRoom`). A "full" refund on an order that was already
  // partially refunded must cover the REMAINDER — sending the whole order
  // total again trips the server's cumulative cap ("Refund amount exceeds
  // order total"), which made a second refund impossible from this screen.
  // Less the delivery a delivered order cannot give back: the carrier was
  // paid when the parcel left, and refunding it takes the fee out of the
  // merchant a second time for a service that was performed. An admin who
  // means to absorb it names it in the delivery row, and only then does the
  // room grow by it.
  const refundCurrency = String(order.currency || "USD");
  const heldDelivery = Math.max(0, Number(unrefundableDelivery || 0));
  const refundRoom = (namedDelivery = 0) =>
    orderRefundRoom({
      ceiling: Number(refundCeiling ?? order.total ?? 0),
      refunded: Number(order.refundedTotal || 0),
      heldDelivery,
      namedDelivery,
      currency: refundCurrency,
    });
  const refundableRemaining = refundRoom().goodsLeft;
  /** The most this refund may be, with the delivery the admin named. */
  const refundLimitFor = (values: InputDialogValues) =>
    refundRoom(Math.max(0, Number(values.shipping || 0))).limit;
  // The delivery the row can name: everything the shopper paid for it that
  // no refund has handed back, the held-back part included. Only a Full
  // refund of an order that has not shipped names it by default.
  const deliveryLeft = quantizeToCurrency(
    Math.max(0, Number(refundableDelivery ?? order.shippingCost ?? 0)),
    refundCurrency,
  );
  const defaultDelivery = quantizeToCurrency(
    Math.max(0, deliveryLeft - heldDelivery),
    refundCurrency,
  );

  // The lines this refund can be described against, and what delivery is left
  // to hand back. Naming them turns the recorded split from an average across
  // the whole sale into a fact — see `allocateOrderRefund` on the server.
  // Leaving them blank keeps the old behaviour exactly.
  //
  // A line an open return covers is not part of a PARTIAL refund here:
  // whoever refunds it second pays for the same goods twice, and the server
  // refuses it for the same reason (see `openReturnQuantitiesByIndex`). A
  // FULL refund does include it — it pays for that return's goods, and the
  // server closes the return with it. A return that is finished (refunded or
  // closed) holds its units either way.
  const openReturnUnitsByLine = new Map<number, number>();
  const finishedReturnUnitsByLine = new Map<number, number>();
  for (const request of returnRequests) {
    if (releasesReturnQuantity(request.status)) continue;
    const units = isOpenReturnStatus(request.status)
      ? openReturnUnitsByLine
      : finishedReturnUnitsByLine;
    for (const item of request.items || []) {
      const index = Number(item?.orderItemIndex);
      if (!Number.isInteger(index)) continue;
      // What the return holds: a unit the store declined to take back is
      // refundable from here again.
      units.set(index, (units.get(index) || 0) + returnClaimedQuantity(item));
    }
  }
  const refundableLines = (order.items || []).map((item, index) => {
    const left = Math.max(
      0,
      Number(item?.quantity || 0) -
        (finishedReturnUnitsByLine.get(index) || 0) -
        // Nor what was refunded here already: named again, the server refuses.
        Number(refundedQuantities?.[index] || 0),
    );
    return {
      index,
      name: String(item?.name || `Item ${index + 1}`),
      price: Math.max(0, Number(item?.price || 0)),
      /** What a partial refund may name. */
      quantity: Math.max(0, left - (openReturnUnitsByLine.get(index) || 0)),
      /** What a Full refund names: an open return's units included. */
      fullQuantity: left,
    };
  });
  // The returns a Full refund of the order closes: the ones still open whose
  // own refund is not in motion — the same test the server applies.
  const returnsClosedByFullRefund = returnRequests.filter(
    (request) =>
      isOpenReturnStatus(request.status) &&
      !REFUND_IN_MOTION_STATUSES.includes(
        String(request.refundStatus || "") as (typeof REFUND_IN_MOTION_STATUSES)[number],
      ),
  );

  const openRefundDialog = (kind: "full" | "partial") => {
    const currentStatus = String(order.paymentStatus || "").toLowerCase();
    if (currentStatus !== "paid" && currentStatus !== "partially_refunded") {
      toast.error(t("orderDetails.refundNotAvailable"));
      return;
    }
    // Nothing left at the order's own precision — the goods, and any
    // delivery that could still be handed back. A float crumb of a cent used
    // to open the dialog on "Refundable: $0.00".
    if (refundRoom(deliveryLeft).limit <= 0) {
      toast.error(
        tr("orderDetails.refundNothingLeft", "Nothing is left to refund on this order."),
      );
      return;
    }

    // A full refund covers everything that is left, so it says so line by
    // line. An attributed refund is what stops the same goods being refunded
    // again through a return — and the whole-order button was the one refund
    // that could never say what it was for.
    setRefundValues({
      amount: "",
      reason: "",
      settle: "send",
      target: "order",
      restock: "no",
      refundTo: "original",
      credit: "",
      ...(kind === "full"
        ? {
            ...Object.fromEntries(
              refundableLines
                // Only while goods money is left — see `goodsToName`.
                .filter((line) => refundableRemaining > 0 && line.fullQuantity > 0)
                .map((line) => [`qty_${line.index}`, String(line.fullQuantity)]),
            ),
            ...(defaultDelivery > 0
              ? {
                  shipping: defaultDelivery.toFixed(
                    currencyPriceScale(refundCurrency),
                  ),
                }
              : {}),
          }
        : {}),
    });
    setRefundErrors({});
    setRefundDialogKind(kind);
  };

  /**
   * What the lines the admin named are worth — goods after the coupon, their
   * tax, and any delivery named beside them.
   *
   * The amount and the description were two independent fields, so the usual
   * refund was a number with nothing said about what it covered — and a refund
   * that says nothing cannot stop the same goods being refunded again through
   * a return. Filling it in as the lines are chosen makes the described refund
   * the easy one to write, which is the only way it becomes the common one.
   *
   * Priced the way `buildReturnRefundEstimate` prices a return of the same
   * goods: the coupon comes off first, and tax follows what the goods sold
   * for — checkout charges tax on the discounted subtotal.
   */
  const describedRefundAmount = (values: InputDialogValues): number => {
    const goodsGross = refundableLines.reduce(
      (sum, line) =>
        sum +
        line.price *
          Math.max(0, Math.min(line.quantity, Number(values[`qty_${line.index}`] || 0))),
      0,
    );
    const shipping = Math.max(0, Number(values.shipping || 0));
    if (goodsGross <= 0 && shipping <= 0) return 0;

    const subtotal = Math.max(0, Number(order.subtotal || 0));
    // A free-shipping coupon discounts DELIVERY, so it never comes off goods.
    const goodsDiscount = isFreeShippingCouponType(order.coupon?.type)
      ? 0
      : Math.max(0, Number(order.discount || 0));
    const goodsNet = Math.max(
      0,
      goodsGross - (subtotal > 0 ? (goodsDiscount * goodsGross) / subtotal : 0),
    );
    const goodsSold = subtotal - goodsDiscount;
    const tax =
      goodsSold > 0
        ? (Math.max(0, Number(order.tax || 0)) * goodsNet) / goodsSold
        : 0;
    return Math.min(
      refundLimitFor(values),
      quantizeToCurrency(goodsNet + tax + shipping, refundCurrency),
    );
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

    // "Full" on a return means what is left of that return. It used to send
    // the whole order's remainder, which the return's own cap then refused.
    const limit = refundLimitNow(values);
    const amount =
      refundDialogKind === "full"
        ? limit
        : quantizeToCurrency(Number(values.amount), refundCurrency);

    if (!Number.isFinite(amount) || amount <= 0) {
      setRefundErrors({
        // Full with only the delivery left: the row to fill in is the delivery.
        [refundDialogKind === "full" &&
        values.settle !== "chargeback" &&
        String(values.target || "order") === "order" &&
        deliveryLeft > 0
          ? "shipping"
          : "amount"]: t("orderDetails.invalidRefundAmount"),
      });
      return;
    }
    if (amount > limit + 0.01) {
      setRefundErrors({
        amount: t("orderDetails.refundExceedsRemaining", {
          amount: formatPrice(limit),
        }),
      });
      return;
    }

    // The part given as store credit (R8): blank is all of it.
    const toCredit = canRefundToCredit && values.refundTo === "store_credit";
    const creditTyped = String(values.credit || "").trim();
    const storeCreditAmount = toCredit
      ? Math.min(
          amount,
          creditTyped === ""
            ? amount
            : quantizeToCurrency(Number(creditTyped), refundCurrency),
        )
      : 0;
    if (toCredit && !(Number.isFinite(storeCreditAmount) && storeCreditAmount > 0)) {
      setRefundErrors({
        credit: tr(
          "orderDetails.refundStoreCreditInvalid",
          "Enter how much to give as store credit, or leave it blank for all of it.",
        ),
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
      // What this refund is FOR, as the admin said it — never guessed. A return
      // refund is capped server-side at the value of the goods coming back, so
      // an amount that does not fit is refused there rather than silently
      // landing on the order.
      const chosen = String(values.target || "order");
      const returnRequestForRefund = isChargeback
        ? undefined
        : refundableReturns.find((request) => chosen === `return:${request._id}`);
      const restocking = values.restock === "yes";
      const saved = await apiClient.put<{
        refundMatched?: unknown;
        refundOwedBySellers?: unknown[];
        refundRecordedLate?: boolean;
        storeCreditFailed?: string;
      }>(
        returnRequestForRefund
          ? `/api/admin/returns/${returnRequestForRefund._id}`
          : `/api/admin/orders/${order._id}`,
        returnRequestForRefund
          ? {
              status: "refunded",
              refundAmount: amount,
              refundReason: values.reason.trim() || undefined,
              ...(alreadyGone ? { manualRefund: true } : {}),
              ...(storeCreditAmount > 0 ? { storeCreditAmount } : {}),
              ...(restocking ? { restoreInventoryOnRefund: true } : {}),
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
              ...(storeCreditAmount > 0 ? { storeCreditAmount } : {}),
              // Only ever honoured on a full refund, which is the one case
              // where restoring the whole order is what the admin means.
              ...(restocking ? { restoreInventoryOnRefund: true } : {}),
              ...(isChargeback
                ? {
                    manualRefundKind: "chargeback",
                    chargebackDisputeId: (values.disputeId || "").trim() || undefined,
                  }
                : {}),
            },
      );

      // The gateway had reported it already: linked, not counted a second time.
      // Or a seller took this cash at the door, and they have been asked to
      // send it — the store is not the one paying it out.
      if (saved?.refundRecordedLate) {
        // The money went and the record did not. Never a failure: a retry
        // would send it again.
        toast.warning(t("orderDetails.refundRecordedLate"));
      } else if (saved?.storeCreditFailed) {
        // The rest went back; only the credit is to give again.
        toast.warning(saved.storeCreditFailed);
      } else {
        toast.success(
          saved?.refundMatched
            ? t("orderDetails.refundMatchedToGateway")
            : saved?.refundOwedBySellers?.length
              ? t("orderDetails.refundOwedBySeller")
              : t("orderDetails.refundRecorded"),
        );
      }
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
  // statement line that says what the refund was for. One list, a row per
  // line: a question per line ran a long order off the screen.
  const fullRefund = refundDialogKind === "full";
  // No goods money left, no goods to name: an older whole refund that named
  // only some lines still paid for the rest, and offering them again would
  // describe the delivery refund as goods.
  const goodsToName = refundableRemaining > 0;
  const describeRows: InputDialogField[] = [
    ...refundableLines
      .map((line) => ({
        line,
        units: !goodsToName ? 0 : fullRefund ? line.fullQuantity : line.quantity,
      }))
      .filter(({ units }) => units > 0)
      .map(({ line, units }) => ({
        name: `qty_${line.index}`,
        label: line.name,
        suffix: `/ ${units}`,
        placeholder: "0",
        type: "number" as const,
        inputMode: "numeric" as const,
        min: "0",
        max: String(units),
        step: "1",
      })),
    // Held back or not: on a dispatched order this row is the only way to
    // hand the delivery back, and it starts empty so that doing so is a
    // decision rather than a default.
    ...(deliveryLeft > 0
      ? [
          {
            name: "shipping",
            label: t("orderDetails.shipping"),
            suffix: `/ ${formatPrice(deliveryLeft)}`,
            placeholder: "0.00",
            type: "number" as const,
            inputMode: "decimal" as const,
            min: "0",
            max: String(deliveryLeft),
            step: "0.01",
          },
        ]
      : []),
  ];
  const describeFields: InputDialogField[] =
    describeRows.length > 0
      ? [
          {
            name: "covers",
            label: t("orderDetails.refundCoversLabel"),
            group: describeRows,
            // Said before it happens: a Full refund pays for the goods on the
            // open returns, and the server closes them with it.
            ...(fullRefund && goodsToName && returnsClosedByFullRefund.length > 0
              ? {
                  hint: tr(
                    "orderDetails.refundClosesReturns",
                    "Closes with this refund, which pays for its items too: {returns}",
                    {
                      returns: returnsClosedByFullRefund
                        .map((request) => request.returnNumber)
                        .join(", "),
                      count: returnsClosedByFullRefund.length,
                    },
                  ),
                }
              : {}),
          },
        ]
      : [];

  // How the money goes back. Sending it is the default; the other two only
  // record money that has already left, so nothing is paid out twice.
  const refundOutOfBand = refundSettlesOutOfBand({
    paymentMethod: order.paymentMethod,
    channel: order.channel,
    stripePaymentIntentId: order.stripePaymentIntentId,
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

  /**
   * The returns this refund could belong to, as a choice rather than a guess.
   *
   * It used to pick the first open return whose remaining cap happened to fit
   * the amount — whatever items that return was for. A goodwill refund for a
   * late parcel landed on somebody's return of a different product, ate its
   * cap, and took the money out of that seller's payable. Worse, choosing a
   * return silently threw away the lines the admin had just described.
   *
   * A chargeback is never a return's: the bank took that money.
   */
  /**
   * What is left to refund on a return: its own remainder, held to what the
   * order still has for it — the goods left, plus the delivery the return's
   * own estimate hands back. A Full refund of the order that paid for the
   * return's goods left the return offering its whole value again, and the
   * held-back delivery was the money it would have come out of.
   */
  const returnRefundLeft = (request: OrderReturnRequest) =>
    Math.min(
      quantizeToCurrency(
        Math.max(
          0,
          Number(request.estimatedRefundTotal || 0) -
            Number(request.actualRefundAmount || 0),
        ),
        refundCurrency,
      ),
      refundRoom(Math.max(0, Number(request.estimatedRefundShipping || 0))).limit,
    );
  /**
   * The most this refund may be, for what the dialog says now: what is left
   * of the chosen return, or of the order with any delivery the admin named.
   * A chargeback is the bank's, so it names no delivery and no return.
   */
  const refundLimitNow = (values: InputDialogValues) => {
    if (values.settle === "chargeback") return refundRoom().limit;
    const chosen = refundableReturns.find(
      (request) => String(values.target || "order") === `return:${request._id}`,
    );
    return chosen ? returnRefundLeft(chosen) : refundLimitFor(values);
  };
  const refundableReturns = recordingChargeback
    ? []
    : returnRequests.filter((request) => {
        // Partly refunded included: the rest of its value can still be owed,
        // and with it left out neither screen could ever send that rest.
        if (
          ![
            "approved",
            "received",
            "inspected",
            "refund_pending",
            "partially_refunded",
          ].includes(request.status)
        ) {
          return false;
        }
        if (Number(request.estimatedRefundTotal || 0) <= 0) return false;
        return returnRefundLeft(request) > 0;
      });
  const refundTarget = String(refundValues.target || "order");
  const targetedReturn = refundableReturns.find(
    (request) => refundTarget === `return:${request._id}`,
  );
  const targetField: InputDialogField = {
    name: "target",
    label: t("orderDetails.refundTargetLabel"),
    options: [
      {
        value: "order",
        label: t("orderDetails.refundTargetOrder"),
        description: t("orderDetails.refundTargetOrderHint"),
      },
      ...refundableReturns.map((request) => ({
        value: `return:${request._id}`,
        label: t("orderDetails.refundTargetReturn", {
          number: request.returnNumber,
        }),
        description: t("orderDetails.refundTargetReturnHint", {
          amount: formatPrice(returnRefundLeft(request)),
        }),
      })),
    ],
  };

  // Goods back on the shelf. The order path can only restore the WHOLE order,
  // so it is offered on a full refund alone; a return restores exactly the
  // units that came back in its parcel. Off by default either way — on this
  // screen nobody has necessarily seen the goods, and saying they are back is
  // the admin's statement, not an assumption.
  const canRestock = refundDialogKind === "full" || Boolean(targetedReturn);
  const restockField: InputDialogField = {
    name: "restock",
    label: targetedReturn
      ? t("orderDetails.refundRestockReturn")
      : t("orderDetails.refundRestockOrder"),
    checkbox: true,
  };

  // Where the refund goes (R8): back the way the shopper paid, or onto their
  // account as store credit — all of it, or the part typed. Only for money
  // being sent now, to a shopper with an account, out of cash the store holds:
  // a seller who took it at their own door refunds it themselves.
  const canRefundToCredit =
    canRefundToStoreCredit && String(refundValues.settle || "send") === "send";
  // Paid partly with store credit: that part goes back as credit first.
  const creditGoesBackFirst = orderCreditRestorable(order);
  const refundingToCredit =
    canRefundToCredit && refundValues.refundTo === "store_credit";
  const refundToFields: InputDialogField[] = canRefundToCredit
    ? [
        {
          name: "refundTo",
          label: tr("orderDetails.refundToLabel", "Refund to"),
          options: [
            {
              value: "original",
              label: tr("orderDetails.refundToOriginal", "Original payment"),
              ...(creditGoesBackFirst > 0
                ? {
                    description: tr(
                      "orderDetails.refundToOriginalCreditFirst",
                      "The {amount} paid with store credit goes back as store credit first.",
                      { amount: formatPrice(creditGoesBackFirst) },
                    ),
                  }
                : {}),
            },
            {
              value: "store_credit",
              label: tr("orderDetails.refundToStoreCredit", "Store credit"),
              description: tr(
                "orderDetails.refundToStoreCreditHint",
                "Added to the customer's account to spend at checkout. It doesn't expire.",
              ),
            },
          ],
        },
        ...(refundingToCredit
          ? [
              {
                name: "credit",
                label: tr("orderDetails.refundStoreCreditAmount", "Store credit amount"),
                type: "number" as const,
                inputMode: "decimal" as const,
                min: "0",
                step: "0.01",
                placeholder: tr("orderDetails.refundStoreCreditAll", "All of it"),
                hint: tr(
                  "orderDetails.refundStoreCreditRest",
                  "Whatever isn't given as credit goes back to the original payment.",
                ),
              },
            ]
          : []),
      ]
    : [];

  const refundFields: InputDialogField[] = [
    ...(refundableReturns.length > 0 ? [targetField] : []),
    settleField,
    ...(recordingChargeback
      ? [
          {
            name: "disputeId",
            label: t("orderDetails.refundChargebackDisputeId"),
            placeholder: t("orderDetails.refundChargebackDisputeIdPlaceholder"),
          },
        ]
      : targetedReturn
        ? []
        : describeFields),
    // Below the lines, since naming them is what fills it in.
    ...(refundDialogKind === "partial"
      ? [
          {
            name: "amount",
            label: t("orderDetails.enterRefundAmount"),
            type: "number" as const,
            inputMode: "decimal" as const,
            min: "0.01",
            max: String(
              targetedReturn
                ? returnRefundLeft(targetedReturn)
                : refundLimitFor(refundValues),
            ),
            step: "0.01",
            required: true,
          },
        ]
      : []),
    ...refundToFields,
    ...(canRestock ? [restockField] : []),
    {
      name: "reason",
      label: t("orderDetails.refundReasonOptional"),
      multiline: true,
      rows: 3,
    },
  ];

  const paymentLocked = Boolean(getPendingPaymentLock(order));
  const statusActions = getOrderStatusActions(order.status).filter(
    (action) =>
      (canCancel || action.id !== "cancel_order") &&
      // Cancelling would restock goods the payer may be paying for right now.
      !(paymentLocked && action.id === "cancel_order"),
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
  // A return asked for by phone, email or chat. Offered once something has been
  // delivered — a split order's consignments each on their own delivery — and
  // the dialog says what else stands in the way.
  const canOpenReturn =
    !readOnly &&
    (order.status === "delivered" ||
      (order.subOrders || []).some((sub) => sub?.status === "delivered"));
  const canShowRefundActions =
    canRefund &&
    (order.paymentStatus === "paid" ||
      order.paymentStatus === "partially_refunded");
  const canMarkPaid =
    !readOnly &&
    !paymentLocked &&
    order.status !== "cancelled" &&
    (order.paymentStatus === "pending" ||
      order.paymentStatus === "partially_paid");
  // "They say the payment failed and they never got an email." The sweep sends
  // this by itself when a gateway confirms nothing arrived; this is the same
  // message on request. Not offered where the shopper is not the one who owes
  // — cash on delivery and pay-later are pending by agreement, not by failure.
  const canSendPaymentLink =
    !readOnly &&
    order.status !== "cancelled" &&
    (order.paymentStatus === "pending" || order.paymentStatus === "expired") &&
    !["cod", "cash_on_delivery", "pay_later"].includes(
      String(order.paymentMethod || "").toLowerCase(),
    );

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
          {paymentLocked ? (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
              {tr(
                "orderDetails.paymentPendingLock",
                "The mobile money payment is still being processed. This order cannot be edited, cancelled or marked as paid until it settles — the payment is checked again every few minutes.",
              )}
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
          {/* Exchanges (R7): where a return's money went, and where an
              exchange order's came from. */}
          {returnRequests.map((request) =>
            request.exchangeOrder ? (
              <p key={`exchange-${request._id}`} className="mt-2 text-sm text-muted-foreground">
                {request.returnNumber} exchanged for order{" "}
                <Link
                  href={`/admin/orders/${request.exchangeOrder._id}`}
                  className="font-medium text-blue-600 hover:underline"
                >
                  #{request.exchangeOrder.orderNumber}
                </Link>
              </p>
            ) : null,
          )}
          {order.exchangeOf?.returnNumber ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Exchange for return {order.exchangeOf.returnNumber} on order{" "}
              <Link
                href={`/admin/orders/${String(order.exchangeOf.orderId)}`}
                className="font-medium text-blue-600 hover:underline"
              >
                #{order.exchangeOf.orderNumber}
              </Link>
              {order.exchangeOf.undoneAt ? " — called off" : ""}
            </p>
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
            canOpenReturn ||
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
                {statusActions.map((action) => {
                  // The server refuses a fulfilment move on an order whose
                  // payment has not arrived; say so here instead of letting
                  // the click fail.
                  const blocked =
                    isFulfillmentTransition(action.to) &&
                    Boolean(
                      getFulfillmentPaymentBlock(
                        order as unknown as Parameters<typeof getFulfillmentPaymentBlock>[0],
                        null,
                      ),
                    );
                  return (
                    <DropdownMenuItem
                      key={action.id}
                      disabled={blocked}
                      className={cn(
                        action.destructive && "text-destructive",
                        blocked && "items-start [&>svg]:mt-0.5",
                      )}
                      onClick={() => handleStatusAction(action)}
                    >
                      {getActionIcon(action.id)}
                      <span className="flex min-w-0 flex-col">
                        <span>{getActionLabel(action)}</span>
                        {blocked ? (
                          <span className="text-[11.5px] leading-tight text-muted-foreground">
                            Payment not received
                          </span>
                        ) : null}
                      </span>
                    </DropdownMenuItem>
                  );
                })}
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
                {canSendPaymentLink && (
                  <DropdownMenuItem
                    disabled={isUpdating}
                    onClick={() => void handleSendPaymentLink()}
                  >
                    <Send className="h-4 w-4" />
                    {tr(
                      "orderDetails.sendPaymentLink",
                      "Send payment link",
                    )}
                  </DropdownMenuItem>
                )}
                {/* Always offered, including on delivered and cancelled orders
                    — those are precisely the ones the workflow leaves no way
                    out of, and the misclick this exists to undo. The one
                    exception is a payment still in flight: the server refuses
                    every status change on those, override included, so
                    offering it here would only produce an error. */}
                {canOverride && !paymentLocked && (
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
                {(canShowReturnActions || canOpenReturn || canShowRefundActions) &&
                (statusActions.length > 0 || canMarkPaid) ? (
                  <DropdownMenuSeparator />
                ) : null}
                {canOpenReturn && (
                  <DropdownMenuItem onClick={() => setOpenReturnDialogOpen(true)}>
                    <Undo2 className="h-4 w-4" />
                    {tr("orderDetails.openReturn", "Open a return")}
                  </DropdownMenuItem>
                )}
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
                    {canShowReturnActions || canOpenReturn ? (
                      <DropdownMenuSeparator />
                    ) : null}
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
          heldDelivery > 0
            ? t("orderDetails.refundableLessDelivery", {
                amount: formatPrice(refundableRemaining),
                delivery: formatPrice(heldDelivery),
              })
            : t("orderDetails.refundableRemaining", {
                amount: formatPrice(refundableRemaining),
              })
        }
        fields={refundFields}
        values={refundValues}
        onValuesChange={(values) => {
          setRefundValues((previous) => {
            // Only when the DESCRIPTION moved. Recomputing on every change
            // would overwrite an amount the admin had just typed by hand.
            const linesChanged =
              refundableLines.some(
                (line) =>
                  previous[`qty_${line.index}`] !== values[`qty_${line.index}`],
              ) || previous.shipping !== values.shipping;
            if (!linesChanged || refundDialogKind !== "partial") return values;
            const described = describedRefundAmount(values);
            return described > 0
              ? {
                  ...values,
                  amount: described.toFixed(currencyPriceScale(refundCurrency)),
                }
              : values;
          });
          if (Object.keys(refundErrors).length > 0) setRefundErrors({});
        }}
        onSubmit={handleRefundSubmit}
        // A Full refund's figure shows nowhere else, and naming the delivery
        // changes it — so the button says what it sends. A partial refund's
        // amount is already in its own field.
        submitText={
          refundDialogKind === "full" && refundLimitNow(refundValues) > 0
            ? tr("orderDetails.refundConfirmAmount", "Confirm {amount}", {
                amount: formatPrice(refundLimitNow(refundValues)),
              })
            : tRoot("common.confirm")
        }
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

      {canOpenReturn ? (
        <OpenReturnDialog
          scope="admin"
          orderId={String(order._id)}
          open={openReturnDialogOpen}
          onOpenChange={setOpenReturnDialogOpen}
          onOpened={() => {
            void fetchReturnRequests();
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
