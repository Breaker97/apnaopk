import { Cart, Order, Product } from "@/models";
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
  systemActor,
} from "@/lib/orders/audit-order";
import type { AuditContext } from "@/lib/audit";
import { applyCouponUsageForOrder } from "@/lib/catalog/coupons";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import { markCheckoutRecovered } from "@/lib/orders/abandoned-checkouts";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { revalidateProductContent } from "@/lib/cache-invalidation";
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
  /**
   * Runs the confirmation email and notifications. Awaited inline by default;
   * a route that streams its response first (PayPal capture) passes Next's
   * `after` so the shopper is not held on the success page.
   */
  schedule?: (task: () => Promise<void>) => void;
}

const CANCELLED_BEFORE_CAPTURE =
  "Order was cancelled before payment capture. Please contact support for a refund.";

type OrderLine = {
  productId: unknown;
  variantId?: unknown;
  quantity: number;
  purchaseType?: string;
};

function isStandardLine(item: { purchaseType?: string }) {
  return (item.purchaseType || PURCHASE_TYPE.STANDARD) === PURCHASE_TYPE.STANDARD;
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

  // Cancelled before capture (admin or customer cancel of a pending order):
  // refuse to resurrect it. The gateway's refund flow makes the customer whole.
  if (order.status === ORDER_STATUS.CANCELLED) {
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
        paymentId,
        ...(verification.paymentUpdate ?? {}),
      },
    },
    { new: true },
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
    schedule: params.schedule,
  });
  if (!settled.ok) {
    throw new ValidationError(
      "Payment captured but inventory is no longer available. Please contact support for a refund.",
    );
  }

  return {
    orderId: String(updatedOrder._id),
    orderNumber: updatedOrder.orderNumber,
    alreadyPaid: false,
  };
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
  schedule?: (task: () => Promise<void>) => void;
}

type SettleCapturedOrderResult =
  | { ok: true }
  | { ok: false; reason: "inventory" };

/**
 * Everything that follows a recorded payment: the ledger charge, the audit
 * trail, loyalty and customer stats, coupon usage, the stock or pre-order
 * reservation, closing the cart, the confirmation email and notifications.
 *
 * Shared by the pre-created-order gateways (through finalizeCapturedOrder)
 * and by Stripe, which creates the order already paid. When stock ran out
 * between checkout and capture the order is cancelled and audited, and the
 * caller decides how to tell the shopper.
 */
export async function settleCapturedOrder(
  params: SettleCapturedOrderParams,
): Promise<SettleCapturedOrderResult> {
  const { order, provider, paymentId, settings, actor } = params;
  const currency =
    order.currency || settings.general?.defaultCurrency;

  await ensureChargeTransaction({
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
  });

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
  await awardOrderLoyaltyPoints(String(order._id)).catch((err) =>
    console.error("Failed to award loyalty points:", err),
  );
  refreshCustomerStatsForOrder(order).catch((err) =>
    console.error("Failed to refresh customer stats:", err),
  );

  await applyCouponUsageForOrder(String(order._id)).catch((err) =>
    console.error(
      `Failed to apply coupon usage on ${provider.label} capture:`,
      err,
    ),
  );

  const items = order.items as OrderLine[];
  try {
    if (order.hasPreorder) {
      await reservePreorderQuantity(getOrderPreorderLines(order.items));
      await markOrderPreorderReserved(String(order._id)).catch((err) =>
        console.error(
          `Failed to mark preorder reserved on ${provider.label} capture:`,
          err,
        ),
      );
    } else {
      await decrementInventory(
        items.filter(isStandardLine).map((item) => ({
          productId: String(item.productId),
          variantId: item.variantId ? String(item.variantId) : undefined,
          quantity: item.quantity,
        })),
        // A collection comes off the counter the shopper chose, not off
        // whichever branch happens to hold the most.
        orderInventoryOpts(order),
      );
      await markOrderInventoryReserved(String(order._id)).catch((err) =>
        console.error(
          `Failed to mark inventory reserved on ${provider.label} capture:`,
          err,
        ),
      );

      const affectedProductIds = Array.from(
        new Set(
          items
            .filter(isStandardLine)
            .map((item) => String(item.productId || "").trim())
            .filter(Boolean),
        ),
      );
      const affectedSlugs = affectedProductIds.length
        ? (
            await Product.find({ _id: { $in: affectedProductIds } })
              .select("slug")
              .lean()
          ).map((product) => product.slug)
        : [];
      revalidateProductContent({
        slugs: affectedSlugs.filter(
          (slug): slug is string =>
            typeof slug === "string" && slug.length > 0,
        ),
      });
    }
  } catch (err) {
    if (
      err instanceof InsufficientStockError ||
      err instanceof PreorderUnavailableError
    ) {
      // Captured, then auto-cancelled on stock. Record why.
      await auditOrderCancelled(actor, order, {
        from: String(order.status),
        by: "system",
        reason: "Inventory no longer available after payment was captured",
      });
      await Order.updateOne(
        { _id: order._id },
        { $set: { status: ORDER_STATUS.CANCELLED } },
      );
      return { ok: false, reason: "inventory" };
    }
    throw err;
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

    await notifyOrderCreatedParticipants(order).catch((err) =>
      console.error(
        `Failed to create ${provider.label} order notifications:`,
        err,
      ),
    );
  };
  if (params.schedule) {
    params.schedule(notifyShopper);
  } else {
    await notifyShopper();
  }

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
