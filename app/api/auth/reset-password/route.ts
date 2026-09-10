import { NextRequest, NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";
import { PasswordReset } from "@/models";
import {
  checkRateLimit,
  rateLimitPresets,
  resetRateLimit,
} from "@/lib/rate-limit";
import { z } from "zod";
import { upsertCredentialPassword } from "@/lib/auth/auth-credentials";
import { getActivePasswordPolicy } from "@/lib/auth/auth";
import {
  checkPasswordPolicy,
  MIN_ALLOWED_PASSWORD_LENGTH,
} from "@/lib/auth/password-policy";

const ResetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  // Floor only — the admin's configured length and complexity rules are
  // applied below, so raising the policy cannot be sidestepped by resetting.
  password: z
    .string()
    .min(
      MIN_ALLOWED_PASSWORD_LENGTH,
      `Password must be at least ${MIN_ALLOWED_PASSWORD_LENGTH} characters`,
    ),
});

/**
 * POST /api/auth/reset-password
 * Reset password using token from email
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const result = ResetPasswordSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.error.issues[0]?.message || "Invalid input",
        },
        { status: 400 },
      );
    }

    const { token, password } = result.data;

    const policyError = checkPasswordPolicy(
      password,
      await getActivePasswordPolicy(),
    );
    if (policyError) {
      return NextResponse.json(
        { success: false, message: policyError },
        { status: 400 },
      );
    }

    // Rate limit by token
    const rateLimit = await checkRateLimit(
      `reset-password:${token}`,
      rateLimitPresets.veryStrict,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Too many attempts. Please request a new password reset link.",
          resetIn: rateLimit.resetIn,
        },
        { status: 429 },
      );
    }

    await connectDB();

    // Verify token
    const resetDoc = await PasswordReset.verifyToken(token);

    if (!resetDoc) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid or expired reset link. Please request a new one.",
        },
        { status: 400 },
      );
    }

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database not connected");
    }

    const userExists = await db
      .collection("user")
      .findOne({ _id: resetDoc.userId }, { projection: { _id: 1 } });

    if (!userExists) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 },
      );
    }

    await upsertCredentialPassword(db, resetDoc.userId, password);

    // Mark token as used
    await resetDoc.markUsed();

    // Invalidate all sessions for this user (by deleting from session collection)
    try {
      await db
        .collection("session")
        .deleteMany({ userId: resetDoc.userId.toString() });
    } catch (sessionError) {
      console.warn("Could not clear sessions:", sessionError);
    }

    // Reset rate limit for this user's email
    const user = await db.collection("user").findOne({ _id: resetDoc.userId });
    if (user?.email) {
      await resetRateLimit(`forgot-password:${user.email}`);
      await resetRateLimit(`login:${user.email}`);
    }

    return NextResponse.json({
      success: true,
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { success: false, message: "An error occurred. Please try again." },
      { status: 500 },
    );
  }
}

/**
 * GET /api/auth/reset-password
 * Verify if a reset token is still valid
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { success: false, valid: false, message: "Token is required" },
        { status: 400 },
      );
    }

    await connectDB();

    // Verify token without marking as used
    const resetDoc = await PasswordReset.verifyToken(token);

    return NextResponse.json({
      success: true,
      valid: !!resetDoc,
      message: resetDoc ? "Token is valid" : "Token is invalid or expired",
    });
  } catch (error) {
    console.error("Verify reset token error:", error);
    return NextResponse.json(
      { success: false, valid: false, message: "An error occurred" },
      { status: 500 },
    );
  }
}
