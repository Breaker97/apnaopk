import { mongoose } from "@/lib/db";
import {
  QUOTE_REQUEST_STATUSES,
  type QuoteRequestStatus,
} from "@/lib/quotes/quote-status";

const { Schema, models, model } = mongoose;

/**
 * A shopper asking what a "price on request" product costs.
 *
 * Products the merchant marks `priceOnRequest` (see
 * lib/products/quote-pricing.ts) show a "Request a quote" button instead of a
 * price and a cart. Pressing it writes one of these rows, which is what the
 * admin Quotes page lists and works through.
 *
 * Deliberately NOT an order and not a draft order: nothing here is priced,
 * reserved or payable. The row is a lead — who asked, for what, how many, and
 * how to reach them — and the merchant answers it by email or in the inbox.
 * Keeping it out of the order collection is what stops a quote from ever being
 * counted as revenue, stock movement or a fulfilment obligation.
 *
 * `quantity` is what the shopper asked for, not a reservation: the product's
 * stock is untouched, because a quote that silently held inventory would let
 * anyone empty a shelf with a contact form.
 */

/**
 * The price the merchant answered a quote with.
 *
 * Priced for a QUANTITY, not per unit in the abstract: a quote is normally a
 * volume price, so the offer is only usable for exactly `quantity` units.
 * Letting the shopper take fewer at the same unit price would hand them the
 * bulk rate for a single piece.
 *
 * Nothing here records "live", "expired" or "used" — see
 * lib/quotes/quote-offer.ts, which derives all of that from `expiresAt`,
 * `withdrawnAt` and the quote's `orderId`.
 */
export interface IQuoteOffer {
  /** Price of one unit, in the store currency. */
  unitPrice: number;
  /** The exact quantity this price is good for. */
  quantity: number;
  /** Shown to the shopper with the price — terms, lead time, what is included. */
  note?: string;
  /** After this moment the offer stops resolving. Optional: no date, no expiry. */
  expiresAt?: Date;
  offeredAt: Date;
  /** The admin or staff member who sent it. */
  offeredBy?: mongoose.Types.ObjectId;
  /** Set when the merchant pulled the offer back; clears on the next one. */
  withdrawnAt?: Date;
}

export interface IQuoteRequest {
  _id: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId;
  /**
   * The product's name and variant as they stood when the request was made.
   * Copied rather than joined so a renamed — or deleted — product still leaves
   * the merchant able to read what was actually asked about.
   */
  productName: string;
  productSlug?: string;
  variantId?: mongoose.Types.ObjectId;
  variantName?: string;
  quantity: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message?: string;
  /** Set when the requester was signed in; guests leave it empty. */
  userId?: mongoose.Types.ObjectId;
  /** The inbox thread opened for this request, when one could be created. */
  conversationId?: mongoose.Types.ObjectId;
  status: QuoteRequestStatus;
  /** Internal note the merchant writes on the row; never shown to the shopper. */
  adminNote?: string;
  /** The price the merchant sent back, when they have sent one. */
  offer?: IQuoteOffer;
  /**
   * Every earlier offer, oldest first — a quote is a negotiation, and the
   * merchant needs to see what they already put on the table before they
   * re-price. Capped at the last 10 so a long haggle cannot grow the document
   * without bound.
   */
  offerHistory?: IQuoteOffer[];
  /**
   * The order the offer was spent on. Its presence is what makes an offer
   * single-use, and the order's own status is what can hand it back: a
   * cancelled order releases the offer without anything having to sweep it.
   */
  orderId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuoteOfferSchema = new Schema<IQuoteOffer>(
  {
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    note: { type: String, trim: true, maxlength: 2000 },
    expiresAt: { type: Date },
    offeredAt: { type: Date, required: true, default: Date.now },
    offeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    withdrawnAt: { type: Date },
  },
  { _id: false },
);

const QuoteRequestSchema = new Schema<IQuoteRequest>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", index: true },
    productName: { type: String, required: true, trim: true, maxlength: 200 },
    productSlug: { type: String, trim: true },
    variantId: { type: Schema.Types.ObjectId },
    variantName: { type: String, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    phone: { type: String, trim: true, maxlength: 40 },
    company: { type: String, trim: true, maxlength: 100 },
    message: { type: String, trim: true, maxlength: 2000 },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
    status: {
      type: String,
      enum: QUOTE_REQUEST_STATUSES,
      default: "new",
      index: true,
    },
    adminNote: { type: String, trim: true, maxlength: 2000 },
    offer: { type: QuoteOfferSchema },
    offerHistory: { type: [QuoteOfferSchema], default: undefined },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
  },
  { timestamps: true },
);

// The admin list is "newest first, optionally filtered by status" and the
// unanswered-count badge is a bare `status: "new"` count — both are served by
// this one compound index.
QuoteRequestSchema.index({ status: 1, createdAt: -1 });
// A vendor only ever sees their own requests, newest first.
QuoteRequestSchema.index({ vendorId: 1, createdAt: -1 });
// The shopper's own list at /account/quotes, and the lookup that decides
// whether they have a live price for the product they are looking at.
QuoteRequestSchema.index({ userId: 1, createdAt: -1 });
// Claiming a signed-out request once its sender logs in with the same address
// (lib/customers/customer.ts, claimGuestCustomerData).
QuoteRequestSchema.index({ email: 1, userId: 1 });

export const QuoteRequest =
  models.QuoteRequest ||
  model<IQuoteRequest>("QuoteRequest", QuoteRequestSchema);
