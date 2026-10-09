import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { getSettingsLean } from "@/models/settings.model";
import { isEmailDeliveryConfigured } from "@/lib/email/email";
import { audit, createAuditContext } from "@/lib/audit";
import { afterResponse } from "@/lib/after-response";
import {
  currentAccountEmailBatch,
  enqueueAccountEmails,
  processAccountEmailJobs,
} from "@/lib/auth/account-email-queue";
import { parseVendorEmailSelection, resolveVendorEmailRecipients } from "@/lib/vendors/vendor-account-email";
import { totalSkipped } from "@/lib/customers/account-email-request";

export const maxDuration = 60;

/**
 * GET /api/admin/vendors/account-emails
 * The send the vendors list reports on — see `currentAccountEmailBatch`.
 */
export const GET = withApi(
  { auth: "admin" },
  async () => {
    if (!(await getSettingsLean()).multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    return successResponse({ batch: await currentAccountEmailBatch({ audience: "vendor" }) });
  },
);

/**
 * POST /api/admin/vendors/account-emails
 *
 * Queue an account email — a reset link, or an invitation for an account with
 * no password — for the selected vendors. Recipients are resolved again here
 * rather than taken from
 * the confirm dialog, which may be minutes old. The first emails go as soon as
 * the answer is sent; /api/cron/account-emails sends the rest, 20 a minute.
 */
export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    rateLimit: { action: "admin:vendors:account-emails", preset: "strict" },
  },
  async ({ request, session }) => {
    const selection = parseVendorEmailSelection(await request.json().catch(() => null));

    if (!isEmailDeliveryConfigured(await getSettingsLean())) {
      const error = new ValidationError(
        "Email is not set up. Set it up in Settings → Email first.",
      );
      error.details = { reason: "unconfigured" };
      throw error;
    }

    const { matched, recipients, skipped } = await resolveVendorEmailRecipients(selection);
    if (recipients.length === 0) {
      return successResponse({ batchId: null, queued: 0, skipped });
    }

    const { batchId, queued } = await enqueueAccountEmails({
      requestedBy: { id: session.user.id, email: session.user.email },
      source: "selection",
      audience: "vendor",
      recipients,
      skippedAtStart: skipped,
    });

    const left = totalSkipped(skipped);
    await audit(createAuditContext(request, session), {
      action: "BULK_ACTION",
      resource: "vendor",
      changes: {
        summary:
          `Queued account emails (a password reset, or an invitation to set one) for ${queued} vendor${queued === 1 ? "" : "s"}` +
          (left > 0 ? `; ${left} left out` : ""),
      },
      metadata: {
        batchId,
        source: "selection",
        audience: "vendor",
        matched,
        queued,
        skipped,
      },
    });

    afterResponse(() => processAccountEmailJobs());

    return successResponse({ batchId, queued, skipped });
  },
);
