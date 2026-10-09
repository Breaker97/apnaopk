import { Types } from "mongoose";
import { Cart, CheckoutAttempt, Order, PaymentTransaction } from "@/models";
import { normalizeFailureCode } from "@/lib/payments/failure-codes";
import { feeInChargeCurrency } from "@/lib/payments/gateway-fee";
import { quantizeToCurrency } from "@/lib/intl/money";
import {
  orderCreditCounted,
  type OrderStoreCredit,
} from "@/lib/store-credit/order-credit";
import type { RefundAllocationShare } from "@/lib/returns/refund-allocation";
import {
  postOrderPaidSafely,
  postRefundSafely,
  resolveRefundAllocation,
} from "@/lib/finance/post-events";

type OrderLike = {
  _id: string;
  orderNumber: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentId?: string;
  stripePaymentIntentId?: string;
  paypalCaptureId?: string;
  razorpayPaymentId?: string;
  paystackTransactionId?: string;
  pesapalConfirmationCode?: string;
  iotecTransactionId?: string;
  orangeMoneyTxnId?: string;
  mtnMomoTransactionId?: string;
  mtnMomoReferenceId?: string;
  subtotal?: number;
  shippingCost?: number;
  tax?: number;
  discount?: number;
  total?: number;
  /** Pre-order balance not collected yet — subtracted from the recorded gross
   *  while the order is partially_paid so the ledger reflects money actually
   *  received, not the full order value. */
  preorderOutstandingAmount?: number;
  /** What the gateway kept, as it reported it. Absent = not reported. */
  paymentFee?: number;
  paymentFeeCurrency?: string;
  paymentFeeRate?: number;
  currency?: string;
  channel?: string;
  posLocationId?: string;
  paymentMetadata?: Record<string, unknown>;
  createdAt?: Date | string;
  /**
   * Store credit that paid part of the order (R8). The gateway's charge is the
   * rest. Read off the order when a caller did not bring it.
   */
  storeCredit?: OrderStoreCredit | null;
};

export function getPaymentProviderFromOrder(order: OrderLike): string {
  const method = String(order.paymentMethod || "").toLowerCase();
  const channel = String(order.channel || "").toLowerCase();

  if (channel === "pos") {
    if (method === "cash") return "pos_cash";
    if (method === "card") return "pos_card";
    if (method === "manual") return "pos_manual";
    return method ? `pos_${method}` : "pos";
  }

  if (method === "card") return "stripe";
  if (method === "paypal") return "paypal";
  if (method === "razorpay") return "razorpay";
  if (method === "paystack") return "paystack";
  if (method === "pesapal") return "pesapal";
  if (method === "iotec") return "iotec";
  if (method === "orange_money") return "orange_money";
  if (method === "mtn_momo") return "mtn_momo";
  if (method === "cod") return "cod";
  if (method === "manual") return "manual";
  return method || "manual";
}

function getChargeExternalId(order: OrderLike): string | undefined {
  return (
    order.stripePaymentIntentId ||
    order.paypalCaptureId ||
    order.razorpayPaymentId ||
    order.paystackTransactionId ||
    order.pesapalConfirmationCode ||
    order.iotecTransactionId ||
    order.orangeMoneyTxnId ||
    // financialTransactionId when the payment succeeded; the request UUID is
    // the fallback so a pending charge row is still traceable to MTN.
    order.mtnMomoTransactionId ||
    order.mtnMomoReferenceId ||
    order.paymentId ||
    undefined
  );
}

function getCurrency(order: OrderLike): string {
  const currency = String(order.currency || "").trim().toUpperCase();
  return currency || "USD";
}

function buildChargePayload(order: OrderLike, status: "pending" | "succeeded") {
  const total = Number(order.total || 0);
  // What the shopper's store credit paid never went through the gateway (R8),
  // and neither did credit whose hold was given back: the gateway was asked
  // for the rest all the same (see `orderCreditCounted`).
  const storeCredit = orderCreditCounted(order);
  // A partially_paid order collected only the deposit; recording the full
  // total would overstate revenue until the balance arrives.
  const currency = getCurrency(order);
  const beforeCredit =
    String(order.paymentStatus || "") === "partially_paid"
      ? Math.max(0, total - Number(order.preorderOutstandingAmount || 0))
      : total;
  // To what the currency can hold once credit came off: 1447.2 − 48.62 is
  // 1398.5800000000002 in floating point. A row with no credit keeps its
  // figure exactly as before.
  const gross =
    storeCredit > 0
      ? quantizeToCurrency(Math.max(0, beforeCredit - storeCredit), currency)
      : beforeCredit;
  const externalId = getChargeExternalId(order);
  // Only a fee expressible in the ORDER's currency may be netted off its total.
  // Stripe settles in the account's balance currency, so a EUR charge on a USD
  // account carries a USD fee — but Stripe also states the rate it used, and
  // with that rate the fee CAN be stated honestly here. Without one it is left
  // out of `netAmount` and kept in metadata, where a report can show it as
  // unconverted rather than silently treating dollars as euros.
  const feeCurrency = String(order.paymentFeeCurrency || "")
    .trim()
    .toUpperCase();
  const reportedFee = Number(order.paymentFee);
  const hasFee = Number.isFinite(reportedFee) && reportedFee >= 0;
  const convertedFee = hasFee
    ? feeInChargeCurrency({
        fee: reportedFee,
        feeCurrency,
        chargeCurrency: currency,
        rate: order.paymentFeeRate,
      })
    : undefined;
  const netableFee =
    convertedFee === undefined ? 0 : quantizeToCurrency(convertedFee, currency);

  return {
    orderId: order._id,
    orderNumber: order.orderNumber,
    type: "charge",
    status,
    provider: getPaymentProviderFromOrder(order),
    paymentMethod: order.paymentMethod || "manual",
    currency,
    grossAmount: gross,
    feeAmount: netableFee,
    netAmount: gross - netableFee,
    refundedAmount: 0,
    externalId,
    metadata: {
      subtotal: Number(order.subtotal || 0),
      shippingCost: Number(order.shippingCost || 0),
      tax: Number(order.tax || 0),
      discount: Number(order.discount || 0),
      channel: order.channel || "online",
      posLocationId: order.posLocationId,
      source: "order-sync",
      ...(storeCredit > 0 ? { storeCredit } : {}),
      ...(hasFee
        ? {
            gatewayFee: reportedFee,
            gatewayFeeCurrency: feeCurrency || currency,
            ...(order.paymentFeeRate
              ? { gatewayFeeRate: order.paymentFeeRate }
              : {}),
            // Flagged rather than hidden: a fee that could not be stated in the
            // order's currency is missing from `netAmount`, and a report that
            // does not know that would present a net figure as complete.
            ...(convertedFee === undefined
              ? { gatewayFeeUnconverted: true }
              : {}),
          }
        : {}),
      ...(order.paymentMetadata || {}),
    },
    createdAt: order.createdAt ? new Date(order.createdAt) : undefined,
  };
}

/**
 * The charge rows that may still become an order's payment.
 *
 * A refusal is a charge row too — `recordChargeFailure` writes one, and the
 * expiry sweep writes a `cancelled` one — and only the cash-on-delivery paths
 * ever write a `pending` row, so on every redirect gateway a refusal is the
 * FIRST row an order has. Without this filter the retry that finally went
 * through was handed the refusal's own document to overwrite, and that cost
 * five things at once: the failed attempt vanished from the order's payment
 * history (the panel hides a row once it reads `succeeded`, and disappears
 * entirely when it was the only one), its `failureCode` and gateway message
 * stayed on a row now marked succeeded, its `currency` survived the `$ifNull`
 * below — so a row that had fallen back to USD mislabelled the charge for
 * good, and dropped it out of every store-currency total — its `createdAt`
 * went on dating the sale, which is what the ledger reads when an order
 * carries no `paidAt`, and `metadata` was replaced wholesale, taking with it
 * the dedupe key that stops a replayed webhook writing the failure twice.
 *
 * A failure stays a failure. The payment that succeeds gets its own row.
 */
const SETTLEABLE_CHARGE_STATUS = { $nin: ["failed", "cancelled"] };

/** The order with its store credit, read off it when the caller did not bring it. */
async function withStoreCredit(order: OrderLike): Promise<OrderLike> {
  if (order.storeCredit !== undefined) return order;
  try {
    const found = await Order.findById(order._id)
      .select("storeCredit")
      .lean<{ storeCredit?: OrderStoreCredit | null } | null>();
    return { ...order, storeCredit: found?.storeCredit ?? null };
  } catch (error) {
    // Never blocks the charge row: read as no credit, and said.
    console.error("Failed to read an order's store credit for its charge row:", error);
    return { ...order, storeCredit: null };
  }
}

export async function ensureChargeTransaction(orderInput: OrderLike) {
  const status = String(orderInput.paymentStatus || "");
  // partially_paid included: a captured pre-order deposit is real money and
  // must appear in the ledger (previously it was never recorded at all).
  if (
    status !== "paid" &&
    status !== "partially_paid" &&
    status !== "partially_refunded" &&
    status !== "refunded"
  ) {
    return;
  }
  const order = await withStoreCredit(orderInput);
  const { recordOrderCollections } = await import("@/lib/finance/collections");
  await recordOrderCollections(order._id);

  const existing = await PaymentTransaction.findOne({
    orderId: order._id,
    type: "charge",
    status: SETTLEABLE_CHARGE_STATUS,
  })
    .select("_id status")
    .lean();

  const payload = buildChargePayload(order, "succeeded");

  if (existing) {
    // Pipeline update so re-syncing an already-refund-adjusted charge doesn't
    // wipe those adjustments: netAmount is recomputed as gross − refundedAmount
    // (a plain $set of netAmount=gross erased prior refunds), and the original
    // currency label is kept — re-labelling historical rows to the CURRENT
    // store currency corrupted reports whenever the default currency changed.
    await PaymentTransaction.updateOne(
      { _id: existing._id },
      [
        {
          $set: {
            status: "succeeded",
            provider: { $literal: payload.provider },
            paymentMethod: { $literal: payload.paymentMethod },
            currency: { $ifNull: ["$currency", payload.currency] },
            grossAmount: payload.grossAmount,
            feeAmount: payload.feeAmount,
            netAmount: {
              $subtract: [
                payload.grossAmount - payload.feeAmount,
                { $ifNull: ["$refundedAmount", 0] },
              ],
            },
            externalId: { $literal: payload.externalId ?? null },
            metadata: { $literal: payload.metadata },
          },
        },
        // Heals a row the filter above now keeps this code away from: a
        // refusal promoted to `succeeded` before that filter existed still
        // carries the gateway's decline code and message, and a succeeded
        // charge that says why it was declined is read by a person.
        { $unset: ["failureCode", "gatewayCode", "gatewayMessage"] },
      ],
    );
    if (existing.status !== "succeeded") {
      // Pending → succeeded is the moment the money is real. Re-syncing an
      // already-succeeded charge posts nothing new: the keys collide.
      postOrderPaidSafely(order._id);
      // Nothing came through a gateway: store credit paid all of it.
      if (!(payload.grossAmount > 0)) return;
      const { notifyAdminsPaymentReceived } = await import("@/lib/notifications/notifications");
      await notifyAdminsPaymentReceived({
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        amount: payload.grossAmount,
        currency: payload.currency,
        paymentMethod: payload.paymentMethod,
      });
    }
    return;
  }

  await PaymentTransaction.create(payload);
  // The ledger follows the same choke point the transaction row does, so every
  // gateway, the POS and the manual paths all post without knowing they do.
  postOrderPaidSafely(order._id);
  // Nothing came through a gateway: store credit paid all of it.
  if (!(payload.grossAmount > 0)) return;
  const { notifyAdminsPaymentReceived } = await import("@/lib/notifications/notifications");
  await notifyAdminsPaymentReceived({
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    amount: payload.grossAmount,
    currency: payload.currency,
    paymentMethod: payload.paymentMethod,
  });
}

export async function ensurePendingChargeTransaction(orderInput: OrderLike) {
  const status = String(orderInput.paymentStatus || "");
  if (status !== "pending" && status !== "partially_paid") return;
  const order = await withStoreCredit(orderInput);

  // Same rule as above: a refusal already recorded against this order is not
  // the pending row, and treating it as one left the order with no charge row
  // at all.
  const existing = await PaymentTransaction.findOne({
    orderId: order._id,
    type: "charge",
    status: SETTLEABLE_CHARGE_STATUS,
  })
    .select("_id")
    .lean();

  if (existing) return;

  await PaymentTransaction.create(buildChargePayload(order, "pending"));
}

/**
 * Record a payment attempt that did NOT produce money.
 *
 * Until this, a refusal left no trace anywhere. Stripe's
 * `payment_intent.payment_failed` reached a `console.log`, Razorpay's
 * `payment.failed` was not subscribed to at all, and `Cart.paymentEvents`
 * declared a `failed` state that nothing ever wrote. So a shopper who rang up
 * saying "my card keeps being refused" could be answered only by opening the
 * gateway's own dashboard, a store worker could not tell one unlucky customer
 * from a card-testing script, and nobody could see that a gateway had been
 * refusing every payment since lunchtime.
 *
 * Three rules this keeps:
 *
 *  - **It never throws.** It is called from webhook handlers whose job is to
 *    acknowledge an event; failing to write a log must not turn into a retry
 *    storm or, worse, a 500 that makes the gateway resend a payment event.
 *  - **`orderId` is optional.** A Stripe card is refused before any order
 *    exists. The cart's `checkoutToken` is recorded instead, which is what
 *    ties the row to a checkout either way.
 *  - **Duplicates collapse.** Gateways resend webhooks; `dedupeKey` (their
 *    event id) makes the second delivery a no-op rather than a second
 *    "failed payment" in the store's count.
 *
 * Who was paying is filled in here when the caller could not say — see
 * {@link resolveFailureIdentity}.
 */
export async function recordChargeFailure(input: {
  provider: string;
  paymentMethod?: string | null;
  /** The gateway's own id for the attempt: payment intent, payment, charge. */
  externalId?: string | null;
  amount?: number | null;
  currency?: string | null;
  /** The gateway's own code, kept as it arrived. */
  failureCode?: string | null;
  gatewayMessage?: string | null;
  /** Where the news came from, for telling a real refusal from a sweep. */
  source: "client" | "webhook" | "return" | "reconcile";
  /** `cancelled` for a shopper who backed out, `failed` for a refusal. */
  status?: "failed" | "cancelled";
  orderId?: unknown;
  orderNumber?: string | null;
  /** The attempt this try belongs to, before any order exists. */
  checkoutAttemptId?: unknown;
  checkoutToken?: string | null;
  clientIp?: string | null;
  /** Who was trying to pay — the card-testing counter follows this. */
  customerEmail?: string | null;
  /** The gateway's event id, when it has one. */
  dedupeKey?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const amount = Number(input.amount);
    const identity = await resolveFailureIdentity(input);
    const payload = {
      ...(input.orderId ? { orderId: input.orderId } : {}),
      ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
      ...(input.checkoutAttemptId
        ? { checkoutAttemptId: input.checkoutAttemptId }
        : {}),
      type: "charge",
      status: input.status || "failed",
      provider: String(input.provider || "").toLowerCase() || "manual",
      ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
      currency: String(input.currency || "USD").toUpperCase(),
      // A refusal moved no money, so the amount is only what was ASKED for —
      // recorded because "the same 2.00 refused forty times" is the shape of
      // a card-testing run, and zero would hide it.
      grossAmount: Number.isFinite(amount) && amount > 0 ? amount : 0,
      feeAmount: 0,
      netAmount: 0,
      refundedAmount: 0,
      ...(input.externalId ? { externalId: input.externalId } : {}),
      // Both: the gateway's own word for staff and for the next time this
      // table needs a row, and the normalized one everything else counts and
      // speaks by. See `lib/payments/failure-codes.ts`.
      ...(input.failureCode ? { gatewayCode: input.failureCode } : {}),
      failureCode: normalizeFailureCode(input.failureCode, input.gatewayMessage),
      ...(input.gatewayMessage
        ? { gatewayMessage: String(input.gatewayMessage).slice(0, 500) }
        : {}),
      ...(identity.checkoutToken
        ? { checkoutToken: identity.checkoutToken }
        : {}),
      ...(identity.clientIp ? { clientIp: identity.clientIp } : {}),
      ...(identity.customerEmail
        ? { customerEmail: identity.customerEmail }
        : {}),
      source: input.source,
      metadata: {
        ...(input.metadata || {}),
        ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      },
    };

    if (input.dedupeKey) {
      await PaymentTransaction.updateOne(
        { "metadata.dedupeKey": input.dedupeKey, type: "charge" },
        { $setOnInsert: payload },
        { upsert: true },
      );
      return;
    }

    await PaymentTransaction.create(payload);
  } catch (error) {
    // Deliberately swallowed: see the doc comment. Logged so it is not silent.
    console.error("Failed to record a payment failure:", error);
  }
}

function cleanIdentityText(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function toObjectIdOrNull(value: unknown): Types.ObjectId | null {
  const id = String(value ?? "");
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
}

/**
 * Who was paying, for the card-testing counters (`assessCardTesting`).
 *
 * Those count refusals by checkout, by email and by address — but almost
 * every refusal arrives by webhook, which knows the gateway's ids and nothing
 * about the shopper. Left to the callers, none of them passed any of the
 * three, so every count read zero and the guard never asked anyone for
 * anything. So what the caller did not say is read here, once, off the records
 * the failure is already tied to: its attempt, its order, and the cart behind
 * either (or the one the gateway quoted back in `metadata.cartId`) — where
 * `updateCheckoutSnapshot` wrote the checkout's token and email before the
 * gateway was asked.
 *
 * Best-effort: a lookup that fails leaves the field out rather than losing
 * the failure itself.
 */
async function resolveFailureIdentity(input: {
  checkoutToken?: string | null;
  clientIp?: string | null;
  customerEmail?: string | null;
  checkoutAttemptId?: unknown;
  orderId?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<{
  checkoutToken?: string;
  clientIp?: string;
  customerEmail?: string;
}> {
  let checkoutToken = cleanIdentityText(input.checkoutToken);
  let clientIp = cleanIdentityText(input.clientIp);
  let customerEmail = cleanIdentityText(input.customerEmail);
  let cartId = toObjectIdOrNull(input.metadata?.cartId);

  try {
    const attemptId = toObjectIdOrNull(input.checkoutAttemptId);
    if (attemptId && !(checkoutToken && customerEmail && clientIp)) {
      const attempt = await CheckoutAttempt.findById(attemptId)
        .select("checkoutToken guestEmail clientIp cartId")
        .lean<{
          checkoutToken?: string;
          guestEmail?: string;
          clientIp?: string;
          cartId?: unknown;
        } | null>();
      checkoutToken ||= cleanIdentityText(attempt?.checkoutToken);
      customerEmail ||= cleanIdentityText(attempt?.guestEmail);
      clientIp ||= cleanIdentityText(attempt?.clientIp);
      cartId ||= toObjectIdOrNull(attempt?.cartId);
    }

    const orderId = toObjectIdOrNull(input.orderId);
    if (orderId && !(checkoutToken && customerEmail)) {
      const order = await Order.findById(orderId)
        .select("guestEmail checkoutCartId")
        .lean<{ guestEmail?: string; checkoutCartId?: unknown } | null>();
      customerEmail ||= cleanIdentityText(order?.guestEmail);
      cartId ||= toObjectIdOrNull(order?.checkoutCartId);
    }

    if (cartId && !(checkoutToken && customerEmail)) {
      const cart = await Cart.findById(cartId)
        .select("checkoutToken email")
        .lean<{ checkoutToken?: string; email?: string } | null>();
      checkoutToken ||= cleanIdentityText(cart?.checkoutToken);
      customerEmail ||= cleanIdentityText(cart?.email);
    }
  } catch (error) {
    console.error("Failed to resolve who a refused payment belonged to:", error);
  }

  return {
    checkoutToken,
    clientIp,
    // The counter lower-cases the address it asks about.
    customerEmail: customerEmail?.toLowerCase(),
  };
}

export async function createRefundTransaction(params: {
  order: OrderLike;
  amount: number;
  reason?: string;
  createdBy?: string;
  /** Refund identifier returned by the payment gateway, when applicable. */
  externalRefundId?: string;
  /**
   * Every gateway refund behind this row, when the money had to come back
   * from more than one charge (a pre-order's deposit AND its balance).
   * Recorded so the gateway's own refund webhook recognises all of them as
   * already known and does not write the extra ones a second time.
   */
  externalRefundIds?: string[];
  /** Whether the refund was issued automatically via the gateway. */
  gatewayCalled?: boolean;
  /**
   * What this refund was made of, per consignment — see
   * `lib/refund-allocation.ts`. Passed when a return knows; an order-level
   * refund passes nothing and the split is worked out from what earlier
   * refunds left behind.
   */
  allocation?: RefundAllocationShare[] | null;
  /**
   * The consignments this refund belongs to, when it is them being called off
   * rather than money back on the whole order: the split is then taken from
   * those consignments alone. See `resolveRefundAllocation`.
   */
  consignmentIds?: ReadonlyArray<unknown> | null;
  /**
   * Recorded by hand for money sent back from the gateway's own dashboard.
   * The gateway will report that refund under an id this row does not carry,
   * so the amount is left waiting for it: the report is matched here instead
   * of being written as a second refund. See `reconcileGatewayOrderRefunds`.
   */
  awaitingGatewayRefund?: boolean;
  /**
   * A chargeback recorded by hand before its gateway reported it. The
   * dispute's report is matched to this row instead of becoming a second one
   * — see `applyGatewayDispute`. Never paired with a refund the gateway
   * reports: the shopper's bank taking money back is not a refund anyone sent.
   */
  awaitingGatewayDispute?: boolean;
  /**
   * More facts about where this money went — the dispute behind a chargeback,
   * the other ids a gateway uses for the same money. Merged into the row's
   * `metadata` beneath the fields this function sets itself.
   */
  metadata?: Record<string, unknown>;
  /**
   * Where the row came from, when the caller knows better than "an admin
   * refunded it" — a chargeback, a refund reported by the gateway.
   */
  source?: string;
  /**
   * Whether someone still has to send this money.
   *
   * A refund no gateway carries — cash on delivery, a POS sale, mobile money,
   * a manual sale — was recorded as succeeded and nothing ever asked whether
   * the shopper was actually paid; only a return tracked that. Neither did a
   * Pesapal refund, which Pesapal only carries out once it approves the
   * request. Such a row now stays pending settlement until an admin records
   * how and when the money went (`PATCH /api/admin/payments/transactions/[id]`).
   *
   * Defaults to exactly those cases. `not_required` is for a caller that
   * already knows the money moved (a refund made in the gateway's dashboard, a
   * reversal the gateway reported) or tracks it elsewhere (a return).
   */
  settlement?: "required" | "not_required";
  /** Tell admins a hand refund is waiting. Off where the caller already has. */
  notifySettlement?: boolean;
  /**
   * Money the order's own charge never took, going back by hand: the part of
   * a guest's exchange order its return paid for (R7). Kept apart from the
   * charge as store credit is — nothing taken off it, nothing filed under its
   * id, no gateway report or dispute ever about it — but booked as cash.
   */
  apartFromCharge?: boolean;
}) {
  const safeAmount = Math.max(0, Number(params.amount || 0));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) return null;

  const gross = Number(params.order.total || 0);
  const chargeExternalId = getChargeExternalId(params.order);
  // Given as store credit (R8): the gateway's money stays where it is. Not
  // filed under the charge's id either — a gateway report about that charge,
  // a dispute above all, is never about this row.
  const storeCredit = params.metadata?.storeCredit === true;
  const apartFromCharge = storeCredit || params.apartFromCharge === true;
  const settlementRequired =
    params.settlement === "required" ||
    (params.settlement !== "not_required" &&
      (params.gatewayCalled === false ||
        String(params.order.paymentMethod || "").toLowerCase() === "pesapal"));

  // Serialize the split per order. `refundedTotal` already stops two refunds
  // exceeding the order between them, but the amount is not the only thing
  // being decided here: resolving the split reads the refunds already
  // recorded, and two that read that list at the same moment would each treat
  // the other's share as still unreversed and both claim it. The claim covers
  // resolve-and-write, and self-expires so a crashed request cannot wedge an
  // order's refunds shut.
  const claimRefundLock = () =>
    Order.findOneAndUpdate(
      {
        _id: params.order._id,
        $or: [
          { refundLockAt: null },
          { refundLockAt: { $exists: false } },
          { refundLockAt: { $lt: new Date(Date.now() - 15_000) } },
        ],
      },
      { $set: { refundLockAt: new Date() } },
    )
      .select("_id")
      .lean()
      .catch((error) => {
        // A lock that cannot be taken must not block a refund the gateway has
        // already paid out. Losing it costs the split, not the money.
        console.error("Failed to claim refund lock:", error);
        return null;
      });
  let lock = await claimRefundLock();
  // Held by another refund being recorded on this order. Going straight ahead
  // beside it was the very failure the lock is for — both read the same
  // history and split their money as though the other had not happened, so
  // one seller was reversed more than their share and another less. Waited
  // for, within the lock's own life, before going ahead without it.
  for (let waited = 0; !lock && waited < 5_000; waited += 250) {
    const held = await (async () =>
      Order.exists({
        _id: params.order._id,
        refundLockAt: { $gte: new Date(Date.now() - 15_000) },
      }))().catch(() => null);
    if (!held) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
    lock = await claimRefundLock();
  }

  let allocation: Awaited<ReturnType<typeof resolveRefundAllocation>> = null;
  try {
    // Resolved BEFORE the row is written, so "earlier refunds" means earlier
    // than this one. Every refund records its own split now — a refund that
    // names no items is prorated over what is LEFT of the order rather than
    // over the whole of it, which is what stopped a delivery refund from
    // reversing a slice of goods that had already been handed back.
    allocation = await resolveRefundAllocation({
      orderId: params.order._id,
      amount: safeAmount,
      supplied: params.allocation,
      consignmentIds: params.consignmentIds,
    });
  } catch (error) {
    // Never block a refund that has already left the gateway. Without a split
    // the ledger falls back to prorating, exactly as it did before.
    console.error("Failed to resolve refund allocation:", error);
  }

  const txn = await PaymentTransaction.create({
    orderId: params.order._id,
    orderNumber: params.order.orderNumber,
    type: "refund",
    status: "succeeded",
    provider: storeCredit
      ? "store_credit"
      : apartFromCharge
        ? "manual"
        : getPaymentProviderFromOrder(params.order),
    paymentMethod: params.order.paymentMethod || "manual",
    currency: getCurrency(params.order),
    grossAmount: safeAmount,
    feeAmount: 0,
    netAmount: -safeAmount,
    refundedAmount: safeAmount,
    externalId: params.externalRefundId || (apartFromCharge ? undefined : chargeExternalId),
    note: params.reason,
    // Written before the ledger is asked to post, because the ledger reads it
    // back off this row rather than being handed it — one stored fact, so a
    // replay of history cannot post a different split from the original, and
    // the payout arithmetic cannot reach a different answer from the ledger.
    refundAllocation:
      allocation && allocation.length > 0 ? allocation : undefined,
    metadata: {
      ...(params.metadata || {}),
      source:
        params.source ||
        (params.gatewayCalled === false ? "admin-refund-manual" : "admin-refund"),
      channel: params.order.channel || "online",
      posLocationId: params.order.posLocationId,
      orderGrossAmount: gross,
      gatewayCalled: params.gatewayCalled !== false,
      chargeExternalId,
      gatewayRefundId: params.externalRefundId,
      ...(params.externalRefundIds && params.externalRefundIds.length > 1
        ? { gatewayRefundIds: params.externalRefundIds }
        : {}),
      ...(params.awaitingGatewayRefund
        ? { awaitingGatewayRefunds: [{ key: "manual", amount: safeAmount }] }
        : {}),
      ...(params.awaitingGatewayDispute
        ? { awaitingGatewayDisputes: [{ key: "manual", amount: safeAmount }] }
        : {}),
      ...(settlementRequired ? { settlement: { required: true } } : {}),
      ...(apartFromCharge && !storeCredit ? { apartFromCharge: true } : {}),
    },
    createdBy: params.createdBy,
  });

  // The charge that went through, not refused attempts beside it: those rows
  // read as refunded on the transactions screen for money they never took.
  // Store credit took nothing back from the charge, nor did money it never took.
  if (!apartFromCharge) {
    await PaymentTransaction.updateMany(
      {
        orderId: params.order._id,
        type: "charge",
        status: "succeeded",
      },
      {
        $inc: { refundedAmount: safeAmount, netAmount: -safeAmount },
      },
    );
  }

  // Released only now: the split is only safe once the row carrying it exists,
  // because that row is what the next refund reads as history.
  if (lock) {
    await Order.updateOne(
      { _id: params.order._id },
      { $unset: { refundLockAt: "" } },
    ).catch((error) => console.error("Failed to release refund lock:", error));
  }

  // Keyed on the refund row, so two refunds of the same amount on one order
  // stay two entries rather than colliding into one.
  postRefundSafely({
    orderId: params.order._id,
    amount: safeAmount,
    refundId: txn?._id,
  });

  if (settlementRequired && params.notifySettlement !== false) {
    const { notifyAdminsPaymentAnomaly } = await import(
      "@/lib/notifications/notifications"
    );
    const pesapal =
      String(params.order.paymentMethod || "").toLowerCase() === "pesapal";
    await notifyAdminsPaymentAnomaly({
      title: pesapal ? "Pesapal refund awaiting approval" : "Refund to send by hand",
      message: pesapal
        ? `A refund of ${safeAmount} ${getCurrency(params.order)} on order ${params.order.orderNumber} was requested from Pesapal and only goes back once Pesapal approves it. Record it as settled on the transaction when it has.`
        : `A refund of ${safeAmount} ${getCurrency(params.order)} on order ${params.order.orderNumber} has no gateway to carry it. Send it to the shopper and record how on the transaction.`,
    }).catch((error) =>
      console.error("Failed to announce a refund awaiting settlement:", error),
    );
  }

  return txn;
}
