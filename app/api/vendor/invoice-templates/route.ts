import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { createdResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateCreated } from "@/lib/invoice-templates/audit";
import { resolveVendorTemplateOwner } from "@/lib/invoice-templates/owner";
import { createTemplateInputSchema } from "@/lib/invoice-templates/schema";
import { createTemplate, listTemplates } from "@/lib/invoice-templates/service";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/invoice-templates/types";

/**
 * The signed-in vendor's own invoice templates (Phase 7, D-07): the same
 * shapes as /api/admin/invoice-templates, so the manager and the editor run on
 * them unchanged. The owner is the session's own approved store, never an id
 * from the request; another store's template is a 404. Reading needs the
 * store-settings view grant, changing it the edit grant; vendor staff and
 * admins are refused, and marketplace mode off is a 404 (owner.ts).
 *
 * GET ?category=online|pos|sticker — the list, the default first.
 * POST — a new template: blank, from a preset, or a whole design.
 */
export const GET = withApi(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:list", preset: "lenient" },
  },
  async ({ request, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "view");
    const category = request.nextUrl.searchParams.get("category");
    if (category && !(TEMPLATE_CATEGORIES as readonly string[]).includes(category)) {
      throw new ValidationError({ category: ["Unknown category"] });
    }
    return successResponse(
      await listTemplates(owner, category ? { category: category as TemplateCategory } : {}),
    );
  },
);

export const POST = withApi(
  {
    auth: "user",
    demo: "block-mutations",
    rateLimit: { action: "vendor:invoice-templates:create" },
  },
  async ({ request, session }) => {
    const owner = await resolveVendorTemplateOwner(session.user, "edit");
    const input = await validateBody(request, createTemplateInputSchema);
    const template = await createTemplate(owner, input, session.user.id);
    await auditTemplateCreated(
      createAuditContext(request, session, { vendorId: template.vendorId }),
      template,
      input.design ? "design" : input.presetKey ? "preset" : "blank",
    );
    return createdResponse(template);
  },
);
