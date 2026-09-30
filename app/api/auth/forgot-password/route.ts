import { NextRequest, NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";
import { PasswordReset } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { checkRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email/email";
import { escapeHtml } from "@/lib/email/escape-html";
import { resolveClientIp } from "@/lib/api/client-ip";
import { handleApiError, RateLimitError } from "@/lib/api/errors";
import { rateLimitMessage } from "@/lib/api/rate-limit-message";
import { afterResponse } from "@/lib/after-response";
import * as z from "zod";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_STORE_NAME,
} from "@/config/branding.config";

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

    afterResponse(() => sendResetLink(email));

    return NextResponse.json({ success: true, message: SENT_IF_REGISTERED });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { success: false, message: "An error occurred. Please try again." },
      { status: 500 },
    );
  }
}

async function sendResetLink(email: string) {
  await connectDB();

  // Find user by email using native MongoDB driver (Better Auth uses 'user' collection)
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Database not connected");
  }

  const user = await db.collection("user").findOne({ email });
  if (!user) return;

  // Check if SMTP is enabled (new structure)
  const settings = await getSettingsLean();
  if (!isEmailDeliveryConfigured(settings)) {
    console.error("Email is not enabled. Cannot send password reset email.");
    return;
  }

  // Create reset token
  const { token } = await PasswordReset.createToken(user._id);

  // Build reset URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const resetUrl = `${appUrl}/en/reset-password?token=${token}`;

  // Send reset email. The account's name is whatever was typed at sign-up,
  // so it is escaped like everything else printed here.
  const storeName = settings.general?.storeName || DEFAULT_STORE_NAME;
  const safeStoreName = escapeHtml(storeName);
  const safeResetUrl = escapeHtml(resetUrl);
  try {
    await sendEmail({
      to: email,
      subject: `Reset your password - ${storeName}`,
      html: `
          <h1>Password Reset Request</h1>
          <p>Hi ${escapeHtml(user.name || "there")},</p>
          <p>We received a request to reset your password for your ${safeStoreName} account.</p>
          <p>Click the link below to reset your password:</p>
          <p><a href="${safeResetUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${DEFAULT_PRIMARY_COLOR}; color: white; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p>${safeResetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
          <p>Thanks,<br>The ${safeStoreName} Team</p>
        `,
      settings,
    });
  } catch (emailError) {
    console.error("Failed to send password reset email:", emailError);
  }
}
