import { z } from "zod";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Vendor } from "@/models";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { auditUpdate, createAuditContext } from "@/lib/audit";
import { getSettings } from "@/models/settings.model";
import {
  preorderAccessDecision,
  resolvePreorderPolicy,
} from "@/lib/orders/preorder-gating";
import { afterResponse } from "@/lib/after-response";
import { notifyVendorPreorderAccessDecision } from "@/lib/notifications/notifications";

const BodySchema = z.object({
  enabled: z.boolean(),
  /**
   * Why — shown to the next admin who looks at this vendor, and sent to the
   * vendor with the decision.
   */
  note: z.string().max(500).optional(),
});

/**
 * GET /api/admin/vendors/[id]/preorder
 *
 * Where this one vendor stands, for the Access tab of their page — with the
 * store's policy alongside, because "no access" means nothing on a store that
 * does not review vendors at all.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:preorder:read",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Vendor");

    const [vendor, settings] = await Promise.all([
      Vendor.findById(id).select("preorder").lean(),
      getSettings(),
    ]);
    if (!vendor) return notFoundResponse("Vendor");

    return successResponse({
      policy: resolvePreorderPolicy(settings.preorder),
      preorder: vendor.preorder ?? null,
    });
  },
);

/**
 * PUT /api/admin/vendors/[id]/preorder
 *
 * Grant or withdraw a vendor's permission to open pre-orders.
 *
 * Only consulted while `settings.preorder.requireVendorApproval` is on, which
 * ships off — a store already selling pre-orders keeps selling them until an
 * admin decides to start reviewing sellers. Turning that setting on without
 * approving anyone is what stops NEW pre-orders; this route is how they are
 * let back in, one vendor at a time.
 *
 * Withdrawing access never touches live listings. A vendor's existing
 * pre-orders keep selling and keep their obligations — pulling them would
 * strand shoppers who have already paid a deposit, which is a worse outcome
 * than letting a batch finish. What it stops is the next one.
 */
export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:preorder",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const { id } = params;
    if (!Types.ObjectId.isValid(id)) return notFoundResponse("Vendor");

    const body = await validateBody(request, BodySchema);

    const before = await Vendor.findById(id)
      .select("storeName preorder userId")
      .lean();
    if (!before) return notFoundResponse("Vendor");

    const now = new Date();
    const vendor = await Vendor.findByIdAndUpdate(
      id,
      {
        $set: {
          "preorder.enabled": body.enabled,
          ...(body.enabled
            ? {
                "preorder.approvedAt": now,
                "preorder.approvedBy": session.user.id,
              }
            : {}),
          ...(body.note ? { "preorder.note": body.note } : {}),
        },
        // `$unset`, not `$set: undefined` — Mongoose drops undefined values
        // from an update, so the request stamp survived every decision and the
        // queue never emptied: an approved vendor sat in it for ever, and the
        // next admin saw a question that had already been answered.
        $unset: {
          "preorder.requestedAt": "",
          ...(body.enabled
            ? {}
            : { "preorder.approvedAt": "", "preorder.approvedBy": "" }),
        },
      },
      { returnDocument: "after" },
    )
      .select("storeName preorder")
      .lean();
    if (!vendor) return notFoundResponse("Vendor");

    await auditUpdate(
      createAuditContext(request, session),
      "vendor",
      id,
      { preorderEnabled: Boolean(before.preorder?.enabled) },
      { preorderEnabled: body.enabled, note: body.note },
      vendor.storeName,
    ).catch((err) =>
      console.error("Failed to audit vendor pre-order decision:", err),
    );

    const settings = await getSettings();
    const decision = preorderAccessDecision(
      before.preorder,
      body.enabled,
      settings.preorder,
    );
    if (decision && before.userId) {
      const vendorUserId = String(before.userId);
      afterResponse(() =>
        notifyVendorPreorderAccessDecision(
          {
            vendorUserId,
            storeName: vendor.storeName,
            decision,
            note: body.note,
          },
          { settings },
        ),
      );
    }

    return successResponse(vendor);
  },
);
