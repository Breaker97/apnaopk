import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, Payout, Vendor, VendorSubscriptionPayment } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { getSettings } from "@/models/settings.model";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { DEFAULT_MIN_WITHDRAWAL_AMOUNT } from "@/lib/orders/order-settings";
import { fromStripeAmount } from "@/lib/payments/stripe";
import { getVendorSalesBreakdowns } from "@/lib/vendors/vendor-sales";
import {
  PAYABLE_ORDER_PROJECTION,
  buildCommissionOwedOrderFilter,
  buildPayableOrderFilter,
  fetchRefundTotalsByOrder,
  fetchVendorCommissionCredit,
  fetchVendorOverpayment,
  isCommissionOwedSubOrder,
  payableInCurrency,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import { withApi } from "@/lib/api/handler";
import { roundMoney } from "@/lib/intl/money";

/** Bank fields a payout run needs to actually reach the vendor. */
const REQUIRED_BANK_FIELDS = [
  ["accountName", "Account name"],
  ["accountNumber", "Account number"],
  ["bankName", "Bank name"],
] as const;

/**
 * GET /api/admin/vendors/[id]/finance
 *
 * The money view of one vendor: what is owed right now, what has been traded
 * over their lifetime, and where their payouts stand.
 *
 * "Owed" is not an estimate. It runs the exact eligibility filter and the exact
 * arithmetic `POST /api/admin/payouts` uses (`lib/vendor-earnings.ts`), so the
 * figure quoted here is the figure a payout created this instant would carry.
 * Without it an admin has no way to see what a vendor is due — they can only
 * guess a period and read the "No eligible orders found" rejection.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:vendors:finance",
      "lenient",
      session.user.role,
    );

    const { id } = params;
    if (!Types.ObjectId.isValid(id)) {
      return notFoundResponse("Vendor");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await Vendor.findById(id)
      .select("isDefault slug bankDetails")
      .lean();
    if (!vendor || isDefaultVendorRecord(vendor)) {
      return notFoundResponse("Vendor");
    }

    const currency = String(
      settings.general?.defaultCurrency || "USD",
    ).toUpperCase();
    const vendorObjectId = new Types.ObjectId(id);

    const [
      payableOrders,
      selfCollectedOrders,
      breakdowns,
      payoutRows,
      subscriptionRows,
    ] = await Promise.all([
        Order.find(buildPayableOrderFilter(vendorObjectId))
          .select(PAYABLE_ORDER_PROJECTION)
          .lean(),
        // The opposite direction: sales this vendor took the money for, whose
        // commission the platform has not collected. Same projection, because
        // the same refund and coupon ratios apply — a cash order that was half
        // refunded owes half the commission.
        Order.find(buildCommissionOwedOrderFilter(vendorObjectId))
          .select(PAYABLE_ORDER_PROJECTION)
          .lean(),
        getVendorSalesBreakdowns([id], { defaultCurrency: currency }),
        Payout.aggregate<{
          _id: string;
          count: number;
          amount: number;
          lastAt: Date | null;
        }>([
          { $match: { vendorId: vendorObjectId } },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
              amount: { $sum: { $ifNull: ["$netAmount", 0] } },
              lastAt: { $max: "$paidAt" },
            },
          },
        ]),
        // Subscription fees the vendor paid the platform. No status filter is
        // needed: a failed or open invoice carries `amountPaid: 0`, and
        // refunds are netted off rather than counted as revenue that arrived.
        VendorSubscriptionPayment.aggregate<{
          _id: string | null;
          paid: number;
          refunded: number;
          invoiceCount: number;
          paidCount: number;
        }>([
          { $match: { vendorId: vendorObjectId } },
          {
            $group: {
              _id: "$currency",
              paid: { $sum: { $ifNull: ["$amountPaid", 0] } },
              refunded: { $sum: { $ifNull: ["$amountRefunded", 0] } },
              invoiceCount: { $sum: 1 },
              paidCount: {
                $sum: {
                  $cond: [{ $gt: [{ $ifNull: ["$amountPaid", 0] }, 0] }, 1, 0],
                },
              },
            },
          },
        ]),
      ]);

    // Money already sent for sales that were refunded afterwards. Shown even
    // when it cannot be recovered yet: a vendor deep enough in the negative
    // cannot have a payout created at all, so a figure that only surfaced
    // during payout creation would be invisible in exactly that case.
    const overpaid = await fetchVendorOverpayment({ vendorId: id, currency });

    const refundByOrderId = await fetchRefundTotalsByOrder([
      ...payableOrders.map((order) => order._id as Types.ObjectId),
      ...selfCollectedOrders.map((order) => order._id as Types.ObjectId),
    ]);
    // Grouped by the currency each sale was made in, then scoped to the one
    // this screen reports in. Everything here used to be one sum across every
    // currency the vendor had ever traded in, labelled with the store's — so a
    // UGX sale inflated a dollar figure by a factor of about four thousand.
    const owedByCurrency = sumVendorPayable(
      payableOrders,
      id,
      refundByOrderId,
      // Everything still unpaid, which is what payout creation would claim.
      (sub) =>
        sub.status === "delivered" &&
        sub.payoutStatus !== "scheduled" &&
        sub.payoutStatus !== "paid",
      currency,
    );
    const owed = payableInCurrency(owedByCurrency, currency);
    // Only `commissionAmount` is meaningful here. `netAmount` is what the
    // platform would owe the vendor, and on these orders it owes them nothing —
    // they were paid at the counter.
    const commissionOwedByCurrency = sumVendorPayable(
      selfCollectedOrders,
      id,
      refundByOrderId,
      isCommissionOwedSubOrder,
      currency,
    );
    const commissionOwed = payableInCurrency(commissionOwedByCurrency, currency);
    // Commission the vendor already PAID on sales refunded afterwards. The
    // invoice settled and the sale left the owed query the moment it was
    // stamped, so nothing was giving it back — the ledger recorded the debt as
    // a negative receivable and no screen turned it into anything actionable.
    const commissionCredit = await fetchVendorCommissionCredit({
      vendorId: id,
      currency,
    });
    const commissionGrossOwed = roundMoney(commissionOwed.commissionAmount);
    const commissionCreditApplied = roundMoney(
      Math.min(commissionCredit, commissionGrossOwed),
    );
    // What is owed in currencies this screen is NOT reporting. Dropping them
    // silently is how a balance goes uncollected forever, so they are named
    // even though nothing here can pay them out.
    const otherCurrencies = [...owedByCurrency, ...commissionOwedByCurrency]
      .filter((row) => row.currency !== currency)
      .map((row) => row.currency)
      .filter((code, index, all) => all.indexOf(code) === index)
      .sort();

    const payoutsByStatus = Object.fromEntries(
      payoutRows.map((row) => [
        String(row._id),
        {
          count: row.count,
          amount: roundMoney(row.amount),
          lastAt: row.lastAt ?? null,
        },
      ]),
    );
    const sumStatuses = (statuses: string[]) =>
      roundMoney(
        statuses.reduce(
          (total, status) => total + (payoutsByStatus[status]?.amount ?? 0),
          0,
        ),
      );

    const lifetime = breakdowns.get(vendorObjectId.toString())?.primaryTotals;

    // Scoped to the store currency like every other figure here, so nothing
    // adds a UGX invoice to a USD commission and labels the result "$".
    const subscriptionBucket = subscriptionRows.find(
      (row) => String(row._id || currency).toUpperCase() === currency,
    );
    // Invoice rows hold Stripe's smallest unit; order money is in major units.
    // Summing them raw would report a $1,000 plan fee as $100,000.
    const subscriptionRevenue = roundMoney(
      Math.max(
        0,
        fromStripeAmount(subscriptionBucket?.paid ?? 0, currency) -
          fromStripeAmount(subscriptionBucket?.refunded ?? 0, currency),
      ),
    );

    // The three ways this vendor makes the platform money. Commission and
    // retained shipping come off their trade; subscription fees they pay
    // directly. Reported together because any one of them read alone
    // understates what the vendor is worth — a plan fee can exceed a year of
    // commission. Revenue, not profit: gateway costs are not netted here.
    const commissionRevenue = roundMoney(lifetime?.commission ?? 0);
    const shippingRetained = roundMoney(lifetime?.shipping ?? 0);

    const bank = (vendor.bankDetails ?? {}) as Record<string, unknown>;
    const missingBankFields = REQUIRED_BANK_FIELDS.filter(
      ([key]) => !String(bank[key] ?? "").trim(),
    ).map(([, label]) => label);

    return successResponse({
      currency,
      // Balances this vendor holds in a currency the screen above cannot show.
      otherCurrencies,
      minWithdrawalAmount: Number(
        settings.orders?.commission?.minWithdrawalAmount ??
          DEFAULT_MIN_WITHDRAWAL_AMOUNT,
      ),
      // Recovered from the next payout, so "owed now" less this is what a
      // payout created today would actually carry.
      overpaid: roundMoney(overpaid),
      owed: {
        // Net of the vendor's commission — this is what they get paid.
        amount: roundMoney(owed.netAmount),
        grossSales: roundMoney(owed.grossSales),
        commissionAmount: roundMoney(owed.commissionAmount),
        orderCount: owed.orderIds.length,
      },
      // The other direction. Cash, COD and own-terminal sales never reach the
      // platform, so their commission cannot be deducted from a payout — it is
      // a debt, and until it is shown somewhere an admin has no way to know it
      // exists. Collecting it is not wired up yet; this reports the balance.
      commissionOwedByVendor: {
        amount: roundMoney(commissionGrossOwed - commissionCreditApplied),
        grossSales: roundMoney(commissionOwed.grossSales),
        orderCount: commissionOwed.orderIds.length,
        // Reported as well as deducted: a vendor whose whole bill is covered
        // by a credit sees a zero, and deserves to know why it is zero.
        creditApplied: commissionCreditApplied,
        grossOwed: commissionGrossOwed,
        // What is left over when the credit is bigger than the bill. Nothing
        // here pays it out — it stands against the next invoice — but a
        // balance nobody is told about is a balance nobody collects.
        creditRemaining: roundMoney(
          Math.max(0, commissionCredit - commissionCreditApplied),
        ),
      },
      lifetime: {
        grossSales: roundMoney(lifetime?.grossSales ?? 0),
        commission: commissionRevenue,
        vendorEarnings: roundMoney(lifetime?.vendorEarnings ?? 0),
        // Buyers paid this for the vendor's shipments; `vendorEarnings` is
        // `subtotal - commission`, so the platform retains it.
        shipping: shippingRetained,
      },
      platformRevenue: {
        commission: commissionRevenue,
        subscriptions: subscriptionRevenue,
        shipping: shippingRetained,
        total: roundMoney(
          commissionRevenue + subscriptionRevenue + shippingRetained,
        ),
        invoiceCount: subscriptionBucket?.invoiceCount ?? 0,
        paidInvoiceCount: subscriptionBucket?.paidCount ?? 0,
      },
      payouts: {
        paidAmount: sumStatuses(["paid"]),
        pendingAmount: sumStatuses(["pending", "processing"]),
        paidCount: payoutsByStatus.paid?.count ?? 0,
        pendingCount:
          (payoutsByStatus.pending?.count ?? 0) +
          (payoutsByStatus.processing?.count ?? 0),
        lastPaidAt: payoutsByStatus.paid?.lastAt ?? null,
        byStatus: payoutsByStatus,
      },
      bank: {
        complete: missingBankFields.length === 0,
        missing: missingBankFields,
      },
    });
  },
);
