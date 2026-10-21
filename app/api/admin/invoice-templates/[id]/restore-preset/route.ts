import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateOptionalBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateRestored } from "@/lib/invoice-templates/audit";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { restoreTemplatePreset } from "@/lib/invoice-templates/service";

const RestoreSchema = z.strictObject({ version: z.number().int().min(1).optional() });

/**
 * Put a template back to its preset's layout, in its own language; the name
 * and the default flag stay. With `version`, only onto that version.
 */
export const POST = withApi<{ id: string }>(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, params, session }) => {
    const { version } = await validateOptionalBody(request, RestoreSchema);
    const { before, after } = await restoreTemplatePreset(PLATFORM_OWNER, params.id, session.user.id, { version });
    await auditTemplateRestored(createAuditContext(request, session), before, after);
    return successResponse(after);
  },
);
