import { sendEmail } from "@/lib/email/email";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import type { ISettings } from "@/models/settings.model";
import { escapeHtml } from "@/lib/email/escape-html";

type ReturnRequestEmailItem = {
  name: string;
  quantity: number;
  unitPrice: number;
};

type ReturnRequestOwnerEmailData = {
  to: string;
  recipientName: string;
  returnNumber: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string;
  reason: string;
  customerNote?: string;
  items: ReturnRequestEmailItem[];
  estimatedRefundTotal: number;
  currency: string;
  dashboardUrl: string;
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

export async function sendReturnRequestOwnerEmail(
  data: ReturnRequestOwnerEmailData,
  settings?: ISettings,
  /** See `sendEmail`. */
  dedupeKey?: string,
) {
  const storeName = settings?.general?.storeName || DEFAULT_STORE_NAME;
  const itemsHtml = data.items
    .map(
      (item) => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee;">
            <strong>${escapeHtml(item.name)}</strong>
          </td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: center;">
            ${item.quantity}
          </td>
          <td style="padding: 10px 0; border-bottom: 1px solid #eee; text-align: right;">
            ${formatMoney(item.unitPrice * item.quantity, data.currency)}
          </td>
        </tr>`,
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New return request - ${escapeHtml(data.returnNumber)}</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:Arial, sans-serif; color:#18181b;">
  <div style="max-width:600px; margin:0 auto; padding:24px;">
    <div style="text-align:center; padding:16px 0; font-size:24px; font-weight:700;">
      ${escapeHtml(storeName)}
    </div>
    <div style="background:#fff; border-radius:8px; padding:28px; box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <h1 style="font-size:20px; margin:0 0 8px;">New return request</h1>
      <p style="margin:0 0 20px; color:#71717a;">
        ${escapeHtml(data.customerName)} submitted a return request for order #${escapeHtml(data.orderNumber)}.
      </p>

      <p style="margin:0 0 4px; color:#71717a; font-size:14px;">Return Number</p>
      <p style="margin:0 0 16px; font-size:18px; font-weight:600;">${escapeHtml(data.returnNumber)}</p>

      <p style="margin:0 0 4px; color:#71717a; font-size:14px;">Customer</p>
      <p style="margin:0 0 16px;">
        ${escapeHtml(data.customerName)}${data.customerEmail ? ` (${escapeHtml(data.customerEmail)})` : ""}
      </p>

      <p style="margin:0 0 4px; color:#71717a; font-size:14px;">Reason</p>
      <p style="margin:0 0 16px;">${escapeHtml(data.reason)}</p>

      ${
        data.customerNote
          ? `<p style="margin:0 0 4px; color:#71717a; font-size:14px;">Customer note</p>
      <p style="margin:0 0 16px;">${escapeHtml(data.customerNote)}</p>`
          : ""
      }

      <table style="width:100%; border-collapse:collapse; margin-top:8px;">
        <thead>
          <tr>
            <th style="text-align:left; padding-bottom:8px; color:#71717a; font-size:13px;">Item</th>
            <th style="text-align:center; padding-bottom:8px; color:#71717a; font-size:13px;">Qty</th>
            <th style="text-align:right; padding-bottom:8px; color:#71717a; font-size:13px;">Refund</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <div style="display:flex; justify-content:space-between; margin-top:18px; font-weight:700;">
        <span>Estimated refund</span>
        <span>${formatMoney(data.estimatedRefundTotal, data.currency)}</span>
      </div>
    </div>
    <div style="text-align:center; padding:24px 0;">
      <a href="${data.dashboardUrl}" style="display:inline-block; background:#18181b; color:#fff; text-decoration:none; padding:12px 20px; border-radius:6px; font-weight:600;">
        Review return
      </a>
    </div>
    <p style="text-align:center; color:#71717a; font-size:12px;">
      You are receiving this because this return request contains your products.
    </p>
  </div>
</body>
</html>`;

  return sendEmail({
    to: data.to,
    subject: `New return request - ${data.returnNumber}`,
    html,
    settings,
    dedupeKey,
  });
}
