import "server-only";

import { diagnoseDefaultVendor } from "@/lib/vendors/multi-vendor";

/**
 * Marks a sanitized settings payload with what is wrong with the house store
 * profile (the default vendor), if anything: `_meta.storeProfileMissing` and
 * `_meta.storeProfileProblem` (`missing` | `no_owner` | `needs_review`).
 *
 * The profile is made on first need by the product form, inventory, POS and
 * the rest, and by saving Settings → General — but not when every admin owns
 * a store of their own, or when an older profile probably exists. The General
 * tab says which, and offers Save as it is for the plain `missing` case.
 *
 * A read, never a repair. When the lookup itself fails, nothing is claimed
 * either way.
 */
export async function withStoreProfileStatus<T extends Record<string, unknown>>(
  payload: T,
): Promise<T> {
  try {
    const problem = await diagnoseDefaultVendor();
    const meta = (payload._meta ?? {}) as Record<string, unknown>;
    meta.storeProfileMissing = problem !== null;
    if (problem) meta.storeProfileProblem = problem;
    else delete meta.storeProfileProblem;
    (payload as Record<string, unknown>)._meta = meta;
  } catch {
    // Unknown: the page simply behaves as before.
  }
  return payload;
}
