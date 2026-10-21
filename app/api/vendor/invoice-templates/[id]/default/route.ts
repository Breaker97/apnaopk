import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateDefault } from "@/lib/invoice-templates/audit";
import { resolveVendorTemplateOwner } from "@/lib/invoice-templates/owner";
import { removeDefaultTemplate, setDefaultTemplate } from "@/lib/invoice-templates/service";

/**
 * POST: make this template the vendor's default for its category — the
 * vendor's own prints (their order page, their POS) use it from then on, in
 * place of the platform's default (§4.8). DELETE: stop, so the vendor's prints
 * fall back to the platform's default, or the standard print.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:update" },
  },
  async ({ request, params, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "edit");
    const { template, replaced } = await setDefaultTemplate(owner, params.id, session.user.id);
    const context = createAuditContext(request, session, { vendorId: template.vendorId });
    if (replaced) await auditTemplateDefault(context, { ...replaced, isDefault: false });
    await auditTemplateDefault(context, template, replaced);
    return successResponse(template);
  },
);

export const DELETE = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:update" },
  },
  async ({ request, params, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "edit");
    const before = await removeDefaultTemplate(owner, params.id, session.user.id);
    await auditTemplateDefault(createAuditContext(request, session, { vendorId: before.vendorId }), before);
    return successResponse(before);
  },
);
