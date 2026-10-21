import "server-only";

import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { DELIVERY_ATTESTED_BY } from "@/lib/orders/delivery-attestation";
import { ValidationError } from "@/lib/api/errors";
import { roundMoney } from "@/lib/intl/money";
import { getEnabledPOSPaymentMethods } from "@/lib/pos/payment";
import {
  checkPOSTenders,
  primaryTenderMethod,
  type POSTenderInput,
} from "@/lib/pos/tenders";
import type { ISettingsData } from "@/models/settings.model";
import type { IOrder } from "@/types";

/**
 * Paying off a deposit sale at the till.
 *
 * A deposit sale (`posBalanceDue > 0`, `partially_paid`) holds its goods and
 * owes the rest. Each payment toward it is a tender appended to the sale with
 * its own request key, so a retried request adds nothing twice; the write is
 * conditional on the balance it was priced against, so two tills collecting the
 * same balance at once cannot both succeed. The payment that clears it makes
 * the sale whole: paid, handed over, and — through `ensureChargeTransaction`,
 * which the caller runs — booked.
 */

export interface CollectBalanceResult {
  order: IOrder;
  /** This payment completed the sale. */
  completed: boolean;
  /** The request had already been applied: nothing new happened. */
  replayed: boolean;
}

export async function collectPOSBalance(params: {
  order: IOrder;
  tenders: POSTenderInput[];
  requestId: string;
  settings: ISettingsData;
  collectedBy: string;
  /** The drawer the payment goes into, when one is open. */
  sessionId?: import("mongoose").Types.ObjectId | null;
  now?: Date;
}): Promise<CollectBalanceResult> {
  const { order } = params;
  const requestId = params.requestId.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) {
    throw new ValidationError("A payment needs its request key");
  }

  // Already applied: the tender with this key is on the sale.
  if ((order.posTenders ?? []).some((tender) => tender.requestId === requestId)) {
    return { order, completed: !(Number(order.posBalanceDue || 0) > 0), replayed: true };
  }

  const due = roundMoney(Number(order.posBalanceDue || 0));
  if (order.channel !== "pos" || order.paymentStatus !== "partially_paid" || !(due > 0)) {
    throw new ValidationError("This sale has nothing left to pay");
  }
  if (params.tenders.some((tender) => tender.method === "store_credit")) {
    // The sale's one credit hold was settled with the deposit; a second
    // spend on the same sale has nowhere to be recorded.
    throw new ValidationError("Store credit can only be used when the sale is rung up");
  }
  if (params.tenders.some((tender) => tender.cardSubMethod === "card_stripe")) {
    throw new ValidationError("Take the balance by card on the reader, or in cash");
  }

  const currency = order.currency || params.settings.general?.defaultCurrency || "USD";
  const checked = checkPOSTenders({
    tenders: params.tenders,
    total: due,
    currency,
    enabledMethods: getEnabledPOSPaymentMethods(params.settings.pos?.checkout?.paymentMethods),
    allowPartial: true,
  });
  if (!checked.ok) throw new ValidationError(checked.message);

  const now = params.now ?? new Date();
  const appended = checked.tenders.map((tender) => ({
    ...tender,
    kind: "balance" as const,
    collectedAt: now,
    collectedBy: params.collectedBy,
    requestId,
    ...(params.sessionId ? { sessionId: params.sessionId } : {}),
  }));
  const remaining = checked.balanceDue;
  const completed = !(remaining > 0);
  const allTenders = [...(order.posTenders ?? []), ...appended];

  const set: Record<string, unknown> = { posBalanceDue: remaining };
  if (completed) {
    Object.assign(set, {
      paymentStatus: "paid",
      paidAt: now,
      status: ORDER_STATUS.DELIVERED,
      "subOrders.$[].status": ORDER_STATUS.DELIVERED,
      // Handed over now that the balance is in: the payout hold and the
      // return window both count from here. Unstamped, a payout read the
      // sale as delivered long ago and paid it the same day.
      shippedAt: order.shippedAt ?? now,
      deliveredAt: now,
      "subOrders.$[].deliveredAt": now,
      "subOrders.$[].deliveryAttestedBy": DELIVERY_ATTESTED_BY.COUNTER,
      // The largest money tender over the whole sale, deposit and balance.
      paymentMethod: primaryTenderMethod(allTenders),
    });
  }

  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      channel: "pos",
      paymentStatus: "partially_paid",
      posBalanceDue: order.posBalanceDue,
      "posTenders.requestId": { $ne: requestId },
    },
    { $push: { posTenders: { $each: appended } }, $set: set },
    { new: true },
  ).lean<IOrder | null>();

  if (!updated) {
    const fresh = await Order.findById(order._id).lean<IOrder | null>();
    if (fresh?.posTenders?.some((tender) => tender.requestId === requestId)) {
      return { order: fresh, completed: !(Number(fresh.posBalanceDue || 0) > 0), replayed: true };
    }
    throw new ValidationError("The balance changed while this payment was being taken. Look the sale up again.");
  }
  return { order: updated, completed, replayed: false };
}
