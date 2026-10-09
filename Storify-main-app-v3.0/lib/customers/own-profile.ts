import { ObjectId } from "mongodb";
import { USER_ROLES } from "@/config/app.config";
import { audit, type AuditContext } from "@/lib/audit";
import { connectDB, mongoose } from "@/lib/db";
import { isRecentSignIn } from "@/lib/auth/recent-sign-in";
import { revokeOtherSessions } from "@/lib/auth/session-revocation";

/**
 * A user changing their own profile: the website's account form
 * (PUT /api/user/profile) and the shopper app (PATCH /me) run this one change,
 * so the two can never disagree about who may change what.
 *
 * Results, not throws: each caller words a refusal its own way.
 */

interface OwnProfileChange {
  name?: string;
  /** The login email. Only an admin may change it, on a recent sign-in. */
  email?: string;
  image?: string;
  /** `null` clears it. */
  phone?: string | null;
  birthday?: string | null;
  gender?: "male" | "female" | "other" | null;
}

type OwnProfileRefusal =
  /** The account is gone. */
  | "NO_ACCOUNT"
  /** Only an admin changes their login email here. */
  | "EMAIL_CHANGE_NOT_ALLOWED"
  /** A new login email needs a sign-in from the last ten minutes. */
  | "RECENT_SIGN_IN_REQUIRED"
  /** Another account signs in with that email. */
  | "EMAIL_TAKEN";

type OwnProfileResult =
  | { ok: true; updated: boolean }
  | { ok: false; refusal: OwnProfileRefusal };

export async function updateOwnProfile(
  actor: {
    userId: string;
    /** The session making the change: it stays signed in when the email changes. */
    sessionId: string;
    /** When that session signed in. */
    signedInAt: Date | string | undefined;
    /** Who is changing it, for the Activity Log (the login email is the one change logged). */
    auditContext?: AuditContext;
  },
  change: OwnProfileChange,
): Promise<OwnProfileResult> {
  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");

  const userId = new ObjectId(actor.userId);
  const currentUser = await db
    .collection("user")
    .findOne({ _id: userId }, { projection: { email: 1, role: 1, roles: 1 } });
  if (!currentUser) return { ok: false, refusal: "NO_ACCOUNT" };
  const previousEmail = currentUser.email;

  const updateFields: Record<string, unknown> = {};
  if (change.name !== undefined) updateFields.name = change.name;
  if (change.email !== undefined) {
    const roles = Array.isArray(currentUser.roles) ? currentUser.roles.map(String) : [];
    const isAdmin = currentUser.role === USER_ROLES.ADMIN || roles.includes(USER_ROLES.ADMIN);
    if (!isAdmin) return { ok: false, refusal: "EMAIL_CHANGE_NOT_ALLOWED" };

    const email = change.email.trim().toLowerCase();
    if (email !== currentUser.email) {
      if (!isRecentSignIn(actor.signedInAt)) {
        return { ok: false, refusal: "RECENT_SIGN_IN_REQUIRED" };
      }
      const existingUser = await db
        .collection("user")
        .findOne({ _id: { $ne: userId }, email }, { projection: { _id: 1 } });
      if (existingUser) return { ok: false, refusal: "EMAIL_TAKEN" };

      updateFields.email = email;
      updateFields.emailVerified = false;
      updateFields.emailVerifiedAt = null;
    }
  }
  if (change.image !== undefined) updateFields.image = change.image;
  if (change.phone !== undefined) updateFields.phone = change.phone;
  if (change.birthday !== undefined) updateFields.birthday = change.birthday;
  if (change.gender !== undefined) updateFields.gender = change.gender;

  if (Object.keys(updateFields).length === 0) return { ok: true, updated: false };

  await db
    .collection("user")
    .updateOne({ _id: userId }, { $set: { ...updateFields, updatedAt: new Date() } });
  // A new login email signs every other device out, as a new password does.
  if (updateFields.email) {
    await revokeOtherSessions(actor.userId, actor.sessionId);
    // The way into an admin account is its email: whoever controls it can reset
    // the password. Only an admin gets here, so this is always an admin's row.
    await audit(actor.auditContext ?? { userId: actor.userId, userRole: USER_ROLES.ADMIN }, {
      action: "UPDATE",
      resource: "user",
      resourceId: actor.userId,
      resourceName: String(updateFields.email),
      changes: {
        before: { email: previousEmail },
        after: { email: updateFields.email },
        fields: ["email"],
        summary: `Changed their login email from ${previousEmail} to ${updateFields.email}, and signed out every other device.`,
      },
    });
  }

  return { ok: true, updated: true };
}
