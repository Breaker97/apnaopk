import { sendEmail } from "@/lib/email/email";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import type { ISettings } from "@/models/settings.model";
import { escapeHtml } from "@/lib/email/escape-html";

/** Why the shopper was given store credit, in words (R8). */
const REASON_LINES: Record<StoreCreditEmailReason, string> = {
  return_refund: "Your return was refunded as store credit.",
  order_refund: "Your refund was given as store credit.",
  order_refund_restore:
    "The store credit you paid with has been given back to you.",
  goodwill: "The store has given you store credit.",
};

export type StoreCreditEmailReason =
  | "return_refund"
  | "order_refund"
  | "order_refund_restore"
  | "goodwill";

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount);
}

/**
 * "You have store credit": how much, when it expires if it does, and where to
 * see it. Sent when credit is given — by a refund, or by the store (R8).
 */
export async function sendStoreCreditIssuedEmail(
  data: {
    to: string;
    customerName?: string;
    amount: number;
    currency: string;
    expiresAt?: Date | null;
    reason: StoreCreditEmailReason;
    /** The store's note, when it gave the credit itself. */
    note?: string;
    accountUrl: string;
  },
  settings?: ISettings,
  /** See `sendEmail`. */
  dedupeKey?: string,
) {
  const storeName = settings?.general?.storeName || DEFAULT_STORE_NAME;
  const amount = formatMoney(data.amount, data.currency);
  const paragraph = (text: string) =>
    `<p style="margin:0 0 16px; color:#52525b; font-size:15px; line-height:1.6;">${escapeHtml(text)}</p>`;
  const expiry = data.expiresAt
    ? `Use it by ${new Date(data.expiresAt).toLocaleDateString("en", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}.`
    : "It doesn't expire.";

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You have ${escapeHtml(amount)} in store credit</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:Arial, sans-serif; color:#18181b;">
  <div style="max-width:600px; margin:0 auto; padding:24px;">
    <div style="text-align:center; padding:16px 0; font-size:24px; font-weight:700;">
      ${escapeHtml(storeName)}
    </div>
    <div style="background:#fff; border-radius:8px; padding:28px; box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <p style="margin:0 0 16px; color:#52525b; font-size:14px;">Hi ${escapeHtml(data.customerName || "there")},</p>
      <h1 style="font-size:20px; margin:0 0 8px;">You have ${escapeHtml(amount)} in store credit</h1>
      ${paragraph(REASON_LINES[data.reason])}
      ${data.note ? paragraph(data.note) : ""}
      ${paragraph(`It's spent automatically when you choose it at checkout, on orders in ${data.currency}. ${expiry}`)}
      <div style="height:1px; background:#e4e4e7; margin:8px 0 24px;"></div>
      <a href="${escapeHtml(data.accountUrl)}" style="display:inline-block; padding:12px 18px; background:#18181b; color:#ffffff; text-decoration:none; border-radius:6px; font-size:14px; font-weight:600;">See your store credit</a>
    </div>
  </div>
</body>
</html>`;

  return sendEmail({
    to: data.to,
    subject: `You have ${amount} in store credit`,
    html,
    settings,
    dedupeKey,
  });
}
