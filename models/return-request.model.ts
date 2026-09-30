import { mongoose } from "@/lib/db";
import {
  RETURN_DECLINE_REASONS,
  RETURN_REFUND_STATUS,
  RETURN_STATUS,
  type ReturnRefundStatus,
  type ReturnStatus,
} from "@/lib/returns/returns";
import {
  REFUND_DESTINATION_METHODS,
  REFUND_PAYERS,
} from "@/lib/returns/refund-settlement";
import {
  RETURN_INSTRUCTIONS_MAX_LENGTH,
  RETURN_METHODS,
  type ReturnMethod,
} from "@/lib/returns/return-shipping";

const { Schema, models, model } = mongoose;

export interface ReturnRequestItem {
  productId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  orderItemIndex: number;
  name: string;
  sku: string;
  quantityOrdered: number;
  quantityRequested: number;
  quantityApproved: number;
  quantityReceived: number;
  unitPrice: number;
  image?: string;
  condition?: "new" | "opened" | "damaged" | "missing_parts" | "unusable";
  restockable?: boolean;
  /**
   * Units of this line put back on the shelf so far. A parcel can arrive in
   * parts, and each restock adds only what came since the last — see
   * `returnRestockPlan`. Absent on a line never restocked this way.
   */
  quantityRestocked?: number;
}

/**
 * What the shopper gets instead of their money back (R7): a line of the
 * exchange order the return becomes once it is processed. Priced when chosen,
 * and taken from stock only when that order is made.
 */
export interface ReturnExchangeItem {
  productId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId;
  name: string;
  sku?: string;
  image?: string;
  quantity: number;
  /** What the shopper pays for one: the catalog's price, or less if the store chose. */
  unitPrice: number;
  /** The catalog's price for one when the item was chosen. */
  listPrice: number;
}

/**
 * The exchange order a processed return became (R7), and how much of the
 * return paid for it. `undoneAt` is set when that order was called off and
 * the money went back to the return.
 */
interface ReturnExchange {
  orderId: mongoose.Types.ObjectId;
  orderNumber: string;
  /** What of the return went to the exchange order. */
  credit: number;
  /** The exchange order's total. */
  total: number;
  /** What the shopper had left to pay, by the link they were sent. */
  owed: number;
  /** Where the return stood before it was processed, which an undo puts back. */
  statusBefore?: string;
  /** The refund row on the returned order that the exchange order was paid from. */
  refundTransactionId?: mongoose.Types.ObjectId;
  processedAt?: Date;
  processedBy?: string;
  undoneAt?: Date;
  undoneReason?: string;
}

/**
 * Where the money goes when no gateway can carry it back.
 *
 * Collected from the shopper at request time rather than chased afterwards: a
 * cash-on-delivery refund has no payment instrument to reverse, and asking for
 * bank details once the return is already approved means an email thread.
 */
interface ReturnRequestRefundDestination {
  method: string;
  accountName?: string;
  accountNumber?: string;
  provider?: string;
  note?: string;
  providedAt?: Date;
}

export interface ReturnRequestRefundEstimate {
  itemsSubtotal: number;
  shipping: number;
  tax: number;
  discountAdjustment: number;
  restockingFee: number;
  returnShippingFee: number;
  total: number;
  currency: string;
}

interface ReturnUnsellableDisposition {
  _id: mongoose.Types.ObjectId;
  /** Position of the line in `items`, which never reorders once counted. */
  itemIndex: number;
  productId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  quantity: number;
  action: "restocked" | "written_off";
  at: Date;
  by?: mongoose.Types.ObjectId;
}

interface IReturnRequest {
  _id: mongoose.Types.ObjectId;
  returnNumber: string;
  orderId: mongoose.Types.ObjectId;
  orderNumber: string;
  customerId: mongoose.Types.ObjectId;
  ownerType: "admin" | "vendor";
  ownerVendorId?: mongoose.Types.ObjectId;
  vendorIds: mongoose.Types.ObjectId[];
  status: ReturnStatus;
  refundStatus: ReturnRefundStatus;
  reason: string;
  customerNote?: string;
  adminNote?: string;
  /**
   * The seller's own note on the parcel. It used to be written over
   * `adminNote`, so a seller recording what arrived erased the store's note.
   */
  vendorNote?: string;
  rejectionReason?: string;
  /**
   * Why the store declined, for the store alone — the shopper reads
   * `rejectionReason`, the store's own words. See `RETURN_DECLINE_REASONS`.
   */
  declineReason?: string;
  items: ReturnRequestItem[];
  estimatedRefund: ReturnRequestRefundEstimate;
  /**
   * Fees the store lowered or waived by hand. A fee is the smaller of this
   * and what the policy charges — never more than the shopper was quoted.
   * See `applyReturnOverrides`.
   */
  feeOverride?: {
    restockingFee?: number | null;
    returnShippingFee?: number | null;
    setBy?: string;
    setAt?: Date;
  };
  /**
   * Delivery the store chose to hand back on this return, in full, whatever
   * the policy would have — up to what the parcel's delivery charged and no
   * refund has returned yet (`returnDeliveryCeiling`).
   */
  deliveryOverride?: {
    amount: number;
    setBy?: string;
    setAt?: Date;
  };
  /**
   * The parts of the return policy the estimate was priced under, as they
   * stood when the shopper asked — see `ReturnAppliedPolicy`. Absent on older
   * returns, which re-price under the settings of the day as they always did.
   */
  policyApplied?: {
    shippingRefund?: string;
    restockingFeePercent?: number;
    returnShippingFee?: number;
  };
  /**
   * The merchant's own finding on whose failure this return was, recorded
   * alongside the shopper's stated reason rather than replacing it.
   *
   * The reason is the shopper's account; this is what someone found when they
   * opened the parcel. Keeping both is what makes a disputed return reviewable.
   */
  faultOverride?: {
    merchantAtFault: boolean;
    note?: string;
    setBy: string;
    setAt: Date;
  };
  /**
   * Whose money this refund comes out of — see `resolveRefundPayer`.
   *
   * Stamped at creation because custody never moves after checkout, and read
   * by every screen that has to say who owes the shopper. Absent on every
   * return that predates it, which reads as `platform`: what the whole system
   * assumed before.
   */
  refundPayer?: string;
  refundDestination?: ReturnRequestRefundDestination;
  /** What the store will send instead of the money (R7), before it is processed. */
  exchangeItems?: ReturnExchangeItem[];
  /** The exchange order's delivery charge, set by the store; nothing when absent. */
  exchangeDelivery?: number;
  exchange?: ReturnExchange;
  /** Set while an exchange is being processed on the return — see `exchangeFreeOnReturn`. */
  exchangeClaimedAt?: Date;
  actualRefund?: {
    amount?: number;
    /** The latest refund row. */
    paymentTransactionId?: mongoose.Types.ObjectId;
    /** Every refund row issued on this return, for a failure to find it by. */
    paymentTransactionIds?: mongoose.Types.ObjectId[];
    provider?: string;
    externalRefundId?: string;
    /**
     * How much of `amount` the shopper was given as store credit (R8) rather
     * than sent back the way they paid. A running total, as `amount` is.
     */
    storeCredit?: number;
    /**
     * How much of `amount` paid for the exchange order (R7) — see `exchange`.
     * A running total, as `amount` is; it comes back off both if that order
     * is called off.
     */
    exchange?: number;
    /**
     * How the money physically reached the shopper on a refund no gateway
     * carried. Until this is set, `manual_required` means nothing has moved —
     * which is the distinction the status alone could never make.
     */
    settledMethod?: string;
    settledReference?: string;
    settledAt?: Date;
    settledBy?: string;
  };
  /**
   * Who opened the return: the shopper from their account, or the store or a
   * seller on the shopper's behalf. Absent on returns from before stores could
   * open them, all of which the shopper opened.
   */
  openedBy?: "customer" | "staff" | "vendor";
  /**
   * The store opening a return the rules would have refused — past the return
   * window — and why. Only an admin, or staff given the permission, can.
   */
  eligibilityOverride?: {
    note?: string;
    by?: string;
    at?: Date;
  };
  /**
   * The checkout email of a guest order, whose shopper has no account: marks
   * the return as a guest's, reached through what the order recorded. Signing
   * up with the email moves the return onto the account with the order.
   */
  guestEmail?: string;
  /**
   * How the goods come back, chosen when the return is approved — see
   * lib/returns/return-shipping.ts. Absent on a return approved before the
   * question was asked, which reads as the shopper posting it.
   */
  returnMethod?: ReturnMethod;
  /**
   * Where the parcel goes, copied from the location when the return was
   * approved, so moving or renaming the location later does not re-address a
   * parcel already on its way.
   */
  returnTo?: {
    locationId?: mongoose.Types.ObjectId;
    name?: string;
    address?: string;
  } | null;
  /**
   * The store's own return instructions as they stood at approval. Absent when
   * it had written none, and the shopper is shown the default wording.
   */
  returnInstructions?: string | null;
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    /** A label the store linked to rather than uploaded. */
    labelUrl?: string;
    /** A label the store uploaded, kept in private storage. */
    labelFileKey?: string;
    labelFileName?: string;
    labelAddedAt?: Date;
    /** Who typed the tracking number in: the shopper who posted it, or staff. */
    trackingAddedBy?: "customer" | "staff";
    trackingAddedAt?: Date;
    shippedAt?: Date;
    deliveredAt?: Date;
  };
  /**
   * The whole return is back on the shelf and nothing more goes back: it was
   * restocked the one-time way returns were before they could be restocked
   * in steps, or an order-wide restock covered it (`restockedByOrderAt`).
   */
  inventoryRestored?: boolean;
  /**
   * What each restock put back, so an order-wide restock can leave it out and
   * the ledger can replay it. One entry per line per step; entries from before
   * steps carry no `step`.
   */
  restockedLines?: Array<{
    productId: mongoose.Types.ObjectId;
    variantId?: mongoose.Types.ObjectId;
    quantity: number;
    orderItemIndex?: number;
    /** Where the units were put: the location chosen, when one was. */
    locationId?: string;
    step?: string;
    at?: Date;
    by?: string;
  }>;
  /**
   * When an order-wide restock (a full refund with "restock" ticked) put this
   * return's goods back, so the return itself never does it a second time.
   */
  restockedByOrderAt?: Date;
  /**
   * What became of the units the count found unsellable: each entry moves some
   * of one line's units out of "Unavailable" — back to sale, or written off.
   * Append-only; see `lib/returns/held-units.ts`.
   */
  unsellableDispositions?: ReturnUnsellableDisposition[];
  /**
   * When a refund on the order itself paid for this return's goods and so
   * closed it, and the refund row that did — so the return is never refunded
   * a second time, and anyone reading it can see where its money went.
   */
  refundedByOrderAt?: Date;
  refundedByOrderTransactionId?: mongoose.Types.ObjectId;
  createdBy: string;
  updatedBy?: string;
  requestedAt: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  receivedAt?: Date;
  /**
   * When the units that came back were counted line by line. "Mark received"
   * sets only `receivedAt` and leaves every `quantityReceived` at 0, so the
   * counts mean something only once this is set.
   */
  itemsCountedAt?: Date;
  inspectedAt?: Date;
  refundedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReturnRequestItemSchema = new Schema<ReturnRequestItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    orderItemIndex: { type: Number, required: true, min: 0 },
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    quantityOrdered: { type: Number, required: true, min: 1 },
    quantityRequested: { type: Number, required: true, min: 1 },
    quantityApproved: { type: Number, required: true, min: 0, default: 0 },
    quantityReceived: { type: Number, required: true, min: 0, default: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    image: { type: String },
    condition: {
      type: String,
      enum: ["new", "opened", "damaged", "missing_parts", "unusable"],
    },
    restockable: { type: Boolean, default: false },
    quantityRestocked: { type: Number, min: 0 },
  },
  { _id: false },
);

const RefundEstimateSchema = new Schema<ReturnRequestRefundEstimate>(
  {
    itemsSubtotal: { type: Number, required: true, min: 0 },
    shipping: { type: Number, required: true, min: 0, default: 0 },
    tax: { type: Number, required: true, min: 0, default: 0 },
    discountAdjustment: { type: Number, required: true, min: 0, default: 0 },
    restockingFee: { type: Number, required: true, min: 0, default: 0 },
    returnShippingFee: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, default: "USD" },
  },
  { _id: false },
);

const ReturnExchangeItemSchema = new Schema<ReturnExchangeItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    name: { type: String, required: true, trim: true, maxlength: 300 },
    sku: { type: String, trim: true },
    image: { type: String },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    listPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const ReturnExchangeSchema = new Schema<ReturnExchange>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true, trim: true },
    credit: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    owed: { type: Number, required: true, min: 0 },
    statusBefore: { type: String, trim: true },
    refundTransactionId: { type: Schema.Types.ObjectId, ref: "PaymentTransaction" },
    processedAt: { type: Date },
    processedBy: { type: String, trim: true },
    undoneAt: { type: Date },
    undoneReason: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const ReturnRequestSchema = new Schema<IReturnRequest>(
  {
    returnNumber: { type: String, required: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ownerType: {
      type: String,
      enum: ["admin", "vendor"],
      default: "admin",
    },
    ownerVendorId: { type: Schema.Types.ObjectId, ref: "Vendor", index: true },
    vendorIds: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
    status: {
      type: String,
      enum: Object.values(RETURN_STATUS),
      default: RETURN_STATUS.REQUESTED,
      index: true,
    },
    refundStatus: {
      type: String,
      enum: Object.values(RETURN_REFUND_STATUS),
      default: RETURN_REFUND_STATUS.PENDING,
      index: true,
    },
    reason: { type: String, required: true, trim: true, maxlength: 100 },
    customerNote: { type: String, trim: true, maxlength: 1000 },
    adminNote: { type: String, trim: true, maxlength: 2000 },
    vendorNote: { type: String, trim: true, maxlength: 2000 },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
    declineReason: { type: String, enum: RETURN_DECLINE_REASONS },
    items: { type: [ReturnRequestItemSchema], required: true },
    estimatedRefund: { type: RefundEstimateSchema, required: true },
    feeOverride: {
      type: new Schema(
        {
          restockingFee: { type: Number, min: 0 },
          returnShippingFee: { type: Number, min: 0 },
          setBy: { type: String, trim: true },
          setAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
    deliveryOverride: {
      type: new Schema(
        {
          amount: { type: Number, min: 0, required: true },
          setBy: { type: String, trim: true },
          setAt: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
    policyApplied: {
      type: new Schema(
        {
          shippingRefund: { type: String, trim: true },
          restockingFeePercent: { type: Number, min: 0, max: 100 },
          returnShippingFee: { type: Number, min: 0 },
        },
        { _id: false },
      ),
      required: false,
    },
    faultOverride: {
      merchantAtFault: { type: Boolean },
      note: { type: String, trim: true, maxlength: 500 },
      setBy: { type: String, trim: true },
      setAt: { type: Date },
    },
    refundPayer: {
      type: String,
      enum: REFUND_PAYERS,
    },
    refundDestination: {
      type: new Schema<ReturnRequestRefundDestination>(
        {
          method: {
            type: String,
            enum: REFUND_DESTINATION_METHODS,
            required: true,
          },
          accountName: { type: String, trim: true, maxlength: 120 },
          accountNumber: { type: String, trim: true, maxlength: 64 },
          provider: { type: String, trim: true, maxlength: 120 },
          note: { type: String, trim: true, maxlength: 500 },
          providedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      required: false,
    },
    exchangeItems: { type: [ReturnExchangeItemSchema], default: undefined },
    exchangeDelivery: { type: Number, min: 0 },
    exchange: { type: ReturnExchangeSchema, default: undefined },
    exchangeClaimedAt: { type: Date },
    actualRefund: {
      amount: { type: Number, min: 0 },
      paymentTransactionId: { type: Schema.Types.ObjectId, ref: "PaymentTransaction" },
      paymentTransactionIds: {
        type: [{ type: Schema.Types.ObjectId, ref: "PaymentTransaction" }],
        default: undefined,
      },
      provider: { type: String, trim: true },
      externalRefundId: { type: String, trim: true },
      storeCredit: { type: Number, min: 0 },
      exchange: { type: Number, min: 0 },
      settledMethod: { type: String, trim: true, maxlength: 40 },
      settledReference: { type: String, trim: true, maxlength: 200 },
      settledAt: { type: Date },
      settledBy: { type: String, trim: true },
    },
    openedBy: { type: String, enum: ["customer", "staff", "vendor"] },
    eligibilityOverride: {
      type: new Schema(
        {
          note: { type: String, trim: true, maxlength: 500 },
          by: { type: String, trim: true },
          at: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },
    guestEmail: { type: String, trim: true, lowercase: true, maxlength: 320 },
    returnMethod: { type: String, enum: RETURN_METHODS },
    returnTo: {
      type: new Schema(
        {
          locationId: { type: Schema.Types.ObjectId, ref: "InventoryLocation" },
          name: { type: String, trim: true, maxlength: 200 },
          address: { type: String, trim: true, maxlength: 600 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    returnInstructions: {
      type: String,
      trim: true,
      maxlength: RETURN_INSTRUCTIONS_MAX_LENGTH,
    },
    shipment: {
      carrier: { type: String, trim: true, maxlength: 100 },
      trackingNumber: { type: String, trim: true, maxlength: 100 },
      labelUrl: { type: String, trim: true, maxlength: 1000 },
      labelFileKey: { type: String, trim: true, maxlength: 512 },
      labelFileName: { type: String, trim: true, maxlength: 255 },
      labelAddedAt: { type: Date },
      trackingAddedBy: { type: String, enum: ["customer", "staff"] },
      trackingAddedAt: { type: Date },
      shippedAt: { type: Date },
      deliveredAt: { type: Date },
    },
    // Set atomically the first time returned items are restocked so a repeated
    // refund action can't restore the same quantities twice.
    inventoryRestored: { type: Boolean },
    restockedLines: {
      type: [
        new Schema(
          {
            productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
            variantId: { type: Schema.Types.ObjectId },
            quantity: { type: Number, required: true, min: 0 },
            orderItemIndex: { type: Number, min: 0 },
            locationId: { type: String, trim: true },
            step: { type: String, trim: true },
            at: { type: Date },
            by: { type: String, trim: true },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    restockedByOrderAt: { type: Date },
    unsellableDispositions: {
      type: [
        new Schema(
          {
            itemIndex: { type: Number, required: true, min: 0 },
            productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
            variantId: { type: Schema.Types.ObjectId },
            quantity: { type: Number, required: true, min: 1 },
            action: {
              type: String,
              enum: ["restocked", "written_off"],
              required: true,
            },
            at: { type: Date, required: true },
            by: { type: Schema.Types.ObjectId, ref: "User" },
          },
        ),
      ],
      default: undefined,
    },
    refundedByOrderAt: { type: Date },
    refundedByOrderTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentTransaction",
    },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, trim: true },
    requestedAt: { type: Date, default: Date.now, index: true },
    approvedAt: Date,
    rejectedAt: Date,
    receivedAt: Date,
    itemsCountedAt: Date,
    inspectedAt: Date,
    refundedAt: Date,
    closedAt: Date,
  },
  { timestamps: true },
);

ReturnRequestSchema.index({ customerId: 1, createdAt: -1 });
ReturnRequestSchema.index({ orderId: 1, status: 1 });
ReturnRequestSchema.index({ vendorIds: 1, createdAt: -1 });
ReturnRequestSchema.index({ ownerType: 1, ownerVendorId: 1, createdAt: -1 });
// Refund totals on the admin dashboard match succeeded refunds and bucket them
// by refundedAt; without this the card scanned every return request.
ReturnRequestSchema.index({ refundStatus: 1, refundedAt: -1 });

export const ReturnRequest =
  models.ReturnRequest ||
  model<IReturnRequest>("ReturnRequest", ReturnRequestSchema);

