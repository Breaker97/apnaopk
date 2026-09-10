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
import { USER_ROLES } from "@/config/app.config";
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

    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const userId = new ObjectId(session.user.id);
    const body = await validateBody(request, UpdateUserProfileSchema);
    const updateFields: Record<string, unknown> = {};

    const currentUser = await db.collection("user").findOne(
      { _id: userId },
      {
        projection: {
          email: 1,
          role: 1,
          roles: 1,
        },
      },
    );

    if (!currentUser) throw new AuthenticationError();

    if (body.name !== undefined) updateFields.name = body.name;
    if (body.email !== undefined) {
      const roles = Array.isArray(currentUser.roles)
        ? currentUser.roles.map(String)
        : [];
      const isAdmin =
        currentUser.role === USER_ROLES.ADMIN || roles.includes(USER_ROLES.ADMIN);

      if (!isAdmin) {
        throw new AuthorizationError("Only admins can update profile email");
      }

      if (body.email !== currentUser.email) {
        const existingUser = await db.collection("user").findOne(
          {
            _id: { $ne: userId },
            email: body.email,
          },
          { projection: { _id: 1 } },
        );

        if (existingUser) {
          throw new ConflictError("Another user already uses this email");
        }

        updateFields.email = body.email;
        updateFields.emailVerified = false;
        updateFields.emailVerifiedAt = null;
      }
    }
    if (body.image !== undefined) updateFields.image = body.image;
    if (body.phone !== undefined) updateFields.phone = body.phone;
    if (body.birthday !== undefined) updateFields.birthday = body.birthday;
    if (body.gender !== undefined) updateFields.gender = body.gender;

    if (Object.keys(updateFields).length === 0) {
      return successResponse({ updated: false }, "No fields to update");
    }

    await db
      .collection("user")
      .updateOne(
        { _id: userId },
        { $set: { ...updateFields, updatedAt: new Date() } },
      );

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
