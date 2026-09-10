"use client";

import { type CSSProperties, FormEvent, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  Search,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast-notification";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import {
  ScanHistory,
  type ScanEvent,
} from "@/components/shipping/scan-history";
import {
  DeliveryException,
  type DeliveryException as DeliveryExceptionData,
} from "@/components/shipping/delivery-exception";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";
import { formatPickupWindow } from "@/lib/checkout/pickup-fulfillment-shared";

type TrackingEvent = {
  key: string;
  title: string;
  description: string;
  timestamp?: string;
  completed: boolean;
};

/** One seller's parcel on a split order. */
type TrackedShipment = {
  vendorName?: string;
  status: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  shippedAt?: string;
  deliveredAt?: string;
  itemIndexes: number[];
  events: ScanEvent[];
  exception?: DeliveryExceptionData;
};

type TrackedOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  trackingEvents?: ScanEvent[];
  /** A failed attempt or a return, which the order status never reflects. */
  trackingException?: DeliveryExceptionData;
  /** Empty on a single-seller order, where the fields above say it all. */
  shipments?: TrackedShipment[];
  placedAt: string;
  updatedAt: string;
  subtotal: number;
  shippingCost: number;
  tax: number;
  discount: number;
  total: number;
  itemCount: number;
  items: Array<{
    name: string;
    sku?: string;
    price: number;
    quantity: number;
    image?: string;
  }>;
  pickup?: {
    pickupAddress?: string;
    instructions?: string;
    timeZone?: string;
    startAt?: string;
    endAt?: string;
    status?: "scheduled" | "ready" | "collected";
  };
  timeline: TrackingEvent[];
};

interface TrackOrderContentProps {
  initialOrderNumber?: string;
}

const statusLabels: Record<string, string> = {
  pending: "Pending",
  processing: "Processing",
  shipped: "In Transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function formatDate(value?: string) {
  if (!value) return "Pending";
  return format(new Date(value), "MMM d, yyyy");
}

function formatEventDate(event: TrackingEvent) {
  if (event.timestamp) return formatDate(event.timestamp);
  return event.completed ? "Completed" : "Pending";
}

function getActiveStepIndex(timeline: TrackingEvent[]) {
  const lastCompleted = timeline.reduce(
    (last, event, index) => (event.completed ? index : last),
    -1,
  );
  return Math.max(lastCompleted, 0);
}

function getDeliveredDate(order: TrackedOrder) {
  const delivered = order.timeline.find((event) => event.key === "delivered");
  return delivered ? formatEventDate(delivered) : "Pending";
}

function getCurrentTrackingStatus(order: TrackedOrder, activeIndex: number) {
  const activeEvent = order.timeline[activeIndex];
  if (activeEvent && activeEvent.key !== "placed") return activeEvent.title;
  return statusLabels[order.status] || order.status;
}

export function TrackOrderContent({
  initialOrderNumber = "",
}: TrackOrderContentProps) {
  const t = useTranslations();
  const locale = useParams().locale as string;
  const { formatPrice } = useCurrency();
  const [orderNumber, setOrderNumber] = useState(initialOrderNumber);
  const [identifier, setIdentifier] = useState("");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);

  const activeIndex = useMemo(
    () => (order ? getActiveStepIndex(order.timeline) : 0),
    [order],
  );
  const currentTrackingStatus = useMemo(
    () => (order ? getCurrentTrackingStatus(order, activeIndex) : ""),
    [activeIndex, order],
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setOrder(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/orders/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, identifier }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(
          data.message ||
            data.error ||
            "We could not find an order with those details.",
        );
        return;
      }

      setOrder(data.data);
    } catch {
      setError("Tracking is temporarily unavailable. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadInvoice = async () => {
    if (!order) return;

    setIsDownloadingInvoice(true);
    try {
      const response = await fetch("/api/orders/track/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber: order.orderNumber, identifier }),
      });

      if (!response.ok) {
        throw new Error("Unable to download invoice");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `invoice-${order.orderNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Invoice download failed");
    } finally {
      setIsDownloadingInvoice(false);
    }
  };

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-5xl px-4 pb-12 pt-8 lg:pb-16 lg:pt-10">
        <StoreBreadcrumb
          className="mb-8"
          locale={locale}
          items={[{ label: t("orders.trackOrder") }]}
        />

        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
            Order Tracking
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Enter your order number and checkout contact to see the latest
            delivery status.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="mt-8 rounded-lg border bg-card p-4 shadow-sm md:p-5"
        >
          <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="order-number">Order number</Label>
              <Input
                id="order-number"
                value={orderNumber}
                onChange={(event) => setOrderNumber(event.target.value)}
                placeholder="ORD-MABC-123456"
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or phone</Label>
              <Input
                id="identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="customer@email.com"
                required
                className="h-11"
              />
            </div>
            <Button type="submit" size="lg" disabled={isLoading} className="h-11">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Track
            </Button>
          </div>
          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : null}
        </form>

        {order ? (
          <main className="mt-10 space-y-8">
            <section>
              <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-semibold">Order Details</h2>
                <Button onClick={handleDownloadInvoice} disabled={isDownloadingInvoice}>
                  {isDownloadingInvoice ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Download Invoice
                </Button>
              </div>

              <div className="grid gap-4 border-b py-5 sm:grid-cols-2 lg:grid-cols-5">
                <Detail label="Order Number" value={order.orderNumber} />
                <Detail label="Order Placed" value={formatDate(order.placedAt)} />
                <Detail label="Order Delivered" value={getDeliveredDate(order)} />
                <Detail
                  label="No. of Items"
                  value={`${order.itemCount} ${order.itemCount === 1 ? "item" : "items"}`}
                />
                <Detail
                  label="Status"
                  value={currentTrackingStatus}
                />
              </div>
            </section>

            <section>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-semibold">Order Tracking</h2>
                <p className="text-sm font-medium text-muted-foreground">
                  Order ID: {order.orderNumber}
                </p>
              </div>

              <div className="mt-5 rounded-lg border bg-card p-5 shadow-sm">
                <div
                  className="grid gap-6 md:px-10 md:[grid-template-columns:repeat(var(--step-count),minmax(0,1fr))]"
                  style={
                    {
                      "--step-count": order.timeline.length,
                    } as CSSProperties
                  }
                >
                  {order.timeline.map((event, index) => {
                    const isActive = index === activeIndex;
                    const isComplete = event.completed;
                    const hasNextStep = index < order.timeline.length - 1;

                    return (
                      <div key={event.key} className="relative">
                        {hasNextStep ? (
                          <div
                            className={cn(
                              "absolute left-[calc(50%+1rem)] right-[calc(-50%-0.5rem)] top-4 hidden h-0.5 md:block",
                              isComplete ? "bg-primary" : "bg-border",
                            )}
                          />
                        ) : null}
                        <div className="relative flex gap-3 md:flex md:flex-col md:items-center md:text-center">
                          <div
                            className={cn(
                              "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold",
                              isComplete && "border-primary bg-primary text-primary-foreground",
                              isActive && "ring-4 ring-primary/15",
                            )}
                          >
                            {isComplete ? <Check className="h-4 w-4" /> : index + 1}
                          </div>
                          <div className="min-w-0 md:mt-1.5">
                            <h3 className="text-sm font-semibold">{event.title}</h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatEventDate(event)}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {(order.carrier || order.trackingNumber) && !order.pickup ? (
                  <div className="mt-5 rounded-md bg-muted/40 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        <span className="font-medium">Shipment:</span>{" "}
                        {order.carrier || "Carrier pending"}
                      </span>
                      {order.trackingNumber ? (
                        <span className="text-muted-foreground">
                          | Tracking no. {order.trackingNumber}
                        </span>
                      ) : null}
                      {order.trackingUrl ? (
                        <a
                          href={order.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                        >
                          Track with carrier
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                    <DeliveryException exception={order.trackingException} />
                    <ScanHistory events={order.trackingEvents} />
                  </div>
                ) : null}

                {/* Split orders only: each seller dispatches on their own
                    schedule, so one badge and one AWB cannot describe them. */}
                {order.shipments?.length && !order.pickup ? (
                  <div className="mt-5 space-y-3">
                    {order.shipments.map((shipment, index) => (
                      <div
                        key={shipment.trackingNumber || shipment.vendorName || index}
                        className="rounded-md border px-4 py-3 text-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <p className="font-medium">
                            {shipment.vendorName || `Seller ${index + 1}`}
                          </p>
                          <span className="text-xs text-muted-foreground">
                            {statusLabels[shipment.status] || shipment.status}
                            {shipment.deliveredAt
                              ? ` • ${formatDate(shipment.deliveredAt)}`
                              : shipment.shippedAt
                                ? ` • ${formatDate(shipment.shippedAt)}`
                                : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {shipment.itemIndexes
                            .map((itemIndex) => order.items[itemIndex]?.name)
                            .filter(Boolean)
                            .join(", ") || "Items in this shipment"}
                        </p>
                        {shipment.carrier || shipment.trackingNumber ? (
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{shipment.carrier || "Carrier pending"}</span>
                            {shipment.trackingNumber ? (
                              <span className="text-muted-foreground">
                                | Tracking no. {shipment.trackingNumber}
                              </span>
                            ) : null}
                            {shipment.trackingUrl ? (
                              <a
                                href={shipment.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                              >
                                Track with carrier
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>
                        ) : null}
                        <DeliveryException exception={shipment.exception} />
                        <ScanHistory events={shipment.events} />
                      </div>
                    ))}
                  </div>
                ) : null}
                {order.pickup ? (
                  <div className="mt-5 rounded-md bg-primary/5 px-4 py-3 text-sm">
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div>
                        <p className="font-medium">Pickup details</p>
                        {formatPickupWindow(undefined, order.pickup) ? (
                          <p className="mt-1">
                            {formatPickupWindow(undefined, order.pickup)}
                          </p>
                        ) : null}
                        {order.pickup.timeZone ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {order.pickup.timeZone}
                          </p>
                        ) : null}
                        {order.pickup.pickupAddress ? (
                          <p className="mt-2 whitespace-pre-line text-muted-foreground">
                            {order.pickup.pickupAddress}
                          </p>
                        ) : null}
                        {order.pickup.instructions ? (
                          <p className="mt-1 text-muted-foreground">
                            {order.pickup.instructions}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold">Items from the order</h2>
              <div className="mt-5 overflow-hidden rounded-lg border bg-card shadow-sm [&_[data-slot=table-container]]:overflow-hidden [&_td]:px-3 [&_th]:px-3 sm:[&_td]:px-4 sm:[&_th]:px-4">
                <Table className="table-fixed">
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="w-16 text-center sm:w-28">
                        Quantity
                      </TableHead>
                      <TableHead className="w-24 text-right sm:w-32">
                        Price
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((item, index) => (
                      <TableRow key={`${item.name}-${index}`}>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted sm:h-16 sm:w-16">
                              {item.image ? (
                                <AppImage
                                  src={item.image}
                                  alt={item.name}
                                  fill
                                  className="object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center">
                                  <Package className="h-6 w-6 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p
                                className="truncate font-semibold"
                                title={item.name}
                              >
                                {truncateWords(item.name, 1)}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Product ID: {item.sku || "Not available"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full border bg-background px-2 text-sm">
                            {item.quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatPrice(item.price * item.quantity)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-card p-5 shadow-sm">
                <TotalRow label="Discount" value={`-${formatPrice(order.discount)}`} />
                <Separator className="my-3" />
                <TotalRow
                  label={order.pickup ? "Local pickup" : "Delivery"}
                  value={formatPrice(order.shippingCost)}
                />
              </div>
              <div className="rounded-lg border bg-card p-5 shadow-sm">
                <TotalRow label="Subtotal" value={formatPrice(order.subtotal)} />
                {order.tax > 0 ? (
                  <>
                    <Separator className="my-3" />
                    <TotalRow label="Tax" value={formatPrice(order.tax)} />
                  </>
                ) : null}
                <Separator className="my-3" />
                <TotalRow label="Total" value={formatPrice(order.total)} strong />
              </div>
            </section>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function truncateWords(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-sm font-semibold", className)}>{value}</p>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 text-sm",
        strong && "text-base font-semibold",
      )}
    >
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
