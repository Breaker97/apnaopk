import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { createdResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { createAuditContext } from "@/lib/audit";
import { auditTemplateCreated } from "@/lib/invoice-templates/audit";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { createTemplateInputSchema } from "@/lib/invoice-templates/schema";
import { createTemplate, listTemplates } from "@/lib/invoice-templates/service";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "@/lib/invoice-templates/types";

/**
 * The platform's invoice templates (Settings → Invoice Settings). Admin only
 * (D-07); a demo site may look but not save (D-11).
 *
 * GET ?category=online|pos|sticker — the list, the default first.
 * POST — a new template: blank, from a preset, or a whole design.
 */
export const GET = withApi({ auth: "admin", demo: "block-mutations" }, async ({ request }) => {
  const category = request.nextUrl.searchParams.get("category");
  if (category && !(TEMPLATE_CATEGORIES as readonly string[]).includes(category)) {
    throw new ValidationError({ category: ["Unknown category"] });
  }
  return successResponse(
    await listTemplates(PLATFORM_OWNER, category ? { category: category as TemplateCategory } : {}),
  );
});

export const POST = withApi({ auth: "admin", demo: "block-mutations" }, async ({ request, session }) => {
  const input = await validateBody(request, createTemplateInputSchema);
  const template = await createTemplate(PLATFORM_OWNER, input, session.user.id);
  await auditTemplateCreated(
    createAuditContext(request, session),
    template,
    input.design ? "design" : input.presetKey ? "preset" : "blank",
  );
  return createdResponse(template);
});
