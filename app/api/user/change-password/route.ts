import { connectDB, mongoose } from "@/lib/db";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { getAuthContext } from "@/lib/auth/auth";
import { getCredentialAccount, upsertCredentialPassword } from "@/lib/auth/auth-credentials";
import { withApi } from "@/lib/api/handler";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8),
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

    await db.collection("session").deleteMany({
      userId: session.user.id,
      _id: { $ne: new ObjectId(session.session.id) },
    });

    return successResponse(
      { updated: true, mode: currentHash ? "changed" : "set" },
      currentHash ? "Password changed successfully" : "Password set successfully",
    );
  },
);
