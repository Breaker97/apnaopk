import {
  VENDOR_APPLICATION_REASONS,
  VendorApplicationDecisionRequest,
  VendorApplicationDecisionResult,
} from "@/contracts/mobile/biz/v1/vendor-applications";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { bizAppAuditContext } from "@/lib/api-core/biz/audit-context";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { connectDB } from "@/lib/db";
import { decideVendorApplication } from "@/lib/vendors/vendor-decision";
import { getSettings } from "@/models/settings.model";
import { readVendorApplication } from "./read";

/**
 * POST /vendor-applications/{id}/decision: approve or reject a waiting
 * application, with everything the website's approval or rejection does
 * (lib/vendors/vendor-decision.ts). One decision per application: a second
 * one, or one on an application nobody submitted, is a 409 with its reason.
 * Open on a demo site, as the website's vendor save is.
 */
export const vendorApplicationDecideRoute = defineBizRoute({
  id: "vendor-applications.decide",
  method: "POST",
  path: "/vendor-applications/{id}/decision",
  auth: "user",
  ...BIZ_ACCESS.REVIEW_VENDOR_APPLICATIONS,
  multiVendorOnly: true,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:vendor-applications:decide", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  input: VendorApplicationDecisionRequest,
  output: VendorApplicationDecisionResult,
  reasons: { values: VENDOR_APPLICATION_REASONS },
  handler: async ({ input, params, session, client, requestId, locale }) => {
    if (input.decision === "reject" && !input.reason) {
      throw new MobileApiError(400, "VALIDATION_ERROR", "A rejection needs a reason the applicant is told.", {
        reason: "REASON_REQUIRED",
        errors: { reason: ["Say why, so the applicant can fix it and apply again."] },
      });
    }
    await connectDB();
    const { vendorStatus } = await decideVendorApplication({
      vendorId: params.id,
      decision: input.decision,
      reason: input.reason,
      settings: await getSettings(),
      auditContext: bizAppAuditContext({
        session,
        client,
        requestId,
        locale,
        method: "POST",
        path: `/vendor-applications/${params.id}/decision`,
      }),
    });
    return { application: await readVendorApplication(params.id), vendorStatus };
  },
});
