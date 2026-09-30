import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

const AbandonedCheckoutItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    variantId: { type: Schema.Types.ObjectId },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    name: { type: String, required: true, trim: true },
    image: { type: String, trim: true },
  },
  { _id: false },
);

const AbandonedCheckoutAddressSchema = new Schema(
  {
    fullName: { type: String, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    street: { type: String, trim: true },
    apartment: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  { _id: false },
);

const AbandonedCheckoutPaymentEventSchema = new Schema(
  {
    gateway: { type: String, trim: true },
    status: {
      type: String,
      enum: ["created", "failed", "succeeded", "cancelled"],
      required: true,
    },
    message: { type: String, trim: true },
    paymentId: { type: String, trim: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

/**
 * One rung of the recovery ladder.
 *
 * The state lives here and nowhere else. It used to be split between the cart
 * and this record, which is how a shopper ends up with two copies of the same
 * email: two places to write meant two chances to disagree about whether it
 * had been sent.
 *
 * `dueAt` is written when the checkout is first marked abandoned, so the
 * schedule is fixed at that moment rather than recomputed on every sweep — a
 * merchant changing the timings does not re-send what has already gone.
 */
const AbandonedRecoveryEmailSchema = new Schema(
  {
    /** 1, 2, 3 — the rung, not the count of attempts. */
    step: { type: Number, required: true, min: 1 },
    dueAt: { type: Date, required: true },
    /** Taken by a sweep before it sends, so two runs cannot both send. */
    claimedAt: { type: Date },
    sentAt: { type: Date },
    /**
     * `queued` is a rung whose email reached the outbox but whose first
     * delivery attempt failed — the outbox retries it on its own schedule, so
     * it is neither sent nor lost. `reconcileQueuedRecoveryEmails` settles it
     * once the outbox knows.
     */
    status: {
      type: String,
      enum: ["pending", "queued", "sent", "failed", "skipped"],
      default: "pending",
    },
    /** The outbox job this rung became, read back to settle a `queued` rung. */
    dedupeKey: { type: String },
  },
  { _id: false },
);

const AbandonedCheckoutSchema = new Schema(
  {
    cartId: { type: Schema.Types.ObjectId, ref: "Cart", index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    sessionId: { type: String, index: true },
    checkoutToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    recoveryToken: { type: String, index: true },
    checkoutUrl: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    phone: { type: String, trim: true },
    customerName: { type: String, trim: true },
    customerLocale: { type: String, trim: true },
    buyerAcceptsMarketing: { type: Boolean, default: false },
    billingAddress: { type: AbandonedCheckoutAddressSchema },
    shippingAddress: { type: AbandonedCheckoutAddressSchema },
    sourceName: { type: String, default: "online_store", trim: true, index: true },
    landingSite: { type: String, trim: true },
    referringSite: { type: String, trim: true },
    gateway: { type: String, trim: true },
    items: { type: [AbandonedCheckoutItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },
    subtotalPrice: { type: Number, default: 0, min: 0 },
    shippingPrice: { type: Number, default: 0, min: 0 },
    totalTax: { type: Number, default: 0, min: 0 },
    totalDiscounts: { type: Number, default: 0, min: 0 },
    totalPrice: { type: Number, default: 0, min: 0 },
    presentmentCurrency: { type: String, trim: true, uppercase: true },
    checkoutStartedAt: { type: Date, index: true },
    abandonedAt: { type: Date },
    completedAt: { type: Date },
    recoveryEmailStatus: {
      type: String,
      enum: ["not_sent", "sent", "failed", "not_applicable"],
      default: "not_sent",
      index: true,
    },
    emailSentAt: { type: Date },
    recoveryStatus: {
      type: String,
      enum: ["not_recovered", "recovered"],
      default: "not_recovered",
    },
    emailStatusReason: { type: String, trim: true },
    status: {
      type: String,
      enum: ["open", "recovered", "closed"],
      default: "open",
      index: true,
    },
    paymentEvents: { type: [AbandonedCheckoutPaymentEventSchema], default: [] },
    /** The ladder — see `AbandonedRecoveryEmailSchema`. */
    recoveryEmails: { type: [AbandonedRecoveryEmailSchema], default: [] },
    /**
     * The shopper asked not to be emailed again. Set by the unsubscribe link
     * every recovery email carries; stops the rest of this ladder, and the
     * customer record it also writes stops every future one.
     */
    unsubscribedAt: { type: Date },
    /**
     * What this checkout was worth once it came back, and what brought it.
     *
     * Recorded rather than derived, because by the time anyone asks, the cart
     * is an order and the ladder's rungs have been overwritten by the next
     * checkout. `recoveredVia` is the rung that did it, `pay_link` when the
     * order was paid through the link a failed payment's email carries, or
     * `organic` when the shopper simply came back on their own.
     */
    recoveredTotal: { type: Number, min: 0 },
    recoveredVia: {
      type: String,
      enum: ["email_1", "email_2", "email_3", "link", "pay_link", "organic"],
    },
    /**
     * When this record deletes itself — roughly three months, the window
     * Shopify keeps. A live checkout has none and is never swept.
     */
    purgeAt: { type: Date },
  },
  {
    timestamps: true,
  },
);

AbandonedCheckoutSchema.index({ email: "text", phone: "text", customerName: "text" });
AbandonedCheckoutSchema.index({ recoveryStatus: 1, recoveryEmailStatus: 1 });
AbandonedCheckoutSchema.index({ abandonedAt: -1, updatedAt: -1 });
/** The ladder sweep: rungs that are due and nobody has taken. */
AbandonedCheckoutSchema.index({
  status: 1,
  "recoveryEmails.dueAt": 1,
  "recoveryEmails.claimedAt": 1,
});
/** Mongo deletes a closed record once its ninety days are up. */
AbandonedCheckoutSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const AbandonedCheckout =
  models.AbandonedCheckout ||
  model("AbandonedCheckout", AbandonedCheckoutSchema);
