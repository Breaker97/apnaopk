/**
 * Order Email Notifications
 * Functions to send order-related emails
 */

import { sendEmail } from "@/lib/email/email";
import type { ISettings } from "@/models/settings.model";
import {
  orderConfirmationTemplate,
  orderStatusUpdateTemplate,
  type OrderStatusEmailData,
} from "@/lib/email/email-templates";
import { trackingUrlForOrder } from "@/lib/orders/order-shipment-view";
import { generateInvoicePdf } from "@/lib/orders/invoice-pdf";
import type { InvoiceData } from "@/lib/orders/invoice-pdf";
import { format, addDays } from "date-fns";
import { DEFAULT_CURRENCY, DEFAULT_STORE_NAME } from "@/config/branding.config";
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
 * Build invoice data from order and settings
 */
function buildInvoiceFromOrder(
  order: OrderData,
  settings?: ISettings
): InvoiceData {
  const currency = settings?.general?.defaultCurrency || DEFAULT_CURRENCY;
  const storeName = settings?.general?.storeName || DEFAULT_STORE_NAME;
  const storeEmail = settings?.general?.storeEmail || "";
  const storePhone = settings?.general?.storePhone || "";
  const storeAddress = settings?.general?.storeAddress || "";
  const logoUrl = settings?.general?.logoUrl || "";

  const now = new Date();

  return {
    invoiceNumber: order.orderNumber,
    status: "Paid",
    dateCreated: format(now, "dd MMM yyyy"),
    dueDate: format(addDays(now, 30), "dd MMM yyyy"),
    from: {
      name: storeName,
      street: storeAddress,
      city: "",
      postalCode: "",
      country: "",
      phone: storePhone,
      email: storeEmail || undefined,
    },
    to: {
      name: order.customerName || order.shippingAddress.fullName || "",
      street: order.shippingAddress.street,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
      phone: order.shippingAddress.phone,
      email: order.customerEmail || undefined,
    },
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.price,
      total: item.price * item.quantity,
    })),
    subtotal: order.subtotal,
    shipping: order.shipping,
    discount: order.discount || 0,
    tax: order.tax,
    total: order.total,
    currency,
    supportEmail: storeEmail || undefined,
    logoUrl: logoUrl || undefined,
    storeName,
  };
}

/**
 * Send order confirmation email to customer with invoice PDF attached
 */
export async function sendOrderConfirmationEmail(
  order: OrderData,
  settings?: ISettings
): Promise<boolean> {
  // Digital orders get a "downloads ready" card. Resolved here (not at the 8
  // gateway call sites) via the order number so every finalizer benefits;
  // any failure just omits the card.
  let downloadsUrl: string | undefined;
  try {
    // `items.vendorId` and the sub-order payment fields are not decoration:
    // entitlement is per consignment, and without them every item on a split
    // order reads as belonging to an unpaid vendor.
    const saved = await Order.findOne({ orderNumber: order.orderNumber })
      .select(
        "_id items.productId items.vendorId paymentStatus subOrders.vendorId subOrders.status subOrders.paymentStatus",
      )
      .lean();
    if (
      saved &&
      isOrderEntitledToDownloads(saved) &&
      (await orderHasDigitalItems(saved))
    ) {
      const baseUrl = (
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
      ).replace(/\/$/, "");
      downloadsUrl = `${baseUrl}/en/account/orders/${saved._id}`;
    }
  } catch (error) {
    console.error("Failed to resolve digital downloads for email:", error);
  }

  const html = orderConfirmationTemplate({ ...order, downloadsUrl }, {
    currency: settings?.general?.defaultCurrency,
    storeName: settings?.general?.storeName,
    logoUrl: settings?.general?.logoUrl,
  });

  // Generate invoice PDF attachment
  let attachments;
  try {
    const invoiceData = buildInvoiceFromOrder(order, settings);
    const pdfBuffer = await generateInvoicePdf(invoiceData);
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

/**
 * Send order status update email to customer
 */
async function sendOrderStatusUpdateEmail(
  order: OrderStatusEmailData & { customerEmail: string },
  settings?: ISettings
): Promise<boolean> {
  const subject =
    STATUS_EMAIL_SUBJECTS[order.newStatus] || `Order Update - ${order.orderNumber}`;

  return sendEmail({
    to: order.customerEmail,
    subject: `${subject} - ${order.orderNumber}`,
    html: orderStatusUpdateTemplate(order),
    settings,
  });
}

/**
 * Send the status email for an order we only have the id of.
 *
 * This is the bridge that was missing: `sendOrderStatusUpdateEmail` existed but
 * had no caller anywhere, because every status-change site holds an order id
 * and not the assembled email payload — so the "your order shipped, here is the
 * tracking number" email was never actually sent. The tracking number is read
 * back from the order at send time so a carrier that stamped it moments earlier
 * is reflected.
 *
 * Returns false rather than throwing: a failed email must never roll back the
 * status change that triggered it.
 */
export async function sendOrderStatusEmailForOrder(params: {
  orderId: string;
  status: string;
  /**
   * The recipient. Required: an order stores only a `customerId`, so the
   * address has to be resolved by whoever already loaded the user — which
   * every caller of `notifyOrderStatus` has.
   */
  customerEmail: string;
  settings?: ISettings;
}): Promise<boolean> {
  try {
    const customerEmail = params.customerEmail?.trim();
    if (!customerEmail) return false;

    const order = await Order.findById(params.orderId)
      .select(
        "orderNumber trackingNumber carrier subOrders.trackingNumber subOrders.carrier",
      )
      .lean<{
        _id: unknown;
        orderNumber?: string;
        trackingNumber?: string;
        carrier?: string;
        subOrders?: Array<{ trackingNumber?: string; carrier?: string }>;
      } | null>();
    if (!order?.orderNumber) return false;

    // On a split order the order-level fields are a summary of the most recent
    // shipment; prefer them, but fall back to the first sub-order that has one
    // so a vendor-driven shipment is not reported as untracked.
    const subOrderWithTracking = order.subOrders?.find((sub) => sub.trackingNumber);
    const trackingNumber = order.trackingNumber || subOrderWithTracking?.trackingNumber;
    const carrier = order.carrier || subOrderWithTracking?.carrier;

    // The template has always had a "Track your parcel" button; nothing ever
    // filled in the link, so every shipped email went out with a bare AWB and
    // left the customer to find the courier's site themselves. The URL lives
    // on the shipment — the order never learns it.
    const trackingUrl = await trackingUrlForOrder({
      orderId: order._id,
      trackingNumber,
      carrier,
    }).catch(() => undefined);

    return await sendOrderStatusUpdateEmail(
      {
        orderNumber: order.orderNumber,
        orderId: String(order._id),
        customerEmail,
        newStatus: params.status,
        trackingNumber,
        trackingUrl,
        carrier,
      },
      params.settings,
    );
  } catch (error) {
    console.error("Failed to send order status email:", error);
    return false;
  }
}

