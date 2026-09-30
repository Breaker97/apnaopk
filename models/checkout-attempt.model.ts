import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * One try at paying for a cart.
 *
 * Every redirect gateway needs something to hang its reference on before the
 * shopper leaves to pay, and until now that something was a whole `Order`,
 * written with an ORD number burned into it. Most of those shoppers never come
 * back: the order stays `pending` for ever, in the admin's lists, the vendor's,
 * the shopper's own history and — until the report fixes — the store's revenue.
 *
 * This is that something, and nothing more. It carries the gateway's
 * reference, a priced snapshot of what was agreed, and the log of what the
 * gateway said. An `Order` is written only once money has actually arrived
 * (`createOrderFromAttempt`), so the Orders collection holds real sales and
 * real commitments, and nothing else. Shopify draws the line in the same
 * place: a checkout is not an order.
 *
 * **Not a second Order.** Nothing here is fulfilled, invoiced, paid out or
 * reported on. When it succeeds it hands its snapshot to an Order and becomes
 * a footnote on it; when it fails it stays here until the 90-day purge, where
 * support and the card-testing counters can still read it.
 *
 * The rollout is per gateway (`settings.payment.attemptGateways`), and the
 * finalizers look for a legacy pending order whenever they cannot find an
 * attempt — see `lib/payments/attempt-gateways.ts`.
 */

/**
 * `open` → a gateway has been asked and may still pay.
 * `finalizing` → a settlement holds the claim; the lease says until when.
 * `completed` → an Order was written; `finalize.orderId` names it.
 * `superseded` → the cart changed, or a newer attempt replaced this one.
 * `expired` → the window closed and the gateway confirmed no money arrived.
 */
export const CHECKOUT_ATTEMPT_STATUS = {
  OPEN: "open",
  FINALIZING: "finalizing",
  COMPLETED: "completed",
  SUPERSEDED: "superseded",
  EXPIRED: "expired",
} as const;

/**
 * Where the gateway's own identifiers live.
 *
 * One flat sub-document rather than twenty fields on the root, because that is
 * how they are read: a webhook arrives holding exactly one of them and has to
 * find the attempt it belongs to. Each gets a unique partial index below, so a
 * reference can never point at two attempts.
 */
const AttemptGatewayRefsSchema = new Schema(
  {
    razorpayOrderId: { type: String, trim: true },
    paypalOrderId: { type: String, trim: true },
    paystackReference: { type: String, trim: true },
    pesapalOrderTrackingId: { type: String, trim: true },
    pesapalMerchantReference: { type: String, trim: true },
    stripePaymentIntentId: { type: String, trim: true },
    stripeSessionId: { type: String, trim: true },
    /** The hosted page the shopper was sent to, for support and for a retry. */
    checkoutUrl: { type: String, trim: true },
  },
  { _id: false },
);

/**
 * The settlement's claim on this attempt.
 *
 * A webhook and the shopper's own return routinely arrive within a second of
 * each other, and both would write the same order. `claimedAt` + `leaseUntil`
 * is the same guard `finalizeCapturedOrder` has always used on the order
 * itself, moved one step earlier — and `orderId`, once set, is the answer to
 * every later arrival: this attempt is already an order, here it is.
 */
const AttemptFinalizeSchema = new Schema(
  {
    claimedAt: { type: Date },
    leaseUntil: { type: Date },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    orderNumber: { type: String, trim: true },
  },
  { _id: false },
);

/** What the gateway has been asked, and what it said. */
const AttemptTriesSchema = new Schema(
  {
    count: { type: Number, default: 0, min: 0 },
    failed: { type: Number, default: 0, min: 0 },
    lastFailureCode: { type: String, trim: true },
    lastFailedAt: { type: Date },
  },
  { _id: false },
);

const AttemptReconcileSchema = new Schema(
  {
    checkedAt: { type: Date },
    closedAt: { type: Date },
  },
  { _id: false },
);

/**
 * The goods held while the shopper is at the gateway.
 *
 * Written when the attempt is opened and cleared when it ends — see
 * `lib/checkout/attempt-stock-hold.ts` for why the hold's clock is far shorter
 * than the attempt's, and why `releasedAt` is a claim rather than a note.
 */
const AttemptStockHoldSchema = new Schema(
  {
    heldAt: { type: Date },
    /** When the goods go back even though the attempt stays open. */
    expiresAt: { type: Date },
    /** Set by whoever wins the release; the winner is the one that restores. */
    releasedAt: { type: Date },
    /** True when the release was an order taking the goods, not giving back. */
    takenByOrder: { type: Boolean },
    /** The counter the stock came off, when the order is collected. */
    locationId: { type: String, trim: true },
    lines: {
      type: [
        new Schema(
          {
            productId: { type: String, required: true },
            variantId: { type: String },
            quantity: { type: Number, required: true, min: 1 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const CheckoutAttemptSchema = new Schema(
  {
    /**
     * No human-readable reference of its own, by choice: the attempt's `_id`
     * is what every gateway is given as its merchant reference, and what a
     * webhook comes back holding. A second identifier would be one more thing
     * to keep in step, and a shopper never needs to read one out — the order
     * number is what they are given once there is an order.
     *
     * Indexed through the compound below that leads with it.
     */
    cartId: { type: Schema.Types.ObjectId, ref: "Cart" },
    /**
     * Ties the attempt to the abandoned-checkout record and its recovery.
     * Indexed through the compound below that leads with it.
     */
    checkoutToken: { type: String, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User" },
    guestEmail: { type: String, trim: true, lowercase: true },
    sessionId: { type: String, trim: true },
    paymentMethod: { type: String, required: true, trim: true, lowercase: true },
    /**
     * A hash of everything the order would be placed for. Two attempts with
     * the same hash would write the same order, so the first stands in for the
     * second — the rule `lib/checkout/checkout-attempts.ts` already applies to
     * pre-created orders. Compared in memory among the cart's own open
     * attempts, never queried on, so it carries no index.
     */
    fingerprint: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(CHECKOUT_ATTEMPT_STATUS),
      default: CHECKOUT_ATTEMPT_STATUS.OPEN,
      required: true,
    },
    /** When this attempt stops being worth returning to. */
    expiresAt: { type: Date, required: true },
    /**
     * When a closed attempt is deleted. Set only once it is `expired` or
     * `superseded`, so a live attempt is never swept away by the TTL, and a
     * completed one is kept for as long as its order is.
     */
    purgeAt: { type: Date },
    /**
     * Everything `createOrder` would have written, priced and agreed at the
     * moment the shopper pressed pay: items, consignments, totals, addresses,
     * shipping, coupon, tax, duty, pre-order terms.
     *
     * `Mixed` because it IS the order payload — a second schema for it would
     * be a copy of the order's, free to drift from it. What keeps it honest is
     * that one function builds it and one function turns it into an Order.
     */
    snapshot: { type: Schema.Types.Mixed, required: true },
    /** What this attempt is holding on the shelf, if anything. */
    stockHold: { type: AttemptStockHoldSchema },
    gateway: { type: AttemptGatewayRefsSchema, default: () => ({}) },
    tries: { type: AttemptTriesSchema, default: () => ({}) },
    finalize: { type: AttemptFinalizeSchema, default: () => ({}) },
    reconcile: { type: AttemptReconcileSchema, default: () => ({}) },
    /** For the card-testing counters, and for answering "who was this?". */
    clientIp: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true },
);

/**
 * A gateway reference identifies exactly one attempt — the whole idempotency
 * story rests on it, so the database enforces it rather than the code hoping.
 *
 * Partial on `{ $gt: "" }`, the codebase's pattern for a string reference
 * (`models/order.model.ts`): an attempt that has no PayPal id is not competing
 * with every other attempt that has none either.
 */
for (const field of [
  "gateway.razorpayOrderId",
  "gateway.paypalOrderId",
  "gateway.paystackReference",
  "gateway.pesapalOrderTrackingId",
  "gateway.pesapalMerchantReference",
  "gateway.stripePaymentIntentId",
  "gateway.stripeSessionId",
] as const) {
  CheckoutAttemptSchema.index(
    { [field]: 1 },
    { unique: true, partialFilterExpression: { [field]: { $gt: "" } } },
  );
}

/** The retry lookup: this cart's live attempt on this gateway. */
CheckoutAttemptSchema.index({ cartId: 1, status: 1, paymentMethod: 1 });
/** The expiry sweep: the oldest unanswered attempts first. */
CheckoutAttemptSchema.index({ status: 1, expiresAt: 1 });
/** The stock-hold sweep, which runs on a much shorter clock than the above. */
CheckoutAttemptSchema.index({ status: 1, "stockHold.expiresAt": 1 });
/** The reconcile sweep, which asks whoever was asked least recently. */
CheckoutAttemptSchema.index({ status: 1, "reconcile.checkedAt": 1, createdAt: 1 });
/** Support: every attempt behind one checkout, newest first. */
CheckoutAttemptSchema.index({ checkoutToken: 1, createdAt: -1 });
/**
 * A closed attempt deletes itself. Mongo drops the document once `purgeAt`
 * passes, and a document without the field is never touched — which is why
 * only `expired` and `superseded` attempts are given one.
 */
CheckoutAttemptSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const CheckoutAttempt =
  models.CheckoutAttempt ||
  model("CheckoutAttempt", CheckoutAttemptSchema);
