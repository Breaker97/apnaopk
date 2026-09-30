"use client";

import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DEFAULT_RETURN_INSTRUCTIONS,
  RETURN_SHIPPING_OPEN_STATUSES,
  describeReturnDestination,
  renderReturnInstructions,
  returnMethodOf,
} from "@/lib/returns/return-shipping";

/** The parts of a return this panel reads — what `toCustomerReturn` sends. */
interface ReturnShippingView {
  _id: string;
  returnNumber: string;
  status: string;
  returnMethod?: string;
  returnTo?: { name?: string; address?: string };
  returnInstructions?: string;
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    labelUrl?: string;
    hasLabelFile?: boolean;
  };
}

type Translate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

/**
 * What an approved return's shopper needs next: where the parcel goes, what
 * to do, the label if the store gave one, and a place to say it is posted.
 *
 * Shown only while there is a parcel to send; before approval the store has
 * not said, and once it has arrived there is nothing left to do here.
 */
export function ReturnShippingDetails({
  request,
  tf,
  onUpdated,
}: {
  request: ReturnShippingView;
  tf: Translate;
  onUpdated: (updated: ReturnShippingView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [carrier, setCarrier] = useState(request.shipment?.carrier || "");
  const [trackingNumber, setTrackingNumber] = useState(
    request.shipment?.trackingNumber || "",
  );
  const [saving, setSaving] = useState(false);

  if (
    !(RETURN_SHIPPING_OPEN_STATUSES as readonly string[]).includes(request.status)
  ) {
    return null;
  }

  const method = returnMethodOf(request.returnMethod);
  if (method === "no_shipping") {
    return (
      <p className="mt-3 rounded-md bg-muted/40 p-3 text-sm">
        {tf(
          "orders.returns.shipping.nothingToSend",
          "You don't need to send anything back.",
        )}
      </p>
    );
  }

  const destination = describeReturnDestination(request.returnTo);
  // The default wording points at the address above it, so it is only shown
  // when there is one.
  const instructions = request.returnInstructions
    ? renderReturnInstructions(request.returnInstructions, {
        returnNumber: request.returnNumber,
        address: destination,
      })
    : destination
      ? tf("orders.returns.shipping.defaultInstructions", DEFAULT_RETURN_INSTRUCTIONS, {
          returnNumber: request.returnNumber,
        })
      : "";
  const hasTracking = Boolean(request.shipment?.trackingNumber);
  const showForm = !hasTracking || editing;

  const save = async () => {
    if (!trackingNumber.trim()) {
      toast.error(
        tf("orders.returns.shipping.trackingRequired", "Enter the tracking number"),
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/returns/${request._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: carrier.trim() || undefined,
          trackingNumber: trackingNumber.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || "");
      }
      toast.success(tf("orders.returns.shipping.saved", "Tracking number saved"));
      setEditing(false);
      onUpdated(data.data as ReturnShippingView);
    } catch (error) {
      toast.error(
        (error instanceof Error && error.message) ||
          tf(
            "orders.returns.shipping.saveFailed",
            "Could not save the tracking number",
          ),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-md bg-muted/40 p-3 text-sm">
      {request.returnTo?.name || request.returnTo?.address ? (
        <div>
          <p className="text-xs text-muted-foreground">
            {tf("orders.returns.shipping.sendTo", "Send it to")}
          </p>
          {request.returnTo?.name ? (
            <p className="font-medium">{request.returnTo.name}</p>
          ) : null}
          {request.returnTo?.address ? (
            <p className="whitespace-pre-line text-muted-foreground">
              {request.returnTo.address}
            </p>
          ) : null}
        </div>
      ) : null}

      {instructions ? <p className="text-muted-foreground">{instructions}</p> : null}

      {request.shipment?.hasLabelFile ? (
        <Button asChild size="sm" variant="outline">
          <a
            href={`/api/returns/${request._id}/label`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="h-4 w-4" />
            {tf("orders.returns.shipping.downloadLabel", "Download return label")}
          </a>
        </Button>
      ) : request.shipment?.labelUrl ? (
        <Button asChild size="sm" variant="outline">
          <a
            href={request.shipment.labelUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4" />
            {tf("orders.returns.shipping.openLabel", "Open return label")}
          </a>
        </Button>
      ) : null}

      {showForm ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor={`return-carrier-${request._id}`} className="text-xs">
              {tf("orders.returns.shipping.carrier", "Carrier (optional)")}
            </Label>
            <Input
              id={`return-carrier-${request._id}`}
              value={carrier}
              maxLength={100}
              onChange={(event) => setCarrier(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`return-tracking-${request._id}`} className="text-xs">
              {tf("orders.returns.shipping.trackingNumber", "Tracking number")}
            </Label>
            <Input
              id={`return-tracking-${request._id}`}
              value={trackingNumber}
              maxLength={100}
              onChange={(event) => setTrackingNumber(event.target.value)}
            />
          </div>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving
              ? tf("orders.returns.shipping.saving", "Saving...")
              : tf("orders.returns.shipping.save", "Save")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">
            {tf("orders.returns.shipping.tracking", "Tracking: {tracking}", {
              tracking: [request.shipment?.carrier, request.shipment?.trackingNumber]
                .filter(Boolean)
                .join(" "),
            })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setEditing(true)}
          >
            {tf("orders.returns.shipping.change", "Change")}
          </Button>
        </div>
      )}
    </div>
  );
}
