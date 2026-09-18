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

    const settings = await getSettings();
    const storeCurrency = (
      settings.general?.defaultCurrency || "USD"
    ).toUpperCase();
    // The store's own book currency, plus rows that carry none — which the
    // ledger also counts as the store's. Every money figure below is read in it;
    // anything genuinely in another currency is reported by Finance, in that
    // currency. Refunds and payouts used to be summed across every currency and
    // printed with this one's symbol.
    const inStoreCurrency = {
      $or: [
        { currency: { $in: [storeCurrency, storeCurrency.toLowerCase()] } },
        { currency: { $exists: false } },
        { currency: null },
        { currency: "" },
      ],
    };

    const [orderAgg, txnAgg, payoutAgg, recentTransactions] =
      await Promise.all([
        Order.aggregate([
          {
            $facet: {
              // Grouped by the currency it was charged in, never summed across
              // them. This added every currency the store has ever traded in
              // into one figure and printed it with the store's own symbol —
              // the exact failure `lib/finance/reports.ts` exists to avoid.
              // Every order money was collected on, including the ones since
              // refunded. Counting only `paid` dropped a refunded order's
              // charge from the total while its refund was still subtracted
              // below — the same money taken off twice. A deposit pre-order
              // counts what it has collected, not what it will.
              paidRevenue: [
                {
                  $match: {
                    ...inPeriod,
                    ...inStoreCurrency,
                    $and: [
                      {
                        $or: [
                          {
                            paymentStatus: {
                              $in: ["paid", "partially_refunded", "refunded"],
                            },
                          },
                          {
                            paymentStatus: "partially_paid",
                            preorderOutstandingAmount: { $gt: 0 },
                          },
                        ],
                      },
                    ],
                  },
                },
                {
                  $group: {
                    _id: null,
                    total: {
                      $sum: {
                        $cond: [
                          { $eq: ["$paymentStatus", "partially_paid"] },
                          {
                            $max: [
                              0,
                              {
                                $subtract: [
                                  "$total",
                                  { $ifNull: ["$preorderOutstandingAmount", 0] },
                                ],
                              },
                            ],
                          },
                          "$total",
                        ],
                      },
                    },
                  },
                },
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
                { $match: inStoreCurrency },
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
                { $match: inStoreCurrency },
                { $group: { _id: "$type", count: { $sum: 1 }, total: { $sum: "$grossAmount" } } },
              ],
              byStatus: [
                { $group: { _id: "$status", count: { $sum: 1 } } },
              ],
              byProvider: [
                { $match: inStoreCurrency },
                { $group: { _id: "$provider", count: { $sum: 1 }, total: { $sum: "$grossAmount" } } },
              ],
              refundTotal: [
                {
                  $match: {
                    type: "refund",
                    status: "succeeded",
                    ...inPeriod,
                    ...inStoreCurrency,
                  },
                },
                { $group: { _id: null, total: { $sum: "$grossAmount" } } },
              ],
            },
          },
        ]),
        Payout.aggregate([
          {
            $facet: {
              pendingAmount: [
                {
                  $match: {
                    status: { $in: ["pending", "processing"] },
                    ...inStoreCurrency,
                  },
                },
                { $group: { _id: null, total: { $sum: "$netAmount" } } },
              ],
              paidAmount: [
                { $match: { status: "paid", ...inStoreCurrency } },
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
        currency: storeCurrency,
        paidRevenue: Number(orderMetrics.paidRevenue?.[0]?.total || 0),
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
