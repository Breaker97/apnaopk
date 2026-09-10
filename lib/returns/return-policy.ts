/**
 * The four rules a return has always been answered by, made explicit.
 *
 * Every one of these was a hardcoded zero: delivery was never refunded, there
 * was never a restocking fee, the platform always handed its whole commission
 * back, and a vendor who collected cash on delivery was never billed for the
 * delivery they had physically taken. Those are business decisions, and a
 * constant is not a decision — it is a decision nobody knew they had made.
 *
 * Every default here reproduces exactly that behaviour, so an install that
 * never opens the settings screen sees no change to a single figure. The
 * policies only do something once a merchant turns them on.
 *
 * Dependency-free and pure, like `lib/order-settings.ts`: the rules are read by
 * an API route, the refund allocation and the payout arithmetic, and they only
 * stay in step if all three read the same resolver.
 */

/** When delivery comes back along with the goods. */
export const RETURN_SHIPPING_REFUND_MODES = [
  /** Never — the shopper received the delivery they paid for. */
  "never",
  /** Only when the return is the merchant's fault. */
  "merchant_fault",
  /** Always, whatever the reason. */
  "always",
] as const;

export type ReturnShippingRefundMode =
  (typeof RETURN_SHIPPING_REFUND_MODES)[number];

/**
 * What an install with nothing stored falls back to.
 *
 * Stays `never` forever. Every store that predates these settings has no value
 * saved, and this is the promise that their refunds did not change underneath
 * them when the settings were added.
 */
export const DEFAULT_RETURN_SHIPPING_REFUND: ReturnShippingRefundMode = "never";

/**
 * What a store created from now on STARTS on.
 *
 * A different constant from the fallback above, and deliberately so. A new
 * shop has no history to protect and every reason to begin where the rest of
 * the world ended up: a shopper sent a broken item should not be paying the
 * delivery on it, and a merchant who never opens the settings screen should
 * not be quietly charging them for it.
 *
 * This is written into the settings document at INSERT (see
 * `loadSettingsDocument`), never used as a schema default — Mongoose applies a
 * schema default when hydrating an existing document too, so making this the
 * schema default would change the refunds of every install whose stored
 * `orders.returns` subtree predates it. Which is exactly the promise above.
 */
export const NEW_STORE_RETURN_SHIPPING_REFUND: ReturnShippingRefundMode =
  "merchant_fault";
export const DEFAULT_RESTOCKING_FEE_PERCENT = 0;
export const DEFAULT_RETURN_SHIPPING_FEE = 0;
export const DEFAULT_REFUND_ADMIN_FEE_PERCENT = 0;
export const DEFAULT_REFUND_ADMIN_FEE_CAP = 0;
export const DEFAULT_BILL_VENDOR_COD_SHIPPING = false;

/**
 * The reasons that put the return on the merchant rather than the shopper.
 *
 * Drawn from `RETURN_REASONS` in lib/returns.ts. A shopper who ordered the
 * wrong size chose to send it back; a shopper sent a broken item did not, and
 * charging them for the delivery of goods they could not use is what return
 * policies everywhere treat as the merchant's cost.
 */
export const MERCHANT_FAULT_RETURN_REASONS = [
  "damaged_or_defective",
  "not_as_described",
  "wrong_item_received",
  // A parcel that turns up late is a fulfilment failure, not a decision the
  // shopper made — they ordered in time and the delivery promise was the
  // merchant's to keep. It sat in the remorse bucket until now, which charged
  // the shopper for a deadline somebody else missed.
  "arrived_late",
] as const;

export interface ReturnPolicy {
  shippingRefund: ReturnShippingRefundMode;
  /** Percent of the returned goods the merchant keeps. 0–100. */
  restockingFeePercent: number;
  /** Flat charge for the return leg, deducted from the refund. */
  returnShippingFee: number;
  /**
   * Percent of the platform's commission it keeps when a sale is returned.
   * 0–100. Amazon's equivalent is 20%, capped — the platform paid to process
   * a sale that then un-happened, and the gateway does not refund its own fee.
   */
  refundAdminFeePercent: number;
  /** Ceiling on that fee per return. 0 means uncapped. */
  refundAdminFeeCap: number;
  /**
   * Whether a vendor who collected cash on delivery owes the platform the
   * delivery charge along with the commission.
   *
   * Off by default because it depends on who actually arranged the carrier,
   * which Storify does not record. On a store where the platform sets the
   * shipping price and the vendor merely collects it, this is money the
   * platform is currently never billing for. See finding F5 in the audit.
   */
  billVendorCodShipping: boolean;
}

/** The settings shape this reads — kept loose so a caller can pass the doc. */
export interface ReturnPolicySettingsLike {
  orders?: {
    returns?: {
      shippingRefund?: string | null;
      restockingFeePercent?: number | null;
      returnShippingFee?: number | null;
      refundAdminFeePercent?: number | null;
      refundAdminFeeCap?: number | null;
      billVendorCodShipping?: boolean | null;
    } | null;
  } | null;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * The policy in force, with every unset or unrecognised value falling back to
 * the behaviour Storify had before these settings existed.
 *
 * Failing to the old behaviour rather than to a "sensible" new one is the whole
 * point: a store that has never seen this screen must not discover that its
 * refunds changed because a field was added.
 */
export function resolveReturnPolicy(
  settings: ReturnPolicySettingsLike | null | undefined,
): ReturnPolicy {
  const raw = settings?.orders?.returns ?? null;
  const mode = String(raw?.shippingRefund || "").trim();

  return {
    shippingRefund: (RETURN_SHIPPING_REFUND_MODES as readonly string[]).includes(
      mode,
    )
      ? (mode as ReturnShippingRefundMode)
      : DEFAULT_RETURN_SHIPPING_REFUND,
    restockingFeePercent: clamp(
      raw?.restockingFeePercent,
      0,
      100,
      DEFAULT_RESTOCKING_FEE_PERCENT,
    ),
    returnShippingFee: clamp(
      raw?.returnShippingFee,
      0,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_RETURN_SHIPPING_FEE,
    ),
    refundAdminFeePercent: clamp(
      raw?.refundAdminFeePercent,
      0,
      100,
      DEFAULT_REFUND_ADMIN_FEE_PERCENT,
    ),
    refundAdminFeeCap: clamp(
      raw?.refundAdminFeeCap,
      0,
      Number.MAX_SAFE_INTEGER,
      DEFAULT_REFUND_ADMIN_FEE_CAP,
    ),
    billVendorCodShipping:
      raw?.billVendorCodShipping === true
        ? true
        : DEFAULT_BILL_VENDOR_COD_SHIPPING,
  };
}

/**
 * Is this return the merchant's failure rather than the shopper's choice?
 *
 * The reason alone decides it, with no policy mode involved, because the two
 * questions a mode could answer are not the same question. A store may choose
 * whether to hand delivery back; it does not get to choose whether a broken
 * item was its own fault.
 *
 * So the fee waivers read this, and only the delivery refund reads
 * `shouldRefundReturnShipping` — where `always` is a store being generous about
 * DELIVERY, not a store declaring every return its own failure. Gated on the
 * mode instead, an `always` store would have stopped charging the restocking
 * fee it deliberately configured.
 */
export function isMerchantFaultReturn(
  reason: string | null | undefined,
): boolean {
  return (MERCHANT_FAULT_RETURN_REASONS as readonly string[]).includes(
    String(reason || "").trim(),
  );
}

/**
 * The merchant's own determination, when they have made one.
 *
 * The shopper picks the reason and it decides money, so a shopper who picks
 * "damaged" on a change of mind harvests a delivery refund, and a genuine
 * defect described under "other" silently loses one. Neither is settled by
 * arguing about the dropdown — it is settled by somebody opening the parcel.
 *
 * So the stated reason stays exactly as the shopper wrote it, and the
 * merchant's finding is recorded ALONGSIDE it rather than overwriting it. The
 * record then shows both, which is what anyone reviewing a disputed return
 * actually needs to see.
 */
export function resolveReturnFault(request: {
  reason?: string | null;
  faultOverride?: { merchantAtFault?: boolean | null } | null;
}): boolean {
  const override = request.faultOverride?.merchantAtFault;
  if (typeof override === "boolean") return override;
  return isMerchantFaultReturn(request.reason);
}

/** Does delivery come back, given who the return turned out to be down to? */
export function shouldRefundReturnShippingForFault(
  mode: ReturnShippingRefundMode,
  merchantAtFault: boolean,
): boolean {
  if (mode === "always") return true;
  if (mode !== "merchant_fault") return false;
  return merchantAtFault;
}

/** Does delivery come back on a return made for `reason`? */
export function shouldRefundReturnShipping(
  mode: ReturnShippingRefundMode,
  reason: string | null | undefined,
): boolean {
  return shouldRefundReturnShippingForFault(mode, isMerchantFaultReturn(reason));
}

/**
 * What the platform keeps out of the commission it would otherwise hand back.
 *
 * Taken off the commission, never off the shopper's refund — they are made
 * whole either way. The fee moves the cost of a processed-then-reversed sale
 * from the platform to the vendor who made it, which is the arrangement every
 * large marketplace settled on.
 *
 * Never more than the commission itself: a fee larger than the cut it is taken
 * from would have the platform earning money by refunding.
 */
export function refundAdminFeeFor(
  commissionBeingRefunded: number,
  policy: Pick<ReturnPolicy, "refundAdminFeePercent" | "refundAdminFeeCap">,
): number {
  const commission = Number(commissionBeingRefunded);
  if (!Number.isFinite(commission) || commission <= 0) return 0;
  if (policy.refundAdminFeePercent <= 0) return 0;

  const fee = (commission * policy.refundAdminFeePercent) / 100;
  const capped =
    policy.refundAdminFeeCap > 0 ? Math.min(fee, policy.refundAdminFeeCap) : fee;
  return Math.min(commission, Math.max(0, capped));
}

/**
 * Delivery a DISPATCHED order cannot hand back.
 *
 * Once the parcel has left the carrier has been paid, and that money
 * is not sitting anywhere to be returned — it left for a third party the day
 * the courier collected. Refunding it does not move it back from the carrier;
 * it takes it out of the merchant a second time, for a service that was
 * performed correctly.
 *
 * So once an order has shipped the delivery charge comes off what a refund can
 * reach, and the goods and their tax are what remains. On an order still
 * sitting unshipped nothing has been spent, so all of it is refundable — which
 * is what cancelling before dispatch is, and it must not be caught by this.
 *
 * `always` is the store saying it would rather absorb the carrier fee than
 * argue about it, and `merchant_fault` is not decided here: an order-level
 * refund carries no return reason to decide it with, so the delivery stays out
 * of the automatic figure and an admin who means to refund it names it.
 */
export function unrefundableDeliveryFor(params: {
  policy: Pick<ReturnPolicy, "shippingRefund">;
  /**
   * Whether the parcel has left — shipped or delivered.
   *
   * DISPATCH is the moment the money goes, not arrival. The label is bought
   * and the courier takes the parcel days before the shopper signs for it, and
   * a cancellation in that window does not get the carrier fee back either.
   * Waiting for  would have handed back a fee already spent on
   * every order still in transit.
   */
  dispatched: boolean;
  /** What the shopper was charged for delivery, after any free-shipping coupon. */
  chargedShipping: number;
  /** Delivery already handed back by earlier refunds. */
  alreadyRefunded?: number;
}): number {
  if (!params.dispatched) return 0;
  if (params.policy.shippingRefund === "always") return 0;

  const charged = Math.max(0, Number(params.chargedShipping) || 0);
  const already = Math.max(0, Number(params.alreadyRefunded) || 0);
  return Math.max(0, charged - already);
}
