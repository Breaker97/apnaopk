import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { audit, createAuditContext } from "@/lib/audit";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import { Vendor } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  OFFER_MAX_VALID_DAYS,
  abandonedOfferPolicy,
} from "@/lib/orders/abandoned-offer-state";
import { offerHeadline } from "@/lib/orders/abandoned-offers";
import { requireVendorAbandonedCheckoutViewer } from "@/lib/orders/vendor-abandoned-checkout-access";

/**
 * The vendor's standing offer to shoppers who abandon a checkout with its
 * goods: the store's recovery email carries it, on the second reminder, as a
 * single-use code at the vendor's cost (`lib/orders/abandoned-offers.ts`).
 *
 * GET needs `view_discounts`; PUT needs `create_discounts`, because a saved
 * rule makes codes on its own later. Both answer only when the store lets
 * vendors make offers, and PUT only when it allows standing ones.
 */

const DEFAULT_RULE = { enabled: false, type: "percentage", value: 10, validDays: 3 } as const;

function storeView(settings: Awaited<ReturnType<typeof getSettings>>) {
  const policy = abandonedOfferPolicy(settings);
  const recovery = normalizeCheckoutSettings(settings.checkout).abandonedCheckouts;
  return {
    policy: {
      enabled: policy.enabled,
      automatic: policy.automatic,
      maxPercent: policy.maxPercent,
      maxValidDays: policy.maxValidDays,
    },
    // A standing offer rides on the store's automatic recovery emails; with
    // those off it is saved but goes nowhere, which the screen says.
    storeSendsRecoveryEmails: Boolean(recovery.enabled && recovery.autoRecoveryEmail),
  };
}

export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:abandoned-checkouts:offer-rule:read", preset: "lenient" },
  },
  async ({ session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.VIEW_DISCOUNTS,
      "You do not have permission to view offers",
    );
    await requireVendorAbandonedCheckoutViewer(session.user.id);
    const [vendor, settings] = await Promise.all([
      requireApprovedVendorByUserId(session.user.id),
      getSettings(),
    ]);
    const saved = (vendor as { abandonedOffer?: Record<string, unknown> }).abandonedOffer;
    return successResponse({
      rule: { ...DEFAULT_RULE, ...(saved ?? {}) },
      ...storeView(settings),
    });
  },
);

const RuleSchema = z.object({
  enabled: z.boolean(),
  type: z.enum(["percentage", "fixed"]),
  value: z.coerce.number().positive().max(1_000_000),
  validDays: z.coerce.number().int().min(1).max(OFFER_MAX_VALID_DAYS),
});

export const PUT = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:abandoned-checkouts:offer-rule:write", preset: "moderate" },
  },
  async ({ request, session }) => {
    await assertVendorPermission(
      session.user,
      VENDOR_PERMISSIONS.CREATE_DISCOUNTS,
      "You do not have permission to set offers",
    );
    const viewer = await requireVendorAbandonedCheckoutViewer(session.user.id);
    const rule = await validateBody(request, RuleSchema);
    const [vendor, settings] = await Promise.all([
      requireApprovedVendorByUserId(session.user.id),
      getSettings(),
    ]);

    const { policy } = storeView(settings);
    // Turning it off is always allowed; turning it on, or changing it, needs
    // the store to allow standing offers and the numbers to fit its limits.
    if (rule.enabled) {
      if (!policy.enabled || !policy.automatic) {
        throw new ValidationError("The store does not let sellers set automatic offers.");
      }
      if (rule.type === "percentage" && rule.value > policy.maxPercent) {
        throw new ValidationError({
          value: [`The store allows at most ${policy.maxPercent}% off`],
        });
      }
      if (rule.validDays > policy.maxValidDays) {
        throw new ValidationError({
          validDays: [`Choose between 1 and ${policy.maxValidDays} days`],
        });
      }
    }

    const before = (vendor as { abandonedOffer?: Record<string, unknown> }).abandonedOffer;
    const next = {
      enabled: rule.enabled,
      type: rule.type,
      value: rule.type === "fixed" ? Math.round(rule.value * 100) / 100 : rule.value,
      validDays: rule.validDays,
    };
    await Vendor.updateOne({ _id: vendor._id }, { $set: { abandonedOffer: next } });

    await audit(createAuditContext(request, session, { vendorId: viewer.vendorId }), {
      action: "SETTINGS_CHANGE",
      resource: "vendor",
      resourceId: String(vendor._id),
      resourceName: vendor.storeName,
      changes: {
        before: { abandonedOffer: before ?? null },
        after: { abandonedOffer: next },
        fields: ["abandonedOffer"],
        summary: next.enabled
          ? `Automatic abandoned checkout offer on: ${offerHeadline(
              next,
              settings.general?.defaultCurrency,
            )}, valid ${next.validDays} day${next.validDays === 1 ? "" : "s"}`
          : "Automatic abandoned checkout offer off",
      },
    });

    return successResponse(
      { rule: next, ...storeView(settings) },
      next.enabled ? "Automatic offer saved" : "Automatic offer turned off",
    );
  },
);
