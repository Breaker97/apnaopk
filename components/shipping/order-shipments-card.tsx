"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Printer,
  RefreshCw,
  Truck,
  Undo2,
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
import {
  openConsignments,
  type BookableConsignment,
} from "./consignment-booking";
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
  /** Which consignment this parcel belongs to; absent on legacy manual rows. */
  subOrderId?: string;
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
  /** One entry per seller's part of the order, as the server describes them. */
  consignments?: BookableConsignment[];
  carriersEnabled: boolean;
  /** Whether a provider is actually configured, not just the master switch. */
  carriersConnected?: boolean;
  packages: CourierPackagePreset[];
  storeCurrency?: string;
  courierTrackingLinks?: CourierTrackingLink[];
  /** Present while shipping waits on an undeliverable address. */
  addressHold?: { state: "open"; message?: string };
  /** Store staff only: what a returned parcel's refund starts from. */
  refund?: {
    refundable: number;
    paymentStatus?: string;
    currency?: string;
    keepReturnShipping: boolean;
  };
}

/**
 * The return shipping a refund keeps, in the order's currency. Only when the
 * label was bought in that currency: a USD label on an INR order has no honest
 * figure to subtract, so nothing is kept rather than a made-up conversion.
 */
function returnShippingDeduction(
  shipment: { rate?: { amount: number; currency: string } },
  refund: { currency?: string },
  keep: boolean,
): number {
  if (!keep || !shipment.rate || !refund.currency) return 0;
  if (shipment.rate.currency.toUpperCase() !== refund.currency.toUpperCase()) return 0;
  return Math.max(0, Number(shipment.rate.amount) || 0);
}

/** A parcel the courier brought back — undeliverable, refused, unclaimed. */
function isReturnedToSender(shipment: { exception?: { code: string } }): boolean {
  return shipment.exception?.code === "returned";
}

/**
 * Whether this row has a label worth printing.
 *
 * A hand-entered parcel always does — its label is generated. A carrier parcel
 * only once one is bought and while it is live: a rate-shopped draft has none,
 * and a voided one's was cancelled by the carrier. The server refuses both too;
 * hiding the buttons is what stops a merchant being offered them at all.
 */
function hasPrintableLabel(shipment: ShipmentRow): boolean {
  if (!shipment.provider) return true;
  return (
    shipment.purchase?.state === "purchased" && shipment.status !== "cancelled"
  );
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

  const router = useRouter();
  const [refundTarget, setRefundTarget] = useState<ShipmentRow | null>(null);
  const [keepReturnShipping, setKeepReturnShipping] = useState(false);

  // The order page around this card is server-rendered, and an address hold a
  // refused label just placed shows in its banner — so it is refreshed too.
  const refresh = useCallback(async () => {
    await load();
    props.onChanged?.();
    router.refresh();
  }, [load, props, router]);

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
      toast.success(result.message || "Shipping label cancelled");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.orderDetails.courier.voidFailed", "Could not cancel the label"),
      );
    } finally {
      setBusyId(null);
      setVoidTarget(null);
    }
  };

  const holdForNewAddress = async (shipment: ShipmentRow) => {
    setBusyId(shipment._id);
    try {
      await apiClient.post(`${props.apiBase}/orders/${props.orderId}/address-hold`, {
        action: "hold",
        message: "The courier returned the parcel as undeliverable",
      });
      toast.success(
        tSafe("admin.orderDetails.courier.heldForAddress", "Order put on hold — the customer was asked for a new address"),
      );
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.orderDetails.courier.holdFailed", "Could not put the order on hold"),
      );
    } finally {
      setBusyId(null);
    }
  };

  const refundReturned = async () => {
    const target = refundTarget;
    const refund = data?.refund;
    if (!target || !refund) return;
    const deduction = returnShippingDeduction(target, refund, keepReturnShipping);
    const amount = Math.max(0, Math.round((refund.refundable - deduction) * 100) / 100);
    if (amount <= 0) return;
    setBusyId(target._id);
    try {
      await apiClient.put(`/api/admin/orders/${props.orderId}`, {
        paymentStatus: amount >= refund.refundable ? "refunded" : "partially_refunded",
        refundAmount: amount,
        refundReason:
          deduction > 0
            ? `Parcel returned as undeliverable — return shipping of ${formatCurrency(deduction, refund.currency || "USD")} kept`
            : "Parcel returned as undeliverable",
      });
      toast.success(tSafe("admin.orderDetails.courier.refunded", "Refund recorded"));
      setRefundTarget(null);
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : tSafe("admin.orderDetails.refundFailed", "Refund failed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  if (props.hidden) return null;

  const shipments = data?.shipments || [];
  const sendable = openConsignments({
    consignments: data?.consignments || [],
    shipments,
  });

  const addressHoldOpen = data?.addressHold?.state === "open";
  const canSendToCourier =
    !addressHoldOpen &&
    Boolean(data?.carriersEnabled) &&
    // The master switch is not a connected carrier. Without this the button sat
    // on every order of a store that had turned carriers on and configured
    // neither provider, and said so only after the parcel form was filled in.
    data?.carriersConnected !== false &&
    !props.readOnly &&
    sendable.length > 0;

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
        ) : addressHoldOpen && !props.readOnly ? (
          <span className="text-xs text-amber-700 dark:text-amber-400">
            {tSafe(
              "admin.orderDetails.courier.waitingForAddress",
              "Waiting for a deliverable address",
            )}
          </span>
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

              {isReturnedToSender(shipment) && props.apiBase === "/api/admin" && !props.readOnly ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="gap-1 bg-destructive/10 text-destructive">
                    <Undo2 className="h-3 w-3" aria-hidden />
                    {tSafe("admin.orderDetails.courier.returned", "Returned to sender")}
                  </Badge>
                  {data?.refund &&
                  ["paid", "partially_paid", "partially_refunded"].includes(
                    String(data.refund.paymentStatus || ""),
                  ) &&
                  data.refund.refundable > 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === shipment._id}
                      onClick={() => {
                        setKeepReturnShipping(Boolean(data.refund?.keepReturnShipping));
                        setRefundTarget(shipment);
                      }}
                    >
                      {tSafe("admin.orderDetails.courier.refundReturned", "Refund order")}
                    </Button>
                  ) : null}
                  {!addressHoldOpen ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === shipment._id}
                      onClick={() => void holdForNewAddress(shipment)}
                    >
                      {tSafe("admin.orderDetails.courier.holdForAddress", "Hold for a new address")}
                    </Button>
                  ) : null}
                </div>
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
                {hasPrintableLabel(shipment) ? (
                  <>
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
                  </>
                ) : null}

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
                    {tSafe("admin.orderDetails.courier.void", "Cancel label")}
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
        addressHoldOpen={addressHoldOpen}
        onFailed={() => void refresh()}
        apiBase={props.apiBase}
        orderId={props.orderId}
        orderNumber={props.orderNumber}
        subOrderId={props.subOrderId}
        consignments={sendable}
        packages={data?.packages || []}
        storeCurrency={data?.storeCurrency}
        onPurchased={() => void refresh()}
      />

      <AlertDialog
        open={Boolean(refundTarget)}
        onOpenChange={(open) => !open && setRefundTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tSafe("admin.orderDetails.courier.refundReturnedTitle", "Refund a returned parcel")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tSafe(
                "admin.orderDetails.courier.refundReturnedBody",
                "The courier brought this parcel back. Put the items back in stock separately if they are resellable.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {refundTarget && data?.refund ? (() => {
            const refund = data.refund;
            const currency = refund.currency || "USD";
            const canKeep =
              Boolean(refundTarget.rate) &&
              refundTarget.rate!.currency.toUpperCase() === currency.toUpperCase();
            const deduction = returnShippingDeduction(refundTarget, refund, keepReturnShipping);
            const amount = Math.max(0, refund.refundable - deduction);
            return (
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                  <dt className="text-muted-foreground">
                    {tSafe("admin.orderDetails.courier.refundable", "Still refundable")}
                  </dt>
                  <dd className="text-right">{formatCurrency(refund.refundable, currency)}</dd>
                  <dt className="text-muted-foreground">
                    {tSafe("admin.orderDetails.courier.returnShippingKept", "Return shipping kept")}
                  </dt>
                  <dd className="text-right">{deduction > 0 ? `−${formatCurrency(deduction, currency)}` : "—"}</dd>
                  <dt className="font-medium">{tSafe("admin.orderDetails.courier.refundTotal", "Refund")}</dt>
                  <dd className="text-right font-medium">{formatCurrency(amount, currency)}</dd>
                </dl>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={keepReturnShipping && canKeep}
                    disabled={!canKeep}
                    onChange={(event) => setKeepReturnShipping(event.target.checked)}
                  />
                  <span>
                    {tSafe("admin.orderDetails.courier.keepReturnShipping", "Keep the return shipping")}
                    {!canKeep ? (
                      <span className="block text-xs text-muted-foreground">
                        {tSafe(
                          "admin.orderDetails.courier.keepReturnShippingCurrency",
                          "The label was paid in another currency, so it can't be taken off this refund.",
                        )}
                      </span>
                    ) : null}
                  </span>
                </label>
              </div>
            );
          })() : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{tSafe("admin.orderDetails.keepOrder", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void refundReturned()}>
              {tSafe("admin.orderDetails.courier.refundConfirm", "Refund")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(voidTarget)}
        onOpenChange={(open) => !open && setVoidTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {tSafe("admin.orderDetails.courier.voidTitle", "Cancel this shipping label?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tSafe(
                "admin.orderDetails.courier.voidConfirm",
                "The label will stop working and can't be used to ship. Whether the label cost is refunded depends on the carrier.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {tSafe("admin.orderDetails.courier.keepLabel", "Keep label")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => voidTarget && void voidLabel(voidTarget)}
            >
              {tSafe("admin.orderDetails.courier.voidAction", "Yes, cancel label")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
