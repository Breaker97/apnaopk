import "server-only";

import { Order } from "@/models";
import {
  buildReturnTerms,
  returnTermsDiffer,
  storedReturnTerms,
  type ReturnPolicySettingsLike,
} from "@/lib/returns/return-policy";

/**
 * Write the rules an order was sold under onto every order that has none,
 * just before the store changes them.
 *
 * Orders placed before terms were stored carry none, and read the settings as
 * every order always did. That is only honest until the rules change: from
 * then on those orders would be answered by rules nobody showed their
 * shoppers. So the first change after upgrading freezes the old rules onto
 * them, and from then on a change reaches future orders only, which is
 * Shopify's rule. No migration has to be run for it.
 *
 * Must run BEFORE the new settings are saved: in between, a return on one of
 * those orders would be priced under the new rules.
 *
 * @returns how many orders were given terms (0 when the rules did not change,
 *   or when every order already had its own).
 */
export async function freezeLegacyReturnTerms(params: {
  before: ReturnPolicySettingsLike | null | undefined;
  after: ReturnPolicySettingsLike | null | undefined;
  now?: Date;
}): Promise<number> {
  const before = buildReturnTerms(params.before);
  if (!returnTermsDiffer(before, buildReturnTerms(params.after))) return 0;

  const result = await Order.updateMany(
    { returnTerms: { $exists: false } },
    {
      $set: {
        returnTerms: {
          ...storedReturnTerms(before),
          source: "legacy",
          capturedAt: params.now ?? new Date(),
        },
      },
    },
  );
  return result.modifiedCount ?? 0;
}
