import "server-only";

import { Shipment } from "@/models/shipment.model";
import type { IShipmentEvent } from "@/models/shipment.model";
import { getSettings, type ISettings } from "@/models/settings.model";
import {
  trackingPageUrl,
  type CourierTrackingLink,
} from "@/lib/shipping/tracking-urls";

/**
 * A parcel as the person who bought it may see it.
 *
 * Both customer-facing order screens read the same things off a shipment — the
 * courier's scans, its "track this parcel" link and whether delivery has gone
 * wrong — and a shipment also carries the ship-from address, the label file,
 * what the label cost and which carrier account paid for it. So this is a
 * whitelist rather than a list of things to strip, and it lives here rather
 * than in either route because the public tracking page is reachable with an
 * order number and an email: two copies of that list are two chances for one
 * of them to widen.
 */
type CustomerShipmentDoc = {
  carrier?: string;
  rate?: { carrierName?: string };
  trackingNumber?: string;
  trackingUrl?: string;
  events?: IShipmentEvent[];
  exception?: { code: string; message: string; at: Date };
};

const CUSTOMER_SHIPMENT_FIELDS =
  "carrier rate.carrierName trackingNumber trackingUrl events exception";

/** Enough scans to tell the story of a parcel without unbounded output. */
export const MAX_SCAN_EVENTS = 25;

/** One scan reported by the courier itself. */
interface CustomerScanEvent {
  at: Date;
  status: string;
  description?: string;
  location?: string;
}

/**
 * Delivery going wrong, in the courier's own words.
 *
 * A return or a failed attempt deliberately does not move the order's status —
 * see `shipmentStatusForTracking` — so without this the screen went on saying
 * "In transit" about a parcel the courier had already given up on, which is
 * the single worst thing a tracking page can do.
 */
interface CustomerDeliveryException {
  /** Our normalized vocabulary: `returned` or `failure`. */
  code: string;
  message: string;
  at: Date;
}

/** What either screen shows about one parcel, beyond what the order knows. */
interface CustomerShipmentTracking {
  trackingUrl?: string;
  /** The courier the carrier itself names, when it named one. */
  carrierName?: string;
  /** Newest first. Empty for a parcel booked outside a connected carrier. */
  events: CustomerScanEvent[];
  exception?: CustomerDeliveryException;
}

/** Shared by every miss that resolves to nothing at all. */
const NO_TRACKING: CustomerShipmentTracking = Object.freeze({ events: [] });

interface OrderShipmentTracking {
  /**
   * The order-level summary parcel.
   *
   * `order.trackingNumber` means "most recent shipment" on a split order, so
   * this follows it rather than guessing at the first sub-order.
   */
  primary: CustomerShipmentTracking;
  /**
   * One consignment's parcel.
   *
   * Matched on the tracking number, not the sub-order: an internally generated
   * label falls back to the order number as its "tracking number", and handing
   * that to a shopper as something to track would be a lie.
   *
   * `carrier` is the consignment's own courier name, used to resolve a
   * tracking page for a parcel that has no shipment row at all — an AWB typed
   * straight onto the order never produced one.
   */
  forTrackingNumber(
    trackingNumber?: string,
    carrier?: string,
  ): CustomerShipmentTracking;
}

/** The courier's own scans, newest first. */
function scanEvents(shipment: CustomerShipmentDoc): CustomerScanEvent[] {
  return (shipment.events || [])
    .slice(-MAX_SCAN_EVENTS)
    .map((event) => ({
      at: event.at,
      status: event.status,
      description: event.description,
      location: event.location,
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function toTracking(params: {
  shipment?: CustomerShipmentDoc;
  trackingNumber?: string;
  carrier?: string;
  links?: CourierTrackingLink[];
}): CustomerShipmentTracking {
  const { shipment } = params;
  const carrierName =
    shipment?.rate?.carrierName || shipment?.carrier || params.carrier;
  const trackingNumber = shipment?.trackingNumber || params.trackingNumber;

  // The provider's own link is authoritative; ours is the fallback that makes
  // a hand-entered AWB clickable at all.
  const trackingUrl =
    shipment?.trackingUrl ||
    trackingPageUrl({
      carrier: carrierName,
      trackingNumber,
      links: params.links,
    });

  if (!shipment) {
    return trackingUrl ? { trackingUrl, carrierName, events: [] } : NO_TRACKING;
  }

  return {
    trackingUrl,
    carrierName,
    events: scanEvents(shipment),
    exception: shipment.exception
      ? {
          code: shipment.exception.code,
          message: shipment.exception.message,
          at: shipment.exception.at,
        }
      : undefined,
  };
}

/**
 * Every trackable parcel on an order, in the shape a customer may see.
 *
 * One query for the whole order: both screens need the order-level parcel and,
 * on a split order, one more per consignment.
 */
export async function loadOrderShipmentTracking(params: {
  orderId: unknown;
  /** The order's own `trackingNumber`, which picks out `primary`. */
  trackingNumber?: string;
  /** The order's own `carrier`, for resolving a link without a shipment row. */
  carrier?: string;
  settings?: ISettings;
}): Promise<OrderShipmentTracking> {
  const [docs, settings] = await Promise.all([
    Shipment.find({
      orderId: params.orderId,
      trackingNumber: { $nin: [null, ""] },
    })
      .select(CUSTOMER_SHIPMENT_FIELDS)
      .lean<CustomerShipmentDoc[]>(),
    params.settings ? Promise.resolve(params.settings) : getSettings(),
  ]);

  const links = settings.shipping?.courierTrackingLinks;

  // First write wins, matching the `.find()` this replaced. Two parcels on one
  // order may legitimately share an AWB — the uniqueness index is per vendor —
  // and silently preferring the last one would change which scans a split
  // order's summary shows.
  const byTrackingNumber = new Map<string, CustomerShipmentDoc>();
  for (const doc of docs) {
    if (doc.trackingNumber && !byTrackingNumber.has(doc.trackingNumber)) {
      byTrackingNumber.set(doc.trackingNumber, doc);
    }
  }

  const forTrackingNumber = (trackingNumber?: string, carrier?: string) =>
    toTracking({
      shipment: trackingNumber
        ? byTrackingNumber.get(trackingNumber)
        : undefined,
      trackingNumber,
      carrier,
      links,
    });

  return {
    primary: forTrackingNumber(params.trackingNumber, params.carrier),
    forTrackingNumber,
  };
}

/**
 * Just the carrier's tracking page for one parcel.
 *
 * Separate from `loadOrderShipmentTracking` because the status email needs the
 * link and nothing else, and pulling every parcel's whole scan array to render
 * one anchor tag is not a trade the mailer should make.
 */
export async function trackingUrlForOrder(params: {
  orderId: unknown;
  trackingNumber?: string;
  carrier?: string;
  settings?: ISettings;
}): Promise<string | undefined> {
  if (!params.trackingNumber) return undefined;

  const shipment = await Shipment.findOne({
    orderId: params.orderId,
    trackingNumber: params.trackingNumber,
  })
    .select("trackingUrl carrier rate.carrierName")
    .lean<CustomerShipmentDoc | null>();

  if (shipment?.trackingUrl) return shipment.trackingUrl;

  const settings = params.settings ?? (await getSettings());
  return trackingPageUrl({
    carrier: shipment?.rate?.carrierName || shipment?.carrier || params.carrier,
    trackingNumber: params.trackingNumber,
    links: settings.shipping?.courierTrackingLinks,
  });
}
