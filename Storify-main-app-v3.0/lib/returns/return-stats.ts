import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, ReturnRequest } from "@/models";
import { getSettings } from "@/models/settings.model";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import { inStoreCurrencyExpr } from "@/lib/intl/currency-scope";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

interface ReturnStats {
  needsReview: number;
  onTheWayBack: number;
  refundDue: number;
  /** Of `refundDue`: a gateway refund that failed, or one nobody has sent by hand. */
  refundProblems: number;
  refundedCount: number;
  refundedAmount: number;
}

const REFUNDED_WINDOW_DAYS = 30;

/**
 * The returns a seller sees: the ones they own, plus a return from before
 * owners were recorded when it names that seller alone — see the single-return
 * route. The list route and the stats strip both read it from here, so the
 * counts above the table never cover rows the table itself would not show.
 */
export function vendorReturnsFilter(vendorId: Types.ObjectId) {
  return {
    $or: [
      { ownerType: "vendor", ownerVendorId: vendorId },
      { ownerType: { $exists: false }, vendorIds: [vendorId] },
    ],
  };
}

/**
 * The counts above the Returns table, one per question the page is opened
 * with: what is waiting on my decision, what is still on its way back, what
 * came back and is still owed, and what went out lately.
 *
 * A failed or `manual_required` refund is counted as owed whatever the status
 * says: a manual one reads "refunded", but no gateway carried the money and
 * nobody has recorded sending it. Refunds are counted and summed in the
 * store's currency only, like every other money card beside the store symbol.
 */
export async function fetchReturnStats(
  options: {
    staffScope?: StaffAccessScope | null;
    vendorId?: string;
  } = {},
): Promise<ReturnStats> {
  await connectDB();

  let match: Record<string, unknown> = options.vendorId
    ? vendorReturnsFilter(new Types.ObjectId(options.vendorId))
    : {};

  // Scoped the way the list route scopes its page: through the ORDER, because
  // a return carries none of the location or region fields the scope is
  // written in. Returns are few, so resolving their orders is cheap here.
  if (hasStaffScope(options.staffScope)) {
    const orderIds = await ReturnRequest.distinct("orderId", match);
    const visible = await Order.find({
      _id: { $in: orderIds },
      ...buildStaffOrderScopeFilter(options.staffScope),
    }).distinct("_id");
    match = { $and: [match, { orderId: { $in: visible } }] };
  }

  const settings = await getSettings();
  const storeCurrency = settings.general?.defaultCurrency || "USD";
  const since = new Date(Date.now() - REFUNDED_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const isRefundStuck = {
    $in: [
      "$refundStatus",
      [RETURN_REFUND_STATUS.FAILED, RETURN_REFUND_STATUS.MANUAL_REQUIRED],
    ],
  };
  // The count is narrowed with the amount: "3 refunded" over a sum that
  // covers two of them is the disagreement the dashboard's refund card avoids.
  const isRefundedLately = {
    $and: [
      { $eq: ["$refundStatus", RETURN_REFUND_STATUS.SUCCEEDED] },
      { $gte: ["$refundedAt", since] },
      inStoreCurrencyExpr(storeCurrency),
    ],
  };
  const countIf = (condition: unknown) => ({
    $sum: { $cond: [condition, 1, 0] },
  });

  const [row] = await ReturnRequest.aggregate<ReturnStats>([
    { $match: match },
    // `inStoreCurrencyExpr` reads a top-level `currency`; a return keeps it
    // on the estimate.
    { $addFields: { currency: "$estimatedRefund.currency" } },
    {
      $group: {
        _id: null,
        needsReview: countIf({ $eq: ["$status", RETURN_STATUS.REQUESTED] }),
        onTheWayBack: countIf({
          $in: [
            "$status",
            [
              RETURN_STATUS.APPROVED,
              RETURN_STATUS.AWAITING_SHIPMENT,
              RETURN_STATUS.IN_TRANSIT,
            ],
          ],
        }),
        refundDue: countIf({
          $or: [
            {
              $in: [
                "$status",
                [
                  RETURN_STATUS.RECEIVED,
                  RETURN_STATUS.INSPECTED,
                  RETURN_STATUS.REFUND_PENDING,
                ],
              ],
            },
            isRefundStuck,
          ],
        }),
        refundProblems: countIf(isRefundStuck),
        refundedCount: countIf(isRefundedLately),
        refundedAmount: {
          $sum: {
            $cond: [
              isRefundedLately,
              { $ifNull: ["$actualRefund.amount", "$estimatedRefund.total"] },
              0,
            ],
          },
        },
      },
    },
  ]);

  return {
    needsReview: row?.needsReview ?? 0,
    onTheWayBack: row?.onTheWayBack ?? 0,
    refundDue: row?.refundDue ?? 0,
    refundProblems: row?.refundProblems ?? 0,
    refundedCount: row?.refundedCount ?? 0,
    refundedAmount: row?.refundedAmount ?? 0,
  };
}
