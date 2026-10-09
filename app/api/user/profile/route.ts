import { RECENT_SIGN_IN_MESSAGE } from "@/lib/auth/recent-sign-in";
import { updateOwnProfile } from "@/lib/customers/own-profile";
import { createAuditContext } from "@/lib/audit";
import { ObjectId } from "mongodb";
import { mongoose } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
} from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { UpdateUserProfileSchema } from "@/lib/validations";
import {
  getTwoFactorPolicy,
  isTwoFactorAvailableForUser,
} from "@/lib/auth/two-factor-policy";
import { withApi } from "@/lib/api/handler";
import {
  PROFILE_DEMO_MODE_MESSAGE,
  getDemoModeMutationResponse,
  isDemoModeEnabled,
} from "@/lib/demo-mode";

/**
 * GET /api/user/profile
 * Get user profile
 */
export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const user = await db.collection("user").findOne(
      { _id: new ObjectId(session.user.id) },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          phone: 1,
          birthday: 1,
          gender: 1,
          twoFactorEnabled: 1,
          emailVerified: 1,
          emailVerifiedAt: 1,
        },
      },
    );

    // Whether self-service 2FA is offered to this user (master switch + the
    // per-role availability toggle). The account/profile UIs use this to decide
    // whether to surface the 2FA management card.
    const policy = await getTwoFactorPolicy();
    const twoFactorAvailable = isTwoFactorAvailableForUser(session.user, policy);

    return successResponse({
      demoMode: {
        enabled: isDemoModeEnabled(),
        message: PROFILE_DEMO_MODE_MESSAGE,
      },
      user: user
        ? {
            ...user,
            twoFactorAvailable,
            emailVerificationStatus: session.user.emailVerificationStatus,
          }
        : user,
    });
  },
);

/**
 * PUT /api/user/profile
 * Update user profile (name, email for admins, image, phone, birthday, gender)
 */
export const PUT = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    // Guarded here rather than via `demo` so the refusal carries the
    // profile-specific wording the account form renders.
    const demoBlock = getDemoModeMutationResponse({
      message: PROFILE_DEMO_MODE_MESSAGE,
    });
    if (demoBlock) return demoBlock;

    const body = await validateBody(request, UpdateUserProfileSchema);
    const result = await updateOwnProfile(
      {
        userId: session.user.id,
        sessionId: session.session.id,
        signedInAt: session.session.createdAt,
        auditContext: createAuditContext(request, session),
      },
      body,
    );
    if (!result.ok) {
      switch (result.refusal) {
        case "NO_ACCOUNT":
          throw new AuthenticationError();
        case "EMAIL_CHANGE_NOT_ALLOWED":
          throw new AuthorizationError("Only admins can update profile email");
        case "RECENT_SIGN_IN_REQUIRED":
          throw new AuthorizationError(RECENT_SIGN_IN_MESSAGE);
        case "EMAIL_TAKEN":
          throw new ConflictError("Another user already uses this email");
      }
    }
    if (!result.updated) {
      return successResponse({ updated: false }, "No fields to update");
    }

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");
    const userId = new ObjectId(session.user.id);
    const user = await db.collection("user").findOne(
      { _id: userId },
      {
        projection: {
          name: 1,
          email: 1,
          image: 1,
          phone: 1,
          birthday: 1,
          gender: 1,
          twoFactorEnabled: 1,
          emailVerified: 1,
          emailVerifiedAt: 1,
        },
      },
    );

    return successResponse(
      {
        user: user
          ? {
              ...user,
              emailVerificationStatus: session.user.emailVerificationStatus,
            }
          : user,
      },
      "Profile updated successfully",
    );
  },
);
