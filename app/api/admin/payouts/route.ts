import { connectDB, mongoose } from "@/lib/db";
import { getSettings, Order, Payout, Vendor } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { getExternalVendorFilter, isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { withApi } from "@/lib/api/handler";
import { fetchPayoutList } from "@/lib/finance/payout-list";
import {
  PAYABLE_ORDER_PROJECTION,
  buildPayableOrderFilter,
  payoutHoldCutoff,
  fetchRefundTotalsByOrder,
  fetchVendorOverpayment,
  payableInCurrency,
  sumVendorPayable,
} from "@/lib/vendors/vendor-earnings";
import {
  claimMaturedReserves,
  computePreorderReserve,
  unclaimReserves,
} from "@/lib/vendors/preorder-reserve";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import {
  commissionOwedForVendor,
  createCommissionInvoice,
  discardCommissionInvoice,
} from "@/lib/finance/commission-invoices";
import { roundMoney } from "@/lib/intl/money";
import { parsePageLimit } from "@/lib/api/list-query";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { resolveMinWithdrawal } from "@/lib/orders/order-settings";

/** How long a vendor's payout-creation claim holds before it is presumed dead. */
const PAYOUT_LOCK_TTL_MS = 2 * 60 * 1000;

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

    // One payout at a time for a vendor. The overpayment recovery and the
    // commission deduction are each worked out from what earlier payouts
    // already took, so two built at the same moment both took them.
    const lockStamp = new Date();
    const locked = await Vendor.findOneAndUpdate(
      {
        _id: vendorId,
        $or: [
          { payoutLockAt: null },
          { payoutLockAt: { $lt: new Date(lockStamp.getTime() - PAYOUT_LOCK_TTL_MS) } },
        ],
      },
      { $set: { payoutLockAt: lockStamp } },
    )
      .select("_id")
      .lean();
    if (!locked) {
      throw new ValidationError(
        "A payout for this vendor is already being created. Try again in a moment.",
      );
    }

    try {
      const vendorObjectId = new mongoose.Types.ObjectId(vendorId);
      // A sale is paid out once the store's return window has closed on it — see
      // `payoutHoldCutoff`. Fixed once, so the read and the claim below agree.
      const deliveredBefore = payoutHoldCutoff(settings);
      const eligibleOrders = await Order.find(
        buildPayableOrderFilter(
          vendorObjectId,
          { periodStart, periodEnd },
          deliveredBefore,
        ),
      )
        .select("_id currency")
        .lean();

      const eligibleOrderIds = eligibleOrders.map((order) => String(order._id));
      if (!eligibleOrderIds.length) {
        // Say why when the sales exist but are still inside the return window,
        // rather than leave the admin guessing at a period that has none.
        const held = await Order.countDocuments(
          buildPayableOrderFilter(vendorObjectId, { periodStart, periodEnd }),
        );
        throw new ValidationError(
          held > 0
            ? `This vendor's delivered sales in this period are still inside the store's return window, so they cannot be paid out yet.`
            : "No eligible orders found for payout",
        );
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
        // Written now rather than only at the end, so a clawback read while this
        // run is still working sees a recovery of nothing — not a row without the
        // field, whose recovery would be worked back out of half-written figures.
        overpaymentRecovered: 0,
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
              // The same hold the read above applied: an order with one
              // consignment past the window and one still inside it pays only
              // the first.
              $or: [
                { "sub.deliveredAt": { $lte: deliveredBefore } },
                { "sub.deliveredAt": { $exists: false } },
                { "sub.deliveredAt": null },
              ],
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
        shippingAmount,
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
      // stays outstanding and comes off the one after. `overpaid` is already net
      // of what earlier payouts took back, which is why this payout has to record
      // what it takes.
      const overpaid = await fetchVendorOverpayment({
        vendorId,
        currency: payoutCurrency,
      });
      const claimedEarnings = roundMoney(netAmount);
      const overpaymentRecovered = roundMoney(Math.min(overpaid, claimedEarnings));

      // Rolling reserve. A pre-order's dispute window is counted from its
      // expected delivery, so a drop sold months ahead can be charged back long
      // after this payout clears — a slice of the pre-order earnings is held
      // back, and any slice held earlier whose window has closed is handed over
      // in the same breath. Both ride `adjustments`, which already carries this
      // exact shape of withhold-now-settle-later correction.
      const reservePolicy = resolvePreorderPolicy(settings.preorder);
      const reserveHeld = computePreorderReserve({
        orders: claimedOrders,
        vendorId,
        refundByOrderId,
        isPayable: (sub) =>
          String(sub.payoutId) === String(payout._id) &&
          sub.status === "delivered",
        storeCurrency,
        payoutCurrency,
        percent: reservePolicy.reservePercent,
      });
      // Claimed before the amount is worked out, and stamped with this payout —
      // the same shape as the sub-order claim above. Reading them and marking
      // them afterwards let two runs pay the same reserve twice.
      const { amount: reserveReleased } = await claimMaturedReserves({
        vendorId,
        currency: payoutCurrency,
        payoutId: payout._id,
      });

      const beforeCommission = roundMoney(
        claimedEarnings - overpaymentRecovered - reserveHeld + reserveReleased,
      );

      // Commission the vendor owes on sales they took the money for themselves,
      // deducted here rather than left on an invoice beside a payout that pays
      // them in full. Claimed through an invoice marked as this payout's, so the
      // same sales cannot also be billed, collected or deducted anywhere else —
      // settled when this payout is paid, handed back if it never is.
      //
      // Only when the whole bill fits. An invoice claims its sales whole, so a
      // bill larger than this payout stays an invoice for the vendor to settle,
      // and the response says so.
      //
      // The balance can also run the other way. On a sale the vendor collected
      // the money for, a promotion the store paid for is owed to the vendor,
      // and where those outweigh the commission the store owes them on
      // balance — which this payout pays, settling those sales the same way.
      const commissionOwed = await commissionOwedForVendor(vendorId, payoutCurrency);
      let commissionOffset = 0;
      let commissionCredit = 0;
      let commissionInvoiceId: string | undefined;
      if (
        (commissionOwed.amount > 0 && commissionOwed.amount <= beforeCommission) ||
        commissionOwed.storeOwes > 0
      ) {
        const deduction = await createCommissionInvoice({
          vendorId,
          userId: session.user.id,
          currency: payoutCurrency,
          note: `Settled in payout ${payout.payoutNumber}`,
          payoutId: payout._id,
        });
        if (deduction && deduction.amount <= beforeCommission) {
          commissionOffset = roundMoney(deduction.amount);
          commissionCredit = roundMoney(deduction.storeOwes);
          commissionInvoiceId = deduction.invoiceId;
        } else if (deduction) {
          await discardCommissionInvoice(deduction.invoiceId);
        }
      }

      const adjustments = roundMoney(
        -overpaymentRecovered -
          reserveHeld +
          reserveReleased -
          commissionOffset +
          commissionCredit,
      );
      const roundedNetAmount = roundMoney(claimedEarnings + adjustments);
      // The floor for this payout's own currency, not the store's number read
      // as if every currency were the store's.
      const minWithdrawalAmount = resolveMinWithdrawal(settings, payoutCurrency);
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
        // Hand back the reserves this run claimed; the payout they were claimed
        // against is about to stop existing.
        await unclaimReserves({ vendorId, payoutId: payout._id }).catch((err) =>
          console.error("Failed to release claimed pre-order reserves:", err),
        );
        // And the commission it was going to deduct: those sales are owed again.
        if (commissionInvoiceId) {
          await discardCommissionInvoice(commissionInvoiceId).catch((err) =>
            console.error("Failed to release a payout's commission deduction:", err),
          );
        }
        await Payout.deleteOne({ _id: payout._id });
        const deducted = [
          overpaymentRecovered > 0
            ? `recovering ${payoutCurrency} ${overpaymentRecovered.toFixed(2)} overpaid on refunded orders`
            : null,
          commissionOffset > 0
            ? `deducting ${payoutCurrency} ${commissionOffset.toFixed(2)} commission owed on sales the vendor collected`
            : null,
        ].filter(Boolean);
        throw new ValidationError(
          adjustments < 0 && deducted.length > 0
            ? `After ${deducted.join(" and ")}, this payout comes to ${payoutCurrency} ${roundedNetAmount.toFixed(2)} — below the ${payoutCurrency} ${minWithdrawalAmount.toFixed(2)} minimum.`
            : `Payout must be at least ${payoutCurrency} ${minWithdrawalAmount.toFixed(2)}`,
        );
      }

      payout.orderIds = claimedOrderIds;
      payout.grossSales = roundMoney(grossSales);
      payout.commissionAmount = roundMoney(commissionAmount);
      payout.shippingAmount = roundMoney(shippingAmount);
      payout.adjustments = adjustments;
      payout.overpaymentRecovered = overpaymentRecovered;
      payout.commissionOffset = commissionOffset;
      payout.commissionCredit = commissionCredit;
      if (commissionInvoiceId) payout.commissionInvoiceId = commissionInvoiceId;
      payout.netAmount = roundedNetAmount;
      payout.preorderReserveHeld = reserveHeld;
      payout.preorderReserveReleaseAt =
        reserveHeld > 0
          ? new Date(Date.now() + reservePolicy.reserveDays * 24 * 60 * 60 * 1000)
          : undefined;
      await payout.save();

      return successResponse(
        {
          payoutId: String(payout._id),
          payoutNumber: payout.payoutNumber,
          netAmount: roundedNetAmount,
          // Named in the response so the admin sees the deduction rather than
          // wondering why the figure is not the one the screen quoted.
          adjustments,
          // The recovery alone, not the whole adjustment: the reserve moves in
          // and out of the same number and has nothing to do with overpayment.
          overpaymentRemaining: roundMoney(overpaid - overpaymentRecovered),
          preorderReserveHeld: reserveHeld,
          preorderReserveReleased: reserveReleased,
          commissionOffset,
          commissionCredit,
          // Owed but too large to come out of this payout — still an invoice.
          commissionOwedNotDeducted: commissionInvoiceId
            ? 0
            : roundMoney(commissionOwed.amount),
        },
        "Payout created",
        201,
      );
    } finally {
      await Vendor.updateOne(
        { _id: vendorId, payoutLockAt: lockStamp },
        { $unset: { payoutLockAt: "" } },
      ).catch((err) => console.error("Failed to release the payout claim:", err));
    }
  },
);
