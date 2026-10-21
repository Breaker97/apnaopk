import "server-only";
import { Types } from "mongoose";
import { Order, Payout } from "@/models";
import {
  COMMISSION_INVOICE_STATUS,
  CommissionInvoice,
} from "@/models/commissionInvoice.model";
import { ORDER_STATUS } from "@/config/app.config";
import { SETTLED_ORDER_PAYMENT_STATUSES } from "@/lib/orders/order-payment-status";
import {
  platformCollectedCodMatch,
  platformSettledOrderFilter,
} from "@/lib/payments/payment-custody";
import {
  buildCommissionOwedOrderFilter,
  fetchVendorOverpaymentBalance,
} from "@/lib/vendors/vendor-earnings";

/**
 * Whether a seller still has money to settle with the store, and what.
 *
 * Deleting a seller used to check only their products. Their unpaid sales,
 * open payouts and the commission they owed stayed behind in the books with
 * nobody to pay or bill: a payout cannot be made to a seller that no longer
 * exists. Returns the first reason found, or null when everything is settled.
 */
export async function describeUnsettledVendorMoney(
  vendorId: Types.ObjectId | string,
): Promise<string | null> {
  const id = new Types.ObjectId(String(vendorId));

  if (await Payout.exists({ vendorId: id, status: { $in: ["pending", "processing"] } })) {
    return "A payout to this seller is still being prepared or sent.";
  }

  // Money the store is holding for this seller and has not paid out: any of
  // their live consignments on a paid order the store collected, delivered or
  // not — the sale is still theirs once it is delivered.
  const unpaid = {
    vendorId: id,
    status: { $ne: ORDER_STATUS.CANCELLED },
    payoutStatus: { $ne: "paid" },
  };
  const holdsTheirMoney = await Order.exists({
    status: { $ne: ORDER_STATUS.CANCELLED },
    paymentStatus: { $in: SETTLED_ORDER_PAYMENT_STATUSES },
    $or: [
      { ...platformSettledOrderFilter(), subOrders: { $elemMatch: unpaid } },
      {
        paymentMethod: "cod",
        subOrders: { $elemMatch: { ...unpaid, ...platformCollectedCodMatch() } },
      },
    ],
  });
  if (holdsTheirMoney) return "The store is still holding sales it has not paid this seller for.";

  if (await CommissionInvoice.exists({ vendorId: id, status: COMMISSION_INVOICE_STATUS.OPEN })) {
    return "This seller has an open commission invoice.";
  }
  if (await Order.exists(buildCommissionOwedOrderFilter(id))) {
    return "This seller still owes commission on sales they collected themselves.";
  }

  const currencies = (await Payout.distinct("currency", { vendorId: id })) as string[];
  for (const currency of currencies) {
    const owedBack = await fetchVendorOverpaymentBalance({ vendorId: id, currency });
    if (owedBack !== 0) {
      return "This seller was paid for sales refunded afterwards and has not paid it back.";
    }
  }

  return null;
}

export const UNSETTLED_VENDOR_DELETE_MESSAGE =
  "This seller still has money to settle. Pay or settle it first, or suspend the seller instead.";
