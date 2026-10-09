import { Types } from "mongoose";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  ApiError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { getSettingsLean } from "@/models/settings.model";
import { isEmailDeliveryConfigured } from "@/lib/email/email";
import { createAuditContext } from "@/lib/audit";
import { sendAccountAccessEmail } from "@/lib/auth/account-access";
import { resolveVendorEmailRecipients } from "@/lib/vendors/vendor-account-email";
import type { AccountEmailSkipReason } from "@/models/account-email-job.model";

function refused(reason: AccountEmailSkipReason | "missing"): never {
  if (reason === "missing") throw new NotFoundError("Vendor");
  throw new ConflictError({
    nonCustomer: "This account is not a vendor owner.",
    banned: "This vendor is banned.",
    inactive: "This vendor account is inactive or the store is not approved.",
    noEmail: "This vendor has no email address.",
    recent: "An account email went to this vendor less than 15 minutes ago or is already queued.",
    duplicate: "This vendor was listed twice.",
  }[reason], { reason });
}

/** Send one account-access email to an approved vendor's saved owner account.
 * Accounts with a password receive a reset; passwordless accounts receive an invite.
 * Failure is reported synchronously and the failed token is discarded.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:vendors:account-email", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    if (!Types.ObjectId.isValid(params.id)) throw new NotFoundError("Vendor");

    const { matched, recipients, skipped } = await resolveVendorEmailRecipients([params.id]);
    // IDs refer to vendor stores; never accept an arbitrary user account ID.
    if (matched === 0) throw new NotFoundError("Vendor");
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

    const userId = recipient.userId;

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
