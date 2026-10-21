import * as z from "zod";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { assertVendorPermission } from "@/lib/access/rbac";
import { createAuditContext } from "@/lib/audit";
import { changeOwnEmail } from "@/lib/auth/own-email";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";

const ChangeEmailSchema = z.object({
  email: z.string().max(254),
  currentPassword: z.string().max(256).optional(),
});

/**
 * PUT /api/vendor/account/email
 *
 * The signed-in vendor changes the email they sign in with, confirmed by
 * their current password; the old address is told (`changeOwnEmail`). Same
 * gate as the rest of the vendor's account settings (/api/vendor/settings).
 */
export const PUT = withApi(
  { auth: "user", demo: "block-mutations" },
  async ({ request, session }) => {
    const body = await validateBody(request, ChangeEmailSchema);
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS,
      "You do not have permission to update your account",
    );
    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:account:email",
      "strict",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });

    const result = await changeOwnEmail({
      userId: session.user.id,
      newEmail: body.email,
      currentPassword: body.currentPassword,
      auditContext: createAuditContext(request, session, { vendorId: vendor._id }),
    });
    if (!result.ok) {
      const { field, message } = result.refusal;
      throw new ValidationError({ [field]: [message] });
    }

    return successResponse({ email: result.email }, "Email updated");
  },
);
