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
import { isEmailDeliveryConfigured, sendEmail } from "@/lib/email/email";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { staffInviteEmailHtml } from "@/lib/email/staff-invite-email";
import { createAuditContext } from "@/lib/audit";
import { auditStaffInvited } from "@/lib/access/audit-staff";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type PasswordResetModelWithCreateToken = {
  createToken: (userId: unknown, purpose: "invite") => Promise<{ token: string }>;
};

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { session, vendor } = await requireVendorStaffPermission(request);

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
    if (!isEmailDeliveryConfigured(settings)) {
      throw new ValidationError(
        "Email is not configured. Please configure SMTP settings first.",
      );
    }

    const passwordResetModel =
      PasswordReset as unknown as PasswordResetModelWithCreateToken;
    const { token } = await passwordResetModel.createToken(user._id, "invite");

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
      html: staffInviteEmailHtml({
        name: user.name || "there",
        storeName,
        roleLabel: "a staff member",
        inviteUrl,
      }),
      settings,
    });

    if (!emailSent) {
      throw new ValidationError(
        "Failed to send invite email. Please check your SMTP settings.",
      );
    }

    await auditStaffInvited(
      createAuditContext(request, session, { vendorId: vendor._id }),
      { userId: id, email: user.email },
      "staff",
    );

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
