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
  /**
   * The parts between the items' value and the refund — discount, tax,
   * delivery and fees — so the lines add up to the total. The column used to
   * read "Refund" over the gross price of each line, and the figures never
   * met the total beneath them.
   */
  estimate?: {
    discountAdjustment?: number;
    tax?: number;
    shipping?: number;
    restockingFee?: number;
    returnShippingFee?: number;
  };
  currency: string;
  dashboardUrl: string;
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

/** The discount, tax, delivery and fees between the items and the refund. */
function estimateRowsHtml(data: ReturnRequestOwnerEmailData): string {
  const parts = data.estimate;
  if (!parts) return "";
  const rows: Array<[string, number, boolean]> = [
    ["Discount applied at checkout", Number(parts.discountAdjustment || 0), true],
    ["Tax", Number(parts.tax || 0), false],
    ["Delivery charge", Number(parts.shipping || 0), false],
    ["Restocking fee", Number(parts.restockingFee || 0), true],
    ["Return shipping", Number(parts.returnShippingFee || 0), true],
  ];
  return rows
    .filter(([, value]) => value > 0)
    .map(
      ([label, value, negative]) => `
      <div style="display:flex; justify-content:space-between; margin-top:8px; color:#71717a; font-size:14px;">
        <span>${label}</span>
        <span>${negative ? "−" : ""}${formatMoney(value, data.currency)}</span>
      </div>`,
    )
    .join("");
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
            <th style="text-align:right; padding-bottom:8px; color:#71717a; font-size:13px;">Value</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      ${estimateRowsHtml(data)}

      <div style="display:flex; justify-content:space-between; margin-top:18px; font-weight:700;">
        <span>Estimated refund</span>
        <span>${formatMoney(data.estimatedRefundTotal, data.currency)}</span>
      </div>
    </div>
    <div style="text-align:center; padding:24px 0;">
      <a href="${escapeHtml(data.dashboardUrl)}" style="display:inline-block; background:#18181b; color:#fff; text-decoration:none; padding:12px 20px; border-radius:6px; font-weight:600;">
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

type ReturnApprovedEmailData = {
  to: string;
  customerName: string;
  returnNumber: string;
  orderNumber: string;
  /** How the parcel comes back — see lib/returns/return-shipping.ts. */
  method: "label" | "customer_ships" | "no_shipping";
  /** Where to send it, when there is a parcel to send. */
  destination?: { name?: string | null; address?: string | null } | null;
  /** The instructions with the return number already filled in. */
  instructions?: string;
  /** The label itself when the store linked to one, else the order page. */
  labelLink?: string;
  orderUrl: string;
  /**
   * The shopper has no account: `orderUrl` is the public tracking page, which
   * shows the order but not the return's address or label.
   */
  guest?: boolean;
  /**
   * Why it is sent: the return was approved, the store changed how the parcel
   * comes back, or the store opened the return for the shopper.
   */
  variant?: "approved" | "updated" | "opened";
};

/**
 * The shopper's "your return is approved" email, with what they now need: where
 * the parcel goes, what to do, and the label if the store gave one. The generic
 * notice said only that it was approved, which left every shopper asking.
 */
export async function sendReturnApprovedEmail(
  data: ReturnApprovedEmailData,
  settings?: ISettings,
  /** See `sendEmail`. */
  dedupeKey?: string,
) {
  const storeName = settings?.general?.storeName || DEFAULT_STORE_NAME;
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px; color:#52525b; font-size:15px; line-height:1.6;">${escapeHtml(text)}</p>`;
  const button = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block; padding:12px 18px; background:#18181b; color:#ffffff; text-decoration:none; border-radius:6px; font-size:14px; font-weight:600;">${escapeHtml(label)}</a>`;

  const destinationHtml =
    data.method !== "no_shipping" && (data.destination?.name || data.destination?.address)
      ? `<p style="margin:0 0 4px; color:#71717a; font-size:14px;">Send it to</p>
      <p style="margin:0 0 16px; font-size:15px; line-height:1.5; color:#18181b;">
        ${data.destination?.name ? `<strong>${escapeHtml(data.destination.name)}</strong><br />` : ""}
        ${escapeHtml(data.destination?.address || "")}
      </p>`
      : "";

  const body =
    data.method === "no_shipping"
      ? paragraph("You don't need to send anything back.")
      : [
          data.method === "label"
            ? paragraph(
                data.labelLink || !data.guest
                  ? "Your return label is ready. Print it, stick it on the parcel and hand it to the carrier."
                  : "Your return label is ready. Contact us and we'll send it to you.",
              )
            : "",
          destinationHtml,
          data.instructions ? paragraph(data.instructions) : "",
        ].join("");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your return is approved - ${escapeHtml(data.returnNumber)}</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:Arial, sans-serif; color:#18181b;">
  <div style="max-width:600px; margin:0 auto; padding:24px;">
    <div style="text-align:center; padding:16px 0; font-size:24px; font-weight:700;">
      ${escapeHtml(storeName)}
    </div>
    <div style="background:#fff; border-radius:8px; padding:28px; box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <p style="margin:0 0 16px; color:#52525b; font-size:14px;">Hi ${escapeHtml(data.customerName || "there")},</p>
      <h1 style="font-size:20px; margin:0 0 8px;">${
        data.variant === "updated"
          ? "How to send your return back"
          : data.variant === "opened"
            ? "We opened a return for you"
            : "Your return is approved"
      }</h1>
      ${paragraph(
        data.variant === "updated"
          ? `The store updated the details for return ${data.returnNumber} on order #${data.orderNumber}.`
          : data.variant === "opened"
            ? `We opened return ${data.returnNumber} for order #${data.orderNumber}, as you asked.`
            : `Return ${data.returnNumber} for order #${data.orderNumber} is approved.`,
      )}
      ${body}
      <div style="height:1px; background:#e4e4e7; margin:8px 0 24px;"></div>
      ${
        data.method === "label" && data.labelLink
          ? button(data.labelLink, "Get your return label")
          : button(data.orderUrl, data.guest ? "Track your order" : "View your return")
      }
    </div>
  </div>
</body>
</html>`;

  return sendEmail({
    to: data.to,
    subject:
      data.variant === "updated"
        ? `How to send back ${data.returnNumber}`
        : data.variant === "opened"
          ? `Your return ${data.returnNumber} is open`
          : `Your return is approved - ${data.returnNumber}`,
    html,
    settings,
    dedupeKey,
  });
}
