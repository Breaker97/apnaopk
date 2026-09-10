import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { PasswordReset, StaffProfile, User } from "@/models";
import { getSettings } from "@/models/settings.model";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { USER_ROLES } from "@/config/app.config";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { successResponse } from "@/lib/api/response";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
  handleApiError,
} from "@/lib/api/errors";
import { STAFF_USER_ROLES } from "@/lib/access/staff-role";
import { VENDOR_OWNED_STAFF_FILTER } from "@/lib/access/staff-ownership";
import { hasVendorPermission } from "@/lib/access/rbac";
import { sendEmail } from "@/lib/email/email";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import {
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_STORE_NAME,
} from "@/config/branding.config";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type PasswordResetModelWithCreateToken = {
  createToken: (userId: unknown) => Promise<{ token: string }>;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { vendor } = await requireVendorStaffPermission(request);

    const { id } = await params;
    if (!Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid staff member ID");
    }

    const profile = await StaffProfile.findOne({
      userId: id,
      vendorIds: vendor._id,
      ...VENDOR_OWNED_STAFF_FILTER,
    }).lean();
    if (!profile) throw new ValidationError("Staff member not found");

    const user = await User.findOne({
      _id: id,
      role: { $in: STAFF_USER_ROLES },
    }).lean();
    if (!user) throw new ValidationError("Staff member not found");

    const settings = await getSettings();
    if (!settings.email?.enabled) {
      throw new ValidationError(
        "Email is not configured. Please configure SMTP settings first.",
      );
    }

    const passwordResetModel =
      PasswordReset as unknown as PasswordResetModelWithCreateToken;
    const { token } = await passwordResetModel.createToken(user._id);

    const localeParam = request.nextUrl.searchParams.get("locale");
    const inviteLocale =
      localeParam && isValidLocale(localeParam) ? localeParam : defaultLocale;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/${inviteLocale}/reset-password?token=${token}&invite=true`;

    const storeName =
      vendor.storeName || settings.general?.storeName || DEFAULT_STORE_NAME;

    const emailSent = await sendEmail({
      to: user.email,
      subject: `You've been invited to join ${storeName} as staff`,
      html: staffInviteTemplate({
        name: user.name || "there",
        storeName,
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
  } catch (error) {
    return handleApiError(error);
  }
}

async function requireVendorStaffPermission(request: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthenticationError();
  if (session.user.role !== USER_ROLES.VENDOR) throw new AuthorizationError();

  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:staff:invite",
    "moderate",
    session.user.role,
  );

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

  const vendor = await requireApprovedVendorByUserId(session.user.id);
  const canManage = await hasVendorPermission(
    session.user as unknown as { id?: string; role?: typeof USER_ROLES.VENDOR },
    VENDOR_PERMISSIONS.MANAGE_STAFF,
  );
  const canEdit = await hasVendorPermission(
    session.user as unknown as { id?: string; role?: typeof USER_ROLES.VENDOR },
    VENDOR_PERMISSIONS.EDIT_STAFF,
  );
  const canManageStoreSettings = await hasVendorPermission(
    session.user as unknown as { id?: string; role?: typeof USER_ROLES.VENDOR },
    VENDOR_PERMISSIONS.MANAGE_STORE_SETTINGS,
  );
  if (!canManage && !canEdit && !canManageStoreSettings) {
    throw new AuthorizationError();
  }

  return { session, vendor };
}

function staffInviteTemplate({
  name,
  storeName,
  inviteUrl,
}: {
  name: string;
  storeName: string;
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
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">Hi ${name},</p>
      <p style="color: #52525b; font-size: 15px; line-height: 1.6;">You've been invited to join <strong>${storeName}</strong> as a staff member.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${inviteUrl}" style="display: inline-block; padding: 14px 32px; background-color: ${DEFAULT_PRIMARY_COLOR}; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Set Your Password</a>
      </div>
      <p style="color: #71717a; font-size: 13px; line-height: 1.6;">This link will expire in 1 hour.</p>
    </div>
  </div>
</body>
</html>`;
}
