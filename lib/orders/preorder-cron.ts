import { Types } from "mongoose";
import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import {
  getPreorderBalanceDue,
  owesPreorderBalanceMatch,
} from "@/lib/orders/order-payment-status";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  consumePreorderStockOnReady,
  releaseOrderPreorders,
} from "@/lib/orders/preorders";
import { refundCancelledPreorder } from "@/lib/orders/preorder-cancel-refund";
import { restoreOrderInventory } from "@/lib/orders/order-inventory";
import { reverseCouponUsageForOrder } from "@/lib/catalog/coupons";
import { notifyPreorderCustomerUpdate } from "@/lib/notifications/notifications";
import { getSettings } from "@/models/settings.model";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import { getFulfillmentPaymentBlock } from "@/lib/orders/fulfillment-payment-gate";
import {
  PREORDER_BALANCE_MAX_ATTEMPTS,
  PREORDER_BALANCE_RETRY_HOURS,
  chargePreorderBalanceOffSession,
  collectPreorderBalanceOnRequest,
} from "@/lib/payments/preorder-balance-charge";

/**
 * The clock a pre-order runs on, once a day.
 *
 * Everything else in the module moves when a person does something — a shopper
 * checks out, an admin marks a batch ready, a carrier reports a delivery. The
 * long middle stretch, where a reservation sits for weeks holding quota against
 * money that has not arrived, had nobody watching it at all. A shopper asked
 * for a balance was told once and never again; an order they abandoned held its
 * quota against a sale that could never complete, for good; and `expired` sat
 * in the status enum with no code path able to write it.
 *
 * **Idempotency is per order, not per run.** There is no global lock, and none
 * is wanted: every action below is a conditional claim on a single document —
 * `$addToSet` for a reminder stage, a status guard for an expiry — so two
 * overlapping runs, or a retry after a timeout, cannot send the same reminder
 * twice or cancel the same order twice. A run-level lease would be weaker: it
 * would stop concurrent runs while doing nothing about a run that half
 * finished.
 *
 * Nothing here decides anything a human should. It never invents a new release
 * date (only the vendor knows one), and it never keeps money — an expiry
 * refunds in full, exactly as any other cancellation does.
 */

/**
 * Reminder stages, keyed by how long before the release date they go out.
 *
 * MUST stay ordered furthest-first: each stage's window is bounded below by
 * the next one down, so that an order does not fall into two at once.
 */
export const PREORDER_REMINDER_STAGES = [
  { key: "t-7", daysBefore: 7 },
  { key: "t-1", daysBefore: 1 },
] as const;

/**
 * How long past its due date an unpaid balance survives, when the store has
 * not said. `settings.preorder.expiryGraceDays` overrides it.
 *
 * The due date is the LATER of the release date and the day the store
 * actually asked for the balance (`preorderBalanceRequestedAt`). The release
 * date alone is the date the shopper agreed to, but it is only the right
 * clock while the goods arrive on time: a batch received in July against a
 * June release date was already past its grace the moment payment was
 * requested, so the shopper was reminded and cancelled in the same run.
 * Orders that predate the stamp still fall back to the release date — the
 * behaviour they have had all along, and better than inventing a request date
 * from `updatedAt`, which would expire orders for having been edited.
 */
export const PREORDER_EXPIRY_GRACE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Orders that owe a balance and are still alive to pay it.
 *
 * Mirrors `getPreorderBalanceDue` — outstanding above zero, not cancelled,
 * part-paid or pending on a pay-later order — so the batch holds only orders a pass
 * will act on. The passes below read a capped batch with no cursor; a row the
 * loop skipped instead of claiming came back first in every run, and enough of
 * them would fill the batch for good and starve every order behind them.
 */
function unpaidBalanceFilter() {
  return {
    hasPreorder: true,
    preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
    status: { $ne: ORDER_STATUS.CANCELLED },
    ...owesPreorderBalanceMatch(),
    preorderOutstandingAmount: { $gt: 0 },
  };
}

type CronOrder = {
  _id: Types.ObjectId;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  total?: number;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  preorderReleaseDate?: Date;
  preorderBalanceRequestedAt?: Date | null;
  preorderOutstandingAmount?: number;
  preorderBalancePaidAt?: Date | null;
  /**
   * Only what `getPreorderBalanceDue` reads of them: a consignment a vendor
   * has called off is no longer part of what the shopper owes, and a reminder
   * built on the raw figure would chase money for goods nobody is sending.
   */
  subOrders?: Array<{
    status?: string;
    items?: Array<{ preorderOutstandingAmount?: number | null }> | null;
  }> | null;
};

const CRON_ORDER_FIELDS =
  "_id orderNumber customerId guestEmail total status paymentStatus paymentMethod preorderReleaseDate preorderBalanceRequestedAt preorderOutstandingAmount preorderBalancePaidAt subOrders.status subOrders.items.preorderOutstandingAmount";

/**
 * Nudge shoppers whose balance falls due soon.
 *
 * Guest orders used to be left out of this entirely — counted and skipped —
 * because their `customerId` is a cart, so the notifier had no account to
 * write to and, more to the point, no page to send them to. Both halves are
 * answered now: the notifier mails the address on the order, and the message
 * carries a link signed for that order
 * (`lib/payments/preorder-balance-link.ts`) which lets them pay without an
 * account. So the batch is one query again, and a guest is reminded like
 * anybody else.
 */
export async function sendPreorderBalanceReminders(limit = 200): Promise<{
  sent: number;
  byStage: Record<string, number>;
}> {
  const now = Date.now();
  const byStage: Record<string, number> = {};
  let sent = 0;

  for (const [index, stage] of PREORDER_REMINDER_STAGES.entries()) {
    byStage[stage.key] = 0;

    // Each window stops where the next one down begins, so an order that only
    // reaches `payment_due` a day before release gets the T-1 nudge and not
    // both at once — two identical mails in the same minute.
    //
    // The nearest stage keeps no lower bound on purpose: it is what catches an
    // order that slipped past a missed run, or one already overdue, and
    // reminds it late rather than not at all.
    const nearerStage = PREORDER_REMINDER_STAGES[index + 1];
    const stageFilter = {
      ...unpaidBalanceFilter(),
      preorderReleaseDate: {
        $lte: new Date(now + stage.daysBefore * DAY_MS),
        ...(nearerStage
          ? { $gt: new Date(now + nearerStage.daysBefore * DAY_MS) }
          : {}),
      },
      preorderBalanceRemindersSent: { $ne: stage.key },
    };
    const due = await Order.find(stageFilter)
      .select(CRON_ORDER_FIELDS)
      .limit(limit)
      .lean<CronOrder[]>();

    for (const order of due) {
      // The query already narrows to these; this is the rule that decides.
      if (getPreorderBalanceDue(order) <= 0) continue;
      // Neither an account to file against nor an address to mail: there is
      // nobody to remind, and the claim below would spend the stage on them.
      if (!order.customerId && !order.guestEmail) continue;

      // The claim. Only the caller that actually adds the stage sends the mail,
      // so a concurrent run finds the array already containing it and stops.
      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, preorderBalanceRemindersSent: { $ne: stage.key } },
        { $addToSet: { preorderBalanceRemindersSent: stage.key } },
      ).lean();
      if (!claimed) continue;

      await notifyPreorderCustomerUpdate(
        String(order.customerId || ""),
        order.orderNumber,
        "payment_due",
        String(order._id),
        {
          releaseDate: order.preorderReleaseDate,
          outstandingAmount: getPreorderBalanceDue(order),
          balanceRequestedAt: order.preorderBalanceRequestedAt ?? undefined,
          // A guest order's `customerId` is its cart, so this is the only
          // address the reminder can reach.
          guestEmail: order.guestEmail,
        },
      ).catch((err) =>
        console.error(
          `Failed to send ${stage.key} pre-order balance reminder for ${order.orderNumber}:`,
          err,
        ),
      );

      byStage[stage.key] += 1;
      sent += 1;
    }
  }

  return { sent, byStage };
}

/**
 * Give up on reservations whose balance never arrived.
 *
 * This is the only writer of `PREORDER_ITEM_STATUS.EXPIRED` — until it existed
 * the state was declared, labelled, coloured and even had notification copy,
 * but nothing could ever reach it.
 *
 * The order is deliberate. `releaseOrderPreorders` stamps `cancelled` as it
 * frees the quota, so the expiry stamp goes on afterwards; and the refund runs
 * before the customer is told, so the message and the money agree.
 */
export async function expireUnpaidPreorders(limit = 100): Promise<{
  expired: number;
  refunded: number;
  graceDays: number;
  needingAttention: Array<{ orderNumber: string; reason?: string }>;
}> {
  const settings = await getSettings();
  const graceDays =
    resolvePreorderPolicy(settings.preorder).expiryGraceDays ||
    PREORDER_EXPIRY_GRACE_DAYS;
  const cutoff = new Date(Date.now() - graceDays * DAY_MS);
  const candidates = await Order.find({
    ...unpaidBalanceFilter(),
    // The release date arm is redundant with the `$expr` below — the later of
    // the two dates can only be past the cutoff if the release date is — but
    // it is the indexed one, so it does the narrowing and the expression does
    // the deciding.
    preorderReleaseDate: { $lt: cutoff },
    $expr: {
      $lt: [
        { $max: ["$preorderReleaseDate", "$preorderBalanceRequestedAt"] },
        cutoff,
      ],
    },
  })
    .select(CRON_ORDER_FIELDS)
    .limit(limit)
    .lean<CronOrder[]>();

  let expired = 0;
  let refunded = 0;
  const needingAttention: Array<{ orderNumber: string; reason?: string }> = [];

  for (const order of candidates) {
    if (getPreorderBalanceDue(order) <= 0) continue;

    // The claim: only a still-live order can be expired, and only once.
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        status: { $ne: ORDER_STATUS.CANCELLED },
        preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
      },
      {
        $set: {
          status: ORDER_STATUS.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: "Pre-order balance was not paid",
        },
      },
    ).lean();
    if (!claimed) continue;

    expired += 1;

    await restoreOrderInventory(String(order._id)).catch((err) =>
      console.error("Failed to restore inventory on pre-order expiry:", err),
    );
    await releaseOrderPreorders(String(order._id)).catch((err) =>
      console.error("Failed to release quota on pre-order expiry:", err),
    );
    await reverseCouponUsageForOrder(String(order._id)).catch((err) =>
      console.error("Failed to reverse coupon on pre-order expiry:", err),
    );

    // Cancel means refund, and an expiry is a cancellation the shopper did not
    // ask for — so it refunds like any other. A deposit order gets its deposit
    // back; a pay-later one took nothing and reports nothing to return.
    const refund = await refundCancelledPreorder({
      orderId: String(order._id),
      reason: "Pre-order expired — balance not paid",
    }).catch((err: unknown) => {
      console.error("Failed to refund expired pre-order:", err);
      return { refunded: false, reason: "The refund could not be issued" };
    });
    if (refund.refunded) {
      refunded += 1;
      // Recorded, but no gateway sent it: a person still has to.
      if ("gatewayCalled" in refund && refund.gatewayCalled === false) {
        needingAttention.push({
          orderNumber: order.orderNumber,
          reason: "Recorded as refunded — send it to the shopper by hand",
        });
      }
    } else if (refund.reason !== "No money was collected on this order") {
      needingAttention.push({
        orderNumber: order.orderNumber,
        reason: refund.reason,
      });
    }

    // Stamped last: `releaseOrderPreorders` writes `cancelled` across the
    // items as it frees the quota, and this is the state that says WHY.
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          preorderStatus: PREORDER_ITEM_STATUS.EXPIRED,
          "items.$[item].preorderStatus": PREORDER_ITEM_STATUS.EXPIRED,
          "subOrders.$[].items.$[subItem].preorderStatus":
            PREORDER_ITEM_STATUS.EXPIRED,
        },
      },
      {
        arrayFilters: [
          { "item.purchaseType": PURCHASE_TYPE.PREORDER },
          { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
        ],
      },
    ).catch((err) =>
      console.error("Failed to stamp pre-order as expired:", err),
    );

    // A cancellation notice is information, not an action, so it reaches a
    // guest as well: the notifier mails the address on the order rather than
    // filing a row against a cart nobody can read. (The reminders above stay
    // account-only — they ask for a payment a guest has no page to make.)
    if (order.customerId || order.guestEmail) {
      await notifyPreorderCustomerUpdate(
        String(order.customerId || ""),
        order.orderNumber,
        "expired",
        String(order._id),
        {
          releaseDate: order.preorderReleaseDate,
          guestEmail: order.guestEmail,
        },
      ).catch((err) =>
        console.error("Failed to notify expired pre-order customer:", err),
      );
    }
  }

  return { expired, refunded, graceDays, needingAttention };
}

/**
 * Try the saved card again on balances that did not go through first time.
 *
 * The store's own "ask for the balance" action makes the first attempt, so
 * that a shopper who authorised a card-on-file charge is normally never
 * troubled at all. This pass is what makes that a promise rather than a hope:
 * it picks up the attempts that failed on a card worth retrying, AND the ones
 * that never happened — a store action whose charge died before it started
 * leaves no stamp behind, and without this the order would sit waiting for a
 * charge nobody was going to make.
 *
 * The decision is not made here. `preorderBalanceChargeEligibility` owns it
 * and the charge re-checks it under a claim, so this query only narrows.
 */
export async function retryPreorderBalanceCharges(limit = 100): Promise<{
  attempted: number;
  charged: number;
  needsShopper: number;
  declined: number;
}> {
  const retryCutoff = new Date(
    Date.now() - PREORDER_BALANCE_RETRY_HOURS * 60 * 60 * 1000,
  );
  const candidates = await Order.find({
    ...unpaidBalanceFilter(),
    preorderSavedPaymentMethodId: { $nin: [null, ""] },
    preorderMandateAcceptedAt: { $ne: null },
    preorderBalanceChargeAttempts: { $lt: PREORDER_BALANCE_MAX_ATTEMPTS },
    $or: [
      { preorderBalanceLastChargeAt: { $exists: false } },
      { preorderBalanceLastChargeAt: null },
      { preorderBalanceLastChargeAt: { $lt: retryCutoff } },
    ],
  })
    .select("_id orderNumber")
    .limit(limit)
    .lean<Array<{ _id: Types.ObjectId; orderNumber: string }>>();

  let attempted = 0;
  let charged = 0;
  let needsShopper = 0;
  let declined = 0;

  for (const order of candidates) {
    const result = await chargePreorderBalanceOffSession({
      orderId: String(order._id),
    }).catch((err: unknown) => {
      console.error(
        `Failed to charge the saved card for ${order.orderNumber}:`,
        err,
      );
      return { charged: false as const, outcome: "error" as const, reason: "" };
    });
    // A skip is a race lost or a rule refused — nothing was tried, so it is
    // not an attempt and says nothing about the card.
    if (!result.charged && result.outcome === "skipped") continue;
    attempted += 1;
    if (result.charged) charged += 1;
    else if (result.outcome === "needs_shopper") needsShopper += 1;
    else if (result.outcome === "declined") declined += 1;
  }

  return { attempted, charged, needsShopper, declined };
}

/**
 * Ask for the balance, and release what is paid for, on the day it was due.
 *
 * The pre-order flow's one remaining manual step: the goods arrive, and
 * somebody has to open the queue and click on every order. A store that ships
 * when it said it would already knows the answer — it is the release date its
 * own vendor set — so this does the clicking for it.
 *
 * **Off unless the store turns it on** (`preorder.autoRelease`). Asking for
 * money is a statement that the goods are ready, and a version bump must never
 * start making that statement on a store's behalf.
 *
 * It never invents a date, which is what separates it from
 * {@link countOverdueReleases} below — that one still refuses to act, because
 * moving a release date needs a NEW date and only the vendor has one. Acting on
 * the date already given is a different thing entirely.
 *
 * The two arms are gated differently, and deliberately:
 *
 *  - **Nothing owed** — the order is released for fulfilment, which consumes
 *    the received units. That claim is the stock check: if the goods are not
 *    actually in, it fails, the order is left alone, and the next run tries
 *    again. Stock decides, not the calendar.
 *  - **A balance owed** — the order moves to `payment_due` and consumes
 *    nothing, exactly as an admin's own "ask for payment" does. The date is
 *    the only gate here because it is the only gate there.
 */
export async function autoReleaseDuePreorders(limit = 100): Promise<{
  enabled: boolean;
  balanceRequested: number;
  released: number;
  waitingOnStock: number;
}> {
  const settings = await getSettings();
  const policy = resolvePreorderPolicy(settings.preorder);
  if (!policy.autoRelease) {
    return {
      enabled: false,
      balanceRequested: 0,
      released: 0,
      waitingOnStock: 0,
    };
  }

  const cutoff = new Date(Date.now() - policy.autoReleaseDelayDays * DAY_MS);
  const candidates = await Order.find({
    hasPreorder: true,
    preorderStatus: PREORDER_ITEM_STATUS.RESERVED,
    status: { $ne: ORDER_STATUS.CANCELLED },
    preorderReleaseDate: { $lte: cutoff },
  })
    .select(CRON_ORDER_FIELDS)
    .limit(limit)
    .lean<CronOrder[]>();

  let balanceRequested = 0;
  let released = 0;
  let waitingOnStock = 0;

  for (const order of candidates) {
    const outstanding = getPreorderBalanceDue(order);

    if (outstanding <= 0) {
      // "Nothing owed" is also the answer for a deposit or full-price
      // pre-order whose gateway never captured anything — releasing that one
      // would put an unpaid order in the vendor's queue to ship. It stays
      // reserved until the payment arrives.
      if (getFulfillmentPaymentBlock({ ...order, hasPreorder: true }, null)) {
        continue;
      }
      const outcome = await consumePreorderStockOnReady(String(order._id));
      if (!outcome.consumed && !outcome.alreadyConsumed) {
        // The intake has not been recorded yet. Nothing is written, so the
        // next run simply tries again — which is the whole point of letting
        // the stock claim be the gate.
        waitingOnStock += 1;
        continue;
      }
      const claimed = await claimAutoRelease(order._id, {
        status: ORDER_STATUS.PROCESSING,
        preorderStatus: PREORDER_ITEM_STATUS.READY,
        extraSet: { processingAt: new Date() },
      });
      if (!claimed) {
        // An admin released it from under us between the read and the claim,
        // and the units we just took are theirs. Put ours back — claim-based,
        // so it no-ops if their own path already accounted for them.
        await restoreOrderInventory(String(order._id)).catch((err) =>
          console.error(
            "Failed to restore stock after a lost auto-release race:",
            err,
          ),
        );
        continue;
      }
      released += 1;

      const { queueAutoShipForOrder } = await import(
        "@/lib/shipping/carriers/shipment-worker"
      );
      await queueAutoShipForOrder(String(order._id)).catch((err) =>
        console.error("Failed to queue auto-ship for a released pre-order:", err),
      );
      await notifyPreorderCustomerUpdate(
        String(order.customerId || ""),
        order.orderNumber,
        "ready",
        String(order._id),
        {
          releaseDate: order.preorderReleaseDate,
          guestEmail: order.guestEmail,
          settings,
        },
      ).catch((err) =>
        console.error("Failed to tell a shopper their pre-order is ready:", err),
      );
      continue;
    }

    const claimed = await claimAutoRelease(order._id, {
      status: ORDER_STATUS.PREORDERED,
      preorderStatus: PREORDER_ITEM_STATUS.PAYMENT_DUE,
      // The expiry clock starts when the money is actually asked for. An order
      // reaching here has never been asked — a `payment_due` one is not in the
      // candidate set — so this is always the first request.
      extraSet: { preorderBalanceRequestedAt: new Date() },
      unset: { preorderBalanceRemindersSent: "" },
    });
    if (!claimed) continue;
    balanceRequested += 1;

    // Take it from the card on file if the shopper left one, exactly as the
    // store's own "ask for payment" does — and say nothing extra if that
    // attempt has already written to them.
    const collection = await collectPreorderBalanceOnRequest(String(order._id));
    if (collection.shopperAlreadyTold) continue;

    await notifyPreorderCustomerUpdate(
      String(order.customerId || ""),
      order.orderNumber,
      "payment_due",
      String(order._id),
      {
        releaseDate: order.preorderReleaseDate,
        outstandingAmount: outstanding,
        balanceRequestedAt: new Date(),
        guestEmail: order.guestEmail,
        settings,
      },
    ).catch((err) =>
      console.error("Failed to ask a shopper for their pre-order balance:", err),
    );
  }

  return { enabled: true, balanceRequested, released, waitingOnStock };
}

/**
 * Move one reservation on, and only from `reserved`.
 *
 * The status guard is the idempotency: two overlapping runs, or a run racing
 * an admin, cannot both transition the same order, and the loser is told so by
 * getting nothing back.
 */
async function claimAutoRelease(
  orderId: unknown,
  next: {
    status: string;
    preorderStatus: string;
    extraSet?: Record<string, unknown>;
    unset?: Record<string, string>;
  },
) {
  return Order.findOneAndUpdate(
    {
      _id: orderId,
      status: { $ne: ORDER_STATUS.CANCELLED },
      preorderStatus: PREORDER_ITEM_STATUS.RESERVED,
    },
    {
      $set: {
        status: next.status,
        preorderStatus: next.preorderStatus,
        "items.$[item].preorderStatus": next.preorderStatus,
        // ONLY the consignments still waiting on the pre-order. An order can
        // pair a pre-order from one seller with lines from another that have
        // already shipped or been cancelled, and a blanket write drags those
        // back — the same rule every other transition here follows.
        "subOrders.$[preorderSub].status": next.status,
        "subOrders.$[preorderSub].items.$[subItem].preorderStatus":
          next.preorderStatus,
        ...(next.extraSet || {}),
      },
      ...(next.unset ? { $unset: next.unset } : {}),
    },
    {
      returnDocument: "after",
      arrayFilters: [
        { "item.purchaseType": PURCHASE_TYPE.PREORDER },
        { "preorderSub.status": ORDER_STATUS.PREORDERED },
        { "subItem.purchaseType": PURCHASE_TYPE.PREORDER },
      ],
    },
  ).lean();
}

/**
 * Reservations whose release date has come and gone with nothing shipped.
 *
 * Counted, never acted on. Moving a release date needs a new date and a reason,
 * and only the vendor has either — a job that guessed would be telling shoppers
 * something nobody knows. Surfacing the number is the useful half.
 *
 * Unrelated to {@link autoReleaseDuePreorders} above, which acts on the date
 * the vendor DID give rather than on one nobody has.
 */
export async function countOverdueReleases(): Promise<number> {
  return Order.countDocuments({
    hasPreorder: true,
    preorderStatus: PREORDER_ITEM_STATUS.RESERVED,
    status: { $ne: ORDER_STATUS.CANCELLED },
    preorderReleaseDate: { $lt: new Date() },
  });
}
