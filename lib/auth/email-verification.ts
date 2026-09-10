import { Notification, User, getSettingsLean } from "@/models";
import { NotificationType } from "@/models/notification.model";
import { sendEmail } from "@/lib/email/email";
import { connectDB } from "@/lib/db";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";

type VerificationUser = {
  id: string;
  email: string;
  name: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendAccountVerificationEmail(params: {
  user: VerificationUser;
  url: string;
}) {
  await connectDB();
  const settings = await getSettingsLean();
  const storeName = settings.general?.storeName || DEFAULT_STORE_NAME;
  const safeName = escapeHtml(params.user.name || "there");
  const safeStoreName = escapeHtml(storeName);
  const safeUrl = escapeHtml(params.url);

  const sent = await sendEmail({
    to: params.user.email,
    subject: `Verify your email - ${storeName}`,
    category: "email-verification",
    settings,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#18181b">
        <h1 style="font-size:24px;margin:0 0 16px">Verify your email</h1>
        <p>Hi ${safeName},</p>
        <p>Confirm this email address to finish setting up your ${safeStoreName} account.</p>
        <p style="margin:24px 0">
          <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Verify email address</a>
        </p>
        <p style="color:#71717a;font-size:13px">This link expires in 24 hours. If you did not create this account, you can ignore this email.</p>
      </div>
    `,
  });

  await Notification.findOneAndUpdate(
    {
      userId: params.user.id,
      type: NotificationType.SYSTEM,
      "data.kind": "email_verification",
    },
    {
      $set: {
        title: sent ? "Verify your email" : "Verification email delivery delayed",
        message: sent
          ? `A verification link was sent to ${params.user.email}.`
          : "We could not deliver your verification email yet. Please use resend shortly.",
        link: `/verify-email?email=${encodeURIComponent(params.user.email)}`,
        data: { kind: "email_verification", deliveryStatus: sent ? "sent" : "retrying" },
        isRead: false,
        isArchived: false,
      },
      $setOnInsert: { userId: params.user.id, type: NotificationType.SYSTEM },
    },
    { upsert: true, new: true },
  );

  if (!sent) {
    throw new Error("Verification email delivery failed");
  }
}

export async function markAccountEmailVerified(user: VerificationUser) {
  await connectDB();
  const verifiedAt = new Date();
  await User.updateOne(
    { _id: user.id },
    {
      $set: { emailVerified: true, emailVerifiedAt: verifiedAt },
      $unset: { emailVerificationRequiredAt: 1 },
    },
  );
  await Notification.findOneAndUpdate(
    {
      userId: user.id,
      type: NotificationType.SYSTEM,
      "data.kind": "email_verification",
    },
    {
      $set: {
        title: "Email verified",
        message: "Your email address has been verified successfully.",
        link: "/account/profile",
        data: { kind: "email_verification", deliveryStatus: "verified", verifiedAt },
        isRead: false,
        isArchived: false,
      },
      $setOnInsert: { userId: user.id, type: NotificationType.SYSTEM },
    },
    { upsert: true, new: true },
  );
}
