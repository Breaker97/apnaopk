import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { audit, createAuditContext } from "@/lib/audit";
import { getSettings } from "@/models/settings.model";
import { offerHeadline, sendVendorOffer } from "@/lib/orders/abandoned-offers";
import { OFFER_MAX_VALID_DAYS } from "@/lib/orders/abandoned-offer-state";
import { requireVendorAbandonedCheckoutViewer } from "@/lib/orders/vendor-abandoned-checkout-access";

const SendOfferSchema = z.object({
  type: z.enum(["percentage", "fixed"]),
  value: z.coerce.number().positive().max(1_000_000),
  validDays: z.coerce.number().int().min(1).max(OFFER_MAX_VALID_DAYS),
});

/**
 * POST /api/vendor/abandoned-checkouts/[id]/offer — send the shopper of one
 * of the vendor's abandoned checkouts a discount on the vendor's goods.
 *
 * The store sends it, from its own address; the vendor never learns who the
 * shopper is. The code is the vendor's (it comes off only the vendor's goods,
 * at the vendor's cost), single-use and the shopper's alone. Needs
 * `create_discounts` — this spends the vendor's money — and the store's
 * switch (Vendors → Configuration → Offers on abandoned checkouts). The
 * vendor comes from the signed-in account, never from the request.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:abandoned-checkouts:offer", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.CREATE_DISCOUNTS,
      "You do not have permission to send offers",
    );
    const viewer = await requireVendorAbandonedCheckoutViewer(session.user.id);
    const input = await validateBody(request, SendOfferSchema);
    const [vendor, settings] = await Promise.all([
      requireApprovedVendorByUserId(session.user.id),
      getSettings(),
    ]);

    const result = await sendVendorOffer({
      checkoutId: params.id,
      vendor,
      actorUserId: session.user.id,
      input,
      settings,
    });

    // In the vendor's own Activity log: what it offered, never to whom.
    const until = result.offer.validUntil.toISOString().slice(0, 10);
    await audit(createAuditContext(request, session, { vendorId: viewer.vendorId }), {
      action: "CREATE",
      resource: "coupon",
      resourceId: result.couponId,
      resourceName: "Abandoned checkout offer",
      changes: {
        after: {
          kind: "manual",
          type: result.offer.type,
          value: result.offer.value,
          validUntil: result.offer.validUntil,
          abandonedCheckoutId: params.id,
          status: result.outcome,
        },
        summary: `Abandoned checkout offer sent: ${offerHeadline(
          result.offer,
          settings.general?.defaultCurrency,
        )}${
          result.productNames.length ? ` on ${result.productNames.join(", ")}` : ""
        }, valid until ${until}`,
      },
    });

    return successResponse(
      { outcome: result.outcome, offer: result.offer },
      result.outcome === "sent"
        ? "Offer sent"
        : result.outcome === "queued"
          ? "Offer queued — delivery is being retried"
          : "The offer could not be sent",
    );
  },
);
