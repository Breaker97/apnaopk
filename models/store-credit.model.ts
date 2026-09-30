import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * Store credit (R8): money a shopper holds with the store, in one currency,
 * spent at checkout.
 *
 * The balance is made of LOTS — each credit given is one, with what is left of
 * it and, when the store set one, the day it expires. Spending takes from the
 * lot that expires first; each lot only ever moves by a conditional `$inc`, so
 * no lot goes below nothing and two checkouts cannot spend the same credit.
 * The account's `balance` is a cache of what its live lots hold, for lists and
 * totals; the lots are the truth. See lib/store-credit/store-credit.ts.
 */

const STORE_CREDIT_TRANSACTION_TYPES = [
  /** Credit given: a lot. `remaining` is what is left of it. */
  "issue",
  /** Credit spent on an order, or held for a checkout still being paid. */
  "redeem",
  /** A lot's rest, gone on its expiry date. */
  "expire",
] as const;
export type StoreCreditTransactionType =
  (typeof STORE_CREDIT_TRANSACTION_TYPES)[number];

/** Why credit was given, or where it went. */
export const STORE_CREDIT_SOURCES = [
  /** A return refunded to store credit. */
  "return_refund",
  /** A refund from the order screen to store credit. */
  "order_refund",
  /** Given by the store with no refund behind it. */
  "goodwill",
  /** Credit that paid for an order, given back when the order was refunded. */
  "order_refund_restore",
  /** Spent on an order. */
  "order",
  /** Expired. */
  "expiry",
] as const;
export type StoreCreditSource = (typeof STORE_CREDIT_SOURCES)[number];

/** A spend held for a checkout, then spent with its order or released. */
export const STORE_CREDIT_REDEEM_STATUSES = ["held", "spent", "released"] as const;
export type StoreCreditRedeemStatus = (typeof STORE_CREDIT_REDEEM_STATUSES)[number];

interface IStoreCreditAccount {
  _id: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  currency: string;
  /** What the live lots hold — a cache; see the note above. */
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStoreCreditTransaction {
  _id: mongoose.Types.ObjectId;
  accountId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  currency: string;
  type: StoreCreditTransactionType;
  /** Always positive; the type says which way it moved. */
  amount: number;
  /** A lot's rest (issue only). */
  remaining?: number;
  /** When a lot's rest expires (issue only); absent, it never does. */
  expiresAt?: Date | null;
  /** The lots a spend or an expiry took from. */
  lots?: Array<{ lotId: mongoose.Types.ObjectId; amount: number }>;
  /** A spend's state (redeem only). */
  status?: StoreCreditRedeemStatus;
  source: StoreCreditSource;
  orderId?: mongoose.Types.ObjectId;
  returnId?: mongoose.Types.ObjectId;
  /** The refund row a refund to credit stands for. */
  paymentTransactionId?: mongoose.Types.ObjectId;
  /**
   * The cart a checkout's hold was taken for (redeem only). One hold per cart:
   * a checkout started again reuses it, or gives it back and takes a new one.
   */
  checkoutCartId?: mongoose.Types.ObjectId;
  /**
   * How long a hold with no order yet stands — a card payment builds its
   * order only once the money lands. Past it, with no order, it goes back.
   */
  heldUntil?: Date;
  note?: string;
  createdBy?: string;
  /** One write per event, whatever retries it — see lib/store-credit. */
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const StoreCreditAccountSchema = new Schema<IStoreCreditAccount>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    currency: { type: String, required: true, uppercase: true, trim: true },
    balance: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);
StoreCreditAccountSchema.index({ customerId: 1, currency: 1 }, { unique: true });

const StoreCreditTransactionSchema = new Schema<IStoreCreditTransaction>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: "StoreCreditAccount",
      required: true,
    },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    currency: { type: String, required: true, uppercase: true, trim: true },
    type: { type: String, enum: STORE_CREDIT_TRANSACTION_TYPES, required: true },
    amount: { type: Number, required: true, min: 0 },
    remaining: { type: Number, min: 0 },
    expiresAt: { type: Date, default: undefined },
    lots: {
      type: [
        new Schema(
          {
            lotId: {
              type: Schema.Types.ObjectId,
              ref: "StoreCreditTransaction",
              required: true,
            },
            amount: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    status: { type: String, enum: STORE_CREDIT_REDEEM_STATUSES },
    source: { type: String, enum: STORE_CREDIT_SOURCES, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    returnId: { type: Schema.Types.ObjectId, ref: "ReturnRequest" },
    paymentTransactionId: { type: Schema.Types.ObjectId, ref: "PaymentTransaction" },
    checkoutCartId: { type: Schema.Types.ObjectId, ref: "Cart" },
    heldUntil: { type: Date },
    note: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: String, trim: true },
    idempotencyKey: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);
StoreCreditTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
// The lots a spend takes from, soonest to expire first.
StoreCreditTransactionSchema.index({
  customerId: 1,
  currency: 1,
  type: 1,
  remaining: 1,
  expiresAt: 1,
});
StoreCreditTransactionSchema.index({ customerId: 1, createdAt: -1 });
StoreCreditTransactionSchema.index({ orderId: 1, type: 1 });
// Holds still open, for the sweep that settles or releases them, and a
// cart's own hold.
StoreCreditTransactionSchema.index({ type: 1, status: 1, createdAt: 1 });
StoreCreditTransactionSchema.index({ checkoutCartId: 1, status: 1 }, { sparse: true });
// The expiry sweep.
StoreCreditTransactionSchema.index({ type: 1, expiresAt: 1, remaining: 1 });

export const StoreCreditAccount =
  models.StoreCreditAccount ||
  model<IStoreCreditAccount>("StoreCreditAccount", StoreCreditAccountSchema);

export const StoreCreditTransaction =
  models.StoreCreditTransaction ||
  model<IStoreCreditTransaction>("StoreCreditTransaction", StoreCreditTransactionSchema);
