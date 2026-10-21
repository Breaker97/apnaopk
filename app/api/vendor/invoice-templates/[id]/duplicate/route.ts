import { withApi } from "@/lib/api/handler";
import { createdResponse } from "@/lib/api/response";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateCreated } from "@/lib/invoice-templates/audit";
import { resolveVendorTemplateOwner } from "@/lib/invoice-templates/owner";
import { duplicateTemplate } from "@/lib/invoice-templates/service";

/** A copy of one of the vendor's templates, named "… (copy)", never the default. */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:create" },
  },
  async ({ request, params, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "edit");
    const copy = await duplicateTemplate(owner, params.id, session.user.id);
    await auditTemplateCreated(createAuditContext(request, session, { vendorId: copy.vendorId }), copy, "copy");
    return createdResponse(copy);
  },
);
