"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  Package,
  Truck,
  MapPin,
  CreditCard,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  RotateCcw,
  Star,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";
import {
  RefundBreakdown,
  type RefundBreakdownData,
} from "@/components/account/refund-breakdown";
import { RefundDestinationFields } from "@/components/account/refund-destination-fields";
import {
  describeRefundDestination,
  validateRefundDestination,
  type RefundDestinationInput,
} from "@/lib/returns/refund-settlement";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { ORDER_STATUS } from "@/config/app.config";
import { AppImage } from "@/components/ui/app-image";
import {
  ScanHistory,
  type ScanEvent,
} from "@/components/shipping/scan-history";
import {
  DeliveryException,
  type DeliveryException as DeliveryExceptionData,
} from "@/components/shipping/delivery-exception";
import { OrderDownloads } from "@/components/account/order-downloads";
import { PreorderBalanceCard } from "@/components/account/preorder-balance-card";
import { PreorderAddressEditor } from "@/components/store/preorder-address-editor";
import { getPreorderStatusLabel } from "@/lib/orders/preorder-status-label";
import { ReviewDialog, type ReviewTarget } from "@/components/reviews/review-dialog";
import { StarRatingDisplay } from "@/components/reviews/star-rating";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { formatPickupWindow } from "@/lib/checkout/pickup-fulfillment-shared";
import { getPaymentMethodMeta } from "@/components/common/payment-method-meta";
import { OrderCheckoutAnswers } from "@/components/common/order-checkout-answers";
import type { OrderCheckoutField } from "@/types";
import type { OrderReviewState } from "@/lib/catalog/review-eligibility";

interface OrderItem {
  productId:
    | string
    | { _id: string; name: string; images?: string[]; slug?: string };
  name: string;
  quantity: number;
  price: number;
  image?: string;
}

interface ShippingAddress {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  street: string;
  apartment?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

/**
 * One seller's consignment, as `sanitizeOrderForCustomer` hands it over.
 *
 * Only populated for orders that actually span sellers — a single-vendor order
 * has nothing to distinguish, so the API sends an empty array and every view
 * below falls back to the order-level story.
 */
interface Shipment {
  _id?: string;
  vendorId?: string;
  vendorName?: string;
  status: string;
  paymentStatus: string;
  trackingNumber?: string;
  carrier?: string;
  /** The carrier's own tracking page, when this parcel was booked through one. */
  trackingUrl?: string;
  /** The courier's scans for this parcel, newest first. */
  events?: ScanEvent[];
  /** A failed attempt or a return, which the order status never reflects. */
  exception?: DeliveryExceptionData;
  /** Positions in `order.items`; returns are filed against these. */
  itemIndexes: number[];
}

interface Order {
  _id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subOrders?: Shipment[];
  /**
   * The order-level parcel — "most recent shipment" on a split order.
   *
   * Single-vendor orders carry no consignments at all, so without these the
   * screen had nothing to say about the parcel for the majority of orders.
   */
  trackingNumber?: string;
  carrier?: string;
  trackingUrl?: string;
  trackingEvents?: ScanEvent[];
  trackingException?: DeliveryExceptionData;
  paymentMethod: string;
  subtotal: number;
  shipping?: number;
  shippingCost?: number;
  tax: number;
  discount?: number;
  /** Import duty collected at checkout; already inside `total`. */
  customs?: { dutyAmount?: number };
  total: number;
  items: OrderItem[];
  shippingAddress: ShippingAddress;
  billingAddress?: ShippingAddress;
  customerNote?: string;
  checkoutFields?: OrderCheckoutField[];
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
  };
  digitalOnly?: boolean;
  hasPreorder?: boolean;
  preorderStatus?: string;
  preorderPaymentMode?: string;
  preorderOutstandingAmount?: number;
  preorderReleaseDate?: string;
  /** Set only once a date has actually moved, so it doubles as "was delayed". */
  preorderOriginalReleaseDate?: string;
  preorderDelayReason?: string;
  /** Computed by the order API — see `PreorderBalanceCard`. */
  preorderBalanceDue?: number;
  preorderPaidSoFar?: number;
  preorderBalanceDeadline?: string;
  /** One per delivered product; absent from everything not yet delivered. */
  reviewStates?: OrderReviewState[];
  createdAt: string;
  updatedAt: string;
}

/** Payment states in which a seller's goods are paid for and returnable. */
const PAID_PAYMENT_STATUSES = ["paid", "partially_refunded"];

/** Payment states carrying an `orders.payment.*` label in every locale. */
const TRANSLATED_PAYMENT_STATUSES = [
  "pending",
  "paid",
  "partially_paid",
  "refunded",
  "partially_refunded",
];

/** Consignment states past the point of stopping. */
const DISPATCHED_STATUSES: string[] = [
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
];

interface ReturnRequest {
  _id: string;
  returnNumber: string;
  status: string;
  refundStatus: string;
  reason: string;
  customerNote?: string;
  estimatedRefund?: RefundBreakdownData;
  refundDestination?: RefundDestinationInput;
  items: Array<{
    orderItemIndex: number;
    name: string;
    quantityRequested: number;
  }>;
  createdAt: string;
}

/** What `POST /api/returns/preview` answers with. */
interface ReturnPreview {
  currency: string;
  merchantAtFault: boolean;
  refundsShipping: boolean;
  /** No gateway can carry this refund, so the shopper must say where to send it. */
  settlesOutOfBand: boolean;
  total: number;
  groups: Array<{
    ownerType: "admin" | "vendor";
    items: Array<{ name: string; quantityRequested: number }>;
    estimatedRefund: RefundBreakdownData;
  }>;
}

const ACTIVE_RETURN_STATUSES = new Set([
  "requested",
  "approved",
  "awaiting_shipment",
  "in_transit",
  "received",
  "inspected",
  "refund_pending",
  "partially_refunded",
  "refunded",
]);

interface OrderDetailsProps {
  orderId: string;
  locale: string;
}

/** An order line's product, whether the API sent the id or the document. */
function describeItem(item: OrderItem) {
  const product = typeof item.productId === "object" ? item.productId : null;
  return {
    productId: product ? product._id : String(item.productId),
    name: product ? product.name : item.name,
    slug: product?.slug ?? null,
    image: item.image || product?.images?.[0] || null,
  };
}

export function OrderDetails({ orderId, locale }: OrderDetailsProps) {
  const t = useTranslations();
  const tf = useFallbackTranslator(t);
  const { formatPrice } = useCurrency();
  const { confirm } = useConfirmation();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);
  const [returnRequests, setReturnRequests] = useState<ReturnRequest[]>([]);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [otherReturnReason, setOtherReturnReason] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);
  // Both keyed by the selection they answer, so a result is matched to its
  // question rather than assumed to be current. Without that, a quote for the
  // previous selection reads as a quote for this one.
  const [returnPreview, setReturnPreview] = useState<{
    key: string;
    data: ReturnPreview;
  } | null>(null);
  const [returnPreviewError, setReturnPreviewError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [refundDestination, setRefundDestination] = useState<RefundDestinationInput>({});
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);

  // Bumped after the shopper pays a pre-order balance so the page re-reads
  // the order instead of showing a "pay" prompt for money already taken.
  const [orderReloadKey, setOrderReloadKey] = useState(0);

  useEffect(() => {
    async function fetchOrder() {
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const data = await res.json();

        if (data.success) {
          setOrder(data.data);
        } else {
          setError(data.message || "Order not found");
        }
      } catch {
        setError("Failed to load order");
      } finally {
        setIsLoading(false);
      }
    }

    fetchOrder();
  }, [orderId, orderReloadKey]);

  useEffect(() => {
    async function fetchReturns() {
      try {
        const res = await fetch(`/api/returns?orderId=${orderId}&limit=20`);
        const data = await res.json();
        if (data.success) {
          setReturnRequests(data.data?.data || []);
        }
      } catch {
        // Return history should not block order rendering.
      }
    }

    void fetchReturns();
  }, [orderId]);

  const handleCancelOrder = async () => {
    if (!order) return;

    const confirmed = await confirm({
      title: t("orders.cancelOrderTitle"),
      description: t("orders.cancelOrderDescription"),
      confirmText: t("orders.cancelOrder"),
      cancelText: t("orders.keepOrder"),
      variant: "destructive",
    });

    if (!confirmed) return;

    setIsCancelling(true);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: ORDER_STATUS.CANCELLED }),
      });

      const data = await res.json();

      if (data.success) {
        // A cancelled pre-order sends money back, and the shopper should be
        // told which of the two happened rather than being left to check their
        // statement. `refund.refunded === false` on an order that collected
        // nothing is not a failure — it is a pay-later reservation with no
        // deposit to return, which the message below does not claim otherwise.
        const refund = data.data?.refund as
          | { refunded?: boolean; amount?: number; reason?: string }
          | undefined;
        if (refund?.refunded && typeof refund.amount === "number") {
          toast.success(
            tf(
              "orders.orderCancelledRefunded",
              "Order cancelled. {amount} is on its way back to you.",
              { amount: formatPrice(refund.amount) },
            ),
          );
        } else {
          toast.success(t("orders.orderCancelled"));
        }
        // Re-read rather than patching the status locally: the cancellation
        // also moves the payment status, the consignments and the pre-order
        // state, and a hand-patched copy would disagree with all three.
        setOrderReloadKey((key) => key + 1);
      } else {
        toast.error(data.message || t("orders.orderCancelFailed"));
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsCancelling(false);
    }
  };

  const handleDownloadInvoice = async () => {
    if (!order) return;
    setIsDownloadingInvoice(true);
    try {
      const res = await fetch(`/api/orders/${order._id}/invoice`);
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
      toast.error(t("orders.invoiceDownloadFailed"));
    } finally {
      setIsDownloadingInvoice(false);
    }
  };

  const handleReturnQuantityChange = (index: number, value: string) => {
    if (!order) return;
    const parsed = Number(value);
    const max = getReturnableQuantity(index);
    setReturnQuantities((current) => ({
      ...current,
      [index]: Number.isFinite(parsed)
        ? Math.min(max, Math.max(0, parsed))
        : 0,
    }));
  };

  const selectedReturnItemsCount = Object.values(returnQuantities).filter(
    (quantity) => Number(quantity || 0) > 0,
  ).length;
  const selectedReturnReason =
    returnReason === "other" ? otherReturnReason.trim() : returnReason.trim();
  const canSubmitReturn =
    selectedReturnReason.length > 0 &&
    selectedReturnItemsCount > 0 &&
    !isSubmittingReturn;

  const currentOrderId = order?._id;

  /**
   * The selection, as one comparable value — empty while there is nothing to
   * quote. Sorted so the same choice made in a different order is the same
   * key, and re-quoting it is a cache hit rather than a second round trip.
   */
  const returnSelectionKey = useMemo(() => {
    const items = Object.entries(returnQuantities)
      .map(([index, quantity]) => ({
        orderItemIndex: Number(index),
        quantity: Number(quantity || 0),
      }))
      .filter((item) => item.quantity > 0)
      .sort((a, b) => a.orderItemIndex - b.orderItemIndex);

    if (items.length === 0 || !selectedReturnReason) return "";
    return JSON.stringify({ reason: selectedReturnReason, items });
  }, [returnQuantities, selectedReturnReason]);

  // Quote the refund while the shopper is still choosing, from the same
  // planner the submission uses. The reason is what decides whether delivery
  // comes back and whether the return leg is charged, so learning the figure
  // only after submitting told them the answer too late to act on it.
  useEffect(() => {
    if (!returnDialogOpen || !currentOrderId || !returnSelectionKey) return;

    const key = returnSelectionKey;
    const selection = JSON.parse(key) as {
      reason: string;
      items: Array<{ orderItemIndex: number; quantity: number }>;
    };
    const controller = new AbortController();

    // Debounced because the quantity inputs fire per keystroke, and aborted on
    // every change so a slow quote cannot land after a faster one.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/returns/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: currentOrderId, ...selection }),
            signal: controller.signal,
          });
          const data = await res.json().catch(() => null);
          if (controller.signal.aborted) return;

          if (res.ok && data?.success) {
            setReturnPreview({ key, data: data.data as ReturnPreview });
          } else {
            // The submission would refuse this selection for the same reason,
            // so showing the message here is the same answer, just sooner.
            setReturnPreviewError({
              key,
              message:
                data?.message || data?.error || "Could not work out a refund for this selection",
            });
          }
        } catch {
          if (controller.signal.aborted) return;
          setReturnPreviewError({
            key,
            message: "Could not work out a refund for this selection",
          });
        }
      })();
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [returnDialogOpen, currentOrderId, returnSelectionKey]);

  const previewError =
    returnPreviewError?.key === returnSelectionKey ? returnPreviewError.message : null;
  const currentPreview =
    returnPreview?.key === returnSelectionKey ? returnPreview.data : null;
  // The previous answer, shown dimmed while the new one is on its way, so
  // adjusting a quantity does not blank the figure the shopper was reading.
  const stalePreview = currentPreview ? null : returnPreview?.data ?? null;
  const shownPreview = currentPreview ?? stalePreview;

  // Only the preview knows whether this order's refund can go back the way it
  // came, so the destination fields appear once it has answered.
  const needsRefundDestination = shownPreview?.settlesOutOfBand === true;
  const refundDestinationProblems = needsRefundDestination
    ? validateRefundDestination(refundDestination)
    : [];
  const canSubmitReturnNow =
    canSubmitReturn && refundDestinationProblems.length === 0;

  const handleSubmitReturn = async () => {
    if (!order) return;

    const items = Object.entries(returnQuantities)
      .map(([index, quantity]) => ({
        orderItemIndex: Number(index),
        quantity: Number(quantity || 0),
      }))
      .filter((item) => item.quantity > 0);

    if (items.length === 0) {
      toast.error("Select at least one item to return");
      return;
    }

    if (!selectedReturnReason) {
      toast.error("Select a return reason");
      return;
    }

    setIsSubmittingReturn(true);
    try {
      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order._id,
          reason: selectedReturnReason,
          customerNote: returnNote.trim() || undefined,
          items,
          refundDestination: needsRefundDestination ? refundDestination : undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.ok && data?.success) {
        toast.success("Return request submitted");
        setReturnDialogOpen(false);
        setReturnReason("");
        setOtherReturnReason("");
        setReturnNote("");
        setReturnQuantities({});
        setReturnPreview(null);
        setReturnPreviewError(null);
        setRefundDestination({});
        setReturnRequests((current) => [
          ...(Array.isArray(data.data) ? data.data : [data.data]),
          ...current,
        ]);
      } else {
        toast.error(data?.message || data?.error || "Failed to submit return");
      }
    } catch {
      toast.error("Failed to submit return");
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const config: Record<
      string,
      {
        variant: "default" | "secondary" | "outline" | "destructive";
        icon: LucideIcon;
        label: string;
      }
    > = {
      [ORDER_STATUS.PENDING]: {
        variant: "outline",
        icon: Clock,
        label: t("orders.pending"),
      },
      [ORDER_STATUS.PROCESSING]: {
        variant: "secondary",
        icon: Package,
        label: t("orders.processing"),
      },
      [ORDER_STATUS.SHIPPED]: {
        variant: "default",
        icon: Truck,
        label: t("orders.shipped"),
      },
      [ORDER_STATUS.DELIVERED]: {
        variant: "default",
        icon: CheckCircle2,
        label: t("orders.delivered"),
      },
      [ORDER_STATUS.CANCELLED]: {
        variant: "destructive",
        icon: XCircle,
        label: t("orders.cancelled"),
      },
    };
    const {
      variant,
      icon: Icon,
      label,
    } = config[status] || { variant: "outline", icon: Package, label: status };
    return (
      <Badge variant={variant} className="gap-1.5 text-sm py-1 px-3">
        <Icon className="h-4 w-4" />
        {label}
      </Badge>
    );
  };

  // The raw enum value used to be printed straight into the page, so a French
  // shopper read "partially_refunded". Membership is tested against a list
  // rather than `t.has` so the label does not depend on which next-intl
  // surface a caller happens to provide.
  const getPaymentBadge = (paymentStatus: string) => (
    <Badge variant={paymentStatus === "paid" ? "default" : "outline"}>
      {TRANSLATED_PAYMENT_STATUSES.includes(paymentStatus)
        ? t(`orders.payment.${paymentStatus}`)
        : paymentStatus}
    </Badge>
  );

  if (isLoading) {
    return <OrderDetailsSkeleton />;
  }

  if (error || !order) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg mb-2">
          {error || "Order not found"}
        </h3>
        <Button variant="outline" asChild>
          <Link href={`/${locale}/account/orders`}>
            {t("orders.backToOrders")}
          </Link>
        </Button>
      </div>
    );
  }

  // Sellers on this order, each with its own status and its own money. Empty
  // for the ordinary single-seller order, which is what keeps every fallback
  // below reading as the order-level story it has always been.
  const shipments = order.subOrders ?? [];
  const isSplitOrder = shipments.length > 1;
  const paidVendorIds = new Set(
    shipments
      .filter((shipment) => PAID_PAYMENT_STATUSES.includes(shipment.paymentStatus))
      .map((shipment) => shipment.vendorId ?? ""),
  );
  const vendorIdByItemIndex = new Map<number, string>();
  for (const shipment of shipments) {
    for (const index of shipment.itemIndexes ?? []) {
      vendorIdByItemIndex.set(index, shipment.vendorId ?? "");
    }
  }
  const hasDispatchedShipment = shipments.some((shipment) =>
    DISPATCHED_STATUSES.includes(shipment.status),
  );

  // One group per seller on a split order, one unheaded group otherwise. Items
  // are addressed by their index in `order.items` throughout, never renumbered
  // — return requests are filed against those indexes, and a per-shipment
  // numbering would file them against the wrong line.
  const itemGroups: Array<{
    key: string;
    shipment: Shipment | null;
    indexes: number[];
  }> = isSplitOrder
    ? shipments.map((shipment, position) => ({
        key: shipment._id ?? shipment.vendorId ?? String(position),
        shipment,
        indexes: shipment.itemIndexes ?? [],
      }))
    : [
        {
          key: "all",
          shipment: null,
          indexes: order.items.map((_, index) => index),
        },
      ];

  // Offered only while the whole order can still be stopped. On a split order
  // where one seller has already handed goods to a courier, cancelling now
  // takes only the rest — a partial outcome behind a button labelled "Cancel
  // order", which is not a thing to spring on someone.
  // `preordered` belongs here as much as `pending` does. A reservation waiting
  // months for a release date is the state a shopper is MOST likely to want out
  // of, the API has always accepted the transition, and nothing has shipped by
  // definition — yet the button was hidden, so the only way out was to ask
  // support. Cancelling now refunds whatever was collected.
  const canCancel =
    (order.status === ORDER_STATUS.PENDING ||
      order.status === ORDER_STATUS.PREORDERED) &&
    !hasDispatchedShipment;
  const preorderStatusLabel = order.hasPreorder
    ? getPreorderStatusLabel(order.preorderStatus)
    : null;
  const formatPreorderDay = (value?: string) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : format(date, "d MMM yyyy");
  };
  const preorderExpectedLabel = formatPreorderDay(order.preorderReleaseDate);
  const preorderOriginalLabel = formatPreorderDay(
    order.preorderOriginalReleaseDate,
  );

  const isReturnEligibleOrder =
    order.status === ORDER_STATUS.DELIVERED &&
    // `partially_paid` belongs here: a split order sits there while one
    // seller's cash is outstanding, and the sellers who HAVE been paid are
    // returnable. Which items that covers is decided per item below.
    (order.paymentStatus === "paid" ||
      order.paymentStatus === "partially_paid" ||
      order.paymentStatus === "partially_refunded");
  const shippingAmount = order.shipping ?? order.shippingCost ?? 0;
  const discountAmount = order.discount ?? 0;
  const dutyAmount = Number(order.customs?.dutyAmount || 0);
  const billingAddress = order.billingAddress || order.shippingAddress;
  const pickup = order.fulfillment?.method === "pickup"
    ? order.fulfillment.pickup
    : undefined;
  const pickupWindow = pickup
    ? formatPickupWindow(locale, pickup)
    : null;
  const getAddressName = (address: ShippingAddress) =>
    address.fullName ||
    [address.firstName, address.lastName].filter(Boolean).join(" ");
  const returnedQuantityByIndex = returnRequests.reduce<Record<number, number>>(
    (acc, request) => {
      if (!ACTIVE_RETURN_STATUSES.has(request.status)) return acc;
      request.items.forEach((item) => {
        const index = item.orderItemIndex;
        if (typeof index !== "number") return;
        acc[index] = (acc[index] || 0) + Number(item.quantityRequested || 0);
      });
      return acc;
    },
    {},
  );
  function getReturnableQuantity(index: number) {
    // Nothing is returnable from a seller who was never paid — there is no
    // money to send back. Mirrors the same rule in `POST /api/returns`, so the
    // form cannot offer a quantity the API will reject.
    if (isSplitOrder && !paidVendorIds.has(vendorIdByItemIndex.get(index) ?? "")) {
      return 0;
    }
    const item = order!.items[index];
    return Math.max(
      0,
      Number(item?.quantity || 0) - (returnedQuantityByIndex[index] || 0),
    );
  }
  const canRequestReturn =
    isReturnEligibleOrder &&
    order.items.some((_, index) => getReturnableQuantity(index) > 0);

  // Reviews are per product: two lines of one product (two sizes, say) share
  // a single review, so they share its state and are asked about once.
  const reviewStateByProduct = new Map(
    (order.reviewStates ?? []).map((state) => [state.productId, state]),
  );
  const reviewTargetFor = (item: OrderItem): ReviewTarget => {
    const { productId, name, image } = describeItem(item);
    return {
      productId,
      orderId: order._id,
      name,
      image,
      orderNumber: order.orderNumber,
    };
  };
  const pendingReviews: ReviewTarget[] = [];
  for (const item of order.items) {
    const { productId } = describeItem(item);
    if (
      reviewStateByProduct.get(productId)?.canReview &&
      !pendingReviews.some((target) => target.productId === productId)
    ) {
      pendingReviews.push(reviewTargetFor(item));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            {t("orders.placedOn")}{" "}
            {format(new Date(order.createdAt), "MMMM d, yyyy 'at' h:mm a")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {getStatusBadge(order.status)}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadInvoice}
            disabled={isDownloadingInvoice}
          >
            {isDownloadingInvoice ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {t("orders.downloadInvoice")}
          </Button>
          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelOrder}
              disabled={isCancelling}
            >
              {isCancelling ? t("orders.cancelling") : t("orders.cancelOrder")}
            </Button>
          )}
          {canRequestReturn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReturnDialogOpen(true)}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Request return
            </Button>
          )}
        </div>
      </div>

      {/* What a pre-order shopper actually wants to know, and the one screen
          that never told them: when it is expected, whether that date has
          moved and why. The orders LIST carried the date all along; the detail
          page — the one the "your pre-order was delayed" mail links to — showed
          only the balance card, so the reason for the delay reached nobody. */}
      {order.hasPreorder ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <CalendarClock className="h-5 w-5 text-primary" aria-hidden />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">
                {preorderStatusLabel ??
                  tf("orders.preorderDetails.title", "Pre-order")}
              </p>
              {preorderExpectedLabel ? (
                <p className="text-sm text-muted-foreground">
                  {tf(
                    "orders.preorderDetails.expected",
                    "Expected around {date}",
                    { date: preorderExpectedLabel },
                  )}
                </p>
              ) : null}
              {/* Only once a date has actually moved — the original is stamped
                  by the delay action and by nothing else. */}
              {preorderOriginalLabel &&
              preorderOriginalLabel !== preorderExpectedLabel ? (
                <p className="text-sm text-muted-foreground">
                  {tf(
                    "orders.preorderDetails.movedFrom",
                    "Originally expected {date}",
                    { date: preorderOriginalLabel },
                  )}
                  {order.preorderDelayReason
                    ? ` — ${order.preorderDelayReason}`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <PreorderBalanceCard
        order={order}
        locale={locale}
        onPaid={() => setOrderReloadKey((key) => key + 1)}
      />

      {/* The delivery notification lands here, so the ask sits at the top
          rather than below the addresses; each line below carries its own
          button too. */}
      {pendingReviews.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-lg bg-background p-2">
              <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="font-semibold">
                {tf("reviews.orderPromptTitle", "How was your order?")}
              </p>
              <p className="text-sm text-muted-foreground">
                {pendingReviews.length === 1
                  ? tf(
                      "reviews.orderPromptOne",
                      "Share a quick review of {name} — it helps other shoppers.",
                      { name: pendingReviews[0].name },
                    )
                  : tf(
                      "reviews.orderPromptMany",
                      "{count} items from this order are waiting for your review.",
                      { count: pendingReviews.length },
                    )}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => setReviewTarget(pendingReviews[0])}
          >
            {tf("reviews.writeReview", "Write a Review")}
          </Button>
        </div>
      ) : null}

      {/* Info Cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact address for pickup; shipping address for delivery.
            Digital-only orders have no shipment; their address snapshot is
            the billing address, shown in the next card. */}
        <Card className="gap-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {order.digitalOnly ? (
                <Download className="h-4 w-4" />
              ) : (
                <MapPin className="h-4 w-4" />
              )}
              {order.digitalOnly
                ? "Delivery"
                : pickup
                  ? t("checkout.contact")
                  : t("checkout.shippingAddress")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {order.digitalOnly ? (
              <p className="text-sm text-muted-foreground">
                Digital order — no shipping needed. Your files are available
                in the Downloads section below.
              </p>
            ) : (
            <div className="text-sm space-y-1">
              {getAddressName(order.shippingAddress) ? (
                <p className="font-medium">
                  {getAddressName(order.shippingAddress)}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                {order.shippingAddress.street}
              </p>
              {order.shippingAddress.apartment ? (
                <p className="text-muted-foreground">
                  {order.shippingAddress.apartment}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
                {order.shippingAddress.postalCode}
              </p>
              <p className="text-muted-foreground">
                {order.shippingAddress.country}
              </p>
              {order.shippingAddress.phone && (
                <p className="text-muted-foreground pt-1">
                  {order.shippingAddress.phone}
                </p>
              )}
              {/* A pre-order waits long enough for people to move. Offered only
                  while nothing has shipped; the server re-checks every rule,
                  including the ones this screen cannot see. */}
              {order.hasPreorder &&
              order.status === "preordered" &&
              !pickup ? (
                <div className="pt-3">
                  <PreorderAddressEditor
                    orderId={order._id}
                    address={order.shippingAddress}
                    onSaved={() => setOrderReloadKey((key) => key + 1)}
                  />
                </div>
              ) : null}
            </div>
            )}
          </CardContent>
        </Card>

        <OrderCheckoutAnswers
          className="gap-1"
          customerNote={order.customerNote}
          checkoutFields={order.checkoutFields}
        />

        {pickup ? (
          <Card className="gap-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4" />
                {t("checkout.pickup.details")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">
                  {t("checkout.pickup.window")}
                </p>
                <p className="mt-1 font-medium">{pickupWindow}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pickup.timeZone}
                </p>
              </div>
              <Separator />
              <div>
                <p className="text-muted-foreground">
                  {t("checkout.pickup.pickupAt")}
                </p>
                <p className="mt-1 whitespace-pre-line">{pickup.pickupAddress}</p>
                {pickup.instructions ? (
                  <p className="mt-2 text-muted-foreground">
                    {pickup.instructions}
                  </p>
                ) : null}
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {t("checkout.pickup.status")}
                </span>
                <span className="font-medium">
                  {t(`checkout.pickup.${pickup.status}`)}
                </span>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* The parcel itself. Hidden for pickup — there is no courier to name
            — and on a split order the per-seller blocks below carry each
            consignment's own AWB; this card is the order-level summary. */}
        {!pickup && (order.trackingNumber || order.trackingUrl) ? (
          <Card className="gap-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4" />
                {t("orders.tracking")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground">{t("orders.carrier")}</p>
                <p className="mt-1 font-medium">
                  {order.carrier || t("orders.carrierPending")}
                </p>
              </div>
              {order.trackingNumber ? (
                <div>
                  <p className="text-muted-foreground">
                    {t("orders.tracking")}
                  </p>
                  <p className="mt-1 font-mono text-xs break-all">
                    {order.trackingNumber}
                  </p>
                </div>
              ) : null}
              {order.trackingUrl ? (
                <a
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {t("orders.trackWithCarrier")}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <DeliveryException
                exception={order.trackingException}
                className="mt-0"
              />
              <ScanHistory events={order.trackingEvents} className="mt-0" />
            </CardContent>
          </Card>
        ) : null}

        {/* Billing Address */}
        <Card className="gap-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              {t("checkout.billingAddress")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              {getAddressName(billingAddress) ? (
                <p className="font-medium">{getAddressName(billingAddress)}</p>
              ) : null}
              <p className="text-muted-foreground">{billingAddress.street}</p>
              {billingAddress.apartment ? (
                <p className="text-muted-foreground">
                  {billingAddress.apartment}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                {billingAddress.city}, {billingAddress.state}{" "}
                {billingAddress.postalCode}
              </p>
              <p className="text-muted-foreground">{billingAddress.country}</p>
              {billingAddress.phone && (
                <p className="text-muted-foreground pt-1">
                  {billingAddress.phone}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payment Info */}
        <Card className="gap-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" />
              {t("checkout.paymentMethod")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("common.method")}
                </span>
                <span>{getPaymentMethodMeta(t, order.paymentMethod).label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("common.status")}
                </span>
                {getPaymentBadge(order.paymentStatus)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Order Items */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isSplitOrder ? t("orders.shipments") : t("orders.orderItems")}
          </CardTitle>
          <CardDescription>
            {isSplitOrder
              ? t("orders.shipmentsDescription")
              : `${order.items.length} ${order.items.length === 1 ? "item" : "items"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {itemGroups.map((group) => (
              <div key={group.key} className="space-y-4">
                {group.shipment ? (
                  // The heart of it: one seller's consignment, with the status
                  // and payment that belong to IT. A single order-level badge
                  // could only ever be right about one seller — it told
                  // shoppers their delivered items had been cancelled because
                  // a different seller's had been.
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2">
                    <span className="text-sm font-medium">
                      {t("cart.soldBy", {
                        seller: group.shipment.vendorName || t("product.vendor"),
                      })}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {getPaymentBadge(group.shipment.paymentStatus)}
                      {getStatusBadge(group.shipment.status)}
                    </div>
                  </div>
                ) : null}
                {group.shipment?.trackingNumber ? (
                  <div className="px-3 text-sm text-muted-foreground">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        {t("orders.tracking")}: {group.shipment.trackingNumber}
                        {group.shipment.carrier
                          ? ` · ${group.shipment.carrier}`
                          : ""}
                      </span>
                      {group.shipment.trackingUrl ? (
                        <a
                          href={group.shipment.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          {t("orders.trackWithCarrier")}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </p>
                    <DeliveryException exception={group.shipment.exception} />
                    <ScanHistory events={group.shipment.events} />
                  </div>
                ) : null}
                {group.indexes.map((index) => {
                  const item = order.items[index];
                  if (!item) return null;
                  const {
                    productId,
                    name: productName,
                    slug: productSlug,
                    image: productImage,
                  } = describeItem(item);
                  const reviewState = reviewStateByProduct.get(productId);

                  return (
                    <div key={index} className="flex gap-4">
                      <div className="relative h-16 w-16 rounded-md overflow-hidden bg-muted flex-shrink-0">
                        {productImage ? (
                          <AppImage
                            src={productImage}
                            alt={productName}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full">
                            <Package className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {productSlug ? (
                          <Link
                            href={`/${locale}/products/${productSlug}`}
                            className="font-medium hover:underline line-clamp-1"
                          >
                            {productName}
                          </Link>
                        ) : (
                          <p className="font-medium line-clamp-1">{productName}</p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {t("common.qty")}: {item.quantity}
                        </p>
                        {reviewState?.rating ? (
                          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <StarRatingDisplay rating={reviewState.rating} />
                            {tf("reviews.youRated", "You rated this")}
                          </p>
                        ) : reviewState?.canReview ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-7 gap-1.5 px-2.5 text-xs"
                            onClick={() => setReviewTarget(reviewTargetFor(item))}
                          >
                            <Star className="h-3.5 w-3.5" />
                            {tf("reviews.writeReview", "Write a Review")}
                          </Button>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p className="font-medium">
                          {formatPrice(item.price * item.quantity)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatPrice(item.price)} each
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <Separator className="my-4" />

          {/* Order Summary */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {t("common.subtotal")}
              </span>
              <span>{formatPrice(order.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {pickup ? t("checkout.pickup.localPickup") : t("common.shipping")}
              </span>
              <span>
                {shippingAmount === 0
                  ? t("common.free")
                  : formatPrice(shippingAmount)}
              </span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("checkout.discount")}
                </span>
                <span className="text-red-600">
                  -{formatPrice(discountAmount)}
                </span>
              </div>
            )}
            {order.tax > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("common.tax")}</span>
                <span>{formatPrice(order.tax)}</span>
              </div>
            )}
            {/* Added to the total at checkout, so without its own row the lines
                above did not add up to it. */}
            {dutyAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {t("orders.importDuties")}
                </span>
                <span>{formatPrice(dutyAmount)}</span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex justify-between text-base font-semibold">
              <span>{t("common.total")}</span>
              <span>{formatPrice(order.total)}</span>
            </div>
            {/* A deposit pre-order is not settled by the total: say here, next
                to it, what has been paid and what is still owed — the same
                figures as the balance card and the invoice. */}
            {order.hasPreorder &&
            typeof order.preorderBalanceDue === "number" &&
            order.preorderBalanceDue > 0 ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("orders.preorderBalance.paidSoFar")}
                  </span>
                  <span>
                    {formatPrice(
                      typeof order.preorderPaidSoFar === "number"
                        ? Math.max(0, order.preorderPaidSoFar)
                        : Math.max(0, order.total - order.preorderBalanceDue),
                    )}
                  </span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t("orders.preorderBalance.balanceDue")}</span>
                  <span>{formatPrice(order.preorderBalanceDue)}</span>
                </div>
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <OrderDownloads orderId={order._id} paymentStatus={order.paymentStatus} />

      {returnRequests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Return requests</CardTitle>
            <CardDescription>
              Return and refund activity for this order.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {returnRequests.map((request) => (
                <div
                  key={request._id}
                  className="rounded-md border p-4 text-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{request.returnNumber}</p>
                      <p className="text-muted-foreground">
                        {request.items
                          .map((item) => `${item.name} x${item.quantityRequested}`)
                          .join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {request.status.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="secondary" className="capitalize">
                        {request.refundStatus.replace(/_/g, " ")}
                      </Badge>
                    </div>
                  </div>
                  {request.estimatedRefund ? (
                    <RefundBreakdown
                      estimate={request.estimatedRefund}
                      formatPrice={formatPrice}
                      className="mt-3"
                    />
                  ) : null}
                  {request.refundDestination?.method ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Refund going to: {describeRefundDestination(request.refundDestination)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Dialog
        open={returnDialogOpen}
        onOpenChange={(open) => {
          setReturnDialogOpen(open);
          if (!open) {
            setReturnReason("");
            setOtherReturnReason("");
            setReturnPreview(null);
            setReturnPreviewError(null);
            setRefundDestination({});
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Request a return</DialogTitle>
            <DialogDescription>
              Select the items you want to return. The store team will review
              the request before refund processing.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2">
            <div className="grid gap-2">
              <Label>Reason</Label>
              <Select
                value={returnReason}
                onValueChange={(value) => {
                  setReturnReason(value);
                  if (value !== "other") setOtherReturnReason("");
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wrong_size_or_variant">
                    Wrong size or variant
                  </SelectItem>
                  <SelectItem value="damaged_or_defective">
                    Damaged or defective
                  </SelectItem>
                  <SelectItem value="not_as_described">
                    Not as described
                  </SelectItem>
                  <SelectItem value="wrong_item_received">
                    Wrong item received
                  </SelectItem>
                  <SelectItem value="arrived_late">Arrived late</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              {returnReason === "other" ? (
                <div className="grid gap-2">
                  <Label htmlFor="other-return-reason">Other reason</Label>
                  <Input
                    id="other-return-reason"
                    value={otherReturnReason}
                    onChange={(event) => setOtherReturnReason(event.target.value)}
                    placeholder="Type your return reason"
                    maxLength={100}
                    required
                  />
                </div>
              ) : null}
            </div>

            <div className="grid gap-3">
              <Label>Items</Label>
              {order.items.map((item, index) => {
                const productName = describeItem(item).name;
                const returnableQuantity = getReturnableQuantity(index);
                return (
                  <div
                    key={index}
                    className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_120px]"
                  >
                    <div>
                      <p className="font-medium">{productName}</p>
                      <p className="text-sm text-muted-foreground">
                        Returnable quantity: {returnableQuantity} of {item.quantity}
                      </p>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`return-item-${index}`} className="text-xs">
                        Return qty
                      </Label>
                      <Input
                        id={`return-item-${index}`}
                        type="number"
                        min={0}
                        max={returnableQuantity}
                        value={returnQuantities[index] ?? 0}
                        disabled={returnableQuantity === 0}
                        onChange={(event) =>
                          handleReturnQuantityChange(index, event.target.value)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="return-note">Notes</Label>
              <Textarea
                id="return-note"
                value={returnNote}
                onChange={(event) => setReturnNote(event.target.value)}
                placeholder="Add details for the store team"
                className="min-h-24"
              />
            </div>

            {selectedReturnItemsCount > 0 && selectedReturnReason ? (
              <div className="grid gap-2" aria-live="polite">
                <Label>What you get back</Label>
                {previewError ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                    {previewError}
                  </p>
                ) : shownPreview ? (
                  <div
                    className={cn(
                      "grid gap-3 transition-opacity",
                      !currentPreview && "opacity-60",
                    )}
                  >
                    {shownPreview.groups.map((group, groupIndex) => (
                      <div key={groupIndex} className="grid gap-1.5">
                        {/* Named only when there is more than one, because each
                            seller receives their own parcel — and is charged
                            their own return-leg fee. */}
                        {shownPreview.groups.length > 1 ? (
                          <p className="text-xs text-muted-foreground">
                            Parcel {groupIndex + 1}:{" "}
                            {group.items
                              .map((item) => `${item.name} x${item.quantityRequested}`)
                              .join(", ")}
                          </p>
                        ) : null}
                        <RefundBreakdown
                          estimate={group.estimatedRefund}
                          formatPrice={formatPrice}
                          refundsShipping={shownPreview.refundsShipping}
                          merchantAtFault={shownPreview.merchantAtFault}
                        />
                      </div>
                    ))}

                    {shownPreview.groups.length > 1 ? (
                      <div className="flex items-baseline justify-between gap-4 px-1 text-sm font-medium">
                        <span>
                          Total across {shownPreview.groups.length} parcels
                        </span>
                        <span className="tabular-nums">
                          {formatPrice(shownPreview.total)}
                        </span>
                      </div>
                    ) : null}

                    <p className="text-xs text-muted-foreground">
                      An estimate. The store confirms the final amount after
                      checking the returned items.
                    </p>
                  </div>
                ) : (
                  <Skeleton className="h-36 w-full" />
                )}
              </div>
            ) : null}

            {needsRefundDestination ? (
              <RefundDestinationFields
                value={refundDestination}
                onChange={setRefundDestination}
              />
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReturnDialogOpen(false)}
              disabled={isSubmittingReturn}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmitReturn()}
              disabled={!canSubmitReturnNow}
            >
              {isSubmittingReturn ? "Submitting..." : "Submit return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReviewDialog
        target={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onReviewed={(reviewed, rating) => {
          setReviewTarget(null);
          setOrder((current) =>
            current
              ? {
                  ...current,
                  reviewStates: (current.reviewStates ?? []).map((state) =>
                    state.productId === reviewed.productId
                      ? { ...state, rating, canReview: false }
                      : state,
                  ),
                }
              : current,
          );
        }}
      />
    </div>
  );
}

function OrderDetailsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-24" />
        </CardHeader>
        <CardContent>
          {[1, 2].map((i) => (
            <div key={i} className="flex gap-4 mb-4">
              <Skeleton className="h-16 w-16 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

