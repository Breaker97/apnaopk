import { carrierSupportsOrigin } from "@/lib/shipping/carrier-config";
import {
  CARRIER_ERROR_CODES,
  CarrierError,
  type CarrierFailure,
} from "./errors";
import { normalizeShiprocketStatus } from "./status-map";
import type {
  CarrierAdapter,
  CarrierContext,
  CarrierLabel,
  CarrierRateQuote,
  CarrierShipmentRequest,
  CarrierTracking,
  CarrierTrackingEvent,
  CarrierWebhookEnvelope,
} from "./types";
import {
  shiprocketAssignAwb,
  shiprocketCachedPickupAddresses,
  shiprocketCancelOrder,
  shiprocketCreateOrder,
  shiprocketFindOrderByReference,
  shiprocketGenerateLabel,
  shiprocketGeneratePickup,
  shiprocketLogin,
  shiprocketPickupLocations,
  shiprocketServiceability,
  shiprocketTrackByAwb,
  type ShiprocketCreateOrderPayload,
} from "./shiprocket-client";

/** Shiprocket prices in kilograms and centimetres, whatever the store uses. */
const GRAMS_PER_UNIT = { g: 1, kg: 1000, lb: 453.59237, oz: 28.349523125 };

function toKilograms(
  weight: number,
  unit: keyof typeof GRAMS_PER_UNIT,
): number {
  return (weight * GRAMS_PER_UNIT[unit]) / 1000;
}

function toCentimetres(value: number, unit: "cm" | "in"): number {
  return unit === "in" ? value * 2.54 : value;
}

async function authenticate(ctx: CarrierContext): Promise<string> {
  const account = ctx.shiprocket;
  if (!account?.email || !account.password) {
    throw new CarrierError({
      provider: "shiprocket",
      code: CARRIER_ERROR_CODES.NOT_CONFIGURED,
      message: "Shiprocket API user credentials are not configured",
      permanent: true,
    });
  }
  return shiprocketLogin({
    email: account.email,
    password: account.password,
    cachedToken: account.cachedToken,
    cachedTokenExpiresAt: account.cachedTokenExpiresAt,
    onToken: account.onToken,
  });
}

function requirePickupLocation(ctx: CarrierContext): string {
  const name = ctx.shiprocket?.pickupLocationName?.trim();
  if (!name) {
    // Shiprocket ships from a registered nickname, never a free-form address.
    // This is the single place that constraint is enforced, so nothing further
    // down has to know about it.
    throw new CarrierError({
      provider: "shiprocket",
      code: CARRIER_ERROR_CODES.SHIPROCKET_PICKUP_NOT_CONFIGURED,
      message:
        "Select a Shiprocket pickup location in Settings → Shipping before shipping with Shiprocket",
      permanent: true,
    });
  }
  return name;
}

/**
 * The postcode a quote should actually be priced from.
 *
 * Shiprocket dispatches from a *registered pickup location*, whose address lives
 * in their dashboard. Storify's own ship-from is a separate record a merchant is
 * free to set differently — and quoting from it produced rates for a lane the
 * consignment never travels: serviceability answered for the wrong origin, and
 * the price the merchant was shown was not the price they were billed.
 *
 * Falls back to the caller's ship-from if the lookup fails, because a secondary
 * call must not take rate shopping down with it. A nickname that is genuinely
 * not on the account *is* raised: the booking would fail on it anyway, and
 * saying so here beats an opaque refusal after the merchant has chosen a rate.
 */
async function resolvePickupPostcode(params: {
  token: string;
  account: string;
  pickupLocation: string;
  fallback: string;
}): Promise<string> {
  let addresses;
  try {
    addresses = await shiprocketCachedPickupAddresses({
      token: params.token,
      account: params.account,
    });
  } catch {
    return params.fallback;
  }

  if (addresses.length === 0) return params.fallback;

  const match = addresses.find(
    (address) =>
      address.name.trim().toLowerCase() ===
      params.pickupLocation.trim().toLowerCase(),
  );
  if (!match) {
    throw new CarrierError({
      provider: "shiprocket",
      code: CARRIER_ERROR_CODES.SHIPROCKET_PICKUP_NOT_CONFIGURED,
      message: `"${params.pickupLocation}" is not a pickup location on this Shiprocket account. Pick one of: ${addresses
        .map((address) => address.name)
        .join(", ")}`,
      permanent: true,
    });
  }

  return match.pincode || params.fallback;
}

function parseEstimatedDays(courier: {
  estimated_delivery_days?: string;
  etd?: string;
}): number | undefined {
  const days = Number(courier.estimated_delivery_days);
  if (Number.isFinite(days) && days > 0) return days;
  const match = String(courier.etd || "").match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Exported for tests: the COD collectable is derived by Shiprocket from these
 * fields rather than taken from us, so what goes in them is money.
 */
export function buildShiprocketOrderPayload(
  request: CarrierShipmentRequest,
  pickupLocation: string,
  channelId?: string,
): ShiprocketCreateOrderPayload {
  const parcel = request.parcels[0];
  const [firstName, ...restName] = request.shipTo.name.trim().split(/\s+/);

  return {
    order_id: request.reference,
    // Their API wants a naive local timestamp, not an ISO instant.
    order_date: new Date().toISOString().slice(0, 16).replace("T", " "),
    pickup_location: pickupLocation,
    ...(channelId ? { channel_id: channelId } : {}),
    billing_customer_name: firstName || request.shipTo.name,
    billing_last_name: restName.join(" ") || undefined,
    billing_address: request.shipTo.street1,
    billing_address_2: request.shipTo.street2,
    billing_city: request.shipTo.city,
    billing_pincode: request.shipTo.postalCode,
    billing_state: request.shipTo.state,
    billing_country: request.shipTo.country,
    billing_email: request.shipTo.email,
    billing_phone: request.shipTo.phone || "",
    shipping_is_billing: true,
    order_items: (request.items || []).map((item) => ({
      name: item.name,
      sku: item.sku || item.name.slice(0, 40),
      units: item.quantity,
      selling_price: item.unitPrice,
    })),
    payment_method: request.cod ? "COD" : "Prepaid",
    sub_total:
      request.declaredValue?.amount ??
      (request.items || []).reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      ),
    // Shiprocket adds this to sub_total to get the amount the courier collects.
    // Without it a COD customer pays for the goods and nothing for delivery,
    // and the merchant silently absorbs the shipping the shopper was charged.
    ...(request.shippingAmount && request.shippingAmount > 0
      ? { shipping_charges: request.shippingAmount }
      : {}),
    length: toCentimetres(parcel.length, parcel.dimensionUnit),
    breadth: toCentimetres(parcel.width, parcel.dimensionUnit),
    height: toCentimetres(parcel.height, parcel.dimensionUnit),
    weight: toKilograms(parcel.weight, parcel.weightUnit),
  };
}

export const shiprocketAdapter: CarrierAdapter = {
  provider: "shiprocket",

  supports(params) {
    if (!carrierSupportsOrigin("shiprocket", params.originCountry))
      return false;
    return params.hasPickupLocation;
  },

  /**
   * Serviceability only — deliberately creates no provider-side state.
   *
   * Shiprocket's real booking flow is order → AWB → pickup → label, but if
   * quoting created an order, every abandoned rate lookup would leave a
   * phantom consignment in the merchant's Shiprocket panel. Rate shopping
   * stays free of side effects, exactly as it is for Shippo.
   */
  async getRates(ctx, request) {
    const token = await authenticate(ctx);
    const pickupLocation = requirePickupLocation(ctx);

    // Priced from where the parcel is actually collected, not from what Storify
    // calls its ship-from — see `resolvePickupPostcode`.
    const pickupPostcode = await resolvePickupPostcode({
      token,
      account: ctx.shiprocket!.email!,
      pickupLocation,
      fallback: request.shipFrom.postalCode,
    });

    const parcel = request.parcels[0];
    const couriers = await shiprocketServiceability({
      token,
      pickupPostcode,
      deliveryPostcode: request.shipTo.postalCode,
      weight: toKilograms(parcel.weight, parcel.weightUnit),
      cod: Boolean(request.cod),
      declaredValue: request.declaredValue?.amount,
    });

    // No service allow-list here, unlike Shippo: Shiprocket's "service" is a
    // courier company id that varies per account, so a stored list of them
    // would be meaningless the moment a vendor ships on its own login. Was
    // previously a filter that always passed, which read as though one existed.
    const quotes: CarrierRateQuote[] = couriers.map((courier) => ({
      provider: "shiprocket" as const,
      // There is no rate object to redeem — the courier id *is* the choice.
      rateId: String(courier.courier_company_id),
      carrierName: courier.courier_name,
      serviceName: courier.courier_name,
      serviceToken: String(courier.courier_company_id),
      amount: Number(courier.rate) || 0,
      // Shiprocket is an Indian domestic aggregator; rates are always INR.
      currency: "INR",
      estimatedDays: parseEstimatedDays(courier),
    }));

    if (quotes.length === 0) {
      throw new CarrierError({
        provider: "shiprocket",
        code: CARRIER_ERROR_CODES.NO_RATES,
        message: "No Shiprocket courier services this route",
        permanent: true,
      });
    }
    return quotes;
  },

  /**
   * Drives the four-call sequence, resuming from whatever a previous attempt
   * managed to complete. Each step's handle is returned so the caller can
   * persist it before the next one runs.
   */
  async purchaseLabel(ctx, params) {
    const token = await authenticate(ctx);
    const pickupLocation = requirePickupLocation(ctx);
    const resume = { ...(params.resume || {}) };

    // Best-effort by contract: a consignment that exists must never be
    // abandoned because we could not write its handle down.
    const checkpoint = async () => {
      await params.onProgress?.({ ...resume }).catch(() => undefined);
    };

    // Step 1 — the order.
    if (!resume.providerShipmentId) {
      try {
        const created = await shiprocketCreateOrder({
          token,
          payload: buildShiprocketOrderPayload(
            params.request,
            pickupLocation,
            ctx.shiprocket?.channelId,
          ),
        });
        // Recorded independently. Tying the order id to the shipment id meant a
        // response carrying only the former threw the one handle `voidLabel`
        // needs — leaving a live consignment in the merchant's panel that
        // Storify had no way to cancel.
        if (created.order_id !== undefined) {
          resume.providerOrderId = String(created.order_id);
        }
        if (created.shipment_id) {
          resume.providerShipmentId = String(created.shipment_id);
        }
      } catch (error) {
        // "Already exists" is the signature of a retry after a lost response.
        // Recovering the existing consignment is the whole reason this method
        // takes a resume state.
        const existing = await shiprocketFindOrderByReference({
          token,
          reference: params.request.reference,
        }).catch(() => null);
        if (existing?.cancelled) {
          // The reference belongs to a consignment somebody cancelled. Booking
          // on it would ask Shiprocket to assign an AWB to a dead order; the
          // reference is supposed to change after a void, so arriving here at
          // all means that did not happen.
          throw new CarrierError({
            provider: "shiprocket",
            code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
            message: `Shiprocket order ${params.request.reference} was cancelled (${existing.status}) and cannot be shipped again under the same reference.`,
            permanent: true,
          });
        }
        if (!existing?.shipmentId) throw error;
        resume.providerShipmentId = existing.shipmentId;
        resume.providerOrderId = existing.orderId;
      }
      // Written down before the AWB is attempted: everything after this point
      // can fail, and the consignment still exists on Shiprocket's side.
      await checkpoint();
    }

    if (!resume.providerShipmentId) {
      throw new CarrierError({
        provider: "shiprocket",
        code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
        message: "Shiprocket did not return a shipment id",
        permanent: false,
      });
    }

    // Step 2 — the AWB.
    let carrierName = params.quote.carrierName;
    if (!resume.trackingNumber) {
      const courierId = Number(params.quote.rateId);
      const assignment = await shiprocketAssignAwb({
        token,
        shipmentId: resume.providerShipmentId,
        courierId: Number.isFinite(courierId) ? courierId : undefined,
      });
      const data = assignment.response?.data;
      if (!data?.awb_code) {
        throw new CarrierError({
          provider: "shiprocket",
          code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
          message: assignment.message || "Shiprocket did not assign an AWB",
          permanent: false,
        });
      }
      resume.trackingNumber = data.awb_code;
      resume.providerTransactionId = data.awb_code;
      carrierName = data.courier_name || carrierName;
      // The AWB is the parcel's identity with the courier. Label generation
      // below can still fail, and a retry must not ask for a second one.
      await checkpoint();
    }

    // Step 3 — the pickup. Non-fatal: the consignment exists and has an AWB,
    // and a merchant can raise the pickup from Shiprocket's own panel.
    await shiprocketGeneratePickup({
      token,
      shipmentId: resume.providerShipmentId,
    }).catch(() => undefined);

    // Step 4 — the label.
    if (!resume.labelUrl) {
      const label = await shiprocketGenerateLabel({
        token,
        shipmentId: resume.providerShipmentId,
      });
      if (!label.label_url) {
        throw new CarrierError({
          provider: "shiprocket",
          code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
          message: "Shiprocket did not return a label URL",
          permanent: false,
          retryAfterSeconds: 20,
        });
      }
      resume.labelUrl = label.label_url;
    }

    const label: CarrierLabel = {
      transactionId: resume.providerTransactionId || resume.trackingNumber!,
      trackingNumber: resume.trackingNumber!,
      trackingUrl: `https://shiprocket.co/tracking/${encodeURIComponent(resume.trackingNumber!)}`,
      labelUrl: resume.labelUrl!,
      labelFormat: "PDF",
      carrierName,
      serviceName: params.quote.serviceName,
      amount: params.quote.amount,
      currency: params.quote.currency,
      resume,
    };
    return label;
  },

  async track(ctx, params) {
    const token = await authenticate(ctx);
    const result = await shiprocketTrackByAwb({
      token,
      awb: params.trackingNumber,
    });

    const data = result.tracking_data;
    const activities = data?.shipment_track_activities || [];
    const events: CarrierTrackingEvent[] = activities.map((activity) => ({
      at: activity.date ? new Date(activity.date) : new Date(),
      status: normalizeShiprocketStatus(activity.status || activity.activity),
      providerStatus: activity.status || undefined,
      description: activity.activity || undefined,
      location: activity.location || undefined,
    }));
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    const currentStatus = data?.shipment_track?.[0]?.current_status;
    const tracking: CarrierTracking = {
      status: currentStatus
        ? normalizeShiprocketStatus(currentStatus)
        : (events[events.length - 1]?.status ?? "unknown"),
      eta: data?.etd ? new Date(data.etd) : undefined,
      events,
    };
    return tracking;
  },

  async voidLabel(ctx, params) {
    const token = await authenticate(ctx);
    const orderId = params.orderId;
    if (!orderId) {
      throw new CarrierError({
        provider: "shiprocket",
        code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
        message: "This shipment has no Shiprocket order to cancel",
        permanent: true,
      });
    }
    const result = await shiprocketCancelOrder({ token, orderIds: [orderId] });
    // Shiprocket cancels the consignment; it never refunds a label fee, so
    // `refunded` is false by definition here.
    return { refunded: false, state: result.message || "cancelled" };
  },

  async testConnection(ctx) {
    const token = await authenticate(ctx);
    const locations = await shiprocketPickupLocations({ token });
    return {
      ok: true as const,
      account: locations[0],
      // Shiprocket has no sandbox: any successful login is a live account.
      mode: "live" as const,
    };
  },

  classify(error): CarrierFailure | undefined {
    if (error instanceof CarrierError && error.provider === "shiprocket") {
      return error.toFailure();
    }
    return undefined;
  },

  parseWebhook({ rawBody }): CarrierWebhookEnvelope | null {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const body = payload as {
      awb?: string;
      current_status?: string;
      current_status_id?: number | string;
      current_timestamp?: string;
      order_id?: string;
      shipment_status?: string;
    };
    const awb = body?.awb;
    if (!awb) return null;

    const eventId =
      `${awb}:${body.current_status_id ?? body.current_status ?? ""}:${body.current_timestamp ?? ""}`.slice(
        0,
        200,
      );

    return {
      provider: "shiprocket",
      eventId,
      type: String(
        body.current_status || body.shipment_status || "tracking_update",
      ),
      objectId: body.order_id,
      trackingNumber: awb,
      test: false,
    };
  },
};

export { shiprocketPickupLocations, authenticate as shiprocketAuthenticate };
