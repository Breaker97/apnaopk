import "server-only";

import { z } from "zod";
import { NextRequest } from "next/server";
import { Shipment } from "@/models/shipment.model";
import { getSettings } from "@/models/settings.model";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditOrderShipment } from "@/lib/orders/audit-order";
import { generateShippingLabelPdf } from "@/lib/shipping/shipping-label-pdf";
import { shipmentItemsForOrder } from "@/lib/shipping/shipments";
import { applyShipmentTrackingToOrder } from "@/lib/shipping/tracking-cascade";
import { ORDER_STATUS } from "@/config/app.config";
import {
  CARRIER_PROVIDERS,
  DIMENSION_UNITS,
  PARCEL_WEIGHT_UNITS,
} from "@/lib/shipping/carrier-config";
import { CarrierError } from "./errors";
import {
  purchaseShipmentLabel,
  rateShopSubOrder,
  refreshShipmentTracking,
  voidShipmentLabel,
} from "./fulfillment";
import { loadOwnedShipment, type ShipmentScope } from "./order-scope";
import type { Address } from "@/types";

/**
 * The carrier fulfillment endpoints, written once.
 *
 * Admin and vendor mount the same handlers with a different scope resolver;
 * duplicating five routes across two trees is exactly how the existing
 * shipments/label routes drifted apart, and these ones spend money.
 */

const ParcelSchema = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  dimensionUnit: z.enum(DIMENSION_UNITS),
  weight: z.number().positive(),
  weightUnit: z.enum(PARCEL_WEIGHT_UNITS),
});

const RatesSchema = z.object({
  subOrderId: z.string().optional(),
  provider: z.enum(CARRIER_PROVIDERS).optional(),
  packageId: z.string().max(100).optional(),
  parcel: ParcelSchema.optional(),
});

const PurchaseSchema = z.object({
  rateId: z.string().min(1).max(200),
  serviceToken: z.string().max(120).optional(),
});

/** Resolves who is calling and what they may touch. */
export type ScopeResolver = (params: {
  request: NextRequest;
  session: { user: { id: string; role: string } };
  orderId: string;
  subOrderId?: string;
  /** Read-only actions need a lighter permission than mutating ones. */
  intent: "read" | "write";
}) => Promise<ShipmentScope>;

/**
 * A carrier fault is the merchant's to fix (bad address, missing pickup
 * location, expired rate), so it surfaces as a 4xx with the provider's own
 * words rather than an opaque 500 with a stack trace in the logs.
 */
function rethrowAsValidation(error: unknown): never {
  if (error instanceof CarrierError) {
    throw new ValidationError(error.message);
  }
  throw error;
}

export function createRateShopHandler(resolveScope: ScopeResolver) {
  return async ({
    request,
    params,
    session,
  }: {
    request: NextRequest;
    params: { id: string };
    session: { user: { id: string; role: string } };
  }) => {
    const body = await validateBody(request, RatesSchema);
    const scope = await resolveScope({
      request,
      session,
      orderId: params.id,
      subOrderId: body.subOrderId,
      intent: "write",
    });

    try {
      const result = await rateShopSubOrder({
        order: scope.order,
        subOrder: scope.subOrder,
        actorId: session.user.id,
        customerEmail: scope.customerEmail,
        provider: body.provider,
        packageId: body.packageId,
        parcelOverride: body.parcel,
      });

      return successResponse({
        shipmentId: String(result.shipment._id),
        provider: result.shipment.provider,
        mode: result.shipment.providerMode,
        quotes: result.quotes,
        quotedAt: result.shipment.quotedAt,
        parcel: result.parcel,
        packing: result.packing,
      });
    } catch (error) {
      rethrowAsValidation(error);
    }
  };
}

export function createPurchaseHandler(resolveScope: ScopeResolver) {
  return async ({
    request,
    params,
    session,
  }: {
    request: NextRequest;
    params: { id: string; shipmentId: string };
    session: { user: { id: string; role: string } };
  }) => {
    const body = await validateBody(request, PurchaseSchema);
    const scope = await resolveScope({
      request,
      session,
      orderId: params.id,
      intent: "write",
    });
    const existing = await loadOwnedShipment({
      shipmentId: params.shipmentId,
      orderId: params.id,
      vendorId: scope.vendorId,
    });

    // A vendor route pins the sub-order to the vendor; an admin may be acting
    // on any of them, so the shipment decides which one this is about.
    const subOrder =
      scope.order.subOrders?.find(
        (entry) => String(entry._id) === String(existing.subOrderId),
      ) || scope.subOrder;

    try {
      const { shipment, alreadyOwned } = await purchaseShipmentLabel({
        shipmentId: params.shipmentId,
        order: scope.order,
        subOrder,
        rateId: body.rateId,
        serviceToken: body.serviceToken,
        actorId: session.user.id,
        customerEmail: scope.customerEmail,
      });

      if (!alreadyOwned && shipment.trackingNumber) {
        const settings = await getSettings();
        // Buying the label is the act that produces a tracking number, so the
        // order carries it immediately. Waiting for the carrier's first scan
        // would leave the customer with no tracking at all — and the sub-order
        // with no `trackingNumber`, which is what auto-ship reads to decide a
        // parcel is already handled.
        await applyShipmentTrackingToOrder({
          orderId: params.id,
          subOrderId: existing.subOrderId
            ? String(existing.subOrderId)
            : undefined,
          trackingNumber: shipment.trackingNumber,
          carrier: shipment.rate?.carrierName || shipment.carrier,
          // The same switch the automated path honours. Off means "record the
          // parcel, I will say when it left" — so the status is not moved.
          targetStatus:
            settings.shipping?.automation?.markOrderShipped !== false
              ? ORDER_STATUS.SHIPPED
              : undefined,
        }).catch(console.error);

        await auditOrderShipment(
          createAuditContext(request, session),
          scope.order,
          {
            carrier: shipment.carrier,
            trackingNumber: shipment.trackingNumber,
          },
        ).catch(console.error);
      }

      return successResponse(
        shipment,
        alreadyOwned
          ? "This label was already purchased"
          : "Shipping label purchased",
      );
    } catch (error) {
      rethrowAsValidation(error);
    }
  };
}

export function createVoidHandler(resolveScope: ScopeResolver) {
  return async ({
    request,
    params,
    session,
  }: {
    request: NextRequest;
    params: { id: string; shipmentId: string };
    session: { user: { id: string; role: string } };
  }) => {
    const scope = await resolveScope({
      request,
      session,
      orderId: params.id,
      intent: "write",
    });
    await loadOwnedShipment({
      shipmentId: params.shipmentId,
      orderId: params.id,
      vendorId: scope.vendorId,
    });

    try {
      const result = await voidShipmentLabel({ shipmentId: params.shipmentId });
      return successResponse(
        {
          shipment: result.shipment,
          refunded: result.refunded,
          state: result.state,
        },
        result.refunded
          ? "Label voided and refund requested"
          : "Label voided — the carrier does not refund this shipment",
      );
    } catch (error) {
      rethrowAsValidation(error);
    }
  };
}

export function createRefreshTrackingHandler(resolveScope: ScopeResolver) {
  return async ({
    request,
    params,
    session,
  }: {
    request: NextRequest;
    params: { id: string; shipmentId: string };
    session: { user: { id: string; role: string } };
  }) => {
    const scope = await resolveScope({
      request,
      session,
      orderId: params.id,
      // A write, despite the name: it spends a carrier API call and rewrites
      // the parcel's status and event log. Viewing an order must not be enough
      // to burn someone else's rate limit.
      intent: "write",
    });
    await loadOwnedShipment({
      shipmentId: params.shipmentId,
      orderId: params.id,
      vendorId: scope.vendorId,
    });

    try {
      const result = await refreshShipmentTracking({
        shipmentId: params.shipmentId,
      });
      return successResponse(result.shipment);
    } catch (error) {
      rethrowAsValidation(error);
    }
  };
}

/**
 * Stream a label.
 *
 * Proxied server-side rather than redirecting: Shiprocket's label URLs expire,
 * Shippo's are unauthenticated, and the existing QZ Tray thermal print path
 * needs a same-origin blob. Falls back to the internally generated PDF so one
 * button serves both the manual and the carrier flow.
 */
export function createLabelHandler(resolveScope: ScopeResolver) {
  return async ({
    request,
    params,
    session,
  }: {
    request: NextRequest;
    params: { id: string; shipmentId: string };
    session: { user: { id: string; role: string } };
  }) => {
    const scope = await resolveScope({
      request,
      session,
      orderId: params.id,
      intent: "read",
    });
    const shipment = await loadOwnedShipment({
      shipmentId: params.shipmentId,
      orderId: params.id,
      vendorId: scope.vendorId,
    });

    const filename = `shipping-label-${scope.order.orderNumber}.pdf`;

    if (shipment.label?.source === "carrier" && shipment.labelUrl) {
      const upstream = await fetch(shipment.labelUrl, { cache: "no-store" });
      if (!upstream.ok || !upstream.body) {
        throw new ValidationError(
          "The carrier label is no longer available. Refresh the shipment and try again.",
        );
      }
      return new Response(upstream.body, {
        headers: {
          "Content-Type":
            upstream.headers.get("content-type") || "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store, private",
        },
      });
    }

    const vendorId = shipment.vendorId ? String(shipment.vendorId) : undefined;
    const items = shipmentItemsForOrder(scope.order, vendorId);
    const pdf = await generateShippingLabelPdf({
      orderNumber: scope.order.orderNumber,
      carrier: shipment.carrier,
      service: shipment.service,
      trackingNumber: shipment.trackingNumber || scope.order.orderNumber,
      from: labelAddress(shipment.shipFrom, "Store"),
      to: labelAddress(shipment.shipTo, "Customer"),
      items: items.map((item) => ({
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
      })),
      parcel: shipment.parcel,
      internalLabel: shipment.label.source === "internal",
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, private",
      },
    });
  };
}

function labelAddress(address: Address, fallbackName: string) {
  return {
    name: address.fullName || fallbackName,
    street: address.street || "",
    apartment: address.apartment,
    city: address.city || "",
    state: address.state || "",
    postalCode: address.postalCode || "",
    country: address.country || "",
    phone: address.phone,
  };
}

/** Shipments for an order, newest first, scoped to what the caller may see. */
export function createListHandler(resolveScope: ScopeResolver) {
  return async ({
    request,
    params,
    session,
  }: {
    request: NextRequest;
    params: { id: string };
    session: { user: { id: string; role: string } };
  }) => {
    const scope = await resolveScope({
      request,
      session,
      orderId: params.id,
      intent: "read",
    });

    const shipments = await Shipment.find({
      orderId: params.id,
      ...(scope.vendorId ? { vendorId: scope.vendorId } : {}),
    })
      .sort({ createdAt: -1 })
      .lean();

    const settings = await getSettings();
    return successResponse({
      shipments,
      carriersEnabled: Boolean(settings.shipping?.carriers?.enabled),
      packages: settings.shipping?.packages || [],
      storeCurrency: settings.general?.defaultCurrency,
      // A hand-entered parcel has no carrier-supplied tracking page, so the
      // panel resolves one the same way the customer's screens do.
      courierTrackingLinks: settings.shipping?.courierTrackingLinks || [],
    });
  };
}
