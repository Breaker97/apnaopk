/**
 * The third line of defence for MTN MoMo payments.
 *
 * MoMo's callback is the weakest of any gateway here: delivered once,
 * unsigned, with no retries at all. If the shopper approves the PIN prompt and
 * then closes the tab before the verify poll resolves, and that one delivery
 * is missed, the order sits PENDING forever with the money already taken and
 * nothing anywhere raising a hand.
 *
 * This sweep closes that hole by asking MTN directly — a status read under the
 * X-Reference-Id we stored at checkout. It needs no callback and no open
 * browser tab.
 *
 * It only ever *completes* payments. A transaction MTN reports as failed or
 * expired is left alone: an abandoned checkout is already handled elsewhere,
 * and cancelling an order on this path would risk retiring one the shopper is
 * still paying for.
 */
import { Order, PlatformPayment } from "@/models";
import { PAYMENT_STATUS, PLATFORM_PAYMENT_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { resolveMtnMomoCredentials } from "@/lib/settings/credentials";
import {
  getMtnMomoCredentials,
  getMtnMomoRequestToPayStatus,
  getMtnMomoTransactionState,
  MtnMomoApiError,
} from "@/lib/payments/mtn-momo";
import { finalizeMtnMomoOrder } from "@/lib/payments/mtn-momo-orders";
import { verifyPlatformPayment } from "@/lib/payments/platform-payments";

/**
 * How long a payment must have been pending before we ask about it.
 *
 * Long enough that the shopper's own poll has had its turn (a MoMo prompt
 * expires within minutes, so anything real has resolved by now), short enough
 * that a stranded order is repaired within one sweep.
 */
const MTN_MOMO_RECONCILE_AFTER_MS = 10 * 60_000;

/**
 * Stop chasing a payment nobody ever completed. A requesttopay left
 * unapproved expires on MTN's side within minutes, so anything still pending
 * after this window is an abandoned checkout, not a recoverable payment —
 * and without a cutoff every abandoned checkout would be re-queried on every
 * sweep, forever.
 */
const MTN_MOMO_RECONCILE_UNTIL_MS = 48 * 60 * 60_000;

interface MtnMomoReconcileResult {
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
export async function reconcileMtnMomoPayments(
  limit = 50,
): Promise<MtnMomoReconcileResult> {
  const settings = await getSettings();
  if (!settings.payment?.mtn_momo?.enabled) {
    return { checked: 0, recovered: 0, failed: 0 };
  }

  let creds;
  try {
    creds = getMtnMomoCredentials(
      resolveMtnMomoCredentials(settings.payment?.mtn_momo),
    );
  } catch {
    // Enabled but not configured — nothing to ask MTN with.
    return { checked: 0, recovered: 0, failed: 0 };
  }

  const now = Date.now();
  const olderThan = new Date(now - MTN_MOMO_RECONCILE_AFTER_MS);
  const newerThan = new Date(now - MTN_MOMO_RECONCILE_UNTIL_MS);

  const result: MtnMomoReconcileResult = {
    checked: 0,
    recovered: 0,
    failed: 0,
  };

  // ---- storefront orders -------------------------------------------------
  const orders = await Order.find({
    paymentMethod: "mtn_momo",
    paymentStatus: PAYMENT_STATUS.PENDING,
    mtnMomoReferenceId: { $gt: "" },
    createdAt: { $lt: olderThan, $gt: newerThan },
  })
    .select("_id mtnMomoReferenceId")
    .limit(limit);

  for (const order of orders) {
    result.checked++;
    try {
      const transaction = await getMtnMomoRequestToPayStatus({
        creds,
        referenceId: String(order.mtnMomoReferenceId),
      });
      if (getMtnMomoTransactionState(transaction) !== "completed") continue;

      // No customerEmail: the confirmation email belongs to the path the
      // shopper is watching, and a sweep replaying it days later is noise.
      await finalizeMtnMomoOrder({
        referenceId: String(order.mtnMomoReferenceId),
        transaction,
        mode: creds.mode,
        settings,
      });
      result.recovered++;
    } catch (error) {
      // A reference MTN has never heard of belongs to a requesttopay that
      // failed after the reference was stored — permanently unanswerable, and
      // permanently unpaid. Not an error worth alarming on every sweep.
      if (error instanceof MtnMomoApiError && error.httpStatus === 404) {
        continue;
      }
      result.failed++;
      console.error(
        `MTN MoMo reconciliation failed for order ${order._id}:`,
        error,
      );
    }
  }

  // ---- vendor → platform attempts ---------------------------------------
  const attempts = await PlatformPayment.find({
    provider: "mtn_momo",
    status: PLATFORM_PAYMENT_STATUS.PENDING,
    mtnMomoReferenceId: { $gt: "" },
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
        `MTN MoMo reconciliation failed for platform payment ${attempt._id}:`,
        error,
      );
    }
  }

  return result;
}
