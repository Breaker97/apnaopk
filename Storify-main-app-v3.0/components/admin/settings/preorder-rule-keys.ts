import type { Settings } from "./types";

type PreorderSettings = Settings["preorder"];

/**
 * `settings.preorder` is edited from two pages. What bounds a vendor's promise
 * lives with the marketplace (Settings → Multi-Vendor Mode); what every
 * pre-order follows, the store's own included, lives beside the pre-order
 * switch (Settings → Products). The cron applies expiry and auto-release to
 * every order, so those two sat on the wrong page while they were "vendor
 * rules". Each page compares and saves only its own keys, so saving one never
 * writes, or reports as unsaved, an edit made on the other.
 */
export const VENDOR_PREORDER_KEYS = [
  "requireVendorApproval",
  "maxLeadDays",
  "maxDepositPercent",
  "reservePercent",
  "reserveDays",
] as const satisfies readonly (keyof PreorderSettings)[];

export const STORE_PREORDER_KEYS = [
  "enabled",
  "autoRelease",
  "autoReleaseDelayDays",
  "expiryGraceDays",
  "balanceChargeNoticeHours",
] as const satisfies readonly (keyof PreorderSettings)[];

/** The given keys of `preorder`, leaving out the ones it does not hold. */
export function pickPreorderRules<K extends keyof PreorderSettings>(
  preorder: Partial<PreorderSettings> | undefined,
  keys: readonly K[],
): Partial<Pick<PreorderSettings, K>> {
  const picked: Partial<Pick<PreorderSettings, K>> = {};
  for (const key of keys) {
    const value = preorder?.[key];
    if (value !== undefined) picked[key] = value as PreorderSettings[K];
  }
  return picked;
}
