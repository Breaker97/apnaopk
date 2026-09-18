import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email/email";
import { getSettings } from "@/models/settings.model";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { appBaseUrl } from "@/lib/app-url";
import { formatCurrency } from "@/lib/intl/money";
import { escapeHtml } from "@/lib/email/escape-html";

/**
 * The emails a quote produces: two when it is asked for — one to the store
 * (this is a lead, go and answer it) and one back to the shopper (we got it) —
 * and one when the merchant answers with a price.
 *
 * All best-effort: the request and the offer are both already stored by the
 * time any of them is attempted, and the callers ignore the result. A store
 * with no SMTP configured still works; the shopper sees the price in their
 * account and on the product page either way.
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

function row(label: string, value?: string) {
  if (!value) return "";
  return `<p style="margin:0 0 6px;font-size:14px;color:#374151;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

export async function sendQuoteRequestEmails(data: QuoteRequestEmailData) {
  try {
    const settings = await getSettings();
    if (!isEmailDeliveryConfigured(settings)) return;

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


export type QuoteOfferEmailData = {
  quoteId: string;
  productName: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  name: string;
  email: string;
  note?: string;
  expiresAt?: Date;
};

/**
 * "Here is your price." The one email in this file the shopper is waiting for,
 * so it carries the number, what it covers, and a link straight to the page
 * that can turn it into an order.
 *
 * The link goes to the shopper's own quote page rather than to the product:
 * the price is theirs alone, and that page is where it is explained — total,
 * expiry, and the button that puts it in the cart.
 */
export async function sendQuoteOfferEmail(data: QuoteOfferEmailData) {
  try {
    const settings = await getSettings();
    if (!isEmailDeliveryConfigured(settings)) return;

    const storeName = settings.general?.storeName?.trim() || DEFAULT_STORE_NAME;
    const currency = settings.general?.defaultCurrency || "USD";
    const productLabel = data.variantName
      ? `${data.productName} — ${data.variantName}`
      : data.productName;
    // Formatted in the store's currency with the runtime's own locale: a quote
    // request carries no locale, and inventing one would print a number in a
    // format neither the merchant nor the shopper chose.
    const unit = formatCurrency(data.unitPrice, currency);
    const total = formatCurrency(data.unitPrice * data.quantity, currency);
    const replyTo =
      settings.general?.storeEmail?.trim() ||
      settings.email?.replyTo?.trim() ||
      settings.email?.fromEmail?.trim();
    const link = `${appBaseUrl()}/account/quotes`;
    const expiry = data.expiresAt
      ? data.expiresAt.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "";

    await sendEmail({
      to: data.email,
      replyTo,
      subject: `${storeName} — your price for ${productLabel}`,
      settings,
      html: `
        <div style="font-family:Arial,sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:24px;">
          <h2 style="margin:0 0 12px;font-size:20px;">Your quote is ready, ${escapeHtml(data.name)}</h2>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">
            ${escapeHtml(storeName)} has priced your request for
            <strong>${escapeHtml(productLabel)}</strong>.
          </p>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:15px;">
            <tr><td style="padding:6px 0;color:#6b7280;">Quantity</td><td style="padding:6px 0;text-align:right;">${data.quantity}</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;">Price each</td><td style="padding:6px 0;text-align:right;">${escapeHtml(unit)}</td></tr>
            <tr><td style="padding:10px 0 0;border-top:1px solid #e5e7eb;font-weight:bold;">Total</td><td style="padding:10px 0 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:bold;">${escapeHtml(total)}</td></tr>
          </table>
          ${
            data.note
              ? `<div style="margin-bottom:20px;padding:12px 14px;background:#f9fafb;border-radius:6px;font-size:14px;line-height:1.7;">${escapeHtml(data.note).replace(/\n/g, "<br />")}</div>`
              : ""
          }
          <p style="margin:0 0 20px;">
            <a href="${link}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:15px;">View and order</a>
          </p>
          ${
            expiry
              ? `<p style="margin:0;color:#6b7280;font-size:13px;">This price is held until ${escapeHtml(expiry)}.</p>`
              : ""
          }
          <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">
            Sign in with this email address to see it — the price is yours alone
            and is not shown to anyone else.
          </p>
        </div>`,
      text: [
        `Your quote is ready, ${data.name}`,
        "",
        `${storeName} has priced your request for ${productLabel}.`,
        `Quantity: ${data.quantity}`,
        `Price each: ${unit}`,
        `Total: ${total}`,
        data.note ? `` : "",
        data.note || "",
        "",
        `View and order: ${link}`,
        expiry ? `This price is held until ${expiry}.` : "",
      ]
        .filter((line) => line !== "")
        .join("\n"),
      category: "transactional",
    });
  } catch (error) {
    console.error("Failed to send quote offer email:", error);
  }
}
