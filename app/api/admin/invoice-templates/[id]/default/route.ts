import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateDefault } from "@/lib/invoice-templates/audit";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { removeDefaultTemplate, setDefaultTemplate } from "@/lib/invoice-templates/service";

/**
 * POST: make this template its category's default — real prints use it from
 * then on. DELETE: stop, so the category prints the standard output again.
 */
export const POST = withApi<{ id: string }>(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, params, session }) => {
    const { template, replaced } = await setDefaultTemplate(PLATFORM_OWNER, params.id, session.user.id);
    if (replaced) await auditTemplateDefault(createAuditContext(request, session), { ...replaced, isDefault: false });
    await auditTemplateDefault(createAuditContext(request, session), template, replaced);
    return successResponse(template);
  },
);

export const DELETE = withApi<{ id: string }>(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, params, session }) => {
    const before = await removeDefaultTemplate(PLATFORM_OWNER, params.id, session.user.id);
    await auditTemplateDefault(createAuditContext(request, session), before);
    return successResponse(before);
  },
);
