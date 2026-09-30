import { CheckoutAttempt, CHECKOUT_ATTEMPT_STATUS } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import { systemActor } from "@/lib/orders/audit-order";
import {
  AttemptAlreadyOrderedError,
  claimAttemptForFinalize,
  claimClosedAttemptForRefund,
  createOrderFromAttempt,
  releaseAttemptClaim,
} from "@/lib/checkout/checkout-attempt-store";
import { notifyAdminsPaymentAnomaly } from "@/lib/notifications/notifications";
import {
  finalizeCapturedOrder,
  refundLatePayment,
  settleCapturedOrder,
  type FinalizeCapturedOrderParams,
  type PendingOrderDocument,
} from "@/lib/payments/finalize-order";

/**
 * Settle a payment against a checkout attempt — and, when there is no attempt,
 * against the pending order the old checkout wrote.
 *
 * **Both shapes, always, whatever the rollout flag says.** That is the whole
 * safety of the migration. At the moment a gateway is switched over, shoppers
 * are sitting on that gateway's page with a pre-created order already written
 * for them; when it is switched back, attempts are open with nothing else to
 * settle them. Worse, a webhook that finds neither is acknowledged with a 200
 * and never retried (`app/api/payments/razorpay/webhook/route.ts`), so a
 * payment this function fails to place is a payment nobody ever hears about
 * again. So the lookup asks for an attempt first and falls through to the
 * legacy order, and the flag decides only what NEW checkouts write.
 *
 * Everything past the lookup is the pipeline `finalizeCapturedOrder` has
 * always run — verify against the gateway, guard the write, settle — with the
 * claim moved onto the attempt, where it can be taken before an order exists.
 */

type FinalizeCapturedAttemptParams = FinalizeCapturedOrderParams & {
  /**
   * Finds the attempt by the gateway's own reference. Given the same `scope`
   * as `findOrder`, so a signed-in shopper's settlement stays scoped to them.
   */
  findAttempt: (
    scope: Record<string, unknown>,
  ) => Promise<AttemptDocument | null>;
  /** Store-configured ORD prefix, for the order this attempt becomes. */
  orderPrefix?: string;
};

type AttemptDocument = {
  _id: unknown;
  status: string;
  snapshot: Record<string, unknown>;
  gateway?: Record<string, unknown> | null;
  finalize?: { orderId?: unknown; orderNumber?: string } | null;
  /** The checkout it came from — where a refused try is shown to the admin. */
  cartId?: unknown;
};

/**
 * An attempt, shaped like the pending order every gateway's `verify` was
 * written against.
 *
 * The snapshot IS an order document, so this is mostly a spread; what it adds
 * is the gateway's own identifiers, which live in their own sub-document on an
 * attempt and at the root of an order. `orderNumber` is deliberately empty —
 * there is no order yet, and a verifier that puts one in a message will say
 * so rather than invent one.
 */
function attemptAsOrderShape(
  attempt: AttemptDocument,
): PendingOrderDocument {
  return {
    ...(attempt.snapshot || {}),
    ...(attempt.gateway || {}),
    _id: attempt._id,
    orderNumber: "",
  } as unknown as PendingOrderDocument;
}

export async function finalizeCapturedAttempt(
  params: FinalizeCapturedAttemptParams,
) {
  const { provider, settings } = params;
  const actor = params.actor ?? systemActor();

  const scope: Record<string, unknown> = {
    paymentMethod: provider.paymentMethod,
  };
  if (params.sessionUserId) {
    scope.customerId = params.sessionUserId;
  }

  const attempt = await params.findAttempt(scope);
  if (!attempt) {
    // No attempt for this reference: either this gateway has not been switched
    // over yet, or the payment belongs to an order written before it was.
    return finalizeCapturedOrder(params);
  }

  // Already an order — a replayed webhook, a success page reloaded, the
  // shopper's return arriving after the webhook. The answer never changes.
  if (attempt.finalize?.orderId) {
    return {
      orderId: String(attempt.finalize.orderId),
      orderNumber: attempt.finalize.orderNumber || "",
      alreadyPaid: true,
    };
  }

  const orderShape = attemptAsOrderShape(attempt);

  // The cart changed under this attempt, or its window closed. Money that
  // arrives anyway is real: it is recorded and sent back, exactly as it is for
  // an order cancelled while its payment was in flight. A gateway that only
  // takes the money inside `verify` is simply not asked — no capture, no
  // refund, no fee.
  if (
    attempt.status === CHECKOUT_ATTEMPT_STATUS.SUPERSEDED ||
    attempt.status === CHECKOUT_ATTEMPT_STATUS.EXPIRED
  ) {
    if (!provider.capturesOnVerify) {
      await refundClosedAttemptPayment(params, attempt, orderShape);
    }
    throw new ValidationError(
      "This checkout was closed before the payment arrived, so the payment is being refunded.",
    );
  }

  const claim = await claimAttemptForFinalize(attempt._id);
  if (claim.outcome === "already_ordered") {
    return {
      orderId: String(claim.orderId),
      orderNumber: claim.orderNumber || "",
      alreadyPaid: true,
    };
  }
  if (claim.outcome === "busy") {
    // Another settlement is mid-promotion. A conflict rather than a failure:
    // the success page treats it as transient and asks again, and a webhook
    // gets the answer on its own retry.
    throw new ConflictError("This payment is already being settled");
  }
  if (claim.outcome !== "claimed") {
    throw new ValidationError(params.notFoundMessage);
  }

  let order;
  try {
    params.assertReference?.(orderShape);
    const verification = await params.verify(orderShape);

    // The order this attempt was always going to be, priced as it was agreed.
    order = await createOrderFromAttempt({
      attempt: { _id: attempt._id, snapshot: attempt.snapshot },
      orderPrefix: params.orderPrefix,
      overrides: {
        paymentStatus:
          Number(attempt.snapshot?.preorderOutstandingAmount || 0) > 0
            ? PAYMENT_STATUS.PARTIALLY_PAID
            : PAYMENT_STATUS.PAID,
        status: attempt.snapshot?.hasPreorder
          ? ORDER_STATUS.PREORDERED
          : ORDER_STATUS.PROCESSING,
        paidAt: new Date(),
        paymentId: verification.paymentId,
        ...(verification.paymentUpdate ?? {}),
      },
    });

    // Stock, coupon use, loyalty, the cart, the emails — every one of them
    // claim-guarded already, and every one of them the same code an order
    // written at checkout runs.
    const settled = await settleCapturedOrder({
      order,
      provider,
      paymentId: verification.paymentId,
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
      throw new ValidationError(
        "The items sold out before your payment was confirmed, so the order was cancelled and the payment is being refunded.",
      );
    }
  } catch (error) {
    if (error instanceof AttemptAlreadyOrderedError) {
      // A run before this one wrote the order and died before saying so. It
      // is that order — whether or not that run got as far as settling it,
      // and settling it again would take its stock twice — so the answer is
      // the order, and a person is asked to check what the run left undone.
      await notifyAdminsPaymentAnomaly({
        title: `${provider.label} payment settled by an interrupted run`,
        message: `Order ${error.order.orderNumber || String(error.order._id)} was written for this payment by a settlement that stopped before finishing. Check that its stock was taken and its confirmation was sent.`,
      }).catch((err) =>
        console.error("Failed to send payment anomaly alert:", err),
      );
      return {
        orderId: String(error.order._id),
        orderNumber: error.order.orderNumber || "",
        alreadyPaid: true,
      };
    }
    // Nothing was written: hand the attempt back so the next answer — the
    // webhook's retry, the shopper reloading — can try again rather than
    // meeting a lease that outlives the request.
    if (!order) await releaseAttemptClaim(attempt._id);
    throw error;
  }

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    alreadyPaid: false,
  };
}

/** Why a cancelled order like this exists, for whoever finds one later. */
const CLOSED_CHECKOUT_CANCEL_REASON =
  "The payment arrived after the checkout had closed";

/**
 * Money that arrived for a checkout that had already closed.
 *
 * `refundLatePayment` is the right code for this — it records the charge,
 * posts it, sends the money back through the gateway and tells the admins
 * when it cannot — but it addresses its row by `_id`, and the `_id` in hand
 * here belongs to a checkout ATTEMPT. An attempt is what a checkout writes
 * INSTEAD of an order, so there is no order for that guarded update to match:
 * handed an attempt's id it wrote nothing and returned quietly, and the money
 * was neither recorded nor refunded while the shopper was being told it was on
 * its way back.
 *
 * So the order is written first, cancelled, from the same snapshot the shopper
 * agreed to — which is what actually happened: a sale was made and called off
 * before anything could ship. It takes no stock, carries the attempt's id, and
 * gives the refund, the ledger and the audit trail a real document to hang
 * off. `refundLatePayment` then runs against it unchanged, so this path books
 * the money exactly as the cancelled-order path does.
 *
 * Claimed first, so two deliveries of one webhook produce one cancelled order
 * and one refund rather than two of each.
 */
async function refundClosedAttemptPayment(
  params: FinalizeCapturedAttemptParams,
  attempt: AttemptDocument,
  orderShape: PendingOrderDocument,
): Promise<void> {
  // Proven before anything is written: a payment the gateway will not vouch
  // for must not mint a cancelled order and a refund out of nothing.
  const verification = await params.verify(orderShape);

  const claim = await claimClosedAttemptForRefund(attempt._id);
  // `already_ordered` — another delivery got there first and refunded it.
  // `busy` — one is mid-flight and will. Either way, nothing to do here.
  if (claim.outcome !== "claimed") return;

  let order: PendingOrderDocument;
  try {
    order = await createOrderFromAttempt({
      attempt: { _id: attempt._id, snapshot: attempt.snapshot },
      orderPrefix: params.orderPrefix,
      // Nothing ships, so nothing comes off the shelf.
      takeStockHold: false,
      overrides: {
        status: ORDER_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: CLOSED_CHECKOUT_CANCEL_REASON,
      },
    });
  } catch (error) {
    if (!(error instanceof AttemptAlreadyOrderedError)) throw error;
    // Written by a delivery that died before refunding it — or after. The
    // refund is guarded on the order still being unpaid, so it runs at most
    // once either way.
    order = error.order as unknown as PendingOrderDocument;
  }

  await refundLatePayment({
    order,
    verification,
    provider: params.provider,
    settings: params.settings,
  });
}

/**
 * Find an open or recently closed attempt by one of its gateway references.
 *
 * Closed attempts are included on purpose: a payment that arrives against a
 * superseded or expired attempt still has to be recognised and refunded, and
 * an attempt that is already an order still has to answer `alreadyPaid`.
 */
export async function findAttemptByGatewayRef(
  field: string,
  value: string,
  scope: Record<string, unknown> = {},
): Promise<AttemptDocument | null> {
  if (!value) return null;
  const { paymentMethod, ...rest } = scope;
  return CheckoutAttempt.findOne({
    [`gateway.${field}`]: value,
    ...(paymentMethod ? { paymentMethod } : {}),
    ...rest,
  })
    .select("_id status snapshot gateway finalize cartId")
    .lean<AttemptDocument | null>();
}
