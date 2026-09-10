import { AuthorizationError } from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { USER_ROLES } from "@/config/app.config";
import { getAIAuthoringRuntime } from "@/lib/ai-authoring/runtime";
import { assertVendorAuthoringAccess } from "@/lib/ai-authoring/permissions";
import { validateSocialExportRequest } from "@/lib/ai-authoring/social-export/validation";
import { createSocialExport } from "@/lib/ai-authoring/social-export/service";

/**
 * Vendor social export. Same deterministic render as the admin route; gated on
 * the AI feature flag, the caller's AI Studio access, and the rate limiter. The
 * SSRF guard in the service keeps the source (and logo) limited to this store's
 * storage.
 */
export const POST = withApi({ auth: "user" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:ai-authoring:social-export",
    "strict",
    session.user.role,
  );

  const runtime = await getAIAuthoringRuntime();
  if (!runtime.settings.enabled) {
    throw new AuthorizationError("AI authoring is disabled in Settings");
  }
  if (
    session.user.role !== USER_ROLES.ADMIN &&
    !runtime.settings.access.vendorsEnabled
  ) {
    throw new AuthorizationError(
      "AI authoring is not enabled for vendor accounts",
    );
  }

  // Approved-vendor status, ACCESS_AI_STUDIO, and the plan's aiAuthoring
  // capability — the same gate the sibling authoring routes apply. Checked
  // before the payload is parsed so an unauthorized caller is refused outright
  // rather than learning which payloads validate.
  await assertVendorAuthoringAccess(session.user);

  const payload = await request.json();
  const exportRequest = validateSocialExportRequest(payload);
  const alt =
    payload && typeof payload === "object" && "alt" in payload
      ? (payload as { alt?: unknown }).alt
      : undefined;

  const media = await createSocialExport({
    ...exportRequest,
    padColor: runtime.settings.brandKit.primaryColor || undefined,
    logoUrl: runtime.settings.brandKit.logoUrl || undefined,
    alt: typeof alt === "string" ? alt : undefined,
  });

  return successResponse(media);
});
