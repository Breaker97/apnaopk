import { assertRecentSignIn } from "@/lib/auth/recent-sign-in";
import { connectDB, mongoose } from "@/lib/db";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import * as z from "zod";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { getActivePasswordPolicy, getAuthContext } from "@/lib/auth/auth";
import { getCredentialAccount, upsertCredentialPassword } from "@/lib/auth/auth-credentials";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { revokeOtherSessions } from "@/lib/auth/session-revocation";
import { withApi } from "@/lib/api/handler";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  // Length and complexity are the admin's policy, checked in the handler. A
  // fixed minimum here would answer first, with a different rule and message.
  newPassword: z.string(),
});

export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "change-password", preset: "strict" },
  },
  async ({ request, session }) => {
    const { currentPassword, newPassword } = await validateBody(
      request,
      ChangePasswordSchema,
    );

    if (currentPassword && currentPassword === newPassword) {
      throw new ValidationError({
        newPassword: ["New password must be different from current password"],
      });
    }

    // The account page changes passwords here, not through Better Auth's own
    // /change-password, so the catch-all route's policy check never sees these
    // requests. Without this, "require a number" held at sign-up and was
    // skipped on every change afterwards.
    const policyError = checkPasswordPolicy(
      newPassword,
      await getActivePasswordPolicy(),
    );
    if (policyError) {
      throw new ValidationError({ newPassword: [policyError] });
    }

    await connectDB();
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const userId = new ObjectId(session.user.id);
    const ctx = await getAuthContext();

    const credentialAccount = await getCredentialAccount(db, userId);
    const credentialPasswordHash = credentialAccount?.password;

    const legacyUser = await db.collection("user").findOne(
      { _id: userId },
      { projection: { password: 1 } },
    );
    const legacyPasswordHash = (legacyUser as { password?: string } | null)?.password;

    const currentHash = credentialPasswordHash || legacyPasswordHash;
    // No password to confirm (an account that signs in with Google, say): a
    // first one is set only by a recent sign-in, or a stolen session could
    // give itself a way back in.
    if (!currentHash) assertRecentSignIn(session);
    if (currentHash) {
      if (!currentPassword) {
        throw new ValidationError({
          currentPassword: ["Current password is required"],
        });
      }

      const isValid = credentialPasswordHash
        ? await ctx.password.verify({
            hash: credentialPasswordHash,
            password: currentPassword,
          })
        : legacyPasswordHash
          ? await bcrypt.compare(currentPassword, legacyPasswordHash)
          : false;
      if (!isValid) {
        throw new ValidationError({
          currentPassword: ["Current password is incorrect"],
        });
      }
    }

    await upsertCredentialPassword(db, userId, newPassword);

    // Every other device signs in again with the new password; this one stays.
    await revokeOtherSessions(session.user.id, session.session.id);

    return successResponse(
      { updated: true, mode: currentHash ? "changed" : "set" },
      currentHash ? "Password changed successfully" : "Password set successfully",
    );
  },
);
