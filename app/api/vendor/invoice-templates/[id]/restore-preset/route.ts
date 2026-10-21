import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateOptionalBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateRestored } from "@/lib/invoice-templates/audit";
import { resolveVendorTemplateOwner } from "@/lib/invoice-templates/owner";
import { restoreTemplatePreset } from "@/lib/invoice-templates/service";

const RestoreSchema = z.strictObject({ version: z.number().int().min(1).optional() });

/**
 * Put one of the vendor's templates back to its preset's layout, in its own
 * language; the name and the default flag stay. With `version`, only onto
 * that version.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:update" },
  },
  async ({ request, params, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "edit");
    const { version } = await validateOptionalBody(request, RestoreSchema);
    const { before, after } = await restoreTemplatePreset(owner, params.id, session.user.id, { version });
    await auditTemplateRestored(createAuditContext(request, session, { vendorId: after.vendorId }), before, after);
    return successResponse(after);
  },
);
