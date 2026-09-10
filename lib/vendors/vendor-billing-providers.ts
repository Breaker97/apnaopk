/**
 * Provider-aware gate for vendor plan billing. The historical gate was
 * assertStripeBillingReady — with multi-gateway collection, approving or
 * charging a paid vendor requires only that at least ONE gateway from the
 * subscription allowlist is usable. Stripe-specific paths (billing portal,
 * plan-change staging) keep calling assertStripeBillingReady directly.
 */

import type { ISettings } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import { resolvePlatformPaymentMethods } from "@/lib/payments/platform-payments";
import type { PlatformPaymentGateway } from "@/config/app.config";

/** Gateways vendors may pay plan subscriptions through. */
export function resolveVendorBillingProviders(
  settings: ISettings,
): PlatformPaymentGateway[] {
  return resolvePlatformPaymentMethods(
    settings,
    settings.vendorConfig?.paymentMethods,
  );
}

/** Throws unless at least one subscription gateway is enabled + configured. */
export function assertVendorBillingReady(
  settings: ISettings,
): PlatformPaymentGateway[] {
  const providers = resolveVendorBillingProviders(settings);
  if (providers.length === 0) {
    throw new ValidationError(
      "No payment gateway is enabled for vendor subscriptions. Enable one in Admin → Settings → Payments before offering paid vendor plans.",
    );
  }
  return providers;
}
