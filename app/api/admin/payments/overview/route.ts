import * as z from "zod";
import { getSettings, Order, PaymentTransaction, Payout } from "@/models";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { validateQuery } from "@/lib/api/validate";
import { resolveRequestedPeriod } from "@/lib/finance/reports";
import {
  inStoreCurrencyMatch,
  narrowedToStoreCurrency,
} from "@/lib/intl/currency-scope";
import {
  COLLECTED_ORDER_MATCH,
  placedOrderMatch,
} from "@/lib/orders/order-payment-status";

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
    // Money taken is dated by when it ARRIVED. Dated by when the order was
    // placed, it sat beside refunds dated by when they went out, and "net
    // collected" took one away from the other across two different calendars.
    // An order from before `paidAt` existed falls back to its creation.
    const paidInPeriod = {
      $or: [
        { paidAt: { $gte: period.from, $lte: period.to } },
        {
          $and: [
            { $or: [{ paidAt: null }, { paidAt: { $exists: false } }] },
            inPeriod,
          ],
        },
      ],
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
    //
    // The rule itself lives in `lib/intl/currency-scope.ts`: the dashboard and
    // the analytics page ask the same question, and three copies of it is how
    // two of them came to answer it differently.
    const inStoreCurrency = inStoreCurrencyMatch(storeCurrency);

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
                    ...inStoreCurrency,
                    $and: [
                      paidInPeriod,
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
              // Deliberately without a period — it is a balance, see the note
              // at the top of this file — but not without the placed match: a
              // checkout somebody walked away from at a gateway sits on
              // `pending` too, and counting those told an admin they had
              // payments to chase that nobody had ever started. The same fix
              // the dashboard and the analytics page already carry.
              pendingOrders: [
                {
                  $match: {
                    ...placedOrderMatch(),
                    paymentStatus: { $in: ["pending", "partially_paid"] },
                  },
                },
                { $count: "count" },
              ],
              // Money taken, by how it was taken. It summed `total` over every
              // order ever written — unpaid ones, cancelled ones and abandoned
              // gateway checkouts alike — so "Cash on delivery: 41,900" was
              // partly orders nobody had paid for and partly orders from two
              // years before the period on the screen. `COLLECTED_ORDER_MATCH`
              // is the one definition of money actually collected, and it
              // carries its own `$or`, so the currency rule is combined with
              // it rather than spread over it.
              methodBreakdown: [
                {
                  $match: narrowedToStoreCurrency(
                    { ...inPeriod, ...COLLECTED_ORDER_MATCH },
                    storeCurrency,
                  ),
                },
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
              // Money, so only the rows that moved any: a charge row now
              // exists for payments that were REFUSED (`recordChargeFailure`),
              // carrying the amount that was asked for, and summing those put
              // every declined card into the store's takings. Scoped to the
              // period for the same reason the refund total is — these are
              // things that happened.
              byType: [
                {
                  $match: { status: "succeeded", ...inPeriod, ...inStoreCurrency },
                },
                { $group: { _id: "$type", count: { $sum: 1 }, total: { $sum: "$grossAmount" } } },
              ],
              // Every status, on purpose: this is the census that answers "how
              // many payments failed today", so filtering it by status would
              // leave it with nothing to say.
              byStatus: [
                { $group: { _id: "$status", count: { $sum: 1 } } },
              ],
              byProvider: [
                {
                  $match: { status: "succeeded", ...inPeriod, ...inStoreCurrency },
                },
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
              // Printed beside the refunded AMOUNT, so counted from the same
              // rows: the orders a refund went out on in the period, in the
              // store's currency. Counted from the orders' own state it was
              // the orders PLACED in the period that read refunded — in any
              // currency — beside money refunded in it.
              refundedOrders: [
                {
                  $match: {
                    type: "refund",
                    status: "succeeded",
                    ...inPeriod,
                    ...inStoreCurrency,
                  },
                },
                { $group: { _id: "$orderId" } },
                { $count: "count" },
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
        refundedOrders: Number(txnMetrics.refundedOrders?.[0]?.count || 0),
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
