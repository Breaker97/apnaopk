import { NextRequest, NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";
import { PasswordReset } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { checkRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/email";
import { z } from "zod";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_STORE_NAME,
} from "@/config/branding.config";

const ForgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
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

    const { email } = result.data;

    // Rate limit by email
    const rateLimit = await checkRateLimit(
      `forgot-password:${email}`,
      rateLimitPresets.strict,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          message: "Too many password reset requests. Please try again later.",
          resetIn: rateLimit.resetIn,
        },
        { status: 429 },
      );
    }

    await connectDB();

    // Find user by email using native MongoDB driver (Better Auth uses 'user' collection)
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database not connected");
    }

    const user = await db
      .collection("user")
      .findOne({ email: email.toLowerCase() });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({
        success: true,
        message:
          "If an account with that email exists, a password reset link has been sent.",
      });
    }

    // Check if SMTP is enabled (new structure)
    const settings = await getSettingsLean();
    if (!settings.email?.enabled) {
      console.error("Email is not enabled. Cannot send password reset email.");
      return NextResponse.json({
        success: true,
        message:
          "If an account with that email exists, a password reset link has been sent.",
      });
    }

    // Create reset token
    const { token } = await PasswordReset.createToken(user._id);

    // Build reset URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetUrl = `${appUrl}/en/reset-password?token=${token}`;

    // Send reset email
    const storeName = settings.general?.storeName || DEFAULT_STORE_NAME;
    try {
      await sendEmail({
        to: email,
        subject: `Reset your password - ${storeName}`,
        html: `
          <h1>Password Reset Request</h1>
          <p>Hi ${user.name || "there"},</p>
          <p>We received a request to reset your password for your ${storeName} account.</p>
          <p>Click the link below to reset your password:</p>
          <p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: ${DEFAULT_PRIMARY_COLOR}; color: white; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p>${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request a password reset, you can safely ignore this email.</p>
          <p>Thanks,<br>The ${storeName} Team</p>
        `,
        settings,
      });
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
    }

    return NextResponse.json({
      success: true,
      message:
        "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { success: false, message: "An error occurred. Please try again." },
      { status: 500 },
    );
  }
}
