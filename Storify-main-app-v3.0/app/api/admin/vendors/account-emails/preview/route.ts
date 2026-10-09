import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { getSettingsLean } from "@/models/settings.model";
import { isEmailDeliveryConfigured } from "@/lib/email/email";
import { resolveVendorEmailRecipients, parseVendorEmailSelection } from "@/lib/vendors/vendor-account-email";

export const maxDuration = 60;

/**
 * POST /api/admin/vendors/account-emails/preview
 *
 * The dry run behind the confirm dialog: how many vendors a send would
 * reach, and how many it would leave out and why — the same resolver the send
 * itself runs, so the number agreed to is the number queued. Writes nothing,
 * so a demo visitor may open the dialog; the send is what demo mode refuses.
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: {
      action: "admin:vendors:account-emails:preview",
      preset: "lenient",
    },
  },
  async ({ request }) => {
    const selection = parseVendorEmailSelection(await request.json().catch(() => null));
    const [{ matched, recipients, skipped }, settings] = await Promise.all([
      resolveVendorEmailRecipients(selection),
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
