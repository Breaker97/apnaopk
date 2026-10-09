import "server-only";

/**
 * Making a commission-rate change reach the vendors it should.
 *
 * `Vendor.commission` is an enforcement cache: the money path reads that number
 * and never re-derives it, which is what keeps orders inert to plan lookups.
 * The cost is that changing a rate in Settings did nothing at all to vendors who
 * already existed — only accounts onboarded afterwards ever saw it. An admin
 * raising the platform rate got silence, with no way to fix it but editing every
 * vendor by hand.
 *
 * The reason it was never simply swept is that `commission` is a bare number: a
 * bulk update cannot see the difference between a rate that is merely the store
 * default and one an admin negotiated for a single merchant, and would quietly
 * erase the second. `Vendor.commissionSource` is what makes the distinction
 * legible, so this sweep can move the defaults and leave every override alone.
 *
 * Plans are deliberately NOT swept. A subscriber's rate is frozen on their
 * subscription (`commissionRateSnapshot`) as the terms they signed up under —
 * the same grandfathering `boostTerms` gives a boost — so editing a plan's rate
 * changes what NEW subscribers get, not what existing ones are charged.
 */

import { Vendor } from "@/models";
import { connectDB } from "@/lib/db";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import type { CommissionSettingsLike } from "@/lib/vendors/vendor-commission";

type CommissionReprojection = {
  /** Vendors whose cached rate now matches the new default. */
  updated: number;
  /** The rate they were moved to. */
  rate: number;
};

/**
 * Push a changed store default onto every vendor still sitting on the old one.
 *
 * Skips, by construction:
 *  - the default (admin-owned) store, which is never billed a commission;
 *  - anyone on a plan, whose rate is their subscription's to state;
 *  - anyone an admin gave a specific rate, which is the whole point of the
 *    `commissionSource` field.
 */
export async function reprojectDefaultCommission(
  settings: CommissionSettingsLike,
): Promise<CommissionReprojection> {
  await connectDB();

  const rate = resolveVendorCommission(null, null, settings);

  const result = await Vendor.updateMany(
    {
      isDefault: { $ne: true },
      planId: null,
      // `$ne: "manual"` rather than `$in: ["default", null]` so a source value
      // added later still gets swept unless it is explicitly an override —
      // the safe direction is "keep charging", not "quietly stop".
      commissionSource: { $ne: "manual" },
    },
    { $set: { commission: rate, commissionSource: "default" } },
  );

  return { updated: result.modifiedCount, rate };
}
