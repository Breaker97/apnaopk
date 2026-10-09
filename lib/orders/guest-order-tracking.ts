import "server-only";

import { connectDB } from "@/lib/db";
import { Order, ReturnRequest, User } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import type { IOrder } from "@/types";
import { countRequest } from "@/lib/api/rate-limit-middleware";
import { orderContactMatches } from "@/lib/orders/order-contact-match";
import { sanitizeOrderForCustomer } from "@/lib/orders/order-customer-view";
import { generateOrderInvoicePdf } from "@/lib/orders/order-invoice";
import { loadOrderShipmentTracking } from "@/lib/orders/order-shipment-view";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";

/**
 * Finding an order without an account: its number, and the email address or
 * phone number it was placed with. The website's tracker (POST
 * /api/orders/track), its invoice download and the shopper app's
 * POST /orders/track all ask here, so they cannot drift over who is handed an
 * order, how often one order may be guessed at, or what a guest is shown.
 *
 * Order numbers are sequential, so the contact is the only secret. Two rules
 * keep it one:
 * - A wrong number and a wrong contact are the same answer, `not_found`, and
 *   cost the same: the order and its customer are read in one round trip
 *   whether the number exists or not, so neither the answer nor the time it
 *   takes says which half was wrong.
 * - Each order is held to a strict limit per address — guessing one order's
 *   contact details — counted before anything is read. The callers keep a
 *   limit per address of their own, for sweeping many orders.
 */

/** A customer as the tracker reads them: enough to match against and to name. */
export type TrackedCustomer = {
  _id?: unknown;
  name?: string;
  email?: string;
  phone?: string;
};

/**
 * The order a guest found, as stored. `customerId` holds the account that
 * placed it, or null for a guest's order (whose `customerId` is the guest's
 * cart), the way a populate reads it.
 */
export type TrackedOrder = Omit<IOrder, "customerId"> & {
  customerId: TrackedCustomer | null;
  contactPhone?: string;
};

export type GuestOrderLookup =
  | { kind: "found"; order: TrackedOrder }
  /** A wrong number or a wrong contact; never says which. */
  | { kind: "not_found" }
  /** The number or the contact is blank. */
  | { kind: "incomplete" }
  /** This address has asked about this order too often. */
  | { kind: "rate_limited"; retryAfter: number };

/**
 * The tight limit on one order from one address. A household or a carrier's
 * shared address tracking different orders does not share it; guessing the
 * contact details of one order is held to it. The website's tracker and its
 * invoice share the count with the app, so moving between them buys nothing.
 */
async function countOrderLookup(
  ip: string | undefined,
  orderNumber: string,
): Promise<{ retryAfter: number } | null> {
  const refusal = await countRequest(
    `ip:${ip ?? "unknown"}:subject:order:${orderNumber.toUpperCase().slice(0, 64)}`,
    "strict",
  );
  return refusal ? { retryAfter: refusal.resetIn } : null;
}

/**
 * The order and the account that placed it, in one round trip either way.
 *
 * Order numbers are generated fully uppercase, so an exact uppercase match
 * seeks the unique index. A case-insensitive anchored regex could not use
 * B-tree bounds and scanned the whole index on every lookup — on a public
 * endpoint, a cheap DoS vector.
 */
async function readTrackedOrder(orderNumber: string): Promise<TrackedOrder | null> {
  await connectDB();
  const [found] = await Order.aggregate<
    Omit<TrackedOrder, "customerId"> & { customerId: unknown; trackedCustomer: TrackedCustomer[] }
  >([
    { $match: { orderNumber: orderNumber.toUpperCase() } },
    { $limit: 1 },
    {
      $lookup: {
        from: User.collection.collectionName,
        localField: "customerId",
        foreignField: "_id",
        as: "trackedCustomer",
      },
    },
    {
      $addFields: {
        trackedCustomer: {
          $map: {
            input: "$trackedCustomer",
            as: "customer",
            in: {
              _id: "$$customer._id",
              name: "$$customer.name",
              email: "$$customer.email",
              phone: "$$customer.phone",
            },
          },
        },
      },
    },
  ]);
  if (!found) return null;
  const { trackedCustomer, ...order } = found;
  return { ...order, customerId: trackedCustomer[0] ?? null };
}

/**
 * Finds the order a guest asked for. `orderNumber` and `contact` are what they
 * typed (trimmed here); `ip` is their address as the proxy chain vouches for
 * it (lib/api/client-ip.ts).
 *
 * The order's limit is counted before the fields are checked, so a lookup
 * that names an order and no contact still counts against it.
 */
export async function lookUpGuestOrder(input: {
  orderNumber: string;
  contact: string;
  ip: string | undefined;
}): Promise<GuestOrderLookup> {
  const orderNumber = input.orderNumber.trim();
  const contact = input.contact.trim();

  if (orderNumber) {
    const refusal = await countOrderLookup(input.ip, orderNumber);
    if (refusal) return { kind: "rate_limited", retryAfter: refusal.retryAfter };
  }
  if (!orderNumber || !contact) return { kind: "incomplete" };

  const order = await readTrackedOrder(orderNumber);
  if (!order) return { kind: "not_found" };

  const customer = order.customerId;
  // Guest orders read no customer (customerId points at the guest's cart),
  // so their checkout email lives on the order itself.
  const matches = orderContactMatches(contact, {
    emails: [customer?.email, order.guestEmail],
    phones: [customer?.phone, order.contactPhone, order.shippingAddress?.phone],
  });
  return matches ? { kind: "found", order } : { kind: "not_found" };
}

/** The name on the order: the delivery address's, else the account's. */
function trackedCustomerName(order: TrackedOrder): string {
  const address = order.shippingAddress;
  const addressName =
    address?.fullName || [address?.firstName, address?.lastName].filter(Boolean).join(" ");
  return addressName || order.customerId?.name || "Customer";
}

/**
 * The invoice of the order a guest found: the same PDF the signed-in order
 * page downloads, made out to the name and email on the order.
 */
export async function buildGuestInvoicePdf(order: TrackedOrder) {
  const settings = await getSettingsLean();
  return generateOrderInvoicePdf(
    order,
    settings,
    trackedCustomerName(order),
    order.customerId?.email || order.guestEmail,
  );
}

function maskEmail(value?: string) {
  if (!value || !value.includes("@")) return undefined;
  const [name, domain] = value.split("@");
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - 2, 3))}@${domain}`;
}

/** A phone number down to its last four digits: `*******2333`. */
export function maskPhone(value?: string) {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;
}

type TimelineOrder = TrackedOrder & {
  status: string;
  carrier?: string;
  processingAt?: Date;
  shippedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type TrackingEvent = {
  key: string;
  title: string;
  description: string;
  timestamp?: Date;
  completed: boolean;
};

type LeanReturnRequest = {
  _id: unknown;
  returnNumber: string;
  status: string;
  refundStatus: string;
  requestedAt?: Date;
  approvedAt?: Date;
  receivedAt?: Date;
  inspectedAt?: Date;
  refundedAt?: Date;
  closedAt?: Date;
  updatedAt: Date;
};

function latestDate(values: Array<Date | undefined>) {
  return values
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
}

function getReturnTimestamp(
  request: LeanReturnRequest,
  fields: Array<keyof LeanReturnRequest>,
) {
  const values = fields.map((field) => request[field]);
  return latestDate(values.filter((value): value is Date => value instanceof Date));
}

function buildReturnTrackingEvents(returnRequests: LeanReturnRequest[]) {
  if (returnRequests.length === 0) return [];

  const approvedStatuses = new Set<string>([
    RETURN_STATUS.APPROVED,
    RETURN_STATUS.AWAITING_SHIPMENT,
    RETURN_STATUS.IN_TRANSIT,
    RETURN_STATUS.RECEIVED,
    RETURN_STATUS.INSPECTED,
    RETURN_STATUS.REFUND_PENDING,
    RETURN_STATUS.REFUNDED,
    RETURN_STATUS.PARTIALLY_REFUNDED,
  ]);
  const receivedStatuses = new Set<string>([
    RETURN_STATUS.RECEIVED,
    RETURN_STATUS.INSPECTED,
    RETURN_STATUS.REFUND_PENDING,
    RETURN_STATUS.REFUNDED,
    RETURN_STATUS.PARTIALLY_REFUNDED,
  ]);

  const events: TrackingEvent[] = [];
  const approvedRequests = returnRequests.filter((request) =>
    approvedStatuses.has(request.status),
  );
  const receivedRequests = returnRequests.filter((request) =>
    receivedStatuses.has(request.status),
  );
  const refundRequests = returnRequests.filter(
    (request) =>
      request.status === RETURN_STATUS.REFUNDED ||
      request.status === RETURN_STATUS.PARTIALLY_REFUNDED ||
      request.status === RETURN_STATUS.REFUND_PENDING ||
      request.refundStatus === RETURN_REFUND_STATUS.SUCCEEDED ||
      request.refundStatus === RETURN_REFUND_STATUS.MANUAL_REQUIRED ||
      request.refundStatus === RETURN_REFUND_STATUS.PROCESSING ||
      request.refundStatus === RETURN_REFUND_STATUS.FAILED,
  );

  if (approvedRequests.length > 0) {
    events.push({
      key: "return_approved",
      title: "Return Request Approved",
      description: "Your return request has been approved.",
      timestamp: latestDate(
        approvedRequests.map((request) =>
          getReturnTimestamp(request, ["approvedAt", "updatedAt", "requestedAt"]),
        ),
      ),
      completed: true,
    });
  }

  if (receivedRequests.length > 0) {
    events.push({
      key: "return_received",
      title: "Return Accepted",
      description: "The returned product has been received.",
      timestamp: latestDate(
        receivedRequests.map((request) =>
          getReturnTimestamp(request, ["receivedAt", "inspectedAt", "updatedAt"]),
        ),
      ),
      completed: true,
    });
  }

  if (refundRequests.length > 0) {
    const issuedRequests = refundRequests.filter(
      (request) =>
        request.status === RETURN_STATUS.REFUNDED ||
        request.status === RETURN_STATUS.PARTIALLY_REFUNDED ||
        request.refundStatus === RETURN_REFUND_STATUS.SUCCEEDED ||
        request.refundStatus === RETURN_REFUND_STATUS.MANUAL_REQUIRED,
    );
    const failedRequests = refundRequests.filter(
      (request) => request.refundStatus === RETURN_REFUND_STATUS.FAILED,
    );

    const refundSource =
      issuedRequests.length > 0
        ? issuedRequests
        : failedRequests.length > 0
          ? failedRequests
          : refundRequests;
    const hasPartialRefund = refundSource.some(
      (request) => request.status === RETURN_STATUS.PARTIALLY_REFUNDED,
    );
    const hasManualRefund = refundSource.some(
      (request) => request.refundStatus === RETURN_REFUND_STATUS.MANUAL_REQUIRED,
    );
    const isFailed = issuedRequests.length === 0 && failedRequests.length > 0;

    events.push({
      key: "refund_status",
      // A refund still sitting on `manual_required` has been APPROVED and not
      // paid — no gateway carried it, and nobody has recorded sending it yet.
      // Calling that "Refund Issued" and ticking the step complete told a
      // shopper their money was on its way when nothing had moved.
      title: isFailed
        ? "Refund Failed"
        : hasManualRefund
          ? "Refund Approved"
          : issuedRequests.length > 0
            ? hasPartialRefund
              ? "Partial Refund Issued"
              : "Refund Issued"
            : "Refund Processing",
      description: isFailed
        ? "Refund processing failed. Please contact support."
        : hasManualRefund
          ? "Your refund has been approved and is being sent to the account you gave us."
          : issuedRequests.length > 0
            ? "The refund status has been updated."
            : "Your refund is being processed.",
      timestamp: latestDate(
        refundSource.map((request) =>
          getReturnTimestamp(request, ["refundedAt", "closedAt", "updatedAt"]),
        ),
      ),
      completed: !isFailed && !hasManualRefund,
    });
  }

  return events;
}

function buildTrackingEvents(
  order: TimelineOrder,
  returnRequests: LeanReturnRequest[] = [],
) {
  const createdAt = order.createdAt;
  const processingAt = order.processingAt;
  const shippedAt = order.shippedAt;
  const deliveredAt = order.deliveredAt;
  const cancelledAt = order.cancelledAt;

  const pickup =
    order.fulfillment?.method === "pickup" ? order.fulfillment.pickup : undefined;
  if (pickup) {
    return [
      {
        key: "placed",
        title: "Order placed",
        description: "We received your order and started checking the details.",
        timestamp: createdAt,
        completed: true,
      },
      {
        key: "processing",
        title: "Preparing pickup",
        description: "The store is preparing your order for collection.",
        timestamp: processingAt,
        completed: ["processing", "delivered"].includes(order.status),
      },
      {
        key: "ready",
        title: "Ready for collection",
        description: "Your order is ready to collect from the pickup location.",
        timestamp: pickup.readyAt,
        completed: ["ready", "collected"].includes(pickup.status || "scheduled"),
      },
      {
        key: "collected",
        title: "Collected",
        description: "The order has been collected.",
        timestamp: pickup.collectedAt,
        completed: pickup.status === "collected",
      },
      ...(order.status === "cancelled"
        ? [
            {
              key: "cancelled",
              title: "Cancelled",
              description: "This order was cancelled.",
              timestamp: cancelledAt || order.updatedAt,
              completed: true,
            },
          ]
        : []),
      ...(order.status === "delivered"
        ? buildReturnTrackingEvents(returnRequests)
        : []),
    ];
  }

  return [
    {
      key: "placed",
      title: "Order placed",
      description: "We received your order and started checking the details.",
      timestamp: createdAt,
      completed: true,
    },
    {
      key: "processing",
      title: "Processing",
      description: "Your items are being prepared for fulfillment.",
      timestamp: processingAt,
      completed: ["processing", "shipped", "delivered"].includes(order.status),
    },
    {
      key: "shipped",
      title: "In transit",
      description: order.carrier
        ? `Handed over to ${order.carrier}.`
        : "Your package is on its way.",
      timestamp: shippedAt,
      completed: ["shipped", "delivered"].includes(order.status),
    },
    {
      key: "delivered",
      title: "Delivered",
      description: "The order has reached the delivery address.",
      timestamp: deliveredAt,
      completed: order.status === "delivered",
    },
    ...(order.status === "cancelled"
      ? [
          {
            key: "cancelled",
            title: "Cancelled",
            description: "This order was cancelled.",
            timestamp: cancelledAt || order.updatedAt,
            completed: true,
          },
        ]
      : []),
    ...(order.status === "delivered"
      ? buildReturnTrackingEvents(returnRequests)
      : []),
  ];
}

/**
 * What the website's tracker shows a guest of the order they found: contacts
 * masked, the consignments without the sellers' economics, the courier's
 * scans, returns on the timeline. Never the billing address, the shopper's
 * note or anything staff-only.
 */
export async function buildGuestTrackingView(found: TrackedOrder) {
  const order = found as TimelineOrder;
  const returnRequests = await ReturnRequest.find({
    orderId: order._id,
    status: {
      $in: [
        RETURN_STATUS.APPROVED,
        RETURN_STATUS.AWAITING_SHIPMENT,
        RETURN_STATUS.IN_TRANSIT,
        RETURN_STATUS.RECEIVED,
        RETURN_STATUS.INSPECTED,
        RETURN_STATUS.REFUND_PENDING,
        RETURN_STATUS.REFUNDED,
        RETURN_STATUS.PARTIALLY_REFUNDED,
      ],
    },
  })
    .select(
      "returnNumber status refundStatus requestedAt approvedAt receivedAt inspectedAt refundedAt closedAt updatedAt",
    )
    .sort({ requestedAt: 1, createdAt: 1 })
    .lean<LeanReturnRequest[]>();

  // The courier's scan history and its "track this parcel" link live on the
  // shipment, never on the order. Without them this page could only ever show
  // its four coarse steps while the carrier had already reported five scans.
  // Shared with the signed-in order screen so the two cannot drift over what
  // a customer is allowed to see of a parcel.
  const tracking = await loadOrderShipmentTracking({
    orderId: order._id,
    trackingNumber: order.trackingNumber,
    carrier: order.carrier,
  });

  // Consignments, and only on split orders. `sanitizeOrderForCustomer` is the
  // same view the signed-in order page renders from, so the two screens
  // cannot disagree about who is shipping what, and it returns nothing for
  // the single-seller majority where the order-level fields say it all.
  const { subOrders: consignments } = await sanitizeOrderForCustomer(
    order as unknown as Parameters<typeof sanitizeOrderForCustomer>[0],
  );

  const customer = order.customerId;
  const shippingAddress = order.shippingAddress || {};
  const pickup =
    order.fulfillment?.method === "pickup" ? order.fulfillment.pickup : undefined;

  return {
    id: String(order._id),
    orderNumber: order.orderNumber,
    customerName: trackedCustomerName(order),
    maskedEmail: maskEmail(customer?.email),
    maskedPhone: maskPhone(customer?.phone || shippingAddress.phone),
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    trackingUrl: tracking.primary.trackingUrl,
    trackingEvents: tracking.primary.events,
    // A failed attempt or a return leaves the order's status alone by
    // design, so this is the only thing on the page that can say delivery
    // has gone wrong.
    trackingException: tracking.primary.exception,
    // Empty on a single-seller order — the fields above already describe its
    // one parcel, and a one-row "shipments" section would be noise.
    shipments: consignments.map((consignment) => {
      const parcel = tracking.forTrackingNumber(
        consignment.trackingNumber,
        consignment.carrier,
      );
      return {
        vendorName: consignment.vendorName,
        status: consignment.status,
        carrier: consignment.carrier || parcel.carrierName,
        trackingNumber: consignment.trackingNumber,
        trackingUrl: parcel.trackingUrl,
        shippedAt: consignment.shippedAt,
        deliveredAt: consignment.deliveredAt,
        itemIndexes: consignment.itemIndexes,
        events: parcel.events,
        exception: parcel.exception,
      };
    }),
    placedAt: order.createdAt,
    updatedAt: order.updatedAt,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost || 0,
    tax: order.tax || 0,
    discount: order.discount || 0,
    total: order.total,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    items: order.items.map((item) => ({
      name: item.name,
      sku: item.sku,
      price: item.price,
      quantity: item.quantity,
      image: item.image,
    })),
    shippingAddress: {
      name: trackedCustomerName(order),
      street: shippingAddress.street,
      apartment: shippingAddress.apartment,
      city: shippingAddress.city,
      state: shippingAddress.state,
      postalCode: shippingAddress.postalCode,
      country: shippingAddress.country,
      phone: maskPhone(shippingAddress.phone),
    },
    pickup: pickup
      ? {
          pickupAddress: pickup.pickupAddress,
          instructions: pickup.instructions,
          timeZone: pickup.timeZone,
          startAt: pickup.startAt,
          endAt: pickup.endAt,
          status: pickup.status,
        }
      : undefined,
    timeline: buildTrackingEvents(order, returnRequests),
  };
}
