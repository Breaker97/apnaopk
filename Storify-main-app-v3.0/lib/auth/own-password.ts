import bcrypt from "bcryptjs";
import { ObjectId, type Db } from "mongodb";
import { getActivePasswordPolicy, getAuthContext } from "@/lib/auth/auth";
import { getCredentialAccount, upsertCredentialPassword } from "@/lib/auth/auth-credentials";
import { checkPasswordPolicy, type PasswordPolicy } from "@/lib/auth/password-policy";
import { isRecentSignIn, RECENT_SIGN_IN_MESSAGE } from "@/lib/auth/recent-sign-in";
import { revokeOtherSessions } from "@/lib/auth/session-revocation";
import { audit, type AuditContext } from "@/lib/audit";
import { connectDB, mongoose } from "@/lib/db";

/**
 * A signed-in user's own password: checking it, and changing it.
 *
 * The account page (`/api/user/change-password`) and the shopper app
 * (`POST /me/password`) both run `changeOwnPassword`, so the admin's password
 * policy, the current-password check and "sign out every other device" hold
 * the same on both. Each caller words a refusal in its own errors.
 */

/** Why a password change was refused, and the field it is about. */
export type PasswordChangeRefusal =
  | { reason: "SAME_PASSWORD"; field: "newPassword"; message: string }
  | {
      reason: "PASSWORD_POLICY";
      field: "newPassword";
      message: string;
      /** The rules in force, for a caller that words the refusal itself. */
      policy: PasswordPolicy;
    }
  | { reason: "CURRENT_PASSWORD_REQUIRED"; field: "currentPassword"; message: string }
  | { reason: "CURRENT_PASSWORD_INCORRECT"; field: "currentPassword"; message: string }
  | { reason: "RECENT_SIGN_IN_REQUIRED"; field: null; message: string };

type PasswordChangeResult =
  | { ok: true; mode: "changed" | "set" }
  | { ok: false; refusal: PasswordChangeRefusal };

async function database(): Promise<Db> {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");
  return db;
}

/**
 * The hash a password is checked against: Better Auth's credential account,
 * else one left on the user document by an import from before Better Auth.
 */
async function readPasswordHash(
  db: Db,
  userId: ObjectId,
): Promise<{ hash: string; legacy: boolean } | null> {
  const credentialHash = (await getCredentialAccount(db, userId))?.password;
  if (credentialHash) return { hash: credentialHash, legacy: false };

  const legacyUser = await db
    .collection("user")
    .findOne({ _id: userId }, { projection: { password: 1 } });
  const legacyHash = (legacyUser as { password?: string } | null)?.password;
  return legacyHash ? { hash: legacyHash, legacy: true } : null;
}

async function matches(
  stored: { hash: string; legacy: boolean },
  password: string,
): Promise<boolean> {
  if (stored.legacy) return bcrypt.compare(password, stored.hash);
  const ctx = await getAuthContext();
  return ctx.password.verify({ hash: stored.hash, password });
}

/**
 * Checks the account's own password. `not_set` is an account that has none
 * (one that signs in with Google, say).
 */
export async function verifyOwnPassword(
  userId: string,
  password: string,
): Promise<"ok" | "incorrect" | "not_set"> {
  const db = await database();
  const stored = await readPasswordHash(db, new ObjectId(userId));
  if (!stored) return "not_set";
  return (await matches(stored, password)) ? "ok" : "incorrect";
}

/**
 * Changes the password, or sets a first one, and signs every other device
 * out; the session making the change stays signed in.
 *
 * An account without a password gets one only on a recent sign-in, or a
 * stolen session could give itself a way back in.
 */
export async function changeOwnPassword(input: {
  userId: string;
  /** The session making the change: it is the one kept signed in. */
  sessionId: string;
  signedInAt: Date | string | undefined;
  currentPassword?: string;
  newPassword: string;
  /**
   * Who is changing it, for the Activity Log: the web route's request, or the
   * shopper app's origin. Everyone's password change is logged, a shopper's
   * included.
   */
  auditContext?: AuditContext;
}): Promise<PasswordChangeResult> {
  const { userId, sessionId, signedInAt, currentPassword, newPassword } = input;

  if (currentPassword && currentPassword === newPassword) {
    return {
      ok: false,
      refusal: {
        reason: "SAME_PASSWORD",
        field: "newPassword",
        message: "New password must be different from current password",
      },
    };
  }

  const policy = await getActivePasswordPolicy();
  const policyError = checkPasswordPolicy(newPassword, policy);
  if (policyError) {
    return {
      ok: false,
      refusal: {
        reason: "PASSWORD_POLICY",
        field: "newPassword",
        message: policyError,
        policy,
      },
    };
  }

  const db = await database();
  const id = new ObjectId(userId);
  const stored = await readPasswordHash(db, id);

  if (!stored && !isRecentSignIn(signedInAt)) {
    return {
      ok: false,
      refusal: {
        reason: "RECENT_SIGN_IN_REQUIRED",
        field: null,
        message: RECENT_SIGN_IN_MESSAGE,
      },
    };
  }
  if (stored) {
    if (!currentPassword) {
      return {
        ok: false,
        refusal: {
          reason: "CURRENT_PASSWORD_REQUIRED",
          field: "currentPassword",
          message: "Current password is required",
        },
      };
    }
    if (!(await matches(stored, currentPassword))) {
      return {
        ok: false,
        refusal: {
          reason: "CURRENT_PASSWORD_INCORRECT",
          field: "currentPassword",
          message: "Current password is incorrect",
        },
      };
    }
  }

  await upsertCredentialPassword(db, id, newPassword);
  const signedOut = await revokeOtherSessions(userId, sessionId);

  const mode = stored ? "changed" : "set";
  await audit(input.auditContext ?? { userId }, {
    action: "PASSWORD_CHANGE",
    resource: "user",
    resourceId: userId,
    resourceName: input.auditContext?.userEmail,
    changes: {
      summary:
        mode === "set"
          ? "Set a password on an account that had none."
          : `Changed their own password${
              signedOut > 0
                ? `, signing out ${signedOut} other device${signedOut === 1 ? "" : "s"}`
                : ""
            }.`,
    },
    metadata: { mode },
  });

  return { ok: true, mode };
}
