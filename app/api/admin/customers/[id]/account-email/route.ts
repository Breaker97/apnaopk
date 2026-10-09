import { Types } from "mongoose";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  ApiError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { getSettingsLean } from "@/models/settings.model";
import { isEmailDeliveryConfigured } from "@/lib/email/email";
import { createAuditContext } from "@/lib/audit";
import { sendAccountAccessEmail } from "@/lib/auth/account-access";
import {
  ensureGuestAccount,
  resolveAccountEmailRecipients,
} from "@/lib/customers/account-email-recipients";
import { ACCOUNT_EMAIL_REFUSAL_MESSAGES } from "@/lib/customers/account-email-request";
import type { AccountEmailSkipReason } from "@/models/account-email-job.model";

function refused(reason: AccountEmailSkipReason | "missing"): never {
  if (reason === "missing") throw new NotFoundError("Customer");
  throw new ConflictError(ACCOUNT_EMAIL_REFUSAL_MESSAGES[reason], { reason });
}

/**
 * POST /api/admin/customers/[id]/account-email
 *
 * The customer page's "Send password reset" / "Send account invite": a reset
 * link when the account has a password, an invitation to set one when it has
 * none. A guest gets an account made for them first — no password, and no
 * second customer row.
 *
 * Sent once, while the admin waits: a failure is reported now, and its link is
 * spent, so a retry from the email log can never deliver a stale one. `[id]`
 * is the customer profile's id, as everywhere on the customer screens.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.EDIT_CUSTOMERS,
      STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
    demo: "block-mutations",
    rateLimit: { action: "admin:customers:account-email", preset: "moderate" },
  },
  async ({ request, params, session, staff }) => {
    if (!Types.ObjectId.isValid(params.id)) throw new NotFoundError("Customer");

    const { matched, recipients, skipped } = await resolveAccountEmailRecipients(
      { profileIds: [params.id] },
      staff?.scope,
    );
    // Outside a scoped staff member's reach, or not a customer row at all.
    if (matched === 0) throw new NotFoundError("Customer");
    const recipient = recipients[0];
    if (!recipient) {
      refused((Object.keys(skipped)[0] as AccountEmailSkipReason) ?? "missing");
    }

    const settings = await getSettingsLean();
    if (!isEmailDeliveryConfigured(settings)) {
      const error = new ValidationError(
        "Email is not set up. Set it up in Settings → Email first.",
      );
      error.details = { reason: "unconfigured" };
      throw error;
    }

    let userId = recipient.userId;
    if (!userId) {
      const account = await ensureGuestAccount(recipient.profileId);
      if ("refused" in account) refused(account.refused);
      userId = account.userId;
    }

    const result = await sendAccountAccessEmail({
      userId,
      locale: recipient.locale,
      delivery: "once",
      settings,
      auditContext: createAuditContext(request, session),
    });

    switch (result.status) {
      case "sent":
        return successResponse(
          { purpose: result.purpose, email: result.email },
          result.purpose === "invite"
            ? `Account invitation sent to ${result.email}`
            : `Password reset link sent to ${result.email}`,
        );
      case "refused":
        return refused(result.reason === "no_email" ? "noEmail" : result.reason);
      case "unconfigured": {
        const error = new ValidationError(
          "Email is not set up. Set it up in Settings → Email first.",
        );
        error.details = { reason: "unconfigured" };
        throw error;
      }
      default: {
        const error = new ApiError(
          result.error
            ? `The email could not be sent: ${result.error}`
            : "The email could not be sent.",
          502,
          "EMAIL_SEND_FAILED",
        );
        error.details = { reason: "failed" };
        throw error;
      }
    }
  },
);
