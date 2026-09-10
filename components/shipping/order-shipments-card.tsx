"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Printer,
  RefreshCw,
  Truck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { formatCurrency } from "@/lib/intl/money";
import { isPurchaseClaimStale } from "@/lib/shipping/carrier-config";
import {
  downloadBlob,
  fetchLabelBlob,
  printLabelBlob,
} from "./carrier-label-actions";
import {
  trackingPageUrl,
  type CourierTrackingLink,
} from "@/lib/shipping/tracking-urls";
import { ScanHistory, type ScanEvent } from "./scan-history";
import {
  SendToCourierDialog,
  type CourierPackagePreset,
} from "./send-to-courier-dialog";

interface ShipmentRow {
  _id: string;
  carrier: string;
  service?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  status: string;
  source: "manual" | "carrier_api";
  provider?: string;
  providerMode?: "test" | "live";
  /** Present once a booking has created anything provider-side, bought or not. */
  providerOrderId?: string;
  providerTransactionId?: string;
  rate?: { amount: number; currency: string; carrierName?: string };
  lastSyncedAt?: string;
  exception?: { code: string; message: string };
  /**
   * The courier's own scans.
   *
   * Already on the wire — the list query returns the whole document — and
   * simply dropped on the floor here, so whoever fielded "where is my parcel?"
   * could see less about it than the customer asking.
   */
  events?: ScanEvent[];
  // `startedAt` is what separates a purchase in flight from one whose worker
  // died; it arrives as a JSON string over the wire.
  purchase?: { state: string; startedAt?: string; lastError?: string };
  label?: { source: "internal" | "carrier" };
}

interface ShipmentsResponse {
  shipments: ShipmentRow[];
  carriersEnabled: boolean;
  packages: CourierPackagePreset[];
  storeCurrency?: string;
  courierTrackingLinks?: CourierTrackingLink[];
}

const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  label_ready: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  shipped: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  in_transit: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  delivered: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancelled: "bg-destructive/10 text-destructive",
};

/**
 * Every parcel on an order, with the carrier actions that apply to it.
 *
 * Shared by the admin and vendor order screens — the vendor's copy is scoped
 * server-side to its own sub-order, so the component itself needs no notion of
 * who is looking.
 */
export function OrderShipmentsCard(props: {
  apiBase: "/api/admin" | "/api/vendor";
  orderId: string;
  orderNumber: string;
  subOrderId?: string;
  /** Hides every mutating action (cancelled orders, read-only staff). */
  readOnly?: boolean;
  /** Suppresses the card entirely for pickup and digital-only orders. */
  hidden?: boolean;
  onChanged?: () => void;
}) {
  const t = useTranslations();
  const tSafe = (key: string, fallback: string) => {
    try {
      const value = t(key);
      return typeof value === "string" && value !== key ? value : fallback;
    } catch {
      return fallback;
    }
  };

  const [data, setData] = useState<ShipmentsResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [courierOpen, setCourierOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<ShipmentRow | null>(null);

  const load = useCallback(
    () =>
      apiClient
        .get<ShipmentsResponse>(
          `${props.apiBase}/orders/${props.orderId}/shipments`,
        )
        .then((result) => setData(result))
        .catch(() => {
          // A failure here must not take the whole order screen down; the
          // panel simply stays empty.
          setData(null);
        }),
    [props.apiBase, props.orderId],
  );

  useEffect(() => {
    if (props.hidden) return;
    void load();
  }, [load, props.hidden]);

  const refresh = useCallback(async () => {
    await load();
    props.onChanged?.();
  }, [load, props]);

  const withLabel = async (
    shipment: ShipmentRow,
    action: (blob: Blob) => void | Promise<void>,
  ) => {
    setBusyId(shipment._id);
    try {
      const blob = await fetchLabelBlob(
        `${props.apiBase}/orders/${props.orderId}/shipments/${shipment._id}/label`,
      );
      await action(blob);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe(
              "admin.orderDetails.shippingLabelFailed",
              "Could not download the label",
            ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const refreshTracking = async (shipment: ShipmentRow) => {
    setBusyId(shipment._id);
    try {
      await apiClient.post(
        `${props.apiBase}/orders/${props.orderId}/shipments/${shipment._id}/refresh-tracking`,
      );
      await refresh();
      toast.success(
        tSafe("admin.orderDetails.courier.trackingRefreshed", "Tracking updated"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe(
              "admin.orderDetails.courier.trackingFailed",
              "Could not refresh tracking",
            ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const voidLabel = async (shipment: ShipmentRow) => {
    setBusyId(shipment._id);
    try {
      const result = await apiClient.request<{ refunded: boolean }>(
        "POST",
        `${props.apiBase}/orders/${props.orderId}/shipments/${shipment._id}/void`,
      );
      await refresh();
      toast.success(result.message || "Label voided");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.orderDetails.courier.voidFailed", "Could not void the label"),
      );
    } finally {
      setBusyId(null);
      setVoidTarget(null);
    }
  };

  if (props.hidden) return null;

  const shipments = data?.shipments || [];
  // One label per parcel. Offering the button once a label exists would only
  // lead to a refusal at the rates step — and a voided one puts it back, which
  // is the whole point of voiding.
  //
  // A `purchasing` claim counts only while it is fresh. An abandoned one is not
  // a purchase in progress, and hiding the button for it took away the only
  // manual way out of a parcel whose worker had died.
  const alreadyBooked = shipments.some(
    (shipment) =>
      shipment.purchase?.state === "purchased" ||
      (shipment.purchase?.state === "purchasing" &&
        !isPurchaseClaimStale(shipment.purchase)),
  );
  const canSendToCourier =
    Boolean(data?.carriersEnabled) && !props.readOnly && !alreadyBooked;

  // Nothing to show and nothing to do — stay out of the way rather than
  // rendering an empty card on every order.
  if (shipments.length === 0 && !canSendToCourier) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          {tSafe("admin.orderDetails.courier.shipments", "Shipments")}
        </CardTitle>
        {canSendToCourier ? (
          <Button size="sm" onClick={() => setCourierOpen(true)}>
            <Truck className="h-4 w-4" />
            {tSafe("admin.orderDetails.courier.sendToCourier", "Send to courier")}
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        {shipments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tSafe(
              "admin.orderDetails.courier.noShipments",
              "No shipments yet.",
            )}
          </p>
        ) : null}

        {shipments.map((shipment) => {
          // A carrier-booked parcel brings its own page; a hand-entered one
          // gets the same resolved link the customer's screens show, so both
          // sides of a support call are looking at the same thing.
          const trackingHref =
            shipment.trackingUrl ||
            trackingPageUrl({
              carrier: shipment.rate?.carrierName || shipment.carrier,
              trackingNumber: shipment.trackingNumber,
              links: data?.courierTrackingLinks,
            });

          return (
            <div key={shipment._id} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {shipment.rate?.carrierName || shipment.carrier}
                </span>
                {shipment.service ? (
                  <span className="text-xs text-muted-foreground">
                    {shipment.service}
                  </span>
                ) : null}
                <Badge
                  variant="secondary"
                  className={STATUS_TONE[shipment.status] || ""}
                >
                  {shipment.status.replace(/_/g, " ")}
                </Badge>
                {/* A test label looks identical to a real one everywhere else,
                    so it is called out here rather than discovered at the depot. */}
                {shipment.providerMode === "test" ? (
                  <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                    TEST
                  </Badge>
                ) : null}
                {shipment.rate ? (
                  <span className="ml-auto text-sm font-semibold">
                    {formatCurrency(shipment.rate.amount, shipment.rate.currency)}
                  </span>
                ) : null}
              </div>

              {shipment.trackingNumber ? (
                <p className="font-mono text-xs">
                  {trackingHref ? (
                    <a
                      href={trackingHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {shipment.trackingNumber}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    shipment.trackingNumber
                  )}
                </p>
              ) : null}

              {shipment.exception ? (
                <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {shipment.exception.message}
                </p>
              ) : null}

              {shipment.purchase?.state === "failed" && shipment.purchase.lastError ? (
                <p className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {shipment.purchase.lastError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === shipment._id}
                  onClick={() =>
                    void withLabel(shipment, (blob) =>
                      downloadBlob(blob, `shipping-label-${props.orderNumber}.pdf`),
                    )
                  }
                >
                  {busyId === shipment._id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {tSafe("admin.orderDetails.shippingLabelDownload", "Download")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId === shipment._id}
                  onClick={() => void withLabel(shipment, printLabelBlob)}
                >
                  <Printer className="h-4 w-4" />
                  {tSafe("admin.orderDetails.printThermalLabel", "Print")}
                </Button>

                {shipment.provider && shipment.trackingNumber ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === shipment._id}
                    onClick={() => void refreshTracking(shipment)}
                  >
                    <RefreshCw className="h-4 w-4" />
                    {tSafe(
                      "admin.orderDetails.courier.refreshTracking",
                      "Refresh tracking",
                    )}
                  </Button>
                ) : null}

                {/* Also offered for a *failed* purchase that got far enough to
                    create something: a Shiprocket booking can leave a real
                    consignment behind after the AWB step fails, and this is the
                    only way to cancel it from here. */}
                {shipment.provider &&
                !props.readOnly &&
                shipment.status !== "delivered" &&
                shipment.status !== "cancelled" &&
                (shipment.purchase?.state === "purchased" ||
                  (shipment.purchase?.state === "failed" &&
                    Boolean(
                      shipment.providerOrderId ||
                        shipment.providerTransactionId ||
                        shipment.trackingNumber,
                    ))) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busyId === shipment._id}
                    onClick={() => setVoidTarget(shipment)}
                  >
                    <XCircle className="h-4 w-4" />
                    {tSafe("admin.orderDetails.courier.void", "Void")}
                  </Button>
                ) : null}
              </div>

              <ScanHistory events={shipment.events} />
            </div>
          );
        })}
      </CardContent>

      <SendToCourierDialog
        open={courierOpen}
        onOpenChange={setCourierOpen}
        apiBase={props.apiBase}
        orderId={props.orderId}
        orderNumber={props.orderNumber}
        subOrderId={props.subOrderId}
        packages={data?.packages || []}
        storeCurrency={data?.storeCurrency}
        onPurchased={() => void refresh()}
      />

      <AlertDialog
        open={Boolean(voidTarget)}
        onOpenChange={(open) => !open && setVoidTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tSafe("admin.orderDetails.courier.void", "Void label")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tSafe(
                "admin.orderDetails.courier.voidConfirm",
                "The carrier will cancel this consignment. Refunds depend on the carrier and are not guaranteed.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {tSafe("admin.orderDetails.keepOrder", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => voidTarget && void voidLabel(voidTarget)}
            >
              {tSafe("admin.orderDetails.courier.void", "Void")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
