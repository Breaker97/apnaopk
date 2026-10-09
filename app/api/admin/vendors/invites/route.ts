import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { currentAccountEmailBatch } from "@/lib/auth/account-email-queue";

/**
 * GET /api/admin/vendors/invites
 * The owner invitations the vendors list reports on: a vendor import's batch
 * still going out, else the latest of the last day (see
 * `currentAccountEmailBatch`). Platform admins only, like the import.
 */
export const GET = withApi({ auth: "admin" }, async () => {
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");
  return successResponse({ batch: await currentAccountEmailBatch({ audience: "vendor" }) });
});
