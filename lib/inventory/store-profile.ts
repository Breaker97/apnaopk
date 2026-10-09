/**
 * The error codes a path answers with when the house store's profile (the
 * default vendor) is not there and may not be made. Paths make it themselves
 * on first need (`ensureDefaultVendorId`); these are the cases where they may
 * not, each with a different thing for the merchant to do:
 *
 * - `STORE_PROFILE_MISSING`: it could not be made just now (a database fault).
 *   Saving Settings → General makes it, as it always has.
 * - `STORE_PROFILE_NO_OWNER`: every admin already owns a store of their own,
 *   and a store has exactly one owner. An admin account without a store fixes
 *   it.
 * - `STORE_PROFILE_NEEDS_REVIEW`: an older profile probably exists under an
 *   admin's own store, so a new one would split the catalog. A person picks it
 *   with `pnpm db:migrate house-profile -- --adopt <id>`.
 * - `STORE_NOT_READY`: the shopper-facing face of the three, on checkout.
 *
 * Pure on purpose: the product editor and the settings screen import it.
 */
export const STORE_PROFILE_MISSING = "STORE_PROFILE_MISSING";
export const STORE_PROFILE_NO_OWNER = "STORE_PROFILE_NO_OWNER";
export const STORE_PROFILE_NEEDS_REVIEW = "STORE_PROFILE_NEEDS_REVIEW";
export const STORE_NOT_READY = "STORE_NOT_READY";

/** What a merchant is told about the house profile, if anything is wrong. */
export type StoreProfileProblem = "missing" | "no_owner" | "needs_review";

/** The API code for a profile problem. */
export function storeProfileErrorCode(problem: StoreProfileProblem): string {
  if (problem === "no_owner") return STORE_PROFILE_NO_OWNER;
  if (problem === "needs_review") return STORE_PROFILE_NEEDS_REVIEW;
  return STORE_PROFILE_MISSING;
}

/** Whether an API code is one of the profile codes above (not checkout's). */
export function isStoreProfileErrorCode(code: unknown): boolean {
  return (
    code === STORE_PROFILE_MISSING ||
    code === STORE_PROFILE_NO_OWNER ||
    code === STORE_PROFILE_NEEDS_REVIEW
  );
}
