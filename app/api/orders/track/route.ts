import { connectDB } from "@/lib/db";
import { Order, ReturnRequest } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import { withApi } from "@/lib/api/handler";
import { sanitizeOrderForCustomer } from "@/lib/orders/order-customer-view";
import { loadOrderShipmentTracking } from "@/lib/orders/order-shipment-view";
import { validateOptionalBody } from "@/lib/api/validate";
import { TrackOrderBodySchema } from "@/lib/validations";

type LeanCustomer = {
  name?: string;
  email?: string;
  phone?: string;
};

type LeanOrder = {
  _id: unknown;
  orderNumber: string;
  customerId?: LeanCustomer;
  guestEmail?: string;
  items: Array<{
    name: string;
    sku?: string;
    price: number;
    quantity: number;
    image?: string;
    vendorId?: unknown;
  }>;
  subOrders?: Array<{
    _id?: unknown;
    vendorId?: unknown;
    status?: string;
    paymentStatus?: string | null;
    subtotal?: number;
    shippingCost?: number;
    trackingNumber?: string;
    carrier?: string;
    shippedAt?: Date | null;
    deliveredAt?: Date | null;
    fulfillment?: unknown;
  }> | null;
  shippingAddress: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    street?: string;
    apartment?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  };
  paymentStatus: string;
  paymentMethod: string;
  status: string;
  trackingNumber?: string;
  carrier?: string;
  subtotal: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total: number;
  fulfillment?: {
    method?: "delivery" | "pickup";
    pickup?: {
      pickupAddress?: string;
      instructions?: string;
      timeZone?: string;
      startAt?: Date;
      endAt?: Date;
      status?: "scheduled" | "ready" | "collected";
      readyAt?: Date;
      collectedAt?: Date;
    };
  };
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

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function maskEmail(value?: string) {
  if (!value || !value.includes("@")) return undefined;
  const [name, domain] = value.split("@");
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - 2, 3))}@${domain}`;
}

function maskPhone(value?: string) {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;
}

function getCustomerName(order: LeanOrder) {
  const address = order.shippingAddress;
  const addressName =
    address.fullName ||
    [address.firstName, address.lastName].filter(Boolean).join(" ");
  return addressName || order.customerId?.name || "Customer";
}

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
  order: LeanOrder,
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

export const POST = withApi(
  {},
  async ({ request }) => {
    // Public, unauthenticated endpoint. Order numbers are sequential and the
    // matcher only guards on email/phone, so throttle by IP to prevent
    // brute-forcing a customer's contact details against a known order.
    await rateLimitByIP(request, "strict");

    // An empty or malformed body is routine on a public endpoint — a bot POSTs
    // to it, or the form submits before hydration — and `request.json()` throws
    // an unhandled SyntaxError rather than reporting it. Same answer as a body
    // that parsed but named nothing.
    const body = await validateOptionalBody(request, TrackOrderBodySchema);
    const orderNumber = normalizeText(body.orderNumber || body.orderId);
    const identifier = normalizeText(body.identifier);

    if (!orderNumber || !identifier) {
      throw new ValidationError("Order number and email or phone are required");
    }

    await connectDB();

    // Order numbers are generated fully uppercase, so an exact uppercase match
    // seeks the unique index. The old case-insensitive anchored regex could
    // not use B-tree bounds and scanned the whole index on every lookup — on
    // a public endpoint that was a cheap DoS vector.
    const order = await Order.findOne({
      orderNumber: orderNumber.trim().toUpperCase(),
    })
      .populate("customerId", "name email phone")
      .lean<LeanOrder | null>();

    if (!order) {
      return notFoundResponse("Order");
    }

    const customer = order.customerId;
    const identifierLower = identifier.toLowerCase();
    const normalizedIdentifierPhone = normalizePhone(identifier);
    // Guest orders populate no customer (customerId points at the guest's
    // cart), so their checkout email lives on the order itself.
    const knownEmails = [customer?.email, order.guestEmail]
      .filter(Boolean)
      .map((email) => email!.toLowerCase());
    const knownPhones = [customer?.phone, order.shippingAddress?.phone]
      .filter(Boolean)
      .map((phone) => normalizePhone(phone!));

    const identifierMatches =
      knownEmails.includes(identifierLower) ||
      knownPhones.some((phone) => phone && phone === normalizedIdentifierPhone);

    if (!identifierMatches) {
      return notFoundResponse("Order");
    }

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
    const { subOrders: consignments } = await sanitizeOrderForCustomer(order);

    const shippingAddress = order.shippingAddress || {};
    const pickup =
      order.fulfillment?.method === "pickup" ? order.fulfillment.pickup : undefined;

    return successResponse({
      id: String(order._id),
      orderNumber: order.orderNumber,
      customerName: getCustomerName(order),
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
        name: getCustomerName(order),
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
    });
  },
);
