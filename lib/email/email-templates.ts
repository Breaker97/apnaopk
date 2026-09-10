/**
 * Email Templates
 * HTML email templates for order notifications
 */

import { getAppName } from "@/lib/email/email";
import { formatCurrency } from "@/lib/intl/money";

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

interface OrderEmailData {
  orderNumber: string;
  customerName: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  discount?: number;
  tax: number;
  total: number;
  shippingAddress: ShippingAddress;
  paymentMethod: string;
  status?: string;
  trackingNumber?: string;
  /** Set when the order includes digital files — renders a downloads card. */
  downloadsUrl?: string;
}

const baseStyles = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .card { background: white; border-radius: 8px; padding: 32px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .header { text-align: center; padding: 20px 0; }
  .logo { font-size: 24px; font-weight: bold; color: #18181b; }
  .title { font-size: 20px; font-weight: 600; color: #18181b; margin: 0 0 8px 0; }
  .subtitle { color: #71717a; font-size: 14px; margin: 0; }
  .divider { height: 1px; background: #e4e4e7; margin: 20px 0; }
  .item-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f4f4f5; }
  .item-image { width: 60px; height: 60px; background: #f4f4f5; border-radius: 6px; object-fit: cover; }
  .item-details { flex: 1; }
  .item-name { font-weight: 500; color: #18181b; margin: 0 0 4px 0; }
  .item-qty { color: #71717a; font-size: 14px; }
  .item-price { font-weight: 500; color: #18181b; }
  .summary-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
  .summary-label { color: #71717a; }
  .summary-value { color: #18181b; }
  .total-row { display: flex; justify-content: space-between; padding: 12px 0; font-size: 16px; font-weight: 600; border-top: 1px solid #e4e4e7; margin-top: 8px; }
  .address-box { background: #f4f4f5; padding: 16px; border-radius: 6px; font-size: 14px; line-height: 1.6; }
  .status-badge { display: inline-block; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; text-transform: uppercase; }
  .status-pending { background: #fef3c7; color: #92400e; }
  .status-processing { background: #dbeafe; color: #1e40af; }
  .status-shipped { background: #d1fae5; color: #065f46; }
  .status-delivered { background: #dcfce7; color: #166534; }
  .status-cancelled { background: #fee2e2; color: #991b1b; }
  .button { display: inline-block; padding: 12px 24px; background: #18181b; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; }
  .footer { text-align: center; padding: 20px; color: #71717a; font-size: 12px; }
`;

function formatPrice(amount: number, currency: string, locale?: string): string {
  return formatCurrency(amount, currency, locale);
}

function getStatusClass(status: string): string {
  const statusMap: Record<string, string> = {
    pending: "status-pending",
    processing: "status-processing",
    shipped: "status-shipped",
    delivered: "status-delivered",
    cancelled: "status-cancelled",
  };
  return statusMap[status] || "status-pending";
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "Order Placed",
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  return labels[status] || status;
}

type EmailTemplateOptions = {
  currency?: string;
  locale?: string;
  storeName?: string;
  logoUrl?: string;
};

/**
 * Emails need absolute URLs: local-storage uploads are root-relative
 * ("/uploads/…"), which email clients would resolve against nothing.
 */
function absoluteAssetUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:)/i.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

/**
 * Order Confirmation Email
 */
export function orderConfirmationTemplate(
  data: OrderEmailData,
  options?: EmailTemplateOptions,
): string {
  const appName = options?.storeName || getAppName();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const currency = (options?.currency || "USD").toUpperCase();
  const locale = options?.locale;

  const itemsHtml = data.items
    .map(
      (item) => `
    <div style="display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #f4f4f5;">
      <div style="flex: 1;">
        <p style="font-weight: 500; color: #18181b; margin: 0 0 4px 0;">${
          item.name
        }</p>
        <p style="color: #71717a; font-size: 14px; margin: 0;">Qty: ${
          item.quantity
        }</p>
      </div>
      <p style="font-weight: 500; color: #18181b; margin: 0;">${formatPrice(
        item.price * item.quantity,
        currency,
        locale,
      )}</p>
    </div>
  `
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmation - ${data.orderNumber}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${absoluteAssetUrl(options?.logoUrl) ? `<img src="${absoluteAssetUrl(options?.logoUrl)}" alt="${appName}" style="max-height: 40px; max-width: 180px;" />` : `<div class="logo">${appName}</div>`}
    </div>

    <div class="card">
      <h1 class="title">Thank you for your order! 🎉</h1>
      <p class="subtitle">We've received your order and are getting it ready.</p>

      <div class="divider"></div>

      <p style="font-size: 14px; color: #71717a; margin: 0 0 4px 0;">Order Number</p>
      <p style="font-size: 18px; font-weight: 600; color: #18181b; margin: 0 0 20px 0;">${
        data.orderNumber
      }</p>
      
      <h3 style="font-size: 14px; font-weight: 600; color: #18181b; margin: 0 0 12px 0;">Order Summary</h3>
      ${itemsHtml}
      
      <div style="margin-top: 16px;">
        <div class="summary-row">
          <span class="summary-label">Subtotal</span>
          <span class="summary-value">${formatPrice(
            data.subtotal,
            currency,
            locale,
          )}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">Shipping</span>
          <span class="summary-value">${
            data.shipping === 0
              ? "Free"
              : formatPrice(data.shipping, currency, locale)
          }</span>
        </div>
        ${
          data.discount && data.discount > 0
            ? `<div class="summary-row">
          <span class="summary-label">Discount</span>
          <span class="summary-value">-${formatPrice(data.discount, currency, locale)}</span>
        </div>`
            : ""
        }
        <div class="summary-row">
          <span class="summary-label">Tax</span>
          <span class="summary-value">${formatPrice(data.tax, currency, locale)}</span>
        </div>
        <div class="total-row">
          <span>Total</span>
          <span>${formatPrice(data.total, currency, locale)}</span>
        </div>
      </div>
    </div>
    
    <div class="card">
      <h3 style="font-size: 14px; font-weight: 600; color: #18181b; margin: 0 0 12px 0;">Shipping Address</h3>
      <div class="address-box">
        <strong>${data.shippingAddress.fullName || data.customerName || ""}</strong><br>
        ${data.shippingAddress.street}<br>
        ${data.shippingAddress.city}, ${data.shippingAddress.state || ""} ${
    data.shippingAddress.postalCode
  }<br>
        ${data.shippingAddress.country}
        ${
          data.shippingAddress.phone
            ? `<br>Phone: ${data.shippingAddress.phone}`
            : ""
        }
      </div>

      <div class="divider"></div>

      <p style="font-size: 14px; color: #71717a; margin: 0 0 4px 0;">Payment Method</p>
      <p style="font-size: 14px; color: #18181b; margin: 0; text-transform: capitalize;">${
        data.paymentMethod
      }</p>
    </div>
    
    ${
      data.downloadsUrl
        ? `<div class="card">
      <h3 style="font-size: 14px; font-weight: 600; color: #18181b; margin: 0 0 8px 0;">Your downloads are ready 📥</h3>
      <p style="font-size: 14px; color: #71717a; margin: 0 0 16px 0;">This order includes digital files. Download them anytime from your order page.</p>
      <a href="${data.downloadsUrl}" class="button">Download your files</a>
    </div>`
        : ""
    }

    <div style="text-align: center; padding: 20px 0;">
      <a href="${appUrl}/en/account/orders/${data.orderNumber}" class="button">View Order Details</a>
    </div>

    <div class="footer">
      <p>You're receiving this email because you placed an order at ${appName}.</p>
      <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Order Status Update Email
 */
/**
 * Everything the status email actually renders.
 *
 * It used to be typed as the full `OrderEmailData`, which demanded line items,
 * totals and an address it never printed — enough friction that the only
 * function able to build one was never called. Asking for what it uses is what
 * lets a courier webhook send this email with the order id it already has.
 */
export interface OrderStatusEmailData {
  orderNumber: string;
  /** Used for the deep link; falls back to the orders list when absent. */
  orderId?: string;
  newStatus: string;
  trackingNumber?: string;
  /** The carrier's own tracking page, when the carrier gave us one. */
  trackingUrl?: string;
  carrier?: string;
}

export function orderStatusUpdateTemplate(data: OrderStatusEmailData): string {
  const appName = getAppName();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const statusMessages: Record<string, { title: string; message: string }> = {
    processing: {
      title: "Your order is being prepared! 📦",
      message:
        "We're preparing your order for shipment. You'll receive another email when it ships.",
    },
    shipped: {
      title: "Your order is on its way! 🚚",
      message:
        "Great news! Your order has been shipped and is on its way to you.",
    },
    delivered: {
      title: "Your order has been delivered! ✅",
      message:
        "Your order has been delivered. We hope you enjoy your purchase!",
    },
    cancelled: {
      title: "Your order has been cancelled",
      message:
        "Your order has been cancelled. If you have any questions, please contact support.",
    },
  };

  const statusInfo = statusMessages[data.newStatus] || {
    title: "Order Status Update",
    message: `Your order status has been updated to: ${data.newStatus}`,
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Update - ${data.orderNumber}</title>
  <style>${baseStyles}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">${appName}</div>
    </div>
    
    <div class="card">
      <h1 class="title">${statusInfo.title}</h1>
      <p class="subtitle">${statusInfo.message}</p>
      
      <div class="divider"></div>
      
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div>
          <p style="font-size: 14px; color: #71717a; margin: 0 0 4px 0;">Order Number</p>
          <p style="font-size: 16px; font-weight: 600; color: #18181b; margin: 0;">${
            data.orderNumber
          }</p>
        </div>
        <span class="status-badge ${getStatusClass(
          data.newStatus
        )}">${getStatusLabel(data.newStatus)}</span>
      </div>
      
      ${
        data.trackingNumber
          ? `
      <div style="background: #f0fdf4; padding: 16px; border-radius: 6px; margin-top: 16px;">
        <p style="font-size: 14px; color: #166534; margin: 0 0 4px 0;">Tracking Number${
          data.carrier ? ` &middot; ${data.carrier}` : ""
        }</p>
        <p style="font-size: 16px; font-weight: 600; color: #166534; margin: 0;">${data.trackingNumber}</p>
        ${
          data.trackingUrl
            ? `<p style="margin: 12px 0 0 0;"><a href="${data.trackingUrl}" style="color: #166534; font-weight: 600;">Track your parcel</a></p>`
            : ""
        }
      </div>
      `
          : ""
      }
    </div>

    <div style="text-align: center; padding: 20px 0;">
      <a href="${appUrl}/en/account/orders${
        data.orderId ? `/${data.orderId}` : ""
      }" class="button">View Order Details</a>
    </div>

    <div class="footer">
      <p>You're receiving this email because you placed an order at ${appName}.</p>
      <p>&copy; ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;
}

