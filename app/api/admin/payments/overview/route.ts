import { z } from "zod";
import { getSettings, Order, PaymentTransaction, Payout } from "@/models";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { resolveRequestedPeriod } from "@/lib/finance/reports";

const OverviewQuerySchema = z.object({
  period: z.string().default("30d"),
  from: z.string().optional(),
  to: z.string().optional(),
});

/**
 * Two kinds of figure live on this screen and only one of them has a period.
 *
 * What was charged and refunded HAPPENED — it belongs to a span of days. What
 * is waiting to be paid out, or waiting to be confirmed, is a BALANCE: it is
 * true now and has no date range at all. Filtering the second by a period would
 * answer a question nobody asks ("how much was outstanding in July?") with a
 * number that looks like the one they wanted.
 */

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:payments:overview", preset: "lenient" },
  },
  async ({ request }) => {
    const query = validateQuery(request, OverviewQuerySchema);
    const period = resolveRequestedPeriod(query);
    const inPeriod = {
      createdAt: { $gte: period.from, $lte: period.to },
    };

    const [settings, orderAgg, txnAgg, payoutAgg, recentTransactions] =
      await Promise.all([
        getSettings(),
        Order.aggregate([
          {
            $facet: {
              // Grouped by the currency it was charged in, never summed across
              // them. This added every currency the store has ever traded in
              // into one figure and printed it with the store's own symbol —
              // the exact failure `lib/finance/reports.ts` exists to avoid.
              paidRevenue: [
                { $match: { paymentStatus: "paid", ...inPeriod } },
                { $group: { _id: "$currency", total: { $sum: "$total" } } },
              ],
              pendingOrders: [
                {
                  $match: {
                    paymentStatus: { $in: ["pending", "partially_paid"] },
                  },
                },
                { $count: "count" },
              ],
              refundedOrders: [
                {
                  $match: {
                    paymentStatus: { $in: ["refunded", "partially_refunded"] },
                  },
                },
                { $count: "count" },
              ],
              methodBreakdown: [
                {
                  $group: {
                    _id: "$paymentMethod",
                    count: { $sum: 1 },
                    total: { $sum: "$total" },
                  },
                },
              ],
            },
          },
        ]),
        PaymentTransaction.aggregate([
          {
            $facet: {
              byType: [
                { $group: { _id: "$type", count: { $sum: 1 }, total: { $sum: "$grossAmount" } } },
              ],
              byStatus: [
                { $group: { _id: "$status", count: { $sum: 1 } } },
              ],
              byProvider: [
                { $group: { _id: "$provider", count: { $sum: 1 }, total: { $sum: "$grossAmount" } } },
              ],
              refundTotal: [
                { $match: { type: "refund", status: "succeeded", ...inPeriod } },
                { $group: { _id: null, total: { $sum: "$grossAmount" } } },
              ],
            },
          },
        ]),
        Payout.aggregate([
          {
            $facet: {
              pendingAmount: [
                { $match: { status: { $in: ["pending", "processing"] } } },
                { $group: { _id: null, total: { $sum: "$netAmount" } } },
              ],
              paidAmount: [
                { $match: { status: "paid" } },
                { $group: { _id: null, total: { $sum: "$netAmount" } } },
              ],
              byStatus: [
                { $group: { _id: "$status", count: { $sum: 1 } } },
              ],
            },
          },
        ]),
        PaymentTransaction.find({})
          .sort({ createdAt: -1 })
          .limit(5)
          .select(
            "orderNumber type status provider paymentMethod grossAmount currency createdAt",
          )
          .lean(),
      ]);

    const orderMetrics = orderAgg?.[0] || {};
    const txnMetrics = txnAgg?.[0] || {};
    const payoutMetrics = payoutAgg?.[0] || {};

    const storeCurrency = (
      settings.general?.defaultCurrency || "USD"
    ).toUpperCase();

    return successResponse({
      period: {
        key: period.key,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
      },
      totals: {
        // The store's own book currency, plus the orders that carry none —
        // which the ledger also counts as the store's. Anything genuinely in
        // another currency is reported by Finance, in that currency.
        paidRevenue: Number(
          (orderMetrics.paidRevenue as Array<{ _id: string | null; total: number }> | undefined)
            ?.filter((row) => {
              const currency = String(row._id || "").toUpperCase();
              return !currency || currency === storeCurrency;
            })
            .reduce((sum, row) => sum + Number(row.total || 0), 0) || 0,
        ),
        refundedAmount: Number(txnMetrics.refundTotal?.[0]?.total || 0),
        pendingPayments: Number(orderMetrics.pendingOrders?.[0]?.count || 0),
        refundedOrders: Number(orderMetrics.refundedOrders?.[0]?.count || 0),
        pendingPayoutAmount: Number(payoutMetrics.pendingAmount?.[0]?.total || 0),
        paidPayoutAmount: Number(payoutMetrics.paidAmount?.[0]?.total || 0),
      },
      breakdowns: {
        paymentMethods: orderMetrics.methodBreakdown || [],
        transactionsByType: txnMetrics.byType || [],
        transactionsByStatus: txnMetrics.byStatus || [],
        transactionsByProvider: txnMetrics.byProvider || [],
        payoutsByStatus: payoutMetrics.byStatus || [],
      },
      recentTransactions,
    });
  },
);
