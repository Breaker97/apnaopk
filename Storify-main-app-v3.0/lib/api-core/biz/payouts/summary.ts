import { PayoutSummary, PayoutSummaryQuery } from "@/contracts/mobile/biz/v1/payouts";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { toMoney } from "@/lib/api-core/shop/money";
import { connectDB } from "@/lib/db";
import { readStoreCurrency } from "@/lib/intl/server-currency";
import { loadVendorBalance } from "@/lib/vendors/vendor-balance";

/**
 * GET /payouts/summary: what the seller is owed, what is held back and why,
 * and what they owe the store, from `loadVendorBalance`, the figures of the
 * website's Finance page and the ones a payout made now would carry.
 *
 * In the store's one currency, read strictly: a settings read that fails is a
 * retryable error, never a balance computed in a fallback currency (it would
 * match nothing and read as zero).
 */
export const payoutSummaryRoute = defineBizRoute({
  id: "payouts.summary",
  method: "GET",
  path: "/payouts/summary",
  auth: "user",
  ...BIZ_ACCESS.VIEW_PAYOUTS,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:payouts:read", preset: "lenient" },
  input: PayoutSummaryQuery,
  output: PayoutSummary,
  handler: async ({ workspace, input }) => {
    const currency = input.currency?.toUpperCase() || (await readStoreCurrency()).code;
    await connectDB();
    const balance = await loadVendorBalance({ vendorId: workspace.vendor.id, currency });
    const money = (amount: number) => toMoney(amount, currency);
    return {
      readyToPay: money(balance.readyToPay),
      ...(balance.grossEligible === undefined ? {} : { grossEligible: money(balance.grossEligible) }),
      ...(balance.breakdown ? { breakdown: Object.fromEntries(Object.entries(balance.breakdown).map(([key, amount]) => [key, money(amount)])) } : {}),
      eligible: balance.eligible,
      hasMore: balance.hasMore,
      availableCurrencies: balance.availableCurrencies,
      calculatedAt: balance.calculatedAt?.toISOString(),
      orderCount: balance.orderCount,
      heldInReturnWindow: {
        amount: money(balance.heldInReturnWindow.amount),
        orderCount: balance.heldInReturnWindow.orderCount,
        windowDays: balance.heldInReturnWindow.windowDays,
      },
      reserveHeld: {
        amount: money(balance.reserveHeld.amount),
        ...(balance.reserveHeld.releaseAt ? { releaseAt: balance.reserveHeld.releaseAt.toISOString() } : {}),
      },
      owedToPlatform: money(balance.owedBack),
      minimumPayout: money(balance.minWithdrawal),
    };
  },
});
