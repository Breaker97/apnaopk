import { connectDB } from "@/lib/db";
import { User, PasswordReset } from "@/models";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { Types } from "mongoose";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email/email";
import { getSettings } from "@/models/settings.model";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_STORE_NAME,
} from "@/config/branding.config";
import { TEAM_USER_ROLES } from "@/lib/access/staff-role";
import { isVendorOwnedStaff } from "@/lib/access/staff-ownership";
import { USER_ROLES } from "@/config/app.config";
import { withApi } from "@/lib/api/handler";

type PasswordResetModelWithCreateToken = {
  createToken: (userId: unknown) => Promise<{ token: string }>;
};

/**
 * POST /api/admin/staff/[id]/invite
 * Send an invite email to a team member to set their password
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:staff:invite", preset: "moderate" },
  },
  async ({ request, params }) => {
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid team member ID");
    }

    await connectDB();

    const user = await User.findOne({
      _id: id,
      role: { $in: TEAM_USER_ROLES },
    }).lean();

    if (!user) {
      throw new ValidationError("Team member not found");
    }

    // Vendor-owned staff are out of scope for the admin — same contract as the
    // team CRUD routes, which 404 them.
    if (await isVendorOwnedStaff(id)) {
      throw new ValidationError("Team member not found");
    }

    // Check email is configured
    const settings = await getSettings();
    if (!isEmailDeliveryConfigured(settings)) {
      throw new ValidationError(
        "Email is not configured. Please configure SMTP settings first.",
      );
    }

    // Create a password reset token (valid for 1 hour for invites)
    const passwordResetModel =
      PasswordReset as unknown as PasswordResetModelWithCreateToken;
    const { token } = await passwordResetModel.createToken(user._id);

    // Build invite URL
    const localeParam = request.nextUrl.searchParams.get("locale");
    const inviteLocale =
      localeParam && isValidLocale(localeParam) ? localeParam : defaultLocale;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/${inviteLocale}/reset-password?token=${token}&invite=true`;

    const storeName = settings.general?.storeName || DEFAULT_STORE_NAME;
    const roleLabel =
      user.role === USER_ROLES.ADMIN ? "an administrator" : "a staff member";

    // Send invite email
    const emailSent = await sendEmail({
      to: user.email,
      subject: `You've been invited to join the ${storeName} team`,
      html: staffInviteTemplate({
        name: user.name || "there",
        storeName,
        roleLabel,
        inviteUrl,
      }),
      settings,
    });

    if (!emailSent) {
      throw new ValidationError(
        "Failed to send invite email. Please check your SMTP settings.",
      );
    }

    return successResponse({
      message: `Invite email sent to ${user.email}`,
    });
  },
);

function staffInviteTemplate({
  name,
  storeName,
  roleLabel,
  inviteUrl,
}: {
  name: string;
  storeName: string;
  roleLabel: string;
  inviteUrl: string;
}) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: white; border-radius: 8px; padding: 32px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e4e4e7; margin-bottom: 24px;">
        <h1 style="font-size: 24px; font-weight: bold; color: #18181b; margin: 0;">${storeName}</h1>
      </div>

      <h2 style="font-size: 20px; font-weight: 600; color: #18181b; margin: 0 0 8px 0;">You're invited!</h2>
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
        Hi ${name},
      </p>
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
        You've been invited to join <strong>${storeName}</strong> as ${roleLabel}. To get started, please set up your password by clicking the button below.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background-color: ${DEFAULT_PRIMARY_COLOR}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
          Set Your Password
        </a>
      </div>

      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        Or copy and paste this link into your browser:
      </p>
      <p style="color: ${DEFAULT_PRIMARY_COLOR}; font-size: 13px; word-break: break-all;">
        ${inviteUrl}
      </p>

      <div style="height: 1px; background: #e4e4e7; margin: 24px 0;"></div>

      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        This link will expire in 1 hour. If it expires, ask your admin to send a new invite.
      </p>
      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">
        If you didn't expect this invitation, you can safely ignore this email.
      </p>
    </div>
    <div style="text-align: center; padding: 16px 0;">
      <p style="color: #a1a1aa; font-size: 12px; margin: 0;">
        &copy; ${new Date().getFullYear()} ${storeName}. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>`;
}
