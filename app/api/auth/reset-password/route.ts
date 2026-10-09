import { NextRequest, NextResponse } from "next/server";
import { connectDB, mongoose } from "@/lib/db";
import { PasswordReset } from "@/models";
import {
  checkRateLimit,
  rateLimitPresets,
  resetRateLimit,
} from "@/lib/rate-limit";
import * as z from "zod";
import { upsertCredentialPassword } from "@/lib/auth/auth-credentials";
import { getActivePasswordPolicy } from "@/lib/auth/auth";
import { revokeAllSessions } from "@/lib/auth/session-revocation";
import { primaryRole } from "@/lib/auth/auth-audit";
import { audit, createAuditContext } from "@/lib/audit";
import { handleApiError, RateLimitError } from "@/lib/api/errors";
import {
  checkPasswordPolicy,
  MIN_ALLOWED_PASSWORD_LENGTH,
} from "@/lib/auth/password-policy";
import { tokenPurpose } from "@/models/password-reset.model";
import { inspectAccountAccessToken } from "@/lib/auth/account-access-token";
import { isCustomerAccount } from "@/lib/access/customer-account";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";

type ResetUser = {
  _id: unknown;
  email?: string;
  name?: string;
  role?: string;
  roles?: string[];
  status?: string;
  emailVerified?: boolean;
};

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

    // Rate limit by token. Every attempt that gets this far spends the link
    // or finds it unusable, so the way on is a new link, not a wait.
    const rateLimit = await checkRateLimit(
      `reset-password:${token}`,
      rateLimitPresets.veryStrict,
    );
    if (!rateLimit.allowed) {
      return handleApiError(
        new RateLimitError(
          "Too many attempts. Please request a new password reset link.",
          rateLimit.resetIn,
        ),
      );
    }

    await connectDB();

    // Spent here, before the password is set, so a second request racing
    // with the same link finds nothing to spend. A reset that fails after
    // this needs a new link, which is the safe way round.
    const resetDoc = await PasswordReset.consumeToken(token);

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

    const user = (await db.collection("user").findOne(
      { _id: resetDoc.userId },
      {
        projection: {
          email: 1,
          name: 1,
          role: 1,
          roles: 1,
          status: 1,
          emailVerified: 1,
        },
      },
    )) as ResetUser | null;

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User not found" },
        { status: 404 },
      );
    }

    // A banned account gets no way back in through an emailed link, one sent
    // before the ban included. The link is spent either way.
    if (user.status === USER_ACCOUNT_STATUS.BANNED) {
      return NextResponse.json(
        { success: false, message: "Your account has been banned. Contact support." },
        { status: 403 },
      );
    }

    // Also spends every other link of this user's, of either kind.
    await upsertCredentialPassword(db, resetDoc.userId, password);

    const userId = resetDoc.userId.toString();
    // Opening the emailed link proved the address, as a verification link
    // would have — an invited shopper must not be asked to verify it again.
    if (user.email && user.emailVerified !== true) {
      try {
        const { markAccountEmailVerified } = await import(
          "@/lib/auth/email-verification"
        );
        await markAccountEmailVerified({
          id: userId,
          email: user.email,
          name: user.name || "",
        });
      } catch (error) {
        console.error("Could not mark the email verified:", error);
      }
    }
    // The address is proven, so the guest orders kept under it are theirs —
    // and an invited guest's customer row becomes the account's own, so the
    // customers list keeps one row for them.
    if (user.email && isCustomerAccount(user)) {
      try {
        const { claimGuestCustomerData } = await import("@/lib/customers/customer");
        await claimGuestCustomerData(userId, user.email);
      } catch (error) {
        console.error("Failed to claim guest customer data:", error);
      }
    }

    // Sign the account out everywhere: whoever had it before the reset —
    // someone who took over a session, say — must not keep it.
    try {
      await revokeAllSessions(resetDoc.userId.toString());
    } catch (sessionError) {
      console.warn("Could not clear sessions:", sessionError);
    }

    // Reset rate limit for this user's email
    if (user.email) {
      await resetRateLimit(`forgot-password:${user.email}`);
      await resetRateLimit(`login:${user.email}`);
    }

    // Everyone's password reset is logged, a shopper's included. The actor is
    // the account's owner: holding the emailed link is what proved it.
    await audit(
      createAuditContext(request, {
        user: {
          id: userId,
          email: user.email,
          role: primaryRole(user),
        },
      }),
      {
        action: "PASSWORD_RESET",
        resource: "user",
        resourceId: userId,
        resourceName: user.email,
        changes: {
          summary:
            tokenPurpose(resetDoc) === "invite"
              ? "Set their password from an account invitation, and was signed out everywhere."
              : "Reset their password from an emailed link, and was signed out everywhere.",
        },
      },
    );

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
 *
 * Kept for a reset page opened before the check moved to
 * POST /api/auth/reset-password/check, which keeps the token out of the
 * query string — and so out of every access log the request passes.
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

    // Verify token without marking as used
    const check = await inspectAccountAccessToken(token);

    return NextResponse.json({
      success: true,
      ...check,
      message: check.valid ? "Token is valid" : "Token is invalid or expired",
    });
  } catch (error) {
    console.error("Verify reset token error:", error);
    return NextResponse.json(
      { success: false, valid: false, message: "An error occurred" },
      { status: 500 },
    );
  }
}
