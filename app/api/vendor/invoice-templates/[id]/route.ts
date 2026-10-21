import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateDeleted, auditTemplateUpdated } from "@/lib/invoice-templates/audit";
import { resolveVendorTemplateOwner } from "@/lib/invoice-templates/owner";
import { updateTemplateInputSchema } from "@/lib/invoice-templates/schema";
import { deleteTemplate, getTemplate, updateTemplate } from "@/lib/invoice-templates/service";

/** One of the vendor's own templates. Another store's id, or the platform's, is a 404. */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:read", preset: "lenient" },
  },
  async ({ params, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "view");
    return successResponse(await getTemplate(owner, params.id));
  },
);

/**
 * PATCH { version, name?, design? }: a rename, a save, or both, onto the
 * version the caller edited. A stale version is a 409 with `currentVersion`.
 */
export const PATCH = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:update" },
  },
  async ({ request, params, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "edit");
    const input = await validateBody(request, updateTemplateInputSchema);
    const { before, after } = await updateTemplate(owner, params.id, input, session.user.id);
    await auditTemplateUpdated(createAuditContext(request, session, { vendorId: after.vendorId }), before, after);
    return successResponse(after);
  },
);

/** Deleting the vendor's default returns that category to the platform's default, or the standard print. */
export const DELETE = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:delete" },
  },
  async ({ request, params, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "edit");
    const removed = await deleteTemplate(owner, params.id);
    await auditTemplateDeleted(createAuditContext(request, session, { vendorId: removed.vendorId }), removed);
    return successResponse({ deleted: true, wasDefault: removed.isDefault, category: removed.category });
  },
);
