import { connectDB } from "@/lib/db";
import { getSettings, Order, Payout } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { postPayoutPaidSafely } from "@/lib/finance/post-events";
import { roundMoney } from "@/lib/intl/money";
import { z } from "zod";

const PayoutUpdateSchema = z.object({
  status: z.string().max(20).optional(),
  note: z.string().max(2000).optional(),
  paidFrom: z.string().max(200).optional(),
  paymentReference: z.string().max(200).optional(),
});

export const GET = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:payouts:read", preset: "lenient" },
  },
  async ({ params }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Payout");

    await connectDB();
    const payout = await Payout.findById(id)
      .populate("vendorId", "storeName slug userId")
      .lean();
    if (!payout) return notFoundResponse("Payout");

    const orderRows = await Order.find({
      _id: { $in: payout.orderIds || [] },
    })
      .select("orderNumber createdAt total paymentStatus status subOrders")
      .sort({ createdAt: -1 })
      .lean();

    /*
     * The order total and the vendor's share are different numbers, and the
     * screen only ever had the first.
     *
     * An order total includes shipping and tax the STORE collected; the
     * payout claims the vendor's share of the goods. Three orders totalling
     * 2,164.44 against gross sales of 1,660.00 looked like an arithmetic error
     * on a page whose whole job is to be checked, so both halves are sent: the
     * share the payout's gross is made of, and the earnings left after
     * commission — which is what the net is made of.
     */
    const vendorId = String(
      (payout.vendorId as { _id?: unknown })?._id ?? payout.vendorId ?? "",
    );
    const orders = orderRows.map((order) => {
      const subOrders = (order.subOrders || []) as Array<{
        vendorId?: unknown;
        subtotal?: number;
        vendorEarnings?: number;
      }>;
      const mine = subOrders.filter((sub) => String(sub.vendorId) === vendorId);
      const round = (value: number) => roundMoney(value);
      // The sub-orders themselves are not sent: they carry every other
      // vendor's earnings on a split order, and this screen is one vendor's.
      const rest = { ...order, subOrders: undefined };
      return {
        ...rest,
        vendorShare: round(
          mine.reduce((sum, sub) => sum + Number(sub.subtotal || 0), 0),
        ),
        vendorEarnings: round(
          mine.reduce((sum, sub) => sum + Number(sub.vendorEarnings || 0), 0),
        ),
      };
    });

    return successResponse({
      payout,
      orders,
    });
  },
);

export const PUT = withApi<{ id: string }>(
  {
    auth: "admin",
    rateLimit: { action: "admin:payouts:update", preset: "moderate" },
  },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Payout");

    const body = await validateBody(request, PayoutUpdateSchema);
    const nextStatus = String(body.status || "").trim().toLowerCase();
    const allowed = new Set(["pending", "processing", "paid", "failed", "cancelled"]);
    if (!allowed.has(nextStatus)) {
      throw new ValidationError("Invalid payout status");
    }

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) {
      throw new ValidationError("Payouts are available only in multi-vendor mode");
    }

    const payout = await Payout.findById(id);
    if (!payout) return notFoundResponse("Payout");

    const currentStatus = String(payout.status || "pending");
    const allowedTransitions: Record<string, Set<string>> = {
      pending: new Set(["pending", "processing", "paid", "cancelled"]),
      processing: new Set(["processing", "paid", "failed", "cancelled"]),
      paid: new Set(["paid"]),
      failed: new Set(["failed"]),
      cancelled: new Set(["cancelled"]),
    };
    if (!allowedTransitions[currentStatus]?.has(nextStatus)) {
      throw new ValidationError(
        `Cannot transition payout from "${currentStatus}" to "${nextStatus}"`,
      );
    }

    payout.status = nextStatus;
    if (typeof body.note === "string") payout.note = body.note.trim() || undefined;
    if (typeof body.paymentReference === "string") {
      payout.paymentReference = body.paymentReference.trim() || undefined;
    }
    if (typeof body.paidFrom === "string") {
      const account = body.paidFrom.trim().toLowerCase();
      payout.paidFrom = ["bank", "cash", "gateway", "other"].includes(account)
        ? account
        : undefined;
    }

    // Appended only when the status actually moved: saving a note twice is not
    // two transitions, and a trail that records non-events is one nobody reads.
    if (nextStatus !== currentStatus) {
      payout.statusHistory = [
        ...(payout.statusHistory || []),
        {
          status: nextStatus,
          at: new Date(),
          by: session.user.id,
          note: typeof body.note === "string" ? body.note.trim() : undefined,
        },
      ];
    }

    if (nextStatus === "paid") {
      payout.paidAt = new Date();
      payout.paidBy = session.user.id;
      // Settles a liability; it is never an expense. Posted here because this
      // is the only transition that moves cash out to a vendor.
      postPayoutPaidSafely({
        _id: payout._id,
        payoutNumber: payout.payoutNumber,
        vendorId: payout.vendorId,
        netAmount: payout.netAmount,
        currency: payout.currency,
        paidAt: payout.paidAt,
      });
      await Order.updateMany(
        { _id: { $in: payout.orderIds || [] } },
        {
          $set: {
            "subOrders.$[sub].payoutStatus": "paid",
            "subOrders.$[sub].payoutDate": new Date(),
          },
        },
        {
          arrayFilters: [{ "sub.payoutId": payout._id }],
        },
      );
    } else if (nextStatus === "cancelled" || nextStatus === "failed") {
      payout.paidAt = undefined;
      payout.paidBy = undefined;
      await Order.updateMany(
        { _id: { $in: payout.orderIds || [] } },
        {
          $set: {
            "subOrders.$[sub].payoutStatus": "unpaid",
          },
          $unset: {
            "subOrders.$[sub].payoutId": "",
            "subOrders.$[sub].payoutDate": "",
          },
        },
        {
          arrayFilters: [{ "sub.payoutId": payout._id }],
        },
      );
    }

    await payout.save();

    return successResponse({ payout });
  },
);
