import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateDeleted, auditTemplateUpdated } from "@/lib/invoice-templates/audit";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { updateTemplateInputSchema } from "@/lib/invoice-templates/schema";
import { deleteTemplate, getTemplate, updateTemplate } from "@/lib/invoice-templates/service";

/** One platform template. Another owner's id is a 404. */
export const GET = withApi<{ id: string }>({ auth: "admin", demo: "block-mutations" }, async ({ params }) =>
  successResponse(await getTemplate(PLATFORM_OWNER, params.id)),
);

/**
 * PATCH { version, name?, design? }: a rename, a save, or both, onto the
 * version the caller edited. A stale version is a 409 with `currentVersion`.
 */
export const PATCH = withApi<{ id: string }>(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, params, session }) => {
    const input = await validateBody(request, updateTemplateInputSchema);
    const { before, after } = await updateTemplate(PLATFORM_OWNER, params.id, input, session.user.id);
    await auditTemplateUpdated(createAuditContext(request, session), before, after);
    return successResponse(after);
  },
);

/** Deleting the default returns its category to the standard print (D-02). */
export const DELETE = withApi<{ id: string }>(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, params, session }) => {
    const removed = await deleteTemplate(PLATFORM_OWNER, params.id);
    await auditTemplateDeleted(createAuditContext(request, session), removed);
    return successResponse({ deleted: true, wasDefault: removed.isDefault, category: removed.category });
  },
);
