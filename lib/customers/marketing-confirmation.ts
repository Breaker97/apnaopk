import { sendEmail } from "@/lib/email/email";
import { escapeHtml } from "@/lib/email/escape-html";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import type { ISettings } from "@/models/settings.model";
import { ensureUnsubscribeTokenForEmail } from "@/lib/customers/marketing-consent";
import { appBaseUrl } from "@/lib/app-url";
import { localeHref } from "@/lib/i18n/locale-routing";

/**
 * The confirmation email behind double opt-in.
 *
 * It carries no offers — that is the whole point of it: a store that has not
 * been told yes yet may ask for the yes, and nothing else. Shopify's help
 * pages say the same in as many words, and it is what makes a confirmed
 * opt-in worth more than a ticked box in the first place.
 *
 * Sent as transactional, because it is: it answers something the shopper just
 * did, and it must reach someone who is not yet a subscriber.
 */
export async function sendMarketingConfirmationEmail(params: {
  email: string;
  settings?: ISettings;
  locale?: string;
}): Promise<boolean> {
  const email = params.email?.trim();
  if (!email) return false;

  const token = await ensureUnsubscribeTokenForEmail(email);
  // No customer record, no token, nothing to confirm against — the caller
  // records consent before asking us, so this means the write did not land.
  if (!token) return false;

  // On the store's own address, never the request's: the checkout that asks
  // for this email can send any Origin header, and the link carries the
  // subscriber's token — it went to whatever host the request named, in an
  // email from the store to any address the caller typed.
  const locale =
    params.locale && isValidLocale(params.locale) ? params.locale : defaultLocale;
  const confirmUrl = `${appBaseUrl()}${await localeHref(
    locale,
    `/marketing/confirm/${encodeURIComponent(token)}`,
  )}`;
  const storeName =
    params.settings?.general?.storeName ||
    process.env.NEXT_PUBLIC_APP_NAME ||
    DEFAULT_STORE_NAME;

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 12px">${escapeHtml(storeName)}</h2>
      <p>Please confirm you want news and offers from us at this address.</p>
      <p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;background:#111827;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Confirm subscription</a></p>
      <p style="color:#6b7280;font-size:13px">If you did not ask for this, ignore this email — nothing will be sent to you.</p>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: `Confirm your subscription to ${storeName}`,
    html,
    settings: params.settings,
    category: "transactional",
  });
}
