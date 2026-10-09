import { NextRequest, NextResponse } from "next/server";
import * as z from "zod";
import { connectDB } from "@/lib/db";
import { auth } from "@/lib/auth/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIP } from "@/lib/api/rate-limit-middleware";
import { handleApiError, RateLimitError } from "@/lib/api/errors";
import { rateLimitMessage } from "@/lib/api/rate-limit-message";
import { headers } from "next/headers";
import { USER_ROLES } from "@/config/app.config";
import { ContactMessageRequest } from "@/contracts/mobile/shop/v1/content";
import { sendContactMessage } from "@/lib/conversations/contact-message";
import {
  attachChatGuestCookie,
  CHAT_GUEST_COOKIE,
  createChatGuestToken,
  hashChatGuestToken,
} from "@/lib/conversations/guest-session";
import { resolveConversationViewer } from "@/lib/conversations/viewer";

/**
 * The form's fields, checked as the app's POST /contact/messages checks them,
 * and `website`: a field people never see, so whatever fills it is a bot.
 */
const ContactMessageSchema = ContactMessageRequest.extend({
  website: z.string().trim().max(200).optional().default(""),
});

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

    const { website, ...message } = parsed.data;

    if (website) {
      return NextResponse.json({
        success: true,
        message: "Thanks, your message has been received.",
      });
    }

    const rateLimit = await checkRateLimit(`contact:${getClientIP(request)}`, {
      windowMs: 15 * 60 * 1000,
      max: 5,
    });

    if (!rateLimit.allowed) {
      return handleApiError(
        new RateLimitError(
          await rateLimitMessage(request, rateLimit.resetIn),
          rateLimit.resetIn,
        ),
      );
    }

    await connectDB();
    const session = await auth.api
      .getSession({ headers: await headers() })
      .catch(() => null);

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
    if (!viewer || (viewer.kind !== "customer" && viewer.kind !== "guest")) {
      throw new Error("Unable to initialize support conversation");
    }
    const { conversationId } = await sendContactMessage({ viewer, message });

    const response = NextResponse.json({
      success: true,
      message: "Thanks, your message has been sent.",
      data: { conversationId },
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
