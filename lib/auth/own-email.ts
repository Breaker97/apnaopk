import { ObjectId } from "mongodb";
import * as z from "zod";
import { audit, type AuditContext } from "@/lib/audit";
import { verifyOwnPassword } from "@/lib/auth/own-password";
import { connectDB, mongoose } from "@/lib/db";
import { getAppName, sendEmail } from "@/lib/email/email";
import { escapeHtml } from "@/lib/email/escape-html";

/**
 * A signed-in user changing their own sign-in email.
 *
 * The change applies at once, confirmed by the account's current password
 * rather than a link to the new address, and the OLD address is told — so
 * a stolen session alone cannot move the account, and a change the owner
 * did not make is not a silent one. Everything that keys on the user keeps
 * working: Better Auth's credential account is tied to the user id, not to
 * the email, which is also how the admin's owner-email edit changes it.
 */

/** Why an email change was refused, and the field it is about. */
export type EmailChangeRefusal =
  | { reason: "EMAIL_INVALID"; field: "email"; message: string }
  | { reason: "SAME_EMAIL"; field: "email"; message: string }
  | { reason: "EMAIL_TAKEN"; field: "email"; message: string }
  | { reason: "CURRENT_PASSWORD_REQUIRED"; field: "currentPassword"; message: string }
  | { reason: "CURRENT_PASSWORD_INCORRECT"; field: "currentPassword"; message: string }
  | { reason: "PASSWORD_NOT_SET"; field: "currentPassword"; message: string };

type EmailChangeResult =
  | { ok: true; email: string }
  | { ok: false; refusal: EmailChangeRefusal };

const EmailSchema = z.string().trim().toLowerCase().email().max(254);

function refuse(refusal: EmailChangeRefusal): EmailChangeResult {
  return { ok: false, refusal };
}

/** The notice the old address gets; best effort, never blocks the change. */
async function noticeOldAddress(oldEmail: string, newEmail: string, name: string) {
  const app = getAppName();
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  await sendEmail({
    to: oldEmail,
    subject: `Your ${app} sign-in email was changed`,
    category: "account-security",
    html: `<p>${greeting}</p>
<p>The email you sign in to ${escapeHtml(app)} with was changed from <strong>${escapeHtml(
      oldEmail,
    )}</strong> to <strong>${escapeHtml(newEmail)}</strong>.</p>
<p>If you did not make this change, contact the store's support team right away.</p>`,
    text: `${name ? `Hi ${name},` : "Hi,"}\n\nThe email you sign in to ${app} with was changed from ${oldEmail} to ${newEmail}.\n\nIf you did not make this change, contact the store's support team right away.`,
  }).catch(() => false);
}

export async function changeOwnEmail(input: {
  userId: string;
  newEmail: string;
  currentPassword?: string;
  /** Who is changing it, for the Activity Log. */
  auditContext?: AuditContext;
}): Promise<EmailChangeResult> {
  const parsed = EmailSchema.safeParse(input.newEmail);
  if (!parsed.success) {
    return refuse({
      reason: "EMAIL_INVALID",
      field: "email",
      message: "Enter a valid email address",
    });
  }
  const newEmail = parsed.data;

  await connectDB();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");
  const users = db.collection("user");
  const id = new ObjectId(input.userId);
  const user = (await users.findOne(
    { _id: id },
    { projection: { email: 1, name: 1 } },
  )) as { email?: string; name?: string } | null;
  if (!user) throw new Error("User not found");

  const oldEmail = (user.email ?? "").toLowerCase();
  if (newEmail === oldEmail) {
    return refuse({
      reason: "SAME_EMAIL",
      field: "email",
      message: "This is already your email",
    });
  }

  if (!input.currentPassword) {
    return refuse({
      reason: "CURRENT_PASSWORD_REQUIRED",
      field: "currentPassword",
      message: "Enter your current password to change your email",
    });
  }
  const check = await verifyOwnPassword(input.userId, input.currentPassword);
  if (check === "not_set") {
    return refuse({
      reason: "PASSWORD_NOT_SET",
      field: "currentPassword",
      message: "Set a password for your account first, then change your email",
    });
  }
  if (check === "incorrect") {
    return refuse({
      reason: "CURRENT_PASSWORD_INCORRECT",
      field: "currentPassword",
      message: "Current password is incorrect",
    });
  }

  const taken = await users.findOne(
    { email: newEmail, _id: { $ne: id } },
    { projection: { _id: 1 } },
  );
  if (taken) {
    return refuse({
      reason: "EMAIL_TAKEN",
      field: "email",
      message: "Another account already uses this email",
    });
  }

  await users.updateOne(
    { _id: id },
    { $set: { email: newEmail, updatedAt: new Date() } },
  );

  await audit(input.auditContext ?? { userId: input.userId }, {
    action: "UPDATE",
    resource: "user",
    resourceId: input.userId,
    resourceName: newEmail,
    changes: { summary: `Changed their own sign-in email from ${oldEmail} to ${newEmail}.` },
    metadata: { field: "email" },
  });

  if (oldEmail) await noticeOldAddress(oldEmail, newEmail, user.name ?? "");

  return { ok: true, email: newEmail };
}
