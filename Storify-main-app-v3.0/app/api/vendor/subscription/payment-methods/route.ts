/**
 * GET /api/vendor/subscription/payment-methods
 * The gateways this vendor may pay subscription charges through (allowlist ∩
 * enabled gateways). Feeds the payment-method picker on the gate screen,
 * the payment-required alert, and the renew flow.
 */

import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { getSettings } from "@/models/settings.model";
import { resolveVendorBillingProviders } from "@/lib/vendors/vendor-billing-providers";

export const GET = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:subscription:methods", preset: "lenient" },
  },
  async () => {
    const settings = await getSettings();
    if (
      !settings.multiVendorMode?.enabled ||
      !settings.vendorConfig?.plansEnabled
    ) {
      throw new NotFoundError("Vendor plans");
    }
    return successResponse({
      paymentMethods: resolveVendorBillingProviders(settings),
      currency: (settings.general?.defaultCurrency || "USD").toUpperCase(),
    });
  },
);
