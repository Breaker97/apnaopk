import { connectDB, mongoose } from "@/lib/db";
import { getSettings, Order, Payout, Vendor } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { getExternalVendorFilter, isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { DEFAULT_MIN_WITHDRAWAL_AMOUNT } from "@/lib/orders/order-settings";
import { withApi } from "@/lib/api/handler";
import { fetchPayoutList } from "@/lib/finance/payout-list";
import {
  PAYABLE_ORDER_PROJECTION,
  buildPayableOrderFilter,
  fetchRefundTotalsByOrder,
  fetchVendorOverpayment,
  payableInCurrency,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import { roundMoney } from "@/lib/intl/money";
import { parsePageLimit } from "@/lib/api/list-query";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

function buildPayoutNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PAYOUT-${ts}-${rand}`;
}

const PayoutCreateSchema = z.object({
  vendorId: z.string().max(64).optional(),
  periodStart: z.string().max(40).optional(),
  periodEnd: z.string().max(40).optional(),
  note: z.string().max(2000).optional(),
});

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:payouts:list", preset: "lenient" },
  },
  async ({ request }) => {
    const { searchParams } = new URL(request.url);
    const { page, limit } = parsePageLimit(searchParams, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const status = (searchParams.get("status") || "all").trim().toLowerCase();
    const search = (searchParams.get("search") || "").trim();
    const vendorId = (searchParams.get("vendorId") || "").trim();
    const sortBy = (searchParams.get("sortBy") || "createdAt").trim();
    const sortOrder = (searchParams.get("sortOrder") || "desc").trim();

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) {
      throw new ValidationError("Payouts are available only in multi-vendor mode");
    }

    const list = await fetchPayoutList({
      page,
      limit,
      search,
      status,
      vendorId,
      sortBy,
      sortOrder: sortOrder === "asc" ? "asc" : "desc",
    });

    return paginatedResponse(list.items, list.page, list.limit, list.total);
  },
);

export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:payouts:create", preset: "moderate" },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, PayoutCreateSchema);

    const vendorId = String(body.vendorId || "").trim();
    if (!mongoose.isValidObjectId(vendorId)) {
      throw new ValidationError("Valid vendorId is required");
    }

    const periodStart = body.periodStart ? new Date(body.periodStart) : null;
    const periodEnd = body.periodEnd ? new Date(body.periodEnd) : null;
    if (!periodStart || Number.isNaN(periodStart.getTime())) {
      throw new ValidationError("Valid periodStart is required");
    }
    if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
      throw new ValidationError("Valid periodEnd is required");
    }
    if (periodEnd < periodStart) {
      throw new ValidationError("periodEnd must be after periodStart");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) {
      throw new ValidationError("Payouts are available only in multi-vendor mode");
    }

    const vendor = await Vendor.findOne({
      ...getExternalVendorFilter(),
      _id: vendorId,
    })
      .select("storeName slug isDefault")
      .lean();
    if (!vendor || isDefaultVendorRecord(vendor)) {
      throw new ValidationError("Vendor not found");
    }

    const vendorObjectId = new mongoose.Types.ObjectId(vendorId);
    const eligibleOrders = await Order.find(
      buildPayableOrderFilter(vendorObjectId, { periodStart, periodEnd }),
    )
      .select("_id currency")
      .lean();

    const eligibleOrderIds = eligibleOrders.map((order) => String(order._id));
    if (!eligibleOrderIds.length) {
      throw new ValidationError("No eligible orders found for payout");
    }

    // The currency the SALES were in, not the store's current default. Those two
    // are the same on almost every install and diverge on exactly the one that
    // matters: the ledger records a vendor's payable in the order's currency, so
    // a payout labelled in a different one debits a balance that was never
    // credited and the liability never clears. An order carrying no currency at
    // all is a pre-snapshot row, and the store default is the same assumption
    // the ledger makes for it.
    const storeCurrency = (
      settings.general?.defaultCurrency || "USD"
    ).toUpperCase();
    const orderCurrencies = new Set(
      eligibleOrders.map((order) =>
        String((order as { currency?: string }).currency || storeCurrency)
          .trim()
          .toUpperCase(),
      ),
    );
    if (orderCurrencies.size > 1) {
      throw new ValidationError(
        `These orders were paid in ${[...orderCurrencies].sort().join(", ")}. Pay each currency out separately by narrowing the period.`,
      );
    }
    const payoutCurrency = [...orderCurrencies][0] || storeCurrency;

    const payout = await Payout.create({
      payoutNumber: buildPayoutNumber(),
      vendorId,
      periodStart,
      periodEnd,
      currency: payoutCurrency,
      orderIds: [],
      grossSales: 0,
      commissionAmount: 0,
      netAmount: 0,
      status: "pending",
      note: typeof body.note === "string" ? body.note.trim() : undefined,
      createdBy: session.user.id,
    });

    const claimResult = await Order.updateMany(
      { _id: { $in: eligibleOrderIds } },
      {
        $set: {
          "subOrders.$[sub].payoutStatus": "scheduled",
          "subOrders.$[sub].payoutId": payout._id,
          // The moment the amount was FROZEN, which is what a later refund has
          // to be measured against. `payoutDate` is stamped when the money
          // actually leaves, and a refund landing in the gap between the two
          // was deducted from neither: not from this payout, whose figure was
          // already fixed, and not by the clawback, which read it as having
          // arrived before the settlement.
          "subOrders.$[sub].payoutClaimedAt": new Date(),
        },
      },
      {
        arrayFilters: [
          {
            "sub.vendorId": vendorObjectId,
            "sub.status": "delivered",
            "sub.payoutStatus": { $nin: ["scheduled", "paid"] },
          },
        ],
      },
    );

    if ((claimResult.modifiedCount ?? 0) === 0) {
      await Payout.deleteOne({ _id: payout._id });
      throw new ValidationError("No eligible orders found for payout");
    }

    const claimedOrders = await Order.find({
      _id: { $in: eligibleOrderIds },
      subOrders: {
        $elemMatch: {
          vendorId: vendorObjectId,
          payoutId: payout._id,
        },
      },
    })
      .select(PAYABLE_ORDER_PROJECTION)
      .lean();

    const claimedOrderObjectIds = claimedOrders.map(
      (order) => new mongoose.Types.ObjectId(String(order._id)),
    );
    const refundByOrderId = await fetchRefundTotalsByOrder(
      claimedOrderObjectIds,
    );

    // Same arithmetic the vendor detail Payouts tab quotes as "owed"; only the
    // sub-order selection differs (there: everything still unpaid — here: the
    // rows this payout just claimed).
    //
    // One currency by construction: the eligible set was refused above if it
    // spanned more than one, so picking that bucket takes everything claimed.
    const {
      grossSales,
      commissionAmount,
      netAmount,
      orderIds: claimedOrderIds,
    } = payableInCurrency(
      sumVendorPayable(
        claimedOrders,
        vendorId,
        refundByOrderId,
        (sub) =>
          String(sub.payoutId) === String(payout._id) &&
          sub.status === "delivered",
        storeCurrency,
      ),
      payoutCurrency,
    );

    if (!claimedOrderIds.length) {
      await Order.updateMany(
        { _id: { $in: eligibleOrderIds } },
        {
          $set: {
            "subOrders.$[sub].payoutStatus": "unpaid",
          },
          $unset: {
            "subOrders.$[sub].payoutId": "",
          },
        },
        {
          arrayFilters: [{ "sub.payoutId": payout._id }],
        },
      );
      await Payout.deleteOne({ _id: payout._id });
      throw new ValidationError("No eligible orders found for payout");
    }

    // Money already sent for sales that were refunded afterwards. A payout is
    // final and a refund is not, so without this the platform hands a vendor
    // their share, the shopper returns the goods a week later, and the platform
    // is out of pocket with nothing recording it. Recovered from the next
    // payout, never more than that payout is worth — whatever is left over
    // stays outstanding and comes off the one after.
    const overpaid = await fetchVendorOverpayment({
      vendorId,
      currency: payoutCurrency,
    });
    const claimedEarnings = roundMoney(netAmount);
    const adjustments = -Math.min(overpaid, claimedEarnings);
    const roundedNetAmount = roundMoney(claimedEarnings + adjustments);
    const minWithdrawalAmount = Number(
      settings.orders?.commission?.minWithdrawalAmount ??
        DEFAULT_MIN_WITHDRAWAL_AMOUNT,
    );
    if (roundedNetAmount < minWithdrawalAmount) {
      await Order.updateMany(
        { _id: { $in: eligibleOrderIds } },
        {
          $set: {
            "subOrders.$[sub].payoutStatus": "unpaid",
          },
          $unset: {
            "subOrders.$[sub].payoutId": "",
          },
        },
        {
          arrayFilters: [{ "sub.payoutId": payout._id }],
        },
      );
      await Payout.deleteOne({ _id: payout._id });
      throw new ValidationError(
        adjustments < 0
          ? `After recovering ${payoutCurrency} ${Math.abs(adjustments).toFixed(2)} overpaid on refunded orders, this payout comes to ${payoutCurrency} ${roundedNetAmount.toFixed(2)} — below the ${payoutCurrency} ${minWithdrawalAmount.toFixed(2)} minimum.`
          : `Payout must be at least ${payoutCurrency} ${minWithdrawalAmount.toFixed(2)}`,
      );
    }

    payout.orderIds = claimedOrderIds;
    payout.grossSales = roundMoney(grossSales);
    payout.commissionAmount = roundMoney(commissionAmount);
    payout.adjustments = adjustments;
    payout.netAmount = roundedNetAmount;
    await payout.save();

    return successResponse(
      {
        payoutId: String(payout._id),
        payoutNumber: payout.payoutNumber,
        netAmount: roundedNetAmount,
        // Named in the response so the admin sees the deduction rather than
        // wondering why the figure is not the one the screen quoted.
        adjustments,
        overpaymentRemaining: roundMoney(overpaid + adjustments),
      },
      "Payout created",
      201,
    );
  },
);
