/**
 * Order Email Notifications
 * Functions to send order-related emails
 */

import { sendEmail } from "@/lib/email/email";
import type { ISettings } from "@/models/settings.model";
import {
  orderConfirmationTemplate,
  orderStatusUpdateTemplate,
} from "@/lib/email/email-templates";
import { trackingUrlForOrder } from "@/lib/orders/order-shipment-view";
import { appBaseUrl } from "@/lib/app-url";
import {
  generateOrderInvoicePdf,
  type OrderInvoiceSource,
} from "@/lib/orders/order-invoice";
import { Order } from "@/models";
import {
  isOrderEntitledToDownloads,
  orderHasDigitalItems,
} from "@/lib/orders/order-digital-downloads";

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
  image?: string;
}

interface ShippingAddress {
  fullName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone?: string;
}

interface OrderData {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  discount?: number;
  total: number;
  shippingAddress: ShippingAddress;
  paymentMethod: string;
}

/**
 * Send order confirmation email to customer with invoice PDF attached
 */
export async function sendOrderConfirmationEmail(
  order: OrderData,
  settings?: ISettings
): Promise<boolean> {
  // The order page is addressed by id, so the button needs the saved order —
  // it used to be built from the order NUMBER, which that page cannot look up,
  // so every confirmation's main button opened an error. A guest has no
  // account page at all; theirs is the public tracking page, which is also
  // the fallback if the lookup below fails.
  let orderUrl = `${appBaseUrl()}/track-order?orderNumber=${encodeURIComponent(order.orderNumber)}`;
  // Digital orders get a "downloads ready" card. Resolved here (not at the 8
  // gateway call sites) via the order number so every finalizer benefits;
  // any failure just omits the card.
  let downloadsUrl: string | undefined;
  // The whole order rather than a projection: the invoice below is rendered
  // from it, and download entitlement is per consignment — a projection that
  // missed a payment field would misstate either one.
  let saved: OrderInvoiceSource | null = null;
  try {
    saved = await Order.findOne({
      orderNumber: order.orderNumber,
    }).lean<OrderInvoiceSource>();
    const accountOrderUrl = saved
      ? `${appBaseUrl()}/account/orders/${saved._id}`
      : undefined;
    if (saved && !saved.guestEmail && accountOrderUrl) orderUrl = accountOrderUrl;
    if (
      saved &&
      isOrderEntitledToDownloads(saved) &&
      (await orderHasDigitalItems(saved))
    ) {
      downloadsUrl = accountOrderUrl;
    }
  } catch (error) {
    console.error("Failed to resolve the order links for email:", error);
  }

  const html = orderConfirmationTemplate({
      ...order,
      // Read off the saved order: the finalizers hand this function their own
      // order shape, and none of them carries the checkout answers.
      customerNote: saved?.customerNote,
      checkoutFields: saved?.checkoutFields,
      orderUrl,
      downloadsUrl,
    }, {
    currency: settings?.general?.defaultCurrency,
    storeName: settings?.general?.storeName,
    logoUrl: settings?.general?.logoUrl,
  });

  // The same invoice the order page downloads. This email used to assemble its
  // own copy and stamp it "Paid" whatever had happened, so a deposit pre-order
  // went out paid in full with no balance on it, and a cash-on-delivery order
  // read paid before any cash had changed hands.
  let attachments;
  if (saved) {
    try {
      const pdfBuffer = await generateOrderInvoicePdf(
        saved,
        settings ?? {},
        order.customerName,
        order.customerEmail,
      );
      attachments = [
        {
          filename: `invoice-${order.orderNumber}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ];
    } catch (error) {
      console.error("Failed to generate invoice PDF for email:", error);
      // Send email without attachment if PDF generation fails
    }
  }

  return sendEmail({
    to: order.customerEmail,
    subject: `Order Confirmed - ${order.orderNumber}`,
    html,
    settings,
    attachments,
  });
}

/** Statuses worth a dedicated email; anything else uses the generic notice. */
const STATUS_EMAIL_SUBJECTS: Record<string, string> = {
  processing: "Order Update - Being Prepared",
  shipped: "Order Shipped - On the Way",
  delivered: "Order Delivered",
  cancelled: "Order Cancelled",
};

export function hasOrderStatusEmail(status: string): boolean {
  return status in STATUS_EMAIL_SUBJECTS;
}

interface OrderTracking {
  trackingNumber?: string;
  carrier?: string;
  /** The carrier's own tracking page, when it gave us one. */
  trackingUrl?: string;
}

/**
 * The parcel an order's customer should be told about: its tracking number,
 * courier and — the part the order itself never learns — the courier's
 * tracking page, which lives on the shipment.
 *
 * On a split order the order-level fields are a summary of the most recent
 * shipment; prefer them, but fall back to the first sub-order that has one so
 * a vendor-driven shipment is not reported as untracked.
 */
export async function resolveOrderTracking(order: {
  _id: unknown;
  trackingNumber?: string;
  carrier?: string;
  subOrders?: Array<{ trackingNumber?: string; carrier?: string }>;
}): Promise<OrderTracking> {
  const subOrderWithTracking = order.subOrders?.find((sub) => sub.trackingNumber);
  const trackingNumber = order.trackingNumber || subOrderWithTracking?.trackingNumber;
  const carrier = order.carrier || subOrderWithTracking?.carrier;
  const trackingUrl = await trackingUrlForOrder({
    orderId: order._id,
    trackingNumber,
    carrier,
  }).catch(() => undefined);
  return { trackingNumber, carrier, trackingUrl };
}

/**
 * Send the purpose-built status email (see `hasOrderStatusEmail`).
 *
 * Resolves true once the email is handed to the outbox — even when its first
 * delivery attempt fails, because the outbox retries it. Answering false
 * there made the notifier send the generic notice as well, and the customer
 * got both once the retry went through.
 */
export async function sendOrderStatusEmail(params: {
  orderNumber: string;
  /** Absolute: the account order page, or the public tracking page for a guest. */
  orderUrl: string;
  status: string;
  customerEmail: string;
  tracking?: OrderTracking;
  settings?: ISettings;
  /** See `sendEmail`. */
  dedupeKey?: string;
}): Promise<boolean> {
  const customerEmail = params.customerEmail.trim();
  if (!customerEmail) return false;

  const subject =
    STATUS_EMAIL_SUBJECTS[params.status] || `Order Update - ${params.orderNumber}`;
  await sendEmail({
    to: customerEmail,
    subject: `${subject} - ${params.orderNumber}`,
    html: orderStatusUpdateTemplate(
      {
        orderNumber: params.orderNumber,
        orderUrl: params.orderUrl,
        newStatus: params.status,
        ...params.tracking,
      },
      {
        storeName: params.settings?.general?.storeName,
        logoUrl: params.settings?.general?.logoUrl,
      },
    ),
    settings: params.settings,
    dedupeKey: params.dedupeKey,
  });
  return true;
}

