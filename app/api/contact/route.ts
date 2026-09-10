import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { sendEmail } from "@/lib/email/email";
import { auth } from "@/lib/auth/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSettings } from "@/models/settings.model";
import { headers } from "next/headers";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_STORE_NAME,
} from "@/config/branding.config";
import { USER_ROLES } from "@/config/app.config";
import {
  attachChatGuestCookie,
  CHAT_GUEST_COOKIE,
  createChatGuestToken,
  hashChatGuestToken,
} from "@/lib/conversations/guest-session";
import { startLiveConversation } from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

const ContactMessageSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional().default(""),
  company: z.string().trim().max(100).optional().default(""),
  subject: z.string().trim().min(3).max(140),
  message: z.string().trim().min(10).max(2000),
  website: z.string().trim().max(200).optional().default(""),
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getClientIp(request: NextRequest) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = ContactMessageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Please check the highlighted fields." },
        { status: 400 },
      );
    }

    const data = parsed.data;

    if (data.website) {
      return NextResponse.json({
        success: true,
        message: "Thanks, your message has been received.",
      });
    }

    const rateLimit = await checkRateLimit(`contact:${getClientIp(request)}`, {
      windowMs: 15 * 60 * 1000,
      max: 5,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "Too many messages. Please try again later.",
          resetIn: rateLimit.resetIn,
        },
        { status: 429 },
      );
    }

    await connectDB();
    const session = await auth.api
      .getSession({ headers: await headers() })
      .catch(() => null);
    const settings = await getSettings();
    const storeName = settings.general?.storeName?.trim() || DEFAULT_STORE_NAME;
    const recipient =
      settings.general?.storeEmail?.trim() ||
      settings.email?.replyTo?.trim() ||
      settings.email?.fromEmail?.trim();

    const customerSession =
      session?.user.role === USER_ROLES.CUSTOMER ? session : null;
    let guestToken = request.cookies.get(CHAT_GUEST_COOKIE)?.value;
    const shouldSetGuestCookie = !customerSession && !guestToken;
    if (shouldSetGuestCookie) guestToken = createChatGuestToken();
    const viewer = await resolveConversationViewer({
      session: customerSession,
      guestKeyHash:
        !customerSession && guestToken
          ? hashChatGuestToken(guestToken)
          : undefined,
    });
    if (!viewer) throw new Error("Unable to initialize support conversation");
    const conversation = await startLiveConversation({
      viewer,
      name: data.name,
      email: data.email,
      subject: data.subject,
      message: data.message,
      clientMessageId: crypto.randomUUID(),
      // The contact form is not the live-chat widget: turning live chat off
      // must not reject (and therefore lose) a contact submission.
      enforceLiveChatAvailability: false,
    });

    const safe = {
      name: escapeHtml(data.name),
      email: escapeHtml(data.email),
      phone: escapeHtml(data.phone),
      company: escapeHtml(data.company),
      subject: escapeHtml(data.subject),
      message: escapeHtml(data.message).replace(/\n/g, "<br />"),
    };

    if (settings.email?.enabled && recipient) {
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
          data.phone ? `Phone: ${data.phone}` : "",
          data.company ? `Company: ${data.company}` : "",
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

    const response = NextResponse.json({
      success: true,
      message: "Thanks, your message has been sent.",
      data: { conversationId: conversation.conversation._id },
    });
    return shouldSetGuestCookie && guestToken
      ? attachChatGuestCookie(response, guestToken)
      : response;
  } catch (error) {
    console.error("Contact message error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
