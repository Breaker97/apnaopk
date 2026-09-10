import { sendEmail } from "@/lib/email/email";
import { getSettings } from "@/models/settings.model";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { appBaseUrl } from "@/lib/app-url";

/**
 * The two emails a quote request produces: one to the store (this is a lead —
 * go and answer it) and one back to the shopper (we got it — someone will
 * reply). Both are best-effort; the request itself is already stored by the
 * time either is attempted, and the caller ignores the result.
 */

export type QuoteRequestEmailData = {
  quoteId: string;
  productName: string;
  variantName?: string;
  quantity: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string, value?: string) {
  if (!value) return "";
  return `<p style="margin:0 0 6px;font-size:14px;color:#374151;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

export async function sendQuoteRequestEmails(data: QuoteRequestEmailData) {
  try {
    const settings = await getSettings();
    if (!settings.email?.enabled) return;

    const storeName = settings.general?.storeName?.trim() || DEFAULT_STORE_NAME;
    const productLabel = data.variantName
      ? `${data.productName} — ${data.variantName}`
      : data.productName;

    const recipient =
      settings.general?.storeEmail?.trim() ||
      settings.email?.replyTo?.trim() ||
      settings.email?.fromEmail?.trim();

    const jobs: Promise<unknown>[] = [];

    if (recipient) {
      jobs.push(
        sendEmail({
          to: recipient,
          // The shopper's own address, so hitting Reply in the mail client
          // answers the person who asked instead of the store's own inbox.
          replyTo: data.email,
          subject: `[${storeName}] Quote request — ${productLabel}`,
          settings,
          html: `
            <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
              <h2 style="margin:0 0 4px;font-size:20px;">New quote request</h2>
              <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">${escapeHtml(productLabel)} · quantity ${data.quantity}</p>
              ${row("Name", data.name)}
              ${row("Email", data.email)}
              ${row("Phone", data.phone)}
              ${row("Company", data.company)}
              ${
                data.message
                  ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:15px;line-height:1.7;">${escapeHtml(data.message).replace(/\n/g, "<br />")}</div>`
                  : ""
              }
              <p style="margin-top:24px;font-size:14px;">
                <a href="${appBaseUrl()}/admin/quotes" style="color:#2563eb;">Open the Quotes page</a>
              </p>
            </div>`,
          text: [
            `New quote request for ${storeName}`,
            `Product: ${productLabel}`,
            `Quantity: ${data.quantity}`,
            `Name: ${data.name}`,
            `Email: ${data.email}`,
            data.phone ? `Phone: ${data.phone}` : "",
            data.company ? `Company: ${data.company}` : "",
            "",
            data.message || "",
          ]
            .filter(Boolean)
            .join("\n"),
          category: "transactional",
        }),
      );
    }

    jobs.push(
      sendEmail({
        to: data.email,
        replyTo: recipient,
        subject: `${storeName} — we received your quote request`,
        settings,
        html: `
          <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
            <h2 style="margin:0 0 12px;font-size:20px;">Thanks, ${escapeHtml(data.name)}</h2>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
              We have your request for a price on
              <strong>${escapeHtml(productLabel)}</strong> (quantity ${data.quantity}).
              Someone from ${escapeHtml(storeName)} will get back to you with a quote.
            </p>
            <p style="margin:0;color:#6b7280;font-size:13px;">
              You do not need to do anything else — just reply to this email if
              you want to add to your request.
            </p>
          </div>`,
        text: [
          `Thanks, ${data.name}`,
          "",
          `We have your request for a price on ${productLabel} (quantity ${data.quantity}).`,
          `Someone from ${storeName} will get back to you with a quote.`,
        ].join("\n"),
        category: "transactional",
      }),
    );

    await Promise.allSettled(jobs);
  } catch (error) {
    console.error("Failed to send quote request emails:", error);
  }
}
