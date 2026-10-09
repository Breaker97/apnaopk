import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { getSettingsLean } from "@/models/settings.model";
import { isEmailDeliveryConfigured } from "@/lib/email/email";
import { resolveAccountEmailRecipients } from "@/lib/customers/account-email-recipients";
import { parseAccountEmailSelection } from "@/lib/customers/account-email-request";

export const maxDuration = 60;

/**
 * POST /api/admin/customers/account-emails/preview
 *
 * The dry run behind the confirm dialog: how many customers a send would
 * reach, and how many it would leave out and why — the same resolver the send
 * itself runs, so the number agreed to is the number queued. Writes nothing,
 * so a demo visitor may open the dialog; the send is what demo mode refuses.
 */
export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.EDIT_CUSTOMERS,
      STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
    rateLimit: {
      action: "admin:customers:account-emails:preview",
      preset: "lenient",
    },
  },
  async ({ request, staff }) => {
    const selection = parseAccountEmailSelection(await request.json().catch(() => null));
    const [{ matched, recipients, skipped }, settings] = await Promise.all([
      resolveAccountEmailRecipients(selection, staff?.scope),
      getSettingsLean(),
    ]);
    return successResponse({
      matched,
      sendable: recipients.length,
      skipped,
      emailConfigured: isEmailDeliveryConfigured(settings),
    });
  },
);
