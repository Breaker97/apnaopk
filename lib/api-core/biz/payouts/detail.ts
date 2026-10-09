import { PayoutDetail } from "@/contracts/mobile/biz/v1/payouts";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { connectDB, mongoose } from "@/lib/db";
import { Payout } from "@/models";
import { type PayoutRow, toPayoutDetail } from "./payout-dto";

/**
 * GET /payouts/{id}: one of the seller's payouts. Another seller's payout is
 * a 404, the same as one that does not exist.
 */
export const payoutDetailRoute = defineBizRoute({
  id: "payouts.detail",
  method: "GET",
  path: "/payouts/{id}",
  auth: "user",
  ...BIZ_ACCESS.VIEW_PAYOUTS,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:payouts:read", preset: "lenient" },
  output: PayoutDetail,
  handler: async ({ params, workspace }) => {
    if (!mongoose.isValidObjectId(params.id)) throw payoutNotFound();
    await connectDB();
    const payout = await Payout.findOne({ _id: params.id, vendorId: workspace.vendor.id }).lean<PayoutRow | null>();
    if (!payout) throw payoutNotFound();
    return toPayoutDetail(payout);
  },
});

function payoutNotFound() {
  return new MobileApiError(404, "NOT_FOUND", "This payout is not available.");
}
