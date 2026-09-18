import { connectDB } from "@/lib/db";
import { getSettings, Order, Payout } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { postPayoutPaidSafely, postPayoutReversed } from "@/lib/finance/post-events";
import { unclaimReserves } from "@/lib/vendors/preorder-reserve";
import {
  releaseCommissionInvoice,
  settleCommissionInvoiceByPayout,
} from "@/lib/finance/commission-invoices";
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

    const payout = await Payout.findById(id).lean<{
      _id: unknown;
      status?: string;
      vendorId: unknown;
      payoutNumber: string;
      netAmount: number;
      commissionOffset?: number | null;
      commissionCredit?: number | null;
      commissionInvoiceId?: unknown;
      currency: string;
      orderIds?: unknown[];
    } | null>();
    if (!payout) return notFoundResponse("Payout");

    const currentStatus = String(payout.status || "pending");
    const allowedTransitions: Record<string, Set<string>> = {
      pending: new Set(["pending", "processing", "paid", "cancelled"]),
      processing: new Set(["processing", "paid", "failed", "cancelled"]),
      // A transfer can come back days after it left — a closed account, a
      // wrong IBAN. The money is in the store's hands again, so the payout
      // must be able to say so; everything it settled is undone below.
      paid: new Set(["paid", "failed"]),
      failed: new Set(["failed"]),
      cancelled: new Set(["cancelled"]),
    };
    if (!allowedTransitions[currentStatus]?.has(nextStatus)) {
      throw new ValidationError(
        `Cannot transition payout from "${currentStatus}" to "${nextStatus}"`,
      );
    }

    // Undoing a payment is not a status typo. The reason is the only record of
    // why money that left came back, and the vendor will ask.
    const bounced = currentStatus === "paid" && nextStatus === "failed";
    if (bounced && !String(body.note || "").trim()) {
      throw new ValidationError(
        "Say why this payout came back — the note is the only record of it.",
      );
    }

    const now = new Date();
    const moved = nextStatus !== currentStatus;
    const $set: Record<string, unknown> = { status: nextStatus };
    const $unset: Record<string, ""> = {};
    const setOrClear = (field: string, value: string | undefined) => {
      if (value) $set[field] = value;
      else $unset[field] = "";
    };
    if (typeof body.note === "string") setOrClear("note", body.note.trim());
    if (typeof body.paymentReference === "string") {
      setOrClear("paymentReference", body.paymentReference.trim());
    }
    if (typeof body.paidFrom === "string") {
      const account = body.paidFrom.trim().toLowerCase();
      setOrClear(
        "paidFrom",
        ["bank", "cash", "gateway", "other"].includes(account) ? account : undefined,
      );
    }
    // Stamped only when the payout actually becomes paid. Saving a note on a
    // paid payout used to re-stamp who paid it and when, and every sub-order's
    // payout date with it — the record of the day the money left, overwritten
    // by the day someone corrected a typo.
    if (moved && nextStatus === "paid") {
      $set.paidAt = now;
      $set.paidBy = session.user.id;
    }
    if (bounced) {
      // `paidAt` stays: the money did leave that day, and the ledger entry it
      // posted keeps that date. What is recorded here is the day it came back.
      $set.reversedAt = now;
      $set.reversedBy = session.user.id;
    } else if (nextStatus === "cancelled" || nextStatus === "failed") {
      $unset.paidAt = "";
      $unset.paidBy = "";
    }

    // Conditional on the status the transition was checked against. Read, then
    // saved, two admins moving one payout at once both passed the check: a
    // payout could be posted to the ledger as paid and saved as cancelled, its
    // sales handed back as unpaid for the next payout to pay a second time.
    const updated = await Payout.findOneAndUpdate(
      { _id: payout._id, status: currentStatus },
      {
        $set,
        ...(Object.keys($unset).length > 0 ? { $unset } : {}),
        // Appended only when the status actually moved: saving a note twice is
        // not two transitions, and a trail that records non-events is one
        // nobody reads.
        ...(moved
          ? {
              $push: {
                statusHistory: {
                  status: nextStatus,
                  at: now,
                  by: session.user.id,
                  note: typeof body.note === "string" ? body.note.trim() : undefined,
                },
              },
            }
          : {}),
      },
      { returnDocument: "after", runValidators: true },
    );
    if (!updated) {
      throw new ValidationError(
        "This payout was changed by someone else. Reload it and try again.",
      );
    }

    if (moved && nextStatus === "paid") {
      // Settles a liability; it is never an expense. Posted here because this
      // is the only transition that moves cash out to a vendor.
      postPayoutPaidSafely({
        _id: payout._id,
        payoutNumber: payout.payoutNumber,
        vendorId: payout.vendorId,
        netAmount: payout.netAmount,
        commissionOffset: payout.commissionOffset,
        commissionCredit: payout.commissionCredit,
        // The account the money left from, as this same write recorded it.
        paidFrom: (updated as { paidFrom?: string | null }).paidFrom,
        currency: payout.currency,
        paidAt: now,
      });
      // The commission this payout held back is now settled: those sales stop
      // being owed, exactly as if the vendor had paid the invoice.
      if (payout.commissionInvoiceId) {
        await settleCommissionInvoiceByPayout({
          invoiceId: String(payout.commissionInvoiceId),
          payoutId: String(payout._id),
          paidAt: now,
        }).catch((err) =>
          console.error("Failed to settle a payout's commission deduction:", err),
        );
      }
      await Order.updateMany(
        { _id: { $in: payout.orderIds || [] } },
        {
          $set: {
            "subOrders.$[sub].payoutStatus": "paid",
            "subOrders.$[sub].payoutDate": now,
          },
        },
        {
          arrayFilters: [{ "sub.payoutId": payout._id }],
        },
      );
    } else if (moved && (nextStatus === "cancelled" || nextStatus === "failed")) {
      // A payout that was paid put money in the books as gone and settled a
      // liability. Coming back undoes both, in its own entries dated today —
      // the day it left is a day the books already closed over.
      if (bounced) {
        await postPayoutReversed({
          _id: payout._id,
          payoutNumber: payout.payoutNumber,
          vendorId: payout.vendorId,
          netAmount: payout.netAmount,
          commissionOffset: payout.commissionOffset,
          commissionCredit: payout.commissionCredit,
          paidFrom: (updated as { paidFrom?: string | null }).paidFrom,
          currency: payout.currency,
          reversedAt: now,
        }).catch((err) =>
          console.error("Failed to reverse a returned payout in the ledger:", err),
        );
      }
      await Order.updateMany(
        { _id: { $in: payout.orderIds || [] } },
        {
          $set: {
            "subOrders.$[sub].payoutStatus": "unpaid",
          },
          $unset: {
            "subOrders.$[sub].payoutId": "",
            "subOrders.$[sub].payoutDate": "",
            "subOrders.$[sub].payoutClaimedAt": "",
          },
        },
        {
          arrayFilters: [{ "sub.payoutId": payout._id }],
        },
      );
      // The matured reserves this payout released from earlier ones go back to
      // being held. Left stamped, they read as paid out in a payout that never
      // paid, and no later payout would ever release them again.
      await unclaimReserves({ vendorId: String(payout.vendorId), payoutId: payout._id });
      // Nor did the commission it was going to deduct get settled: those sales
      // are owed again, to be billed or deducted from a payout that happens.
      if (payout.commissionInvoiceId) {
        await releaseCommissionInvoice(
          String(payout.commissionInvoiceId),
          "cancelled",
        ).catch((err) =>
          console.error("Failed to release a payout's commission deduction:", err),
        );
      }
    }

    return successResponse({ payout: updated });
  },
);
