/**
 * What an admin settings save could not do although it stored the settings,
 * sent back as codes in the saved payload's `_meta.saveWarnings` and worded by
 * the settings screen in the admin's language. Pure: the browser imports it.
 */

/**
 * The house store profile (the default vendor), which the product form,
 * inventory and the POS all scope to, could not be created or updated from
 * the saved settings. Saving again repeats the attempt.
 */
export const DEFAULT_VENDOR_SYNC_FAILED = "default_vendor_sync_failed";

/**
 * The profile is missing and may not be made because every admin already owns
 * a store of their own (a store has one owner). An admin account without a
 * store lets the next save make it.
 */
export const DEFAULT_VENDOR_NO_OWNER = "default_vendor_no_owner";

/**
 * The profile is missing, but an admin-owned store holds the admin catalog and
 * is probably the house of an older install. Nothing was made; a person picks
 * it with `pnpm db:migrate house-profile -- --adopt <id>`.
 */
export const DEFAULT_VENDOR_NEEDS_REVIEW = "default_vendor_needs_review";

export type SettingsSaveWarning =
  | typeof DEFAULT_VENDOR_SYNC_FAILED
  | typeof DEFAULT_VENDOR_NO_OWNER
  | typeof DEFAULT_VENDOR_NEEDS_REVIEW;
