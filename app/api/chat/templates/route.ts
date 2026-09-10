import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireConversationViewer } from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import { createWhatsAppTemplate } from "@/lib/conversations/providers/whatsapp-templates";

const CreateTemplateSchema = z.object({
  connectionId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(512),
  language: z.string().trim().min(2).max(40),
  // AUTHENTICATION is intentionally absent: the send compiler cannot emit the
  // OTP button component Meta requires, so such a template could be approved
  // and then never sent. See AUTHENTICATION_TEMPLATE_CATEGORY.
  category: z.enum(["UTILITY", "MARKETING"]),
  headerText: z.string().trim().max(60).optional(),
  headerExample: z.string().trim().max(1000).optional(),
  // Required for every category the API still accepts; only AUTHENTICATION
  // templates (Meta authors their body) could omit it.
  bodyText: z.string().trim().min(1, "Template body is required").max(1024),
  bodyExamples: z.array(z.string().trim().min(1).max(1000)).max(20),
  footerText: z.string().trim().max(60).optional(),
  button: z
    .object({
      type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER"]),
      text: z.string().trim().min(1).max(25),
      value: z.string().trim().max(2000).optional(),
      example: z.string().trim().max(2000).optional(),
    })
    .optional(),
  authentication: z
    .object({
      addSecurityRecommendation: z.boolean(),
      codeExpirationMinutes: z.number().int().min(1).max(90),
    })
    .optional(),
});

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "chat:templates:create",
      "strict",
      session.user.role,
    );
    const body = await validateBody(request, CreateTemplateSchema);
    const viewer = requireConversationViewer(
      await resolveConversationViewer({ session }),
    );
    return successResponse(
      {
        template: await createWhatsAppTemplate({
          viewer,
          ...body,
        }),
      },
      "WhatsApp template submitted for review",
    );
  },
);
