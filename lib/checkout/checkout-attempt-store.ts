import { CheckoutAttempt, CHECKOUT_ATTEMPT_STATUS, Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { attemptWindowMs } from "@/lib/checkout/checkout-attempts";
import {
  persistOrderFromDocument,
  type OrderDocumentLike,
} from "@/lib/orders/persist-order";

/**
 * The life of one checkout attempt: opened when a gateway is asked, claimed
 * when an answer arrives, and promoted to an order when the answer is "paid".
 *
 * Every rule that used to be enforced on a pre-created `Order` lives here
 * instead, and one of them is enforced twice over on purpose. A gateway
 * webhook and the shopper's own return routinely arrive within a second of
 * each other; both would write an order for the same payment. The claim below
 * is what normally stops that, and `Order.checkoutAttemptId`'s unique index is
 * what stops it when the claim has a bug in it.
 *
 * Deliberately small: it knows about attempts and nothing about gateways. What
 * a Razorpay answer means is Razorpay's finalizer's business.
 */

/** How long a settlement may hold a claim before another may take it over. */
const FINALIZE_LEASE_MS = 60 * 1000;

/** How long a closed attempt is kept before the TTL index deletes it. */
const PURGE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

type OpenAttemptInput = {
  /** The order document this attempt would become — see `persist-order.ts`. */
  snapshot: OrderDocumentLike;
  paymentMethod: string;
  cartId?: unknown;
  checkoutToken?: string;
  customerId?: unknown;
  guestEmail?: string;
  sessionId?: string;
  fingerprint?: string;
  clientIp?: string;
  userAgent?: string;
};

/**
 * Open an attempt for a cart about to be sent to a gateway.
 *
 * Its `_id` is what the gateway is given as the merchant reference, so the
 * caller writes the gateway's own ids back with {@link recordAttemptGatewayRefs}
 * once the session exists.
 */
export async function openCheckoutAttempt(input: OpenAttemptInput) {
  const now = Date.now();
  return CheckoutAttempt.create({
    snapshot: input.snapshot,
    paymentMethod: String(input.paymentMethod).toLowerCase(),
    cartId: input.cartId,
    checkoutToken: input.checkoutToken,
    customerId: input.customerId,
    guestEmail: input.guestEmail,
    sessionId: input.sessionId,
    fingerprint: input.fingerprint,
    clientIp: input.clientIp,
    userAgent: input.userAgent,
    status: CHECKOUT_ATTEMPT_STATUS.OPEN,
    expiresAt: new Date(now + attemptWindowMs(input.paymentMethod)),
    tries: { count: 1, failed: 0 },
  });
}

/** Write the gateway's own identifiers onto the attempt they belong to. */
export async function recordAttemptGatewayRefs(
  attemptId: unknown,
  refs: Record<string, string | undefined>,
): Promise<void> {
  const set: Record<string, string> = {};
  for (const [key, value] of Object.entries(refs)) {
    if (value) set[`gateway.${key}`] = value;
  }
  if (Object.keys(set).length === 0) return;
  await CheckoutAttempt.updateOne({ _id: attemptId }, { $set: set });
}

/** Another try on the same attempt — the shopper came back and paid again. */
export async function recordAttemptTry(attemptId: unknown): Promise<void> {
  await CheckoutAttempt.updateOne(
    { _id: attemptId },
    { $inc: { "tries.count": 1 } },
  );
}

/** A try the gateway refused. The attempt stays open: shoppers retry. */
export async function recordAttemptFailure(
  attemptId: unknown,
  failureCode?: string,
): Promise<void> {
  await CheckoutAttempt.updateOne(
    { _id: attemptId },
    {
      $inc: { "tries.failed": 1 },
      $set: {
        "tries.lastFailedAt": new Date(),
        ...(failureCode ? { "tries.lastFailureCode": failureCode } : {}),
      },
    },
  );
}

/**
 * The attempt this cart may return to on this gateway, superseding any other.
 *
 * A shopper who closes the gateway window and presses pay again must land on
 * the SAME gateway session: two live sessions for one cart is two places the
 * money can arrive. So the newest attempt that still matches — same gateway,
 * same fingerprint (nothing about the order changed), still open, still inside
 * its window — is handed back, and every other open attempt on the cart is
 * closed as superseded.
 *
 * This is the rule `takeOverCheckoutAttempt` applies to pre-created orders,
 * with the same reasoning and the same fingerprint.
 */
export async function takeOverOpenAttempt(params: {
  cartId: unknown;
  paymentMethod: string;
  fingerprint?: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const method = String(params.paymentMethod).toLowerCase();
  const open = await CheckoutAttempt.find({
    cartId: params.cartId,
    status: CHECKOUT_ATTEMPT_STATUS.OPEN,
  })
    .sort({ createdAt: -1 })
    .lean<
      Array<{
        _id: unknown;
        paymentMethod?: string;
        fingerprint?: string;
        expiresAt?: Date;
        gateway?: Record<string, unknown>;
        snapshot?: OrderDocumentLike;
      }>
    >();

  const reusable = open.find(
    (attempt) =>
      attempt.paymentMethod === method &&
      Boolean(params.fingerprint) &&
      attempt.fingerprint === params.fingerprint &&
      Boolean(attempt.expiresAt) &&
      new Date(attempt.expiresAt as Date) > now,
  );

  await Promise.all(
    open
      .filter((attempt) => attempt !== reusable)
      .map((attempt) =>
        closeCheckoutAttempt(attempt._id, CHECKOUT_ATTEMPT_STATUS.SUPERSEDED),
      ),
  );

  return reusable ?? null;
}

type AttemptClaim =
  /** This settlement holds the attempt and must finish it. */
  | { outcome: "claimed" }
  /** Somebody already turned it into an order — here it is. */
  | { outcome: "already_ordered"; orderId: unknown; orderNumber?: string }
  /** Another settlement holds a live claim; try again in a moment. */
  | { outcome: "busy" }
  /** Closed before the money arrived: superseded, or expired. */
  | { outcome: "closed"; status: string }
  | { outcome: "not_found" };

/**
 * Take the attempt for settlement, or say who has it.
 *
 * One atomic update does the taking, so two settlements racing cannot both
 * win. A claim that is never released — a process that dies mid-promotion —
 * expires with its lease, and the next run finds either the order it wrote
 * (`already_ordered`) or an attempt it can take again.
 */
export async function claimAttemptForFinalize(
  attemptId: unknown,
  now: Date = new Date(),
): Promise<AttemptClaim> {
  const claimed = await CheckoutAttempt.findOneAndUpdate(
    {
      _id: attemptId,
      $or: [
        { status: CHECKOUT_ATTEMPT_STATUS.OPEN },
        // A lease nobody finished. Its holder is gone; taking it over is how
        // a half-written promotion is completed rather than stranded.
        {
          status: CHECKOUT_ATTEMPT_STATUS.FINALIZING,
          "finalize.orderId": null,
          "finalize.leaseUntil": { $lt: now },
        },
      ],
    },
    {
      $set: {
        status: CHECKOUT_ATTEMPT_STATUS.FINALIZING,
        "finalize.claimedAt": now,
        "finalize.leaseUntil": new Date(now.getTime() + FINALIZE_LEASE_MS),
      },
    },
    { new: true },
  );
  if (claimed) return { outcome: "claimed" };

  const current = await CheckoutAttempt.findById(attemptId)
    .select("status finalize.orderId finalize.orderNumber")
    .lean<{
      status?: string;
      finalize?: { orderId?: unknown; orderNumber?: string };
    } | null>();
  if (!current) return { outcome: "not_found" };
  if (current.finalize?.orderId) {
    return {
      outcome: "already_ordered",
      orderId: current.finalize.orderId,
      orderNumber: current.finalize.orderNumber,
    };
  }
  if (current.status === CHECKOUT_ATTEMPT_STATUS.FINALIZING) {
    return { outcome: "busy" };
  }
  return { outcome: "closed", status: String(current.status || "") };
}

/**
 * Take a CLOSED attempt, to record and give back money that arrived anyway.
 *
 * {@link claimAttemptForFinalize} deliberately refuses a superseded or expired
 * attempt: nothing may turn one into a live order. But money that landed on it
 * is real, and the only honest thing to do with it is write the order it was
 * for, cancelled, and refund it — which is one order and one refund however
 * many times the gateway delivers the news. So this is the same mutual
 * exclusion, on the statuses the other one will not touch.
 *
 * The status is left alone rather than moved to `finalizing`: a closed attempt
 * stays closed, and the lease alone is what keeps two deliveries from both
 * writing an order. `createOrderFromAttempt` makes it permanent by stamping
 * `finalize.orderId`, and `Order.checkoutAttemptId`'s unique index is the
 * backstop if a process dies between the two.
 */
export async function claimClosedAttemptForRefund(
  attemptId: unknown,
  now: Date = new Date(),
): Promise<AttemptClaim> {
  const claimed = await CheckoutAttempt.findOneAndUpdate(
    {
      _id: attemptId,
      status: {
        $in: [
          CHECKOUT_ATTEMPT_STATUS.SUPERSEDED,
          CHECKOUT_ATTEMPT_STATUS.EXPIRED,
        ],
      },
      "finalize.orderId": null,
      $or: [
        { "finalize.leaseUntil": null },
        { "finalize.leaseUntil": { $lt: now } },
      ],
    },
    {
      $set: {
        "finalize.claimedAt": now,
        "finalize.leaseUntil": new Date(now.getTime() + FINALIZE_LEASE_MS),
      },
    },
    { new: true },
  );
  if (claimed) return { outcome: "claimed" };

  const current = await CheckoutAttempt.findById(attemptId)
    .select("status finalize.orderId finalize.orderNumber")
    .lean<{
      status?: string;
      finalize?: { orderId?: unknown; orderNumber?: string };
    } | null>();
  if (!current) return { outcome: "not_found" };
  if (current.finalize?.orderId) {
    return {
      outcome: "already_ordered",
      orderId: current.finalize.orderId,
      orderNumber: current.finalize.orderNumber,
    };
  }
  return { outcome: "busy" };
}

/** Hand the attempt back when the settlement decided not to finish it. */
export async function releaseAttemptClaim(attemptId: unknown): Promise<void> {
  await CheckoutAttempt.updateOne(
    {
      _id: attemptId,
      status: CHECKOUT_ATTEMPT_STATUS.FINALIZING,
      "finalize.orderId": null,
    },
    {
      $set: { status: CHECKOUT_ATTEMPT_STATUS.OPEN },
      $unset: { "finalize.claimedAt": "", "finalize.leaseUntil": "" },
    },
  );
}

/**
 * The order this attempt promotes to had already been written.
 *
 * Only one thing leaves that state behind: a run that wrote the order and died
 * before it could stamp `finalize.orderId` on the attempt, so the claim could
 * not see it and let the next answer in. `Order.checkoutAttemptId`'s unique
 * index refuses the second order — and without this, it refused it on every
 * webhook retry for as long as the gateway kept retrying, because nothing ever
 * turned the refusal into "this attempt is already that order". Carries the
 * order it found, which the attempt now points at.
 */
export class AttemptAlreadyOrderedError extends Error {
  constructor(
    readonly order: {
      _id: unknown;
      orderNumber?: string;
      preorderOutstandingAmount?: number;
    },
  ) {
    super("This checkout attempt was already turned into an order");
    this.name = "AttemptAlreadyOrderedError";
  }
}

function isAttemptOrderConflict(error: unknown): boolean {
  const conflict = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
  } | null;
  return (
    conflict?.code === 11000 &&
    Boolean(conflict.keyPattern && "checkoutAttemptId" in conflict.keyPattern)
  );
}

/**
 * The money arrived: write the order this attempt was always going to be.
 *
 * The order is written from the snapshot taken when the shopper pressed pay,
 * so the price they agreed to is the price they are charged, however long the
 * gateway took. `overrides` carries what only the gateway's answer knows — the
 * payment status, when it was paid, the capture's own ids.
 *
 * The attempt is marked `completed` only after the order exists. If this dies
 * in between, the unique index on `Order.checkoutAttemptId` stops the next run
 * writing a second order, and that run points the attempt at the first and
 * throws {@link AttemptAlreadyOrderedError} rather than settling it again.
 */
export async function createOrderFromAttempt(params: {
  attempt: {
    _id: unknown;
    snapshot: OrderDocumentLike;
    /** What the attempt is holding on the shelf — see `attempt-stock-hold.ts`. */
    stockHold?: { lines?: unknown[]; releasedAt?: Date | null } | null;
  };
  orderPrefix?: string;
  overrides?: Record<string, unknown>;
  /**
   * Whether the order takes over the goods the attempt was holding.
   *
   * True for every ordinary promotion. False for an order written only to
   * record and refund money that arrived after the checkout closed: that
   * order ships nothing, so claiming the hold for it would take units off the
   * shelf that nobody is going to buy — and leave them there, because a
   * cancelled order written cancelled never runs a restore.
   */
  takeStockHold?: boolean;
}) {
  let order;
  try {
    order = await persistOrderFromDocument(params.attempt.snapshot, {
      orderPrefix: params.orderPrefix,
      checkoutAttemptId: params.attempt._id,
      overrides: params.overrides,
    });
  } catch (error) {
    if (!isAttemptOrderConflict(error)) throw error;
    const existing = await Order.findOne({
      checkoutAttemptId: params.attempt._id,
    })
      .select("_id orderNumber preorderOutstandingAmount")
      .lean<{
        _id: unknown;
        orderNumber?: string;
        preorderOutstandingAmount?: number;
      } | null>();
    if (!existing) throw error;
    await CheckoutAttempt.updateOne(
      { _id: params.attempt._id },
      {
        $set: {
          status: CHECKOUT_ATTEMPT_STATUS.COMPLETED,
          "finalize.orderId": existing._id,
          "finalize.orderNumber": existing.orderNumber,
        },
        $unset: { purgeAt: "" },
      },
    );
    throw new AttemptAlreadyOrderedError(existing);
  }

  // The attempt was holding the goods, so the order inherits them: without
  // this flag the capture path would take the same units a second time, and
  // the shop would be short of stock it never sold. A hold that had already
  // lapsed leaves the flag off, and capture takes the stock as it always did.
  const { markAttemptHoldTaken } = await import(
    "@/lib/checkout/attempt-stock-hold"
  );
  // Claimed, not read: the sweep that gives lapsed holds back races this, and
  // only one of the two may win. Winning here means the goods are the order's,
  // so it is flagged as already holding them; losing means the hold had gone
  // back on the shelf and the capture path takes the stock itself.
  if (
    params.takeStockHold !== false &&
    (await markAttemptHoldTaken(params.attempt._id))
  ) {
    const { markOrderInventoryReserved } = await import(
      "@/lib/orders/order-inventory"
    );
    await markOrderInventoryReserved(String(order._id)).catch((err) =>
      console.error(
        "Failed to flag the stock an attempt was holding onto its order:",
        err,
      ),
    );
    // And on the copy in hand, not only in the database. The settler reads
    // the flags off the document it is GIVEN (`settleCapturedOrder`), so a
    // document written a moment before the flag would tell it the goods were
    // still on the shelf — and it would take the same units a second time,
    // which is the exact bug the flag exists to prevent.
    for (const consignment of (order.subOrders ?? []) as Array<{
      status?: string;
      inventoryReserved?: boolean;
    }>) {
      if (consignment.status !== ORDER_STATUS.CANCELLED) {
        consignment.inventoryReserved = true;
      }
    }
  }

  await CheckoutAttempt.updateOne(
    { _id: params.attempt._id },
    {
      $set: {
        status: CHECKOUT_ATTEMPT_STATUS.COMPLETED,
        "finalize.orderId": order._id,
        "finalize.orderNumber": order.orderNumber,
      },
      $unset: { purgeAt: "" },
    },
  );

  return order;
}

/**
 * The cart became an order some other way — paid by card, cash on delivery, or
 * a gateway that is not on the attempt path — so every attempt still open on
 * it is a second place the money could land. They are closed as superseded,
 * which is what the pre-attempt checkout does to its pending orders
 * (`retireCartCheckoutAttempts`).
 *
 * `exceptAttemptId` is the attempt that BECAME the order, which must not close
 * itself.
 */
export async function closeCartOpenAttempts(
  cartId: unknown,
  exceptAttemptId?: unknown,
): Promise<number> {
  if (!cartId) return 0;
  const open = await CheckoutAttempt.find({
    cartId,
    status: CHECKOUT_ATTEMPT_STATUS.OPEN,
    ...(exceptAttemptId ? { _id: { $ne: exceptAttemptId } } : {}),
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  const closed = await Promise.all(
    open.map((attempt) =>
      closeCheckoutAttempt(attempt._id, CHECKOUT_ATTEMPT_STATUS.SUPERSEDED),
    ),
  );
  return closed.filter(Boolean).length;
}

/**
 * Close an attempt nobody will pay: the cart changed under it, or its window
 * ran out with the gateway confirming no money arrived.
 *
 * Conditional on it still being open, so an attempt that was paid a moment ago
 * is never closed out from under its own settlement. `purgeAt` starts the
 * ninety-day clock the TTL index acts on.
 */
export async function closeCheckoutAttempt(
  attemptId: unknown,
  status:
    | typeof CHECKOUT_ATTEMPT_STATUS.SUPERSEDED
    | typeof CHECKOUT_ATTEMPT_STATUS.EXPIRED,
): Promise<boolean> {
  const result = await CheckoutAttempt.updateOne(
    { _id: attemptId, status: CHECKOUT_ATTEMPT_STATUS.OPEN },
    {
      $set: {
        status,
        purgeAt: new Date(Date.now() + PURGE_AFTER_MS),
        "reconcile.closedAt": new Date(),
      },
    },
  );
  if (result.modifiedCount !== 1) return false;

  // Whatever it was holding goes back on the shelf. Claim-based inside, so an
  // attempt that held nothing — or whose hold already lapsed — is a no-op.
  const { releaseAttemptStock } = await import(
    "@/lib/checkout/attempt-stock-hold"
  );
  await releaseAttemptStock(attemptId);
  return true;
}
