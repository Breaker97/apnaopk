import { Types } from "mongoose";
import { Payout } from "@/models";
import { roundMoney } from "@/lib/intl/money";
import {
  emptyRefundBreakdown,
  payableInCurrency,
  sumVendorPayable,
  type OrderRefundBreakdown,
  type PayableOrderLike,
  type PayableSubOrderLike,
} from "@/lib/vendors/vendor-earnings";

/**
 * The rolling reserve on pre-order payouts.
 *
 * Why a pre-order and not every sale: a card network counts its dispute window
 * from the EXPECTED DELIVERY date, not the purchase date. A shopper who
 * pre-orders in September for a December drop can still dispute in March —
 * months after the vendor was paid, and after the platform's own gateway
 * balance has moved on. On a normal sale the two dates are days apart and the
 * existing delivered-gated payout is protection enough; on a pre-order they are
 * a season apart, and it is not.
 *
 * The mechanism rides on `Payout.adjustments`, which already carries exactly
 * this shape of correction — the overpayment recovery withholds now and settles
 * later, and this is its mirror. Nothing about sub-order eligibility changes,
 * so `payoutStatus` stays the binary it has always been: a consignment is paid
 * once, and the reserve is a line on the payout rather than a half-paid
 * consignment nothing could represent.
 *
 * Off unless a store turns it on (`preorder.reservePercent` defaults to 0).
 * Withholding a vendor's money is a policy someone chooses, not a default a
 * version bump imposes.
 */

/** A sub-order is reservable when it actually carries pre-order lines. */
function isPreorderSubOrder(sub: PayableSubOrderLike): boolean {
  const items = (sub as { items?: Array<{ purchaseType?: string }> | null }).items;
  return (items || []).some((item) => item?.purchaseType === "preorder");
}

/**
 * How much of a payout should be held back.
 *
 * Measured on the pre-order consignments alone — a payout mixing a pre-order
 * with ordinary sales holds a slice of the former and pays the latter in full,
 * because only the former carries the long dispute tail.
 */
export function computePreorderReserve<
  TOrder extends PayableOrderLike & {
    _id?: unknown;
    subOrders?: PayableSubOrderLike[] | null;
  },
>(params: {
  orders: ReadonlyArray<TOrder>;
  vendorId: Types.ObjectId | string;
  refundByOrderId: ReadonlyMap<string, OrderRefundBreakdown>;
  /** The same predicate the payout used, so both see one set of rows. */
  isPayable: (sub: PayableSubOrderLike) => boolean;
  storeCurrency: string;
  payoutCurrency: string;
  percent: number;
}): number {
  if (!(params.percent > 0)) return 0;

  const { netAmount } = payableInCurrency(
    sumVendorPayable(
      params.orders,
      params.vendorId,
      params.refundByOrderId,
      (sub) => params.isPayable(sub) && isPreorderSubOrder(sub),
      params.storeCurrency,
    ),
    params.payoutCurrency,
  );

  return Math.max(0, roundMoney((netAmount * params.percent) / 100));
}

/**
 * Take ownership of every matured reserve this payout is going to pay out.
 *
 * Claimed BEFORE the payout's amount is worked out, and stamped with the
 * payout that claimed them — the same shape as the sub-order claim a few lines
 * up the route. Reading them first and marking them afterwards was wrong twice
 * over: two payout runs for one vendor both read the same rows and both added
 * the money, and a marking step that failed (it is logged, not thrown) left the
 * rows unreleased for the next payout to pay a second time. Either way the
 * vendor is paid the same reserve twice, and nothing says so.
 *
 * The amount returned is what was ACTUALLY claimed, read back by this payout's
 * own id, so it can never exceed what this run won. A concurrent run that
 * loses simply picks the reserve up next time, which is the safe direction to
 * fail in.
 *
 * A cancelled or failed payout is skipped: its money never left, so there is
 * nothing held to give back.
 */
export async function claimMaturedReserves(params: {
  vendorId: Types.ObjectId | string;
  currency: string;
  payoutId: unknown;
  now?: Date;
}): Promise<{ amount: number; count: number }> {
  const now = params.now || new Date();
  const matured = {
    vendorId: new Types.ObjectId(String(params.vendorId)),
    currency: params.currency.toUpperCase(),
    preorderReserveHeld: { $gt: 0 },
    preorderReserveReleasedAt: null,
    preorderReserveReleaseAt: { $lte: now },
    status: { $nin: ["cancelled", "failed"] },
  };

  // The candidates first, so every query below is bounded by `_id`. Reading
  // the claim back by the payout stamp alone had no index to use and scanned
  // every payout the store has ever made, on every payout run. The claim
  // itself stays conditional, so a concurrent run that saw the same rows
  // stamps none of them and reads back nothing.
  const candidates = await Payout.find(matured).select("_id").lean();
  if (candidates.length === 0) return { amount: 0, count: 0 };
  const ids = candidates.map((row) => row._id);

  await Payout.updateMany(
    { ...matured, _id: { $in: ids } },
    {
      $set: {
        preorderReserveReleasedAt: now,
        preorderReserveReleasedInPayoutId: params.payoutId,
      },
    },
  );

  const claimed = await Payout.find({
    _id: { $in: ids },
    preorderReserveReleasedInPayoutId: params.payoutId,
  })
    .select("preorderReserveHeld")
    .lean();

  return {
    amount: roundMoney(
      claimed.reduce((sum, row) => sum + Number(row.preorderReserveHeld || 0), 0),
    ),
    count: claimed.length,
  };
}

/**
 * Give the claimed reserves back, for a payout that never happened.
 *
 * Every path in the payout route that abandons its work deletes the payout row
 * and throws; without this the reserves it claimed on the way would stay marked
 * released against a payout that does not exist, and nobody would ever be paid
 * them. Scoped to the vendor, whose index narrows it — a payout only ever
 * claims its own vendor's reserves.
 */
export async function unclaimReserves(params: {
  vendorId: Types.ObjectId | string;
  payoutId: unknown;
}): Promise<number> {
  const result = await Payout.updateMany(
    {
      vendorId: new Types.ObjectId(String(params.vendorId)),
      preorderReserveReleasedInPayoutId: params.payoutId,
    },
    {
      $set: { preorderReserveReleasedAt: null },
      $unset: { preorderReserveReleasedInPayoutId: "" },
    },
  );
  return result.modifiedCount ?? 0;
}

/** What a vendor is still holding in reserve, for the finance screens. */
export async function sumHeldReserve(params: {
  vendorId: Types.ObjectId | string;
  currency?: string;
}): Promise<number> {
  const rows = await Payout.find({
    vendorId: new Types.ObjectId(String(params.vendorId)),
    ...(params.currency ? { currency: params.currency.toUpperCase() } : {}),
    preorderReserveHeld: { $gt: 0 },
    preorderReserveReleasedAt: null,
    status: { $nin: ["cancelled", "failed"] },
  })
    .select("preorderReserveHeld")
    .lean();
  return roundMoney(
    rows.reduce((sum, row) => sum + Number(row.preorderReserveHeld || 0), 0),
  );
}

export { emptyRefundBreakdown };
