/**
 * The third line of defence for Orange Money payments.
 *
 * Every other gateway Storify speaks to has two independent confirmations: the
 * shopper's browser polling the verify route, and a webhook the gateway
 * guarantees to redeliver. Orange has the first, but its notification retry
 * behaviour is undocumented — so if the shopper validates the OTP and then
 * closes the tab before the poll resolves, and the notification never lands,
 * the order sits PENDING forever with the money already taken and nothing
 * anywhere raising a hand.
 *
 * This sweep closes that hole by asking Orange directly about every pending
 * Orange Money payment old enough that a human would have finished by now. It
 * needs no notification and no open browser tab.
 *
 * It only ever *completes* payments. A transaction Orange reports as failed or
 * expired is left alone: an abandoned checkout is already handled elsewhere,
 * and cancelling an order on this path would risk retiring one the shopper is
 * still paying for.
 */
import { Order, PlatformPayment } from "@/models";
import { PAYMENT_STATUS, PLATFORM_PAYMENT_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { resolveOrangeMoneyCredentials } from "@/lib/settings/credentials";
import {
  getOrangeMoneyCredentials,
  getOrangeMoneyTransactionState,
  getOrangeMoneyTransactionStatus,
} from "@/lib/payments/orange-money";
import { finalizeOrangeMoneyOrder } from "@/lib/payments/orange-money-orders";
import { verifyPlatformPayment } from "@/lib/payments/platform-payments";

/**
 * How long a payment must have been pending before we ask about it.
 *
 * Long enough that the shopper's own poll (~90s) has had its turn and a
 * notification would normally have arrived, short enough that a stranded order
 * is repaired within one sweep.
 */
const ORANGE_MONEY_RECONCILE_AFTER_MS = 10 * 60_000;

/**
 * Stop chasing a payment nobody ever completed. Orange's pay tokens do not
 * outlive this by much, and without a cutoff every abandoned checkout would be
 * re-queried on every sweep, forever.
 */
const ORANGE_MONEY_RECONCILE_UNTIL_MS = 48 * 60 * 60_000;

interface OrangeMoneyReconcileResult {
  checked: number;
  recovered: number;
  failed: number;
}

/**
 * Sweeps stranded storefront orders and vendor→platform attempts.
 *
 * `limit` caps each of the two passes independently so one busy queue cannot
 * starve the other.
 */
export async function reconcileOrangeMoneyPayments(
  limit = 50,
): Promise<OrangeMoneyReconcileResult> {
  const settings = await getSettings();
  if (!settings.payment?.orange_money?.enabled) {
    return { checked: 0, recovered: 0, failed: 0 };
  }

  let creds;
  try {
    creds = getOrangeMoneyCredentials(
      resolveOrangeMoneyCredentials(settings.payment?.orange_money),
    );
  } catch {
    // Enabled but not configured — nothing to ask Orange with.
    return { checked: 0, recovered: 0, failed: 0 };
  }

  const now = Date.now();
  const olderThan = new Date(now - ORANGE_MONEY_RECONCILE_AFTER_MS);
  const newerThan = new Date(now - ORANGE_MONEY_RECONCILE_UNTIL_MS);

  const result: OrangeMoneyReconcileResult = {
    checked: 0,
    recovered: 0,
    failed: 0,
  };

  // ---- storefront orders -------------------------------------------------
  const orders = await Order.find({
    paymentMethod: "orange_money",
    paymentStatus: PAYMENT_STATUS.PENDING,
    // Without a pay token there is nothing to ask Orange, and the checkout that
    // failed to store one already cancelled its order.
    orangeMoneyPayToken: { $gt: "" },
    orangeMoneyOrderId: { $gt: "" },
    createdAt: { $lt: olderThan, $gt: newerThan },
  })
    .select("_id orangeMoneyOrderId orangeMoneyPayToken total preorderOutstandingAmount")
    .limit(limit);

  for (const order of orders) {
    result.checked++;
    try {
      const expectedAmount = Math.max(
        0,
        Number(order.total || 0) - Number(order.preorderOutstandingAmount || 0),
      );
      const transaction = await getOrangeMoneyTransactionStatus({
        creds,
        orderId: String(order.orangeMoneyOrderId),
        amount: expectedAmount,
        payToken: String(order.orangeMoneyPayToken),
      });
      if (getOrangeMoneyTransactionState(transaction) !== "completed") continue;

      // No customerEmail: the confirmation email belongs to the path the
      // shopper is watching, and a sweep replaying it days later is noise.
      await finalizeOrangeMoneyOrder({
        orderId: String(order.orangeMoneyOrderId),
        transaction,
        mode: creds.mode,
        settings,
      });
      result.recovered++;
    } catch (error) {
      result.failed++;
      console.error(
        `Orange Money reconciliation failed for order ${order._id}:`,
        error,
      );
    }
  }

  // ---- vendor → platform attempts ---------------------------------------
  const attempts = await PlatformPayment.find({
    provider: "orange_money",
    status: PLATFORM_PAYMENT_STATUS.PENDING,
    orangeMoneyPayToken: { $gt: "" },
    createdAt: { $lt: olderThan, $gt: newerThan },
  }).limit(limit);

  for (const attempt of attempts) {
    result.checked++;
    try {
      const { paid } = await verifyPlatformPayment(attempt, settings);
      if (paid) result.recovered++;
    } catch (error) {
      result.failed++;
      console.error(
        `Orange Money reconciliation failed for platform payment ${attempt._id}:`,
        error,
      );
    }
  }

  return result;
}
