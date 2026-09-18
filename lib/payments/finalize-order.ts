import { after } from "next/server";
import { Cart, Order } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { sendOrderConfirmationEmail } from "@/lib/email/order-emails";
import {
  decrementInventory,
  InsufficientStockError,
} from "@/lib/inventory/inventory";
import {
  markOrderInventoryReserved,
  orderInventoryOpts,
} from "@/lib/orders/order-inventory";
import {
  getOrderPreorderLines,
  markOrderPreorderReserved,
  PreorderUnavailableError,
  PURCHASE_TYPE,
  reservePreorderQuantity,
} from "@/lib/orders/preorders";
import { ensureChargeTransaction } from "@/lib/payments/payment-transactions";
import {
  auditOrderCancelled,
  auditOrderPaid,
  auditOrderPlaced,
  auditConsignmentsCancelled,
  systemActor,
} from "@/lib/orders/audit-order";
import type { AuditContext } from "@/lib/audit";
import { applyCouponUsageForOrder } from "@/lib/catalog/coupons";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import { markCheckoutRecovered } from "@/lib/orders/abandoned-checkouts";
import {
  notifyAdminsPaymentAnomaly,
  notifyOrderItemsDropped,
  notifyOrderCreatedParticipants,
} from "@/lib/notifications/notifications";
import type { getSettings } from "@/models/settings.model";

export type SettingsDocument = Awaited<ReturnType<typeof getSettings>>;

/** A pending order as `Order.findOne()` hands it over. */
export type PendingOrderDocument = NonNullable<
  Awaited<ReturnType<typeof Order.findOne>>
>;

interface FinalizedOrderResult {
  orderId: string;
  orderNumber: string;
  /** True when a replay (second webhook, racing poll) found the money already recorded. */
  alreadyPaid: boolean;
}

/**
 * What a gateway's verifier hands back once it has proven the payment: the
 * identifier to record, the provider columns to set with it, and what the
 * audit trail should call the transaction.
 */
interface CapturedPaymentVerification {
  /** Written to `Order.paymentId` and named in the abandoned-checkout event. */
  paymentId: string;
  /** Provider-specific columns set in the same write (ids, gateway fee). */
  paymentUpdate?: Record<string, unknown>;
  /**
   * Shown in the audit trail. Defaults to `paymentId`; pass `null` when the
   * gateway reported no transaction id of its own (the audit row then simply
   * omits it, as the per-gateway finalizers always did).
   */
  auditTransactionId?: string | null;
  /** The payer's email as the gateway reported it, used when the caller has none. */
  customerEmail?: string;
}

export interface FinalizeCapturedOrderParams {
  provider: {
    /** `Order.paymentMethod` of the orders this gateway settles. */
    paymentMethod: string;
    /** Human name for the audit trail and log lines ("Paystack"). */
    label: string;
    /** Key recorded on the abandoned-checkout payment event ("mtn_momo"). */
    recoveryGateway: string;
    /**
     * True when `verify` is what takes the money (PayPal captures inside it).
     * Such a verifier is never run for a cancelled order: nothing has been
     * taken yet, and capturing only to refund would put both on the shopper's
     * statement.
     */
    capturesOnVerify?: boolean;
  };
  /**
   * Locates the pending order. `scope` already carries the payment method and,
   * for a signed-in verify call, the customer — spread it into every query.
   */
  findOrder: (
    scope: Record<string, unknown>,
  ) => Promise<PendingOrderDocument | null>;
  /** Thrown as a ValidationError when `findOrder` finds nothing. */
  notFoundMessage: string;
  /**
   * Provider checks that must run even on an already-paid order (a reference
   * that points at a different transaction is wrong regardless of state).
   */
  assertReference?: (order: PendingOrderDocument) => void;
  /**
   * Proves the gateway's answer matches this order — state, reference,
   * currency, amount — and throws a ValidationError on any doubt. Only runs
   * for an order that is still unpaid and not cancelled.
   */
  verify: (
    order: PendingOrderDocument,
  ) => CapturedPaymentVerification | Promise<CapturedPaymentVerification>;
  settings: SettingsDocument;
  sessionUserId?: string;
  cartSessionId?: string;
  customerEmail?: string;
  /** Audit actor; the system actor unless the caller has a request to attach. */
  actor?: AuditContext;
}

const CANCELLED_BEFORE_CAPTURE =
  "This order was cancelled before the payment arrived, so the payment is being refunded.";

const SOLD_OUT_AFTER_CAPTURE =
  "The items sold out before your payment was confirmed, so the order was cancelled and the payment is being refunded.";

/**
 * The `cancelReason` of an order whose goods sold out between checkout and
 * capture. Stored so a page that finds the order afterwards — the card success
 * page, polling after the order was already written — can tell the shopper why
 * it is gone rather than thanking them for it.
 */
export const SOLD_OUT_AFTER_CAPTURE_CANCEL_REASON =
  "The items sold out after the payment was captured";

type OrderLine = {
  productId: unknown;
  variantId?: unknown;
  vendorId?: unknown;
  quantity: number;
  purchaseType?: string;
  quoteId?: unknown;
};

type ConsignmentRef = { _id?: unknown; vendorId?: unknown; status?: string };

function isStandardLine(item: { purchaseType?: string }) {
  return (item.purchaseType || PURCHASE_TYPE.STANDARD) === PURCHASE_TYPE.STANDARD;
}

/** Which seller a line belongs to; "" for a line that names none. */
function lineVendorKey(item: { vendorId?: unknown }): string {
  return item.vendorId ? String(item.vendorId) : "";
}

function sameProductLine(
  item: OrderLine,
  line: { productId?: unknown; variantId?: unknown },
): boolean {
  const productId = String(
    (item.productId as { _id?: unknown } | null)?._id ?? item.productId ?? "",
  );
  return (
    productId === String(line.productId ?? "") &&
    String(item.variantId ?? "") === String(line.variantId ?? "")
  );
}

/**
 * Take the stock (or pre-order quota) for every seller still on the order,
 * dropping any seller whose goods ran out instead of the whole order.
 *
 * One seller's line selling out between checkout and capture used to cancel
 * and refund everybody's: a shopper who bought a 300 jacket and a 30 scarf
 * from two different shops lost the jacket because the scarf was gone. The
 * decrement is all-or-nothing and names the line it could not cover, so the
 * seller behind that line is set aside and the rest is tried again.
 *
 * Throws the stock error when there is nothing worth keeping — a single
 * seller, a line nobody on the order sells, or every seller gone — and the
 * caller cancels the whole order exactly as before. Resolves with the sellers
 * that had to be dropped.
 */
async function takeStockDroppingSoldOutSellers(params: {
  order: PendingOrderDocument;
  lines: OrderLine[];
}): Promise<string[]> {
  const { order } = params;
  let remaining = params.lines;
  const soldOut: string[] = [];

  for (;;) {
    try {
      if (order.hasPreorder) {
        await reservePreorderQuantity(getOrderPreorderLines(remaining));
      } else {
        await decrementInventory(
          remaining.filter(isStandardLine).map((item) => ({
            productId: String(item.productId),
            variantId: item.variantId ? String(item.variantId) : undefined,
            quantity: item.quantity,
          })),
          // A collection comes off the counter the shopper chose, not off
          // whichever branch happens to hold the most.
          orderInventoryOpts(order),
        );
      }
      return soldOut;
    } catch (err) {
      if (
        !(err instanceof InsufficientStockError) &&
        !(err instanceof PreorderUnavailableError)
      ) {
        throw err;
      }
      const sellers = new Set(remaining.map(lineVendorKey));
      const failedLine = (err as { line?: { productId?: unknown; variantId?: unknown } })
        .line;
      const culprits = new Set(
        failedLine
          ? remaining
              .filter((item) => sameProductLine(item, failedLine))
              .map(lineVendorKey)
          : [],
      );
      if (sellers.size <= 1 || culprits.size === 0 || culprits.has("")) {
        throw err;
      }
      remaining = remaining.filter((item) => !culprits.has(lineVendorKey(item)));
      soldOut.push(...culprits);
      if (remaining.length === 0) throw err;
    }
  }
}

/**
 * Give back one or more consignments' share of a payment that has otherwise
 * gone through, and tell the admins how it went.
 */
async function refundDroppedConsignments(params: {
  order: { _id: unknown; orderNumber: string; paymentId?: string; currency?: string };
  subOrderIds: unknown[];
  provider: { label: string };
  reason: string;
  /** Why the goods are not coming, in the words the shopper is told. */
  cause: "sold_out" | "seller_cancelled";
}): Promise<boolean> {
  const { order, provider, reason } = params;
  if (params.subOrderIds.length === 0) return false;
  const { refundOrderCancellation } = await import(
    "@/lib/orders/preorder-cancel-refund"
  );
  const refund = await refundOrderCancellation({
    orderId: String(order._id),
    cancelledSubOrderIds: params.subOrderIds,
    reason,
  }).catch((err: unknown) => ({
    refunded: false,
    gatewayCalled: undefined,
    reason: err instanceof Error ? err.message : "The refund could not be issued",
  }));
  // Nothing collected for them, nothing to say.
  if (!refund) return false;

  const outcome = !refund.refunded
    ? `was NOT refunded (${refund.reason}) — refund it by hand`
    : refund.gatewayCalled === false
      ? `was recorded as refunded, but ${provider.label} cannot send it back automatically — return it by hand`
      : "was refunded through the gateway";
  await notifyAdminsPaymentAnomaly({
    title: `${provider.label} payment covered goods that will not ship`,
    message: `Order ${order.orderNumber}: ${reason}. That part of the payment ${outcome}; the rest of the order goes ahead.`,
    paymentIntentId: order.paymentId,
  }).catch((err) =>
    console.error("Failed to send payment anomaly alert:", err),
  );

  // The shopper paid for these too. Their confirmation lists every item at the
  // original total, so without this they wait for goods that are not coming.
  // A refund that could not be recorded at all is the admins' to sort out
  // first; telling the shopper they are being refunded would be a promise.
  const refundedAmount = Number((refund as { amount?: number }).amount || 0);
  if (refund.refunded && refundedAmount > 0) {
    await notifyOrderItemsDropped({
      orderId: String(order._id),
      refundedAmount,
      currency: order.currency,
      cause: params.cause,
      refundSent: refund.gatewayCalled !== false,
    }).catch((err) =>
      console.error("Failed to tell the shopper about dropped items:", err),
    );
  }
  return Boolean(refund.refunded);
}

/**
 * Settles a pending order once its gateway has confirmed the money.
 *
 * Every gateway that creates the order at checkout and captures later
 * (Paystack, Razorpay, PayPal, Pesapal, ioTec, MTN MoMo, Orange Money) runs
 * this same pipeline; only `findOrder` and `verify` differ. The write that
 * records the payment is guarded on the order still being unpaid and not
 * cancelled, so a replayed webhook, a racing poll or a late callback returns
 * `alreadyPaid` instead of running the side effects twice.
 */
export async function finalizeCapturedOrder(
  params: FinalizeCapturedOrderParams,
): Promise<FinalizedOrderResult> {
  const { provider, settings } = params;
  const actor = params.actor ?? systemActor();

  const scope: Record<string, unknown> = {
    paymentMethod: provider.paymentMethod,
  };
  if (params.sessionUserId) {
    scope.customerId = params.sessionUserId;
  }

  const order = await params.findOrder(scope);
  if (!order) {
    throw new ValidationError(params.notFoundMessage);
  }

  params.assertReference?.(order);

  if (
    order.paymentStatus === PAYMENT_STATUS.PAID ||
    order.paymentStatus === PAYMENT_STATUS.PARTIALLY_PAID
  ) {
    return {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      alreadyPaid: true,
    };
  }

  // Cancelled while the payment was in flight (a customer or admin cancelling
  // a pending order). Never resurrected — but money a gateway already took is
  // real, and telling the shopper to "contact support" left it sitting there
  // with nothing recorded and nobody told.
  if (order.status === ORDER_STATUS.CANCELLED) {
    if (!provider.capturesOnVerify) {
      await refundLatePayment({
        order,
        verification: await params.verify(order),
        provider,
        settings,
      });
    }
    throw new ValidationError(CANCELLED_BEFORE_CAPTURE);
  }

  const verification = await params.verify(order);
  const paymentId = verification.paymentId;

  const nextStatus = order.hasPreorder
    ? ORDER_STATUS.PREORDERED
    : ORDER_STATUS.PROCESSING;

  const updatedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      paymentStatus: {
        $nin: [PAYMENT_STATUS.PAID, PAYMENT_STATUS.PARTIALLY_PAID],
      },
      status: { $ne: ORDER_STATUS.CANCELLED },
    },
    {
      $set: {
        paymentStatus:
          Number(order.preorderOutstandingAmount || 0) > 0
            ? PAYMENT_STATUS.PARTIALLY_PAID
            : PAYMENT_STATUS.PAID,
        status: nextStatus,
        // The consignments move with the order. Only the order used to, so a
        // paid order kept `pending` sub-orders: the vendor list showed it as
        // awaiting payment, and the first vendor to touch their own parcel
        // re-derived the whole order back to `pending`, where the shopper
        // could cancel it. A pre-order's consignments are already
        // `preordered` and are released by the balance flow, not here.
        ...(nextStatus === ORDER_STATUS.PROCESSING
          ? { "subOrders.$[awaiting].status": ORDER_STATUS.PROCESSING }
          : {}),
        paymentId,
        ...(verification.paymentUpdate ?? {}),
      },
      // When the money arrived, which the ledger dates the sale by.
      $min: { paidAt: new Date() },
    },
    {
      returnDocument: "after",
      ...(nextStatus === ORDER_STATUS.PROCESSING
        ? { arrayFilters: [{ "awaiting.status": ORDER_STATUS.PENDING }] }
        : {}),
    },
  );

  if (!updatedOrder) {
    // Lost the race to another finalizer, or cancelled in between: read the
    // row back and answer for whichever it was.
    const freshOrder = await Order.findById(order._id).select(
      "paymentStatus status orderNumber",
    );
    if (
      freshOrder?.paymentStatus === PAYMENT_STATUS.PAID ||
      freshOrder?.paymentStatus === PAYMENT_STATUS.PARTIALLY_PAID
    ) {
      return {
        orderId: String(order._id),
        orderNumber: freshOrder.orderNumber,
        alreadyPaid: true,
      };
    }
    if (freshOrder?.status === ORDER_STATUS.CANCELLED) {
      // Cancelled between the read and the write, with the payment already
      // proven — the same money as above, and it goes back the same way.
      await refundLatePayment({ order, verification, provider, settings });
      throw new ValidationError(CANCELLED_BEFORE_CAPTURE);
    }
    throw new ConflictError("Order payment update failed");
  }

  const settled = await settleCapturedOrder({
    order: updatedOrder,
    provider,
    paymentId,
    auditTransactionId: verification.auditTransactionId,
    settings,
    actor,
    cart: {
      sessionUserId: params.sessionUserId,
      cartSessionId: params.cartSessionId,
    },
    customerEmail: params.customerEmail || verification.customerEmail,
  });
  if (!settled.ok) {
    throw new ValidationError(SOLD_OUT_AFTER_CAPTURE);
  }

  return {
    orderId: String(updatedOrder._id),
    orderNumber: updatedOrder.orderNumber,
    alreadyPaid: false,
  };
}

/** The charge row's input, read off an order whose payment is recorded. */
function chargeTransactionInput(
  order: PendingOrderDocument,
  currency: string | undefined,
) {
  return {
    _id: String(order._id),
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentId: order.paymentId,
    stripePaymentIntentId: order.stripePaymentIntentId,
    paypalCaptureId: order.paypalCaptureId,
    razorpayPaymentId: order.razorpayPaymentId,
    paystackTransactionId: order.paystackTransactionId,
    pesapalConfirmationCode: order.pesapalConfirmationCode,
    iotecTransactionId: order.iotecTransactionId,
    orangeMoneyTxnId: order.orangeMoneyTxnId,
    mtnMomoTransactionId: order.mtnMomoTransactionId,
    mtnMomoReferenceId: order.mtnMomoReferenceId,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    tax: order.tax,
    discount: order.discount,
    total: order.total,
    preorderOutstandingAmount: order.preorderOutstandingAmount,
    // The gateway's cut, so the charge row's net is net — the ledger reads
    // the same fields off the order.
    paymentFee: order.paymentFee,
    paymentFeeCurrency: order.paymentFeeCurrency,
    paymentFeeRate: order.paymentFeeRate,
    currency,
    channel: order.channel || "online",
    createdAt: order.createdAt,
  };
}

/**
 * Send back money a gateway captured for an order that will never ship.
 *
 * The order is already cancelled when this runs, and its payment already
 * recorded, so the refund reads the gateway references it needs off the order
 * and posts against a charge that exists. `refundCancelledPreorder` is the one
 * cancel-refund flow the codebase has; nothing in it is specific to a
 * pre-order — on an ordinary order what was collected is simply the total.
 *
 * Admins are told either way. A gateway with no refund API (mobile money, the
 * store's own cash) records the refund but cannot send it, and a refusal leaves
 * the money where it is; in both cases a person has to act.
 */
async function refundUnfulfillablePayment(params: {
  order: { _id: unknown; orderNumber: string; paymentId?: string };
  provider: { label: string };
  reason: string;
}): Promise<void> {
  const { order, provider, reason } = params;
  const { refundCancelledPreorder } = await import(
    "@/lib/orders/preorder-cancel-refund"
  );
  const refund = await refundCancelledPreorder({
    orderId: String(order._id),
    reason,
    // The alert below already tells admins, with why the order could not ship.
    notifySettlement: false,
  }).catch((err: unknown) => ({
    refunded: false,
    gatewayCalled: undefined,
    reason: err instanceof Error ? err.message : "The refund could not be issued",
  }));

  const outcome = !refund.refunded
    ? `was NOT refunded (${refund.reason}) — refund it by hand`
    : refund.gatewayCalled === false
      ? `was recorded as refunded, but ${provider.label} cannot send it back automatically — return it by hand`
      : "was refunded through the gateway";
  await notifyAdminsPaymentAnomaly({
    title: `${provider.label} payment on an order that cannot be fulfilled`,
    message: `Order ${order.orderNumber}: ${reason}. The payment ${outcome}.`,
    paymentIntentId: order.paymentId,
  }).catch((err) =>
    console.error("Failed to send payment anomaly alert:", err),
  );
}

/**
 * A payment that landed on an order cancelled while it was in flight.
 *
 * Recorded first, conditionally, so a replayed callback cannot refund twice:
 * only the call that moves the cancelled order onto "paid" goes on to write
 * the charge and send it back, and every later call finds it paid or refunded
 * and stops.
 */
async function refundLatePayment(params: {
  order: PendingOrderDocument;
  verification: CapturedPaymentVerification;
  provider: { label: string };
  settings: SettingsDocument;
}): Promise<void> {
  const { order, verification, provider, settings } = params;
  const recorded = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: ORDER_STATUS.CANCELLED,
      paymentStatus: {
        $nin: [
          PAYMENT_STATUS.PAID,
          PAYMENT_STATUS.PARTIALLY_PAID,
          PAYMENT_STATUS.REFUNDED,
          PAYMENT_STATUS.PARTIALLY_REFUNDED,
        ],
      },
    },
    {
      $set: {
        paymentStatus:
          Number(order.preorderOutstandingAmount || 0) > 0
            ? PAYMENT_STATUS.PARTIALLY_PAID
            : PAYMENT_STATUS.PAID,
        paymentId: verification.paymentId,
        ...(verification.paymentUpdate ?? {}),
      },
      $min: { paidAt: new Date() },
    },
    { returnDocument: "after" },
  );
  if (!recorded) return;

  await ensureChargeTransaction(
    chargeTransactionInput(
      recorded,
      recorded.currency || settings.general?.defaultCurrency,
    ),
  );
  await refundUnfulfillablePayment({
    order: recorded,
    provider,
    reason: "The payment arrived after the order was cancelled",
  });
}

interface SettleCapturedOrderParams {
  /** The order with its payment already recorded (updated, or created paid). */
  order: PendingOrderDocument;
  provider: { label: string; recoveryGateway: string };
  paymentId: string;
  /** See CapturedPaymentVerification.auditTransactionId. */
  auditTransactionId?: string | null;
  /** Stripe creates the order already paid, so it records the placement too. */
  recordPlacement?: boolean;
  /** A guest checkout's email-keyed customer record, when the gateway knows it. */
  guestProfile?: { email: string; name?: string };
  settings: SettingsDocument;
  actor: AuditContext;
  /** Which cart to close: the one the payment quoted, or the shopper's by session. */
  cart:
    | { cartId: unknown }
    | { sessionUserId?: string; cartSessionId?: string };
  /** Abandoned-checkout event text; defaults to "<label> payment captured". */
  recoveryMessage?: string;
  customerEmail?: string;
}

type SettleCapturedOrderResult =
  | { ok: true }
  | { ok: false; reason: "inventory" };

/**
 * Hands the shopper-facing messages to Next's `after`, which runs them once
 * the response has been sent. They were awaited inline, and they are the slow
 * part of settling: the confirmation email fetches the store logo, renders a
 * PDF invoice and opens a fresh SMTP session, then the notifications email and
 * push every admin, vendor and staff member. That held the success page on
 * "Verifying payment" for seconds after the money was already recorded, and
 * nothing on that page reads any of it.
 *
 * Every caller is a route handler (verify, webhook, callback, cron). Outside a
 * request, in a script or a test, `after` throws; there is no response to
 * wait for then, so the messages go out inline.
 */
async function runAfterResponse(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    await task();
  }
}

/**
 * Everything that follows a recorded payment: the ledger charge, the audit
 * trail, loyalty and customer stats, coupon usage, the stock or pre-order
 * reservation, closing the cart, the confirmation email and notifications.
 *
 * Shared by the pre-created-order gateways (through finalizeCapturedOrder)
 * and by Stripe, which creates the order already paid. When stock ran out
 * between checkout and capture the order is cancelled and audited, and the
 * caller decides how to tell the shopper. The email and notifications run
 * after the response (see runAfterResponse), so the answer never waits on them.
 */
export async function settleCapturedOrder(
  params: SettleCapturedOrderParams,
): Promise<SettleCapturedOrderResult> {
  const { order, provider, paymentId, settings, actor } = params;
  const currency =
    order.currency || settings.general?.defaultCurrency;

  await ensureChargeTransaction(chargeTransactionInput(order, currency));

  // Only reached by the call that actually recorded the money — a replay
  // returned before getting here, so nothing below runs twice.
  if (params.recordPlacement) {
    await auditOrderPlaced(actor, order, {
      source: "storefront",
      total: order.total,
      currency,
      itemCount: order.items.length,
      paymentMethod: order.paymentMethod,
    });
  }
  await auditOrderPaid(actor, order, {
    gateway: provider.label,
    amount:
      Number(order.total || 0) -
      Number(order.preorderOutstandingAmount || 0),
    currency,
    transactionId:
      params.auditTransactionId === undefined
        ? paymentId
        : (params.auditTransactionId ?? undefined),
    partial: order.paymentStatus === PAYMENT_STATUS.PARTIALLY_PAID,
  });

  const items = order.items as OrderLine[];
  const consignments = (order.subOrders || []) as ConsignmentRef[];

  // A seller who called their consignment off while the shopper was still at
  // the gateway. The shopper paid for it anyway — the amount was fixed when the
  // payment started — so its goods must not come off the shelf, and its share
  // of the money goes back below.
  const cancelledBeforeCapture = consignments.filter(
    (sub) => sub.status === ORDER_STATUS.CANCELLED,
  );
  const cancelledSellers = new Set(
    cancelledBeforeCapture.map((sub) => String(sub.vendorId ?? "")),
  );
  const liveLines = items.filter(
    (item) => !item.vendorId || !cancelledSellers.has(lineVendorKey(item)),
  );

  // Stock before anything is spent on the sale: an order that turns out to be
  // unfulfillable must not have awarded points, used up a coupon or closed a
  // quote first.
  let soldOutSellers: string[] = [];
  try {
    soldOutSellers = await takeStockDroppingSoldOutSellers({
      order,
      lines: liveLines,
    });
  } catch (err) {
    if (
      err instanceof InsufficientStockError ||
      err instanceof PreorderUnavailableError
    ) {
      // Captured, then sold out. The order was only cancelled at the top
      // level: the money stayed captured with nothing sending it back, the
      // consignments stayed live for a vendor to ship, and the loyalty points
      // and coupon use below had already been spent on it.
      await auditOrderCancelled(actor, order, {
        from: String(order.status),
        by: "system",
        reason: "Inventory no longer available after payment was captured",
      });
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            status: ORDER_STATUS.CANCELLED,
            cancelledAt: new Date(),
            cancelReason: SOLD_OUT_AFTER_CAPTURE_CANCEL_REASON,
            "subOrders.$[].status": ORDER_STATUS.CANCELLED,
          },
        },
      );
      await refundUnfulfillablePayment({
        order,
        provider,
        reason: SOLD_OUT_AFTER_CAPTURE_CANCEL_REASON,
      });
      return { ok: false, reason: "inventory" };
    }
    throw err;
  }

  // The sellers whose goods ran out are called off; everybody else ships.
  const soldOutConsignments = consignments.filter(
    (sub) =>
      sub.status !== ORDER_STATUS.CANCELLED &&
      soldOutSellers.includes(String(sub.vendorId ?? "")),
  );
  if (soldOutConsignments.length > 0) {
    await Order.updateOne(
      { _id: order._id },
      { $set: { "subOrders.$[gone].status": ORDER_STATUS.CANCELLED } },
      {
        arrayFilters: [
          {
            "gone._id": { $in: soldOutConsignments.map((sub) => sub._id) },
            "gone.status": { $ne: ORDER_STATUS.CANCELLED },
          },
        ],
      },
    );
    for (const sub of soldOutConsignments) sub.status = ORDER_STATUS.CANCELLED;
    await auditConsignmentsCancelled(actor, order, {
      count: soldOutConsignments.length,
      reason: "their stock ran out after the payment was captured",
    });
  }

  // Only now, with the called-off consignments written: the flags skip them,
  // so a later cancel cannot restock goods that never left the shelf.
  if (order.hasPreorder) {
    await markOrderPreorderReserved(String(order._id)).catch((err) =>
      console.error(
        `Failed to mark preorder reserved on ${provider.label} capture:`,
        err,
      ),
    );
  } else {
    await markOrderInventoryReserved(String(order._id)).catch((err) =>
      console.error(
        `Failed to mark inventory reserved on ${provider.label} capture:`,
        err,
      ),
    );
  }

  // Bookkeeping on money already taken: none of it may reject the handler,
  // or the gateway retries into the replay guard and the later steps never run.
  const {
    awardOrderLoyaltyPoints,
    refreshCustomerStatsForOrder,
    upsertGuestCustomerProfile,
  } = await import("@/lib/customers/customer");
  // Guest checkouts leave an email-keyed customer record behind, the Shopify
  // way; loyalty and stats route to it through the order's guestEmail rather
  // than the cart id its customerId carries.
  if (params.guestProfile) {
    await upsertGuestCustomerProfile(params.guestProfile).catch((err) =>
      console.error("Failed to upsert guest customer profile:", err),
    );
  }
  // Awarded while the order still reads paid, before any consignment's share
  // goes back below. The award only pays a fully paid order, so refunding a
  // sold-out seller first left the shopper with no points at all — for the
  // goods that do ship as much as for the ones that don't.
  await awardOrderLoyaltyPoints(String(order._id)).catch((err) =>
    console.error("Failed to award loyalty points:", err),
  );

  // Money for goods that will not ship goes back — per consignment, so the
  // sellers still shipping keep their whole share.
  // Each refund takes the points for what it returned back off, so the shopper
  // keeps exactly the points for what they are receiving.
  await refundDroppedConsignments({
    order,
    subOrderIds: cancelledBeforeCapture.map((sub) => sub._id),
    provider,
    reason: "A seller cancelled their items before the payment arrived",
    cause: "seller_cancelled",
  });
  await refundDroppedConsignments({
    order,
    subOrderIds: soldOutConsignments.map((sub) => sub._id),
    provider,
    reason: "A seller's items sold out after the payment was captured",
    cause: "sold_out",
  });
  refreshCustomerStatsForOrder(order).catch((err) =>
    console.error("Failed to refresh customer stats:", err),
  );

  await applyCouponUsageForOrder(String(order._id)).catch((err) =>
    console.error(
      `Failed to apply coupon usage on ${provider.label} capture:`,
      err,
    ),
  );

  // The negotiated prices this order was placed on are now paid for: bind any
  // that were not bound at placement (Stripe creates its order here, already
  // paid, so nothing bound them earlier — the bind is guarded and no-ops for
  // every gateway that did) and close the quotes out as won.
  const quoteIds = items
    .map((item) => (item.quoteId ? String(item.quoteId) : ""))
    .filter(Boolean);
  if (quoteIds.length > 0) {
    const { bindOffersToOrder, markQuotesWon } = await import(
      "@/lib/quotes/quote-offer"
    );
    await bindOffersToOrder(quoteIds, String(order._id)).catch((err) =>
      console.error("Failed to bind quote offers on capture:", err),
    );
    await markQuotesWon(quoteIds).catch((err) =>
      console.error("Failed to close quotes on capture:", err),
    );
  }

  const paymentEvent = {
    gateway: provider.recoveryGateway,
    status: "succeeded" as const,
    paymentId,
    message: params.recoveryMessage ?? `${provider.label} payment captured`,
  };
  if ("cartId" in params.cart) {
    // The cart the payment was quoted against is known outright.
    await markCheckoutRecovered({
      cartId: params.cart.cartId,
      orderId: order._id,
      paymentEvent,
    }).catch((err) =>
      console.error("Failed to mark abandoned checkout recovered:", err),
    );
    // Cart cleanup must never fail an order whose payment already succeeded.
    await Cart.findByIdAndUpdate(params.cart.cartId, {
      $set: { items: [] },
    }).catch((err) =>
      console.error(`Failed to clear cart after ${provider.label} capture:`, err),
    );
  } else if (params.cart.sessionUserId || params.cart.cartSessionId) {
    const cart = await Cart.findOne(
      params.cart.sessionUserId
        ? { userId: params.cart.sessionUserId }
        : { sessionId: params.cart.cartSessionId },
    );
    if (cart) {
      await markCheckoutRecovered({
        cartId: cart._id,
        orderId: order._id,
        paymentEvent,
      }).catch((err) =>
        console.error("Failed to mark abandoned checkout recovered:", err),
      );
      // markCheckoutRecovered() saves its own copy of this cart and bumps
      // __v, so saving the document loaded above would throw a VersionError
      // on an already-paid order. Clear atomically, and never let cart
      // cleanup fail a captured payment.
      await Cart.updateOne({ _id: cart._id }, { $set: { items: [] } }).catch(
        (err) =>
          console.error(
            `Failed to clear cart after ${provider.label} capture:`,
            err,
          ),
      );
    }
  } else {
    // Two queries because customerId means different things: a User id for a
    // registered checkout, and the guest's own cart _id for a guest one (see
    // the note on Order.customerId). Whichever misses is a no-op. Cart cleanup
    // must never fail an order whose payment already succeeded.
    await Promise.all([
      Cart.findOneAndUpdate(
        { userId: order.customerId },
        { $set: { items: [] } },
      ),
      Cart.findByIdAndUpdate(order.customerId, { $set: { items: [] } }),
    ]).catch((err) =>
      console.error("Failed to clear cart after payment capture:", err),
    );
  }

  const customerEmail = params.customerEmail || undefined;

  const notifyShopper = async () => {
    if (customerEmail) {
      await sendOrderConfirmationEmail(
        {
          orderNumber: order.orderNumber,
          customerName: order.shippingAddress?.fullName || "Customer",
          customerEmail,
          items: order.items.map(
            (item: {
              name: string;
              quantity: number;
              price: number;
              image?: string;
            }) => ({
              name: item.name,
              quantity: item.quantity,
              price: item.price,
              image: item.image,
            }),
          ),
          subtotal: order.subtotal,
          discount: order.discount,
          shipping: order.shippingCost,
          tax: order.tax,
          total: order.total,
          shippingAddress: order.shippingAddress,
          paymentMethod: order.paymentMethod,
        },
        settings,
      ).catch((err) =>
        console.error(
          `Failed to send ${provider.label} order confirmation email:`,
          err,
        ),
      );
    }

    await notifyOrderCreatedParticipants(order, {
      customerEmailSent: Boolean(customerEmail),
    }).catch((err) =>
      console.error(
        `Failed to create ${provider.label} order notifications:`,
        err,
      ),
    );
  };
  await runAfterResponse(notifyShopper);

  return { ok: true };
}

/** The amount a gateway must have collected now: total less any pre-order balance. */
export function amountDueNow(order: {
  total?: number;
  preorderOutstandingAmount?: number;
}): number {
  return Math.max(
    0,
    Number(order.total || 0) - Number(order.preorderOutstandingAmount || 0),
  );
}
