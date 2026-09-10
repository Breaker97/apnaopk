/**
 * Vendor commission — the single source of truth for a vendor's effective
 * commission rate.
 *
 * `resolveVendorCommission` is a PURE function: callers pass already-loaded
 * docs, no DB reads happen here. Its result is written to `Vendor.commission`
 * (the enforcement cache) at write/seed moments only — vendor apply, admin
 * create, plan assignment, and subscription expiry. The order/payout path never
 * calls this; it reads the cached `Vendor.commission` number, so the money path
 * stays inert to plans.
 *
 * Precedence (highest → lowest):
 *   1. the default (admin-owned) store          → 0   (never billed)
 *   2. an applicable subscription plan           → plan.commissionRate
 *   3. settings.orders.commission.vendorRate     → the configured default
 *   4. DEFAULT_VENDOR_COMMISSION_RATE            → the built-in fallback
 *
 * A change to the SETTINGS rate reaches existing vendors through
 * `lib/commission-reprojection.ts`, which the settings save runs: it moves every
 * vendor still sitting on the old default and leaves per-vendor overrides alone,
 * which it can only do because `Vendor.commissionSource` records which of the
 * two a given number is.
 *
 * A change to a PLAN's `commissionRate` deliberately does not. Subscribers keep
 * `commissionRateSnapshot`, the terms they signed up under, across renewals —
 * the same grandfathering a boost gets from `boostTerms`. Editing a plan changes
 * what new subscribers are charged, not what existing ones are.
 *
 * The caller passes `plan` ONLY when it should apply (i.e. the vendor has an
 * active/trialing subscription to it); this keeps subscription-status logic out
 * of the resolver.
 */

import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";

interface CommissionVendorLike {
  isDefault?: boolean;
  slug?: string;
}

interface CommissionPlanLike {
  commissionRate?: number;
}

export interface CommissionSettingsLike {
  orders?: { commission?: { vendorRate?: number } } | null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VENDOR_COMMISSION_RATE;
  return Math.max(0, Math.min(100, value));
}

export function resolveVendorCommission(
  vendor: CommissionVendorLike | null | undefined,
  plan: CommissionPlanLike | null | undefined,
  settings: CommissionSettingsLike | null | undefined,
): number {
  // The default (admin-owned) store is never billed a commission.
  if (vendor && isDefaultVendorRecord(vendor)) return 0;

  if (plan && typeof plan.commissionRate === "number") {
    return clampPercent(plan.commissionRate);
  }

  const settingsRate = settings?.orders?.commission?.vendorRate;
  if (typeof settingsRate === "number" && Number.isFinite(settingsRate)) {
    return clampPercent(settingsRate);
  }

  return DEFAULT_VENDOR_COMMISSION_RATE;
}
