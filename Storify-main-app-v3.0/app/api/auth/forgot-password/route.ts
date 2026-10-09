import { NextRequest, NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";
import { checkRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { resolveClientIp } from "@/lib/api/client-ip";
import { handleApiError, RateLimitError } from "@/lib/api/errors";
import { rateLimitMessage } from "@/lib/api/rate-limit-message";
import { afterResponse } from "@/lib/after-response";
import { sendAccountAccessEmail } from "@/lib/auth/account-access";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/locale-prefix";
import * as z from "zod";

const ForgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

/** The one answer, whether or not the address has an account. */
const SENT_IF_REGISTERED =
  "If an account with that email exists, a password reset link has been sent.";

/** The standard refusal, worded in the page's language with the wait in it. */
async function tooManyRequests(request: NextRequest, resetIn: number) {
  return handleApiError(
    new RateLimitError(await rateLimitMessage(request, resetIn), resetIn),
  );
}

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 *
 * The account lookup and the email happen after the answer is sent, so the
 * answer takes as long for an address with an account as for one without —
 * a reply that came back slower when a reset was mailed said the address was
 * registered.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const result = ForgotPasswordSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { success: false, message: "Invalid email address" },
        { status: 400 },
      );
    }

    // One address however it is capitalised: `Owner@Shop.test` and
    // `owner@shop.test` are the same account, and used to be two limits.
    const email = result.data.email.trim().toLowerCase();

    const perAddress = await checkRateLimit(
      `forgot-password:${email}`,
      rateLimitPresets.strict,
    );
    if (!perAddress.allowed) return tooManyRequests(request, perAddress.resetIn);

    // And one sender however many addresses they try.
    const ip = resolveClientIp(request.headers);
    if (ip) {
      const perSender = await checkRateLimit(
        `forgot-password-ip:${ip}`,
        rateLimitPresets.moderate,
      );
      if (!perSender.allowed) return tooManyRequests(request, perSender.resetIn);
    }

    // The link opens in the language of the page that asked for it: the page
    // keeps the locale cookie on its own language (LocaleCookieSync).
    const locale = request.cookies.get(LOCALE_COOKIE_NAME)?.value ?? null;
    afterResponse(() => sendResetLink(email, locale));

    return NextResponse.json({ success: true, message: SENT_IF_REGISTERED });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { success: false, message: "An error occurred. Please try again." },
      { status: 500 },
    );
  }
}

async function sendResetLink(email: string, locale: string | null) {
  await connectDB();

  // Find user by email using native MongoDB driver (Better Auth uses 'user' collection)
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database not connected");
  }

  const user = await db
    .collection("user")
    .findOne({ email }, { projection: { _id: 1 } });
  if (!user) return;

  // An account with a password gets a reset; one without (made by an admin,
  // or only ever signed in with Google) is asked to set its first — an hour's
  // link either way, since the owner asked for it just now. A banned account
  // gets nothing: the service refuses it.
  const result = await sendAccountAccessEmail({
    userId: String(user._id),
    locale,
    delivery: "outbox",
    selfService: true,
  });
  if (result.status === "unconfigured") {
    console.error("Email is not enabled. Cannot send password reset email.");
  } else if (result.status === "failed") {
    console.error("Failed to send password reset email.");
  }
}
