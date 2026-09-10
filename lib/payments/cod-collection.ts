import {
  COD_COLLECTED_BY,
  COD_COLLECTED_BY_INHERIT,
  type CodCollectedBy,
} from "@/config/app.config";

/**
 * Who takes the cash on a cash-on-delivery sale.
 *
 * `lib/payment-custody.ts` answers "did the platform receive this order's
 * money" for every gateway. COD is the one method it could not answer, because
 * the answer is not a property of the payment at all — it is a property of who
 * physically handed the goods over. A vendor's own van collects into the
 * vendor's pocket; the platform's courier collects into the platform's.
 *
 * So the answer is resolved once, at order creation, and STAMPED on the
 * consignment (`subOrders[].codCollectedBy`). Three reasons it is frozen
 * rather than looked up later:
 *
 *  - custody must stay a pure function of the order, or its Mongo mirror in
 *    `payment-custody.ts` cannot exist;
 *  - a merchant who changes the setting must not silently rewrite who owed
 *    whom on every historical order — the same reason `currency` is frozen at
 *    checkout;
 *  - the payout and commission queries have to be able to filter on it.
 *
 * Deliberately free of `server-only` and of any import beyond the config
 * enums, so it is testable and usable from both a query builder and a form.
 */

interface CodCollectorInput {
  /** Store-wide default, from `settings.shipping.codCollectedBy`. */
  storeDefault?: string | null;
  /** This vendor's own answer, or "inherit" to defer to the store. */
  vendorPreference?: string | null;
}

/**
 * Resolve at stamp time, from the store default and the vendor's override.
 *
 * Anything unrecognised resolves to `vendor`, which is what every order
 * written before this existed already behaves as — so an install that never
 * touches the setting sees no change at all.
 */
export function resolveCodCollector(
  input: CodCollectorInput,
): CodCollectedBy {
  const vendorPreference = String(input.vendorPreference || "").trim();
  if (vendorPreference === COD_COLLECTED_BY.PLATFORM) {
    return COD_COLLECTED_BY.PLATFORM;
  }
  if (vendorPreference === COD_COLLECTED_BY.VENDOR) {
    return COD_COLLECTED_BY.VENDOR;
  }
  // "inherit", empty, or anything unrecognised falls through to the store.
  if (
    vendorPreference === COD_COLLECTED_BY_INHERIT ||
    vendorPreference === ""
  ) {
    return String(input.storeDefault || "").trim() ===
      COD_COLLECTED_BY.PLATFORM
      ? COD_COLLECTED_BY.PLATFORM
      : COD_COLLECTED_BY.VENDOR;
  }
  return COD_COLLECTED_BY.VENDOR;
}

export type CodCustodySubOrder = {
  codCollectedBy?: string | null;
  fulfillment?: { method?: string } | null;
};

/**
 * Does the PLATFORM collect this consignment's cash?
 *
 * The stamp decides it, with one override the stamp cannot know at creation
 * time: a collection at the vendor's own counter is always the vendor's cash,
 * whoever the store's courier would have been. Nobody from the platform is
 * standing there.
 */
export function isPlatformCollectedCod(
  subOrder: CodCustodySubOrder | undefined | null,
): boolean {
  if (!subOrder) return false;
  if (subOrder.fulfillment?.method === "pickup") return false;
  return (
    String(subOrder.codCollectedBy || "") === COD_COLLECTED_BY.PLATFORM
  );
}

/**
 * The Mongo equivalent, as conditions on a sub-order.
 *
 * Lives beside the predicate it mirrors for the same reason
 * `platformSettledOrderFilter` lives beside `isPlatformSettled`: these two
 * decide which direction money moves, and they only stay in step if they are
 * read together. Spread into an `$elemMatch`, never at order level — the
 * question is about one consignment.
 */
export function platformCollectedCodMatch(): Record<string, unknown> {
  return {
    codCollectedBy: COD_COLLECTED_BY.PLATFORM,
    "fulfillment.method": { $ne: "pickup" },
  };
}

/** The complement, including every consignment with no stamp at all. */
export function vendorCollectedCodMatch(): Record<string, unknown> {
  return {
    $or: [
      { codCollectedBy: { $ne: COD_COLLECTED_BY.PLATFORM } },
      { "fulfillment.method": "pickup" },
    ],
  };
}
