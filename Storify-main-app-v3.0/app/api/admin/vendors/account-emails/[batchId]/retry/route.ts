import { Types } from "mongoose";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { audit, createAuditContext } from "@/lib/audit";
import { afterResponse } from "@/lib/after-response";
import {
  processAccountEmailJobs,
  retryFailedAccountEmails,
} from "@/lib/auth/account-email-queue";

/**
 * POST /api/admin/vendors/account-emails/[batchId]/retry
 * Retry failed vendor account emails, each with a fresh
 * link. An address the mail server refused outright is left alone.
 */
export const POST = withApi<{ batchId: string }>(
  {
    auth: "admin",
    // It sends real email.
    demo: "block-mutations",
    rateLimit: { action: "admin:vendors:account-emails:retry", preset: "strict" },
  },
  async ({ request, params, session }) => {
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
    if (!Types.ObjectId.isValid(params.batchId)) throw new NotFoundError("Send");
    const requeued = await retryFailedAccountEmails(params.batchId, { audience: "vendor" });
    if (requeued > 0) {
      await audit(createAuditContext(request, session), {
        action: "BULK_ACTION",
        resource: "vendor",
        changes: {
          summary: `Retried ${requeued} vendor account email${requeued === 1 ? "" : "s"} that could not be sent`,
        },
        metadata: { batchId: params.batchId, requeued },
      });
      afterResponse(() => processAccountEmailJobs());
    }
    return successResponse({ requeued });
  },
);
