import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import { PayoutList, PayoutListQuery } from "@/contracts/mobile/biz/v1/payouts";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { nextPageCursor, pageFromCursor } from "@/lib/api-core/shop/page-cursor";
import { fetchPayoutList } from "@/lib/finance/payout-list";
import { type PayoutRow, toPayoutListItem } from "./payout-dto";

/**
 * GET /payouts: the seller's payouts, newest first, from `fetchPayoutList`,
 * the reader of the website's payouts page, pinned to the seller of the
 * workspace.
 */
export const payoutListRoute = defineBizRoute({
  id: "payouts.list",
  method: "GET",
  path: "/payouts",
  auth: "user",
  ...BIZ_ACCESS.VIEW_PAYOUTS,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:payouts:read", preset: "lenient" },
  input: PayoutListQuery,
  output: PayoutList,
  handler: async ({ input, workspace }) => {
    const page = pageFromCursor(input.cursor);
    const list = await fetchPayoutList(
      {
        page,
        limit: input.limit ?? LIST_DEFAULT_LIMIT,
        status: input.status,
        sortBy: "createdAt",
        sortOrder: "desc",
      },
      { vendorId: workspace.vendor.id },
    );
    return {
      items: (list.items as PayoutRow[]).map(toPayoutListItem),
      nextCursor: nextPageCursor(list.page, list.totalPages),
    };
  },
});
