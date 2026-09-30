import { connectDB } from "@/lib/db";
import { User, PasswordReset } from "@/models";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { Types } from "mongoose";
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email/email";
import { getSettings } from "@/models/settings.model";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { staffInviteEmailHtml } from "@/lib/email/staff-invite-email";
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
      html: staffInviteEmailHtml({
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
