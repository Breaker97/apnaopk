import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { getSettingsLean } from "@/models/settings.model";
import { isEmailDeliveryConfigured } from "@/lib/email/email";
import { audit, createAuditContext } from "@/lib/audit";
import { afterResponse } from "@/lib/after-response";
import {
  currentAccountEmailBatch,
  enqueueAccountEmails,
  processAccountEmailJobs,
} from "@/lib/auth/account-email-queue";
import { resolveAccountEmailRecipients } from "@/lib/customers/account-email-recipients";
import {
  parseAccountEmailSelection,
  totalSkipped,
} from "@/lib/customers/account-email-request";

export const maxDuration = 60;

const SENDERS = [
  STAFF_PERMISSIONS.EDIT_CUSTOMERS,
  STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
];

/**
 * GET /api/admin/customers/account-emails
 * The send the customers list reports on — see `currentAccountEmailBatch`.
 */
export const GET = withApi(
  { auth: "admin-or-staff", staffPermissions: SENDERS },
  async () => successResponse({ batch: await currentAccountEmailBatch() }),
);

/**
 * POST /api/admin/customers/account-emails
 *
 * Queue an account email — a reset link, or an invitation for an account with
 * no password — for the ticked customers or for everyone a list filter
 * matches. The recipients are worked out again here rather than taken from
 * the confirm dialog, which may be minutes old. The first emails go as soon as
 * the answer is sent; /api/cron/account-emails sends the rest, 20 a minute.
 */
export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: SENDERS,
    demo: "block-mutations",
    rateLimit: { action: "admin:customers:account-emails", preset: "strict" },
  },
  async ({ request, session, staff }) => {
    const selection = parseAccountEmailSelection(await request.json().catch(() => null));

    if (!isEmailDeliveryConfigured(await getSettingsLean())) {
      const error = new ValidationError(
        "Email is not set up. Set it up in Settings → Email first.",
      );
      error.details = { reason: "unconfigured" };
      throw error;
    }

    const { matched, recipients, skipped } = await resolveAccountEmailRecipients(
      selection,
      staff?.scope,
    );
    if (recipients.length === 0) {
      return successResponse({ batchId: null, queued: 0, skipped });
    }

    const filter = "filter" in selection ? selection.filter : undefined;
    const { batchId, queued } = await enqueueAccountEmails({
      requestedBy: { id: session.user.id, email: session.user.email },
      source: filter ? "filter" : "selection",
      ...(filter ? { filter: { ...filter } } : {}),
      recipients,
      skippedAtStart: skipped,
    });

    const left = totalSkipped(skipped);
    await audit(createAuditContext(request, session), {
      action: "BULK_ACTION",
      resource: "user",
      changes: {
        summary:
          `Queued account emails (a password reset, or an invitation to set one) for ${queued} customer${queued === 1 ? "" : "s"}` +
          (filter ? " matching a filter" : "") +
          (left > 0 ? `; ${left} left out` : ""),
      },
      metadata: {
        batchId,
        source: filter ? "filter" : "selection",
        ...(filter ? { filter } : {}),
        matched,
        queued,
        skipped,
      },
    });

    afterResponse(() => processAccountEmailJobs());

    return successResponse({ batchId, queued, skipped });
  },
);
