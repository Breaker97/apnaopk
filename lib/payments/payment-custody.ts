/**
 * Who is actually holding an order's money.
 *
 * Every payout formula in this codebase assumes the platform collected the
 * money and is handing the vendor their share of it. For a cash sale that is
 * backwards: the merchant took the notes over their own counter, so they are
 * already holding 100% of the order — and the platform is the one owed its
 * commission, not the other way round.
 *
 * Paying such an order out anyway costs the platform twice: it sends the
 * merchant `vendorEarnings` in money it never received, AND it never collects
 * the commission it was owed. So this is the gate that decides whether an order
 * may enter a payout at all.
 *
 * Deliberately free of `server-only` and of any import, exactly as
 * `lib/locations/dispatch-order.ts` is: the rule is asserted in tests and is
 * needed by both a Mongo query and plain object checks.
 *
 * **Only affects marketplace mode.** The default (admin-owned) store is never
 * billed a commission and payout creation refuses it outright, so a
 * single-vendor install never reaches this rule.
 */

/**
 * The methods that settle onto the platform's own gateway credentials.
 *
 * An ALLOWLIST, deliberately, and it is the whole of the storefront rule. The
 * first version of this listed the self-collected methods instead and was
 * wrong within a day: `manual_pending` — the unpaid twin of `manual`, written
 * by the admin order form — was not on it, so those orders read as
 * platform-settled and stayed payable. A list of what to exclude fails open,
 * and failing open here means paying a merchant money that never arrived.
 *
 * So an unrecognised method is treated as the merchant's. Adding a gateway
 * means adding it here; forgetting to withholds a payout, which someone
 * complains about the same week. The alternative failure is silent and
 * permanent.
 *
 * Mirrors the checkout enum in `lib/validations/index.ts` minus `cod`.
 */
import {
  isPlatformCollectedCod,
  type CodCustodySubOrder,
} from "@/lib/payments/cod-collection";

export const PLATFORM_GATEWAY_PAYMENT_METHODS = [
  "card",
  "paypal",
  "razorpay",
  "paystack",
  "pesapal",
  "iotec",
  // Orange Money settles into the platform's Orange merchant account, so the
  // platform holds the money and owes the vendor a payout. That it also sits in
  // refund-settlement's OUT_OF_BAND_METHODS is not a contradiction: this list
  // answers "who collected it", that one answers "can a gateway push it back".
  "orange_money",
  // Same custody as Orange Money: requesttopay settles into the platform's
  // MoMo collections account.
  "mtn_momo",
] as const;

/** The order fields the custody rule reads. */
export type PaymentCustodyOrder = {
  paymentMethod?: string | null;
  channel?: string | null;
  stripePaymentIntentId?: string | null;
};

/**
 * COD custody is per consignment, so its query half cannot live in the
 * order-level `$or` this module contributes — it belongs inside the caller's
 * `$elemMatch`. Re-exported here so the two halves of a payout filter are
 * imported from one place.
 */
export { platformCollectedCodMatch, vendorCollectedCodMatch } from "@/lib/payments/cod-collection";

/**
 * Whether the platform received this order's money.
 *
 * The POS arm exists because `lib/pos/payment.ts` normalises both `card_touch`
 * and `card_stripe` down to a bare `"card"` before it reaches the order — the
 * original only survives in `paymentMetadata`. Those two are opposites for this
 * question: `card_touch` is the merchant's own terminal (their money), while
 * `card_stripe` is charged against the platform's Stripe account (ours). What
 * tells them apart on the order itself is the payment intent, which the POS
 * route writes only after verifying it, so its presence is the honest signal.
 */
export function isPlatformSettled(
  order: PaymentCustodyOrder,
  /**
   * The consignment being asked about. Required only to answer for COD, where
   * custody is not a property of the payment method at all but of who handed
   * the goods over — so it is stamped per consignment at checkout.
   *
   * Omitting it answers "vendor" for COD, which is what every caller assumed
   * before platform-collected COD existed and what every un-stamped order
   * still behaves as.
   */
  subOrder?: CodCustodySubOrder | null,
): boolean {
  const method = String(order.paymentMethod || "").toLowerCase();

  if (String(order.channel || "").toLowerCase() === "pos") {
    return (
      method === "card" &&
      Boolean(String(order.stripePaymentIntentId || "").trim())
    );
  }

  // The platform's own courier collected the notes and banked them. The vendor
  // never touched that money, so it is the platform's to hold and the vendor
  // is owed their earnings out of it — the exact opposite of a vendor-van COD
  // sale, which this used to classify every COD order as.
  if (method === "cod") return isPlatformCollectedCod(subOrder);

  return (PLATFORM_GATEWAY_PAYMENT_METHODS as readonly string[]).includes(method);
}

/**
 * MongoDB equivalent of {@link isPlatformSettled}.
 *
 * Lives beside the function it mirrors for the same reason
 * `collectableAtBranchesQuery` lives beside `branchStocksLine`: an order the
 * query pays out but the predicate calls self-collected — or the reverse — is
 * money moving on a rule nothing agrees on, and the two only stay in step if
 * they are read together.
 *
 * Owns the `$or` key of whatever filter it is spread into. A caller that needs
 * its own `$or` must combine both under `$and` rather than let one overwrite
 * the other.
 */
export function platformSettledOrderFilter(): Record<string, unknown> {
  return {
    $or: platformSettledArms(),
  };
}

/**
 * The complement: orders whose money the merchant took themselves.
 *
 * Built by negating the same arms rather than by listing the self-collected
 * cases, so the two can never describe overlapping or gapped sets — an order
 * that is neither payable nor commission-owed is money that simply vanishes
 * from both ledgers.
 *
 * Contributes `$nor`, so it composes with a filter that already carries `$or`.
 */
export function selfCollectedOrderFilter(): Record<string, unknown> {
  return {
    $nor: platformSettledArms(),
  };
}

/** The one definition of "the platform received this", as query arms. */
function platformSettledArms(): Record<string, unknown>[] {
  return [
    {
      // `$ne: "pos"` rather than `= "online"`: orders written before the
      // channel field existed carry nothing, and they are all storefront
      // orders that settled on a gateway.
      channel: { $ne: "pos" },
      paymentMethod: { $in: [...PLATFORM_GATEWAY_PAYMENT_METHODS] },
    },
    {
      channel: "pos",
      paymentMethod: "card",
      // A missing field compares equal to null in Mongo, so this arm also
      // rejects the `card_touch` sale that never had an intent at all.
      stripePaymentIntentId: { $nin: [null, ""] },
    },
  ];
}
