import { DEFAULT_PRIMARY_COLOR, DEFAULT_STORE_NAME } from "@/config/branding.config";
import type { ContactMessageRequest } from "@/contracts/mobile/shop/v1/content";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email/email";
import { getSettings } from "@/models/settings.model";
import { startLiveConversation } from "./service";
import type { ConversationViewer } from "./types";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * A message from the contact form, the website's (app/api/contact) or the
 * app's (POST /contact/messages): it opens, or lands in, a conversation in
 * the store's inbox, and goes to the store's email when email is set up. The
 * caller has checked it (`ContactMessageRequest`), limited the sender and
 * resolved who they are. Needs the database connected.
 */
export async function sendContactMessage(params: {
  viewer: Extract<ConversationViewer, { kind: "customer" | "guest" }>;
  message: ContactMessageRequest;
}): Promise<{ conversationId: string }> {
  const data = params.message;
  const settings = await getSettings();
  const storeName = settings.general?.storeName?.trim() || DEFAULT_STORE_NAME;
  const recipient =
    settings.general?.storeEmail?.trim() ||
    settings.email?.replyTo?.trim() ||
    settings.email?.fromEmail?.trim();

  const conversation = await startLiveConversation({
    viewer: params.viewer,
    name: data.name,
    email: data.email,
    subject: data.subject,
    message: data.message,
    clientMessageId: crypto.randomUUID(),
    // The contact form is not the live-chat widget: turning live chat off
    // must not reject (and therefore lose) a contact submission.
    enforceLiveChatAvailability: false,
  });

  const phone = data.phone ?? "";
  const company = data.company ?? "";
  const safe = {
    name: escapeHtml(data.name),
    email: escapeHtml(data.email),
    phone: escapeHtml(phone),
    company: escapeHtml(company),
    subject: escapeHtml(data.subject),
    message: escapeHtml(data.message).replace(/\n/g, "<br />"),
  };

  if (isEmailDeliveryConfigured(settings) && recipient) {
    const sent = await sendEmail({
      to: recipient,
      replyTo: data.email,
      subject: `[${storeName}] ${data.subject}`,
      settings,
      html: `
        <div style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#111827;">
          <div style="max-width:640px;margin:0 auto;padding:28px;">
            <div style="border-radius:10px;background:#ffffff;overflow:hidden;border:1px solid #e5e7eb;">
              <div style="background:${DEFAULT_PRIMARY_COLOR};padding:22px 26px;color:#ffffff;">
                <p style="margin:0 0 6px;font-size:13px;opacity:.9;">New contact message</p>
                <h1 style="margin:0;font-size:22px;line-height:1.3;">${safe.subject}</h1>
              </div>
              <div style="padding:26px;">
                <p style="margin:0 0 18px;font-size:15px;line-height:1.7;">${safe.message}</p>
                <div style="border-top:1px solid #e5e7eb;padding-top:18px;font-size:14px;line-height:1.7;color:#374151;">
                  <p style="margin:0;"><strong>Name:</strong> ${safe.name}</p>
                  <p style="margin:0;"><strong>Email:</strong> ${safe.email}</p>
                  ${safe.phone ? `<p style="margin:0;"><strong>Phone:</strong> ${safe.phone}</p>` : ""}
                  ${safe.company ? `<p style="margin:0;"><strong>Company:</strong> ${safe.company}</p>` : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
      `,
      text: [
        `New contact message for ${storeName}`,
        `Subject: ${data.subject}`,
        `Name: ${data.name}`,
        `Email: ${data.email}`,
        phone ? `Phone: ${phone}` : "",
        company ? `Company: ${company}` : "",
        "",
        data.message,
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (!sent) {
      console.error(
        `Contact email delivery failed for conversation ${conversation.conversation._id}`,
      );
    }
  }

  return { conversationId: String(conversation.conversation._id) };
}
