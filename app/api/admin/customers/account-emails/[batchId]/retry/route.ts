import { Types } from "mongoose";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { audit, createAuditContext } from "@/lib/audit";
import { afterResponse } from "@/lib/after-response";
import {
  processAccountEmailJobs,
  retryFailedAccountEmails,
} from "@/lib/auth/account-email-queue";

/**
 * POST /api/admin/customers/account-emails/[batchId]/retry
 * Send a finished send's failed emails again, each with a fresh link.
 */
export const POST = withApi<{ batchId: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.EDIT_CUSTOMERS,
      STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
    ],
    demo: "block-mutations",
    rateLimit: { action: "admin:customers:account-emails", preset: "strict" },
  },
  async ({ request, params, session }) => {
    if (!Types.ObjectId.isValid(params.batchId)) throw new NotFoundError("Send");
    const requeued = await retryFailedAccountEmails(params.batchId);
    if (requeued > 0) {
      await audit(createAuditContext(request, session), {
        action: "BULK_ACTION",
        resource: "user",
        changes: {
          summary: `Retried ${requeued} account email${requeued === 1 ? "" : "s"} that could not be sent`,
        },
        metadata: { batchId: params.batchId, requeued },
      });
      afterResponse(() => processAccountEmailJobs());
    }
    return successResponse({ requeued });
  },
);
