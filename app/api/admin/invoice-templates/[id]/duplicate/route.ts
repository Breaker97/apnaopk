import { withApi } from "@/lib/api/handler";
import { createdResponse } from "@/lib/api/response";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateCreated } from "@/lib/invoice-templates/audit";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { duplicateTemplate } from "@/lib/invoice-templates/service";

/** A copy of a template, named "… (copy)", never the default. */
export const POST = withApi<{ id: string }>(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, params, session }) => {
    const copy = await duplicateTemplate(PLATFORM_OWNER, params.id, session.user.id);
    await auditTemplateCreated(createAuditContext(request, session), copy, "copy");
    return createdResponse(copy);
  },
);
